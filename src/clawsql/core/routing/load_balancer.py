"""
Dynamic load balancer for MySQL read traffic.
"""

import asyncio
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from ..discovery.models import MySQLCluster, MySQLInstance
from ..monitoring.collector import InstanceMetrics, MetricsCollector
from .proxysql_manager import ProxySQLManager


@dataclass
class LoadMetrics:
    """Load metrics for routing decisions."""

    instance_id: str
    connections: int = 0
    max_connections: int = 0
    queries_per_second: float = 0.0
    avg_query_time_ms: float = 0.0
    cpu_usage: float = 0.0
    replication_lag: float = 0.0
    weight: float = 1.0

    @property
    def connection_usage_pct(self) -> float:
        """Get connection usage percentage."""
        if self.max_connections == 0:
            return 0.0
        return (self.connections / self.max_connections) * 100


class DynamicLoadBalancer:
    """
    Implements dynamic load balancing for read traffic.

    Monitors instance load and adjusts ProxySQL weights
    to distribute traffic optimally.
    """

    LOAD_WEIGHTS = {
        "connections": 0.3,
        "query_time": 0.3,
        "cpu_usage": 0.3,
        "replication_lag": 0.1,
    }

    def __init__(
        self,
        proxysql_manager: ProxySQLManager,
        metrics_collector: MetricsCollector,
        rebalance_threshold: float = 0.2,
        check_interval_seconds: float = 30.0,
        min_weight: int = 1,
        max_weight: int = 100,
    ):
        """
        Initialize the load balancer.

        Args:
            proxysql_manager: ProxySQL manager instance
            metrics_collector: Metrics collector instance
            rebalance_threshold: Threshold for triggering rebalance
            check_interval_seconds: Interval between rebalance checks
            min_weight: Minimum server weight
            max_weight: Maximum server weight
        """
        self.proxysql = proxysql_manager
        self.metrics = metrics_collector
        self.rebalance_threshold = rebalance_threshold
        self.check_interval = check_interval_seconds
        self.min_weight = min_weight
        self.max_weight = max_weight

        self._rebalance_task: Optional[asyncio.Task] = None
        self._running = False
        self._clusters: dict[str, MySQLCluster] = {}
        self._last_weights: dict[str, dict[str, int]] = {}

    async def start_rebalancing(self, clusters: list[MySQLCluster]) -> None:
        """
        Start automatic load rebalancing.

        Args:
            clusters: Clusters to monitor
        """
        if self._running:
            return

        self._running = True
        for cluster in clusters:
            self._clusters[cluster.cluster_id] = cluster

        self._rebalance_task = asyncio.create_task(self._rebalance_loop())

    async def stop_rebalancing(self) -> None:
        """Stop automatic load rebalancing."""
        self._running = False
        if self._rebalance_task:
            self._rebalance_task.cancel()
            try:
                await self._rebalance_task
            except asyncio.CancelledError:
                pass

    def calculate_weight(
        self,
        instance: MySQLInstance,
        metrics: Optional[InstanceMetrics],
    ) -> float:
        """
        Calculate load weight for an instance.

        Higher weight = more traffic.

        Args:
            instance: Instance to calculate for
            metrics: Current metrics for instance

        Returns:
            Calculated weight (0-1 scale)
        """
        if not metrics:
            return 0.5  # Default weight when no metrics

        score = 1.0

        # Connection factor (lower usage = higher score)
        if metrics.connections_max > 0:
            conn_usage = metrics.connections_current / metrics.connections_max
            conn_score = 1.0 - conn_usage
            score -= self.LOAD_WEIGHTS["connections"] * (1.0 - conn_score)

        # Query time factor (lower time = higher score)
        if metrics.queries_per_second > 0:
            # Normalize query time (simplified)
            query_score = min(1.0, 1000.0 / (metrics.queries_per_second + 1))
            score -= self.LOAD_WEIGHTS["query_time"] * (1.0 - query_score * 0.1)

        # CPU factor (lower usage = higher score)
        cpu_score = 1.0 - min(1.0, metrics.cpu_usage / 100.0)
        score -= self.LOAD_WEIGHTS["cpu_usage"] * (1.0 - cpu_score)

        # Replication lag factor (lower lag = higher score)
        if instance.is_replica and metrics.replication_lag_seconds is not None:
            lag_score = max(0.0, 1.0 - (metrics.replication_lag_seconds / 60.0))
            score -= self.LOAD_WEIGHTS["replication_lag"] * (1.0 - lag_score)

        return max(0.1, min(1.0, score))

    async def get_current_weights(
        self,
        hostgroup_id: int,
    ) -> dict[str, int]:
        """
        Get current weights from ProxySQL.

        Args:
            hostgroup_id: Hostgroup to query

        Returns:
            Dictionary of instance_id -> weight
        """
        servers = await self.proxysql.get_servers(hostgroup_id)
        weights = {}

        for server in servers:
            instance_id = f"{server.hostname}:{server.port}"
            weights[instance_id] = server.weight

        return weights

    async def rebalance_read_pool(
        self,
        hostgroup_id: int,
        instances: list[MySQLInstance],
    ) -> bool:
        """
        Rebalance weights in read pool based on load.

        Args:
            hostgroup_id: Reader hostgroup ID
            instances: Instances in the pool

        Returns:
            True if rebalanced
        """
        if not instances:
            return False

        # Calculate new weights
        calculated_weights: dict[str, float] = {}
        metrics_data: dict[str, LoadMetrics] = {}

        for instance in instances:
            metrics = self.metrics.get_latest_metrics(instance.instance_id)
            weight = self.calculate_weight(instance, metrics)
            calculated_weights[instance.instance_id] = weight

            load_metrics = LoadMetrics(
                instance_id=instance.instance_id,
                connections=metrics.connections_current if metrics else 0,
                max_connections=metrics.connections_max if metrics else 0,
                queries_per_second=metrics.queries_per_second if metrics else 0,
                cpu_usage=metrics.cpu_usage if metrics else 0,
                replication_lag=metrics.replication_lag_seconds if metrics else 0,
                weight=weight,
            )
            metrics_data[instance.instance_id] = load_metrics

        # Check if rebalancing is needed
        current_weights = await self.get_current_weights(hostgroup_id)
        if not self.should_rebalance(current_weights, calculated_weights):
            return False

        # Calculate final weights (scale to min/max range)
        total_score = sum(calculated_weights.values())
        if total_score == 0:
            return False

        for instance_id, score in calculated_weights.items():
            # Normalize and scale
            normalized = score / total_score
            final_weight = int(
                self.min_weight + normalized * (self.max_weight - self.min_weight)
            )
            final_weight = max(self.min_weight, min(self.max_weight, final_weight))

            # Update weight
            instance = next(
                (i for i in instances if i.instance_id == instance_id), None
            )
            if instance:
                await self.proxysql.update_server_weight(
                    instance, final_weight, hostgroup_id
                )

        # Load to runtime
        await self.proxysql.load_config_to_runtime()

        # Store new weights
        self._last_weights[str(hostgroup_id)] = {
            iid: int(w * 100) for iid, w in calculated_weights.items()
        }

        return True

    def should_rebalance(
        self,
        current_weights: dict[str, int],
        calculated_weights: dict[str, float],
    ) -> bool:
        """
        Determine if rebalancing is needed.

        Args:
            current_weights: Current ProxySQL weights
            calculated_weights: Newly calculated weights

        Returns:
            True if rebalancing should occur
        """
        if not current_weights or not calculated_weights:
            return True

        # Check for new or removed instances
        if set(current_weights.keys()) != set(calculated_weights.keys()):
            return True

        # Check for significant weight changes
        for instance_id in current_weights:
            current = current_weights.get(instance_id, 1)
            calculated = calculated_weights.get(instance_id, 0.5)

            # Scale calculated weight to same range
            scaled = calculated * 100

            # Check if change exceeds threshold
            if current > 0:
                change = abs(scaled - current) / current
                if change > self.rebalance_threshold:
                    return True

        return False

    async def get_load_distribution(
        self,
        hostgroup_id: int,
    ) -> dict[str, Any]:
        """
        Get current load distribution for a hostgroup.

        Args:
            hostgroup_id: Hostgroup to analyze

        Returns:
            Load distribution metrics
        """
        servers = await self.proxysql.get_servers(hostgroup_id)

        total_weight = sum(s.weight for s in servers)
        distribution = []

        for server in servers:
            pct = (server.weight / total_weight * 100) if total_weight > 0 else 0
            distribution.append(
                {
                    "instance_id": f"{server.hostname}:{server.port}",
                    "weight": server.weight,
                    "traffic_percent": round(pct, 2),
                    "status": server.status,
                }
            )

        return {
            "hostgroup_id": hostgroup_id,
            "total_weight": total_weight,
            "server_count": len(servers),
            "distribution": distribution,
        }

    async def set_instance_offline(
        self,
        instance: MySQLInstance,
        hostgroup_id: int,
        soft: bool = True,
    ) -> bool:
        """
        Set an instance offline in the load balancer.

        Args:
            instance: Instance to set offline
            hostgroup_id: Hostgroup ID
            soft: Use soft offline (allow existing connections)

        Returns:
            True if set offline
        """
        status = "OFFLINE_SOFT" if soft else "OFFLINE_HARD"
        return await self.proxysql.update_server_status(
            instance, status, hostgroup_id
        )

    async def set_instance_online(
        self,
        instance: MySQLInstance,
        hostgroup_id: int,
    ) -> bool:
        """
        Set an instance online in the load balancer.

        Args:
            instance: Instance to set online
            hostgroup_id: Hostgroup ID

        Returns:
            True if set online
        """
        return await self.proxysql.update_server_status(
            instance, "ONLINE", hostgroup_id
        )

    async def _rebalance_loop(self) -> None:
        """Background rebalancing loop."""
        while self._running:
            try:
                for cluster in self._clusters.values():
                    # Get reader hostgroup (simplified - would need proper tracking)
                    reader_hg = 20  # Default reader hostgroup

                    await self.rebalance_read_pool(
                        reader_hg, cluster.replicas
                    )

                await asyncio.sleep(self.check_interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Rebalance error: {e}")
                await asyncio.sleep(self.check_interval)

    def get_stats(self) -> dict[str, Any]:
        """Get load balancer statistics."""
        return {
            "running": self._running,
            "check_interval": self.check_interval,
            "rebalance_threshold": self.rebalance_threshold,
            "clusters_monitored": len(self._clusters),
            "last_weights": self._last_weights,
        }
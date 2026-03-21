"""
Metrics collector for MySQL instances.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..discovery.models import MySQLInstance


@dataclass
class InstanceMetrics:
    """Collected metrics for a MySQL instance."""

    instance_id: str
    timestamp: datetime = field(default_factory=datetime.utcnow)

    # Replication metrics
    replication_lag_seconds: float | None = None
    replication_io_running: bool = False
    replication_sql_running: bool = False
    seconds_behind_master: float | None = None

    # Connection metrics
    connections_current: int = 0
    connections_max: int = 0
    connections_active: int = 0
    threads_running: int = 0
    threads_connected: int = 0

    # Performance metrics
    queries_per_second: float = 0.0
    slow_queries_count: int = 0
    innodb_buffer_pool_usage: float = 0.0
    innodb_buffer_pool_hit_rate: float = 0.0

    # Resource metrics
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    disk_usage: float = 0.0
    disk_io_read_bytes: int = 0
    disk_io_write_bytes: int = 0

    # Additional metrics
    uptime_seconds: int = 0
    bytes_received: int = 0
    bytes_sent: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            "instance_id": self.instance_id,
            "timestamp": self.timestamp.isoformat(),
            "replication_lag_seconds": self.replication_lag_seconds,
            "replication_io_running": self.replication_io_running,
            "replication_sql_running": self.replication_sql_running,
            "seconds_behind_master": self.seconds_behind_master,
            "connections_current": self.connections_current,
            "connections_max": self.connections_max,
            "connections_active": self.connections_active,
            "threads_running": self.threads_running,
            "threads_connected": self.threads_connected,
            "queries_per_second": self.queries_per_second,
            "slow_queries_count": self.slow_queries_count,
            "innodb_buffer_pool_usage": self.innodb_buffer_pool_usage,
            "innodb_buffer_pool_hit_rate": self.innodb_buffer_pool_hit_rate,
            "cpu_usage": self.cpu_usage,
            "memory_usage": self.memory_usage,
            "disk_usage": self.disk_usage,
            "uptime_seconds": self.uptime_seconds,
        }


class MetricsCollector:
    """
    Collects metrics from MySQL instances.

    Provides periodic metric collection with configurable intervals
    and retention policies.
    """

    METRICS_QUERIES = {
        "global_status": "SHOW GLOBAL STATUS",
        "global_variables": "SHOW GLOBAL VARIABLES",
        "slave_status": "SHOW SLAVE STATUS",
        "processlist": "SHOW PROCESSLIST",
    }

    def __init__(
        self,
        collection_interval: float = 15.0,
        retention_hours: int = 24,
        connection_factory: callable | None = None,
    ):
        """
        Initialize the metrics collector.

        Args:
            collection_interval: Seconds between collections
            retention_hours: Hours to retain metrics history
            connection_factory: Factory function for MySQL connections
        """
        self.collection_interval = collection_interval
        self.retention_hours = retention_hours
        self.connection_factory = connection_factory
        self._metrics_history: dict[str, list[InstanceMetrics]] = {}
        self._collection_task: asyncio.Task | None = None
        self._running = False

    async def start(self, instances: list[MySQLInstance]) -> None:
        """
        Start background metrics collection.

        Args:
            instances: List of instances to collect from
        """
        if self._running:
            return

        self._running = True
        self._instances = instances
        self._collection_task = asyncio.create_task(
            self._collection_loop()
        )

    async def stop(self) -> None:
        """Stop background metrics collection."""
        self._running = False
        if self._collection_task:
            self._collection_task.cancel()
            try:
                await self._collection_task
            except asyncio.CancelledError:
                pass

    async def collect_instance(
        self,
        instance: MySQLInstance,
    ) -> InstanceMetrics:
        """
        Collect metrics from a single instance.

        Args:
            instance: MySQL instance to collect from

        Returns:
            InstanceMetrics with collected data
        """
        metrics = InstanceMetrics(
            instance_id=instance.instance_id,
            timestamp=datetime.utcnow(),
        )

        try:
            # In real implementation, connect to MySQL and run queries
            # For now, return mock data structure
            if self.connection_factory:
                conn = await self.connection_factory(instance)
                if conn:
                    # Collect global status
                    status = await self._query_status(conn)
                    metrics = self._parse_status(metrics, status)

                    # Collect replication status
                    replication = await self._query_replication(conn)
                    metrics = self._parse_replication(metrics, replication)

                    await conn.close()

            # Store in history
            if instance.instance_id not in self._metrics_history:
                self._metrics_history[instance.instance_id] = []
            self._metrics_history[instance.instance_id].append(metrics)

            # Prune old metrics
            self._prune_history(instance.instance_id)

        except Exception as e:
            # Log error but continue
            print(f"Error collecting metrics from {instance.instance_id}: {e}")

        return metrics

    def get_latest_metrics(
        self,
        instance_id: str,
    ) -> InstanceMetrics | None:
        """
        Get most recent metrics for an instance.

        Args:
            instance_id: Instance identifier

        Returns:
            Latest InstanceMetrics or None
        """
        history = self._metrics_history.get(instance_id, [])
        return history[-1] if history else None

    def get_metrics_history(
        self,
        instance_id: str,
        hours: int = 1,
    ) -> list[InstanceMetrics]:
        """
        Get historical metrics for an instance.

        Args:
            instance_id: Instance identifier
            hours: Number of hours of history

        Returns:
            List of InstanceMetrics
        """
        history = self._metrics_history.get(instance_id, [])
        cutoff = datetime.utcnow()

        return [
            m
            for m in history
            if (cutoff - m.timestamp).total_seconds() / 3600 <= hours
        ]

    async def _collection_loop(self) -> None:
        """Background collection loop."""
        while self._running:
            try:
                for instance in self._instances:
                    if self._running:
                        await self.collect_instance(instance)
                await asyncio.sleep(self.collection_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Collection error: {e}")
                await asyncio.sleep(self.collection_interval)

    async def _query_status(self, conn: Any) -> dict[str, Any]:
        """Query global status variables."""
        # Placeholder - real implementation would query MySQL
        return {}

    async def _query_replication(self, conn: Any) -> dict[str, Any] | None:
        """Query replication status."""
        # Placeholder - real implementation would query MySQL
        return None

    def _parse_status(
        self,
        metrics: InstanceMetrics,
        status: dict[str, Any],
    ) -> InstanceMetrics:
        """Parse MySQL status into metrics."""
        # Connections
        metrics.connections_current = int(status.get("Threads_connected", 0))
        metrics.connections_max = int(status.get("max_connections", 0))
        metrics.threads_running = int(status.get("Threads_running", 0))
        metrics.threads_connected = int(status.get("Threads_connected", 0))

        # Performance
        metrics.queries_per_second = float(status.get("Queries_per_second", 0))
        metrics.slow_queries_count = int(status.get("Slow_queries", 0))

        # InnoDB
        buffer_pool_reads = int(status.get("Innodb_buffer_pool_reads", 0))
        buffer_pool_read_requests = int(
            status.get("Innodb_buffer_pool_read_requests", 1)
        )
        if buffer_pool_read_requests > 0:
            metrics.innodb_buffer_pool_hit_rate = (
                1 - buffer_pool_reads / buffer_pool_read_requests
            ) * 100

        # Traffic
        metrics.bytes_received = int(status.get("Bytes_received", 0))
        metrics.bytes_sent = int(status.get("Bytes_sent", 0))
        metrics.uptime_seconds = int(status.get("Uptime", 0))

        return metrics

    def _parse_replication(
        self,
        metrics: InstanceMetrics,
        replication: dict[str, Any] | None,
    ) -> InstanceMetrics:
        """Parse replication status into metrics."""
        if replication:
            metrics.replication_io_running = replication.get(
                "Slave_IO_Running", "No"
            ) == "Yes"
            metrics.replication_sql_running = replication.get(
                "Slave_SQL_Running", "No"
            ) == "Yes"
            metrics.seconds_behind_master = replication.get("Seconds_Behind_Master")
            metrics.replication_lag_seconds = metrics.seconds_behind_master

        return metrics

    def _prune_history(self, instance_id: str) -> None:
        """Prune old metrics from history."""
        history = self._metrics_history.get(instance_id, [])
        if not history:
            return

        cutoff = datetime.utcnow()
        cutoff_seconds = self.retention_hours * 3600

        self._metrics_history[instance_id] = [
            m
            for m in history
            if (cutoff - m.timestamp).total_seconds() <= cutoff_seconds
        ]

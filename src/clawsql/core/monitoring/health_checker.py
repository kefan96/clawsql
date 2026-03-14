"""
Health checker for MySQL instances and clusters.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional

from ..discovery.models import MySQLCluster, MySQLInstance
from .collector import InstanceMetrics


class HealthStatus(Enum):
    """Health status levels."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class HealthCheck:
    """Definition of a health check."""

    name: str
    description: str
    critical_threshold: float
    warning_threshold: float
    check_interval_seconds: float = 10.0


@dataclass
class HealthCheckResult:
    """Result of a health check."""

    check_name: str
    status: HealthStatus
    value: float
    message: str
    timestamp: datetime
    instance_id: str
    threshold: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "check_name": self.check_name,
            "status": self.status.value,
            "value": self.value,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "instance_id": self.instance_id,
            "threshold": self.threshold,
        }


class HealthChecker:
    """
    Performs health checks on MySQL instances and clusters.

    Provides configurable health checks with threshold-based
    status evaluation and alert generation.
    """

    DEFAULT_CHECKS: dict[str, HealthCheck] = {
        "replication_lag": HealthCheck(
            name="replication_lag",
            description="Replication lag in seconds",
            critical_threshold=60.0,
            warning_threshold=30.0,
            check_interval_seconds=10.0,
        ),
        "connection_usage": HealthCheck(
            name="connection_usage",
            description="Connection pool usage percentage",
            critical_threshold=90.0,
            warning_threshold=75.0,
            check_interval_seconds=30.0,
        ),
        "replication_io": HealthCheck(
            name="replication_io",
            description="Replication IO thread status",
            critical_threshold=0.0,  # 0 = stopped = critical
            warning_threshold=1.0,  # 1 = running
            check_interval_seconds=10.0,
        ),
        "replication_sql": HealthCheck(
            name="replication_sql",
            description="Replication SQL thread status",
            critical_threshold=0.0,
            warning_threshold=1.0,
            check_interval_seconds=10.0,
        ),
        "innodb_buffer_pool": HealthCheck(
            name="innodb_buffer_pool",
            description="InnoDB buffer pool hit rate",
            critical_threshold=90.0,  # Below 90% is critical
            warning_threshold=95.0,
            check_interval_seconds=60.0,
        ),
        "seconds_behind_master": HealthCheck(
            name="seconds_behind_master",
            description="Seconds behind master",
            critical_threshold=300.0,
            warning_threshold=60.0,
            check_interval_seconds=10.0,
        ),
    }

    def __init__(
        self,
        custom_checks: Optional[dict[str, HealthCheck]] = None,
    ):
        """
        Initialize the health checker.

        Args:
            custom_checks: Additional custom health checks
        """
        self.checks = {**self.DEFAULT_CHECKS, **(custom_checks or {})}
        self._alert_handlers: list[Callable[[HealthCheckResult], None]] = []

    def register_alert_handler(
        self,
        handler: Callable[[HealthCheckResult], None],
    ) -> None:
        """
        Register a handler for health check alerts.

        Args:
            handler: Async function to handle alerts
        """
        self._alert_handlers.append(handler)

    async def check_instance(
        self,
        instance: MySQLInstance,
        metrics: InstanceMetrics,
    ) -> list[HealthCheckResult]:
        """
        Run all applicable health checks on an instance.

        Args:
            instance: MySQL instance to check
            metrics: Current metrics for the instance

        Returns:
            List of health check results
        """
        results: list[HealthCheckResult] = []

        # Run replication checks for replicas
        if instance.is_replica:
            results.extend(self._check_replication(instance, metrics))

        # Run general checks for all instances
        results.extend(self._check_connections(instance, metrics))
        results.extend(self._check_buffer_pool(instance, metrics))

        # Notify handlers
        for result in results:
            if result.status != HealthStatus.HEALTHY:
                for handler in self._alert_handlers:
                    try:
                        handler(result)
                    except Exception:
                        pass

        return results

    async def check_cluster(
        self,
        cluster: MySQLCluster,
        metrics: dict[str, InstanceMetrics],
    ) -> dict[str, list[HealthCheckResult]]:
        """
        Run health checks on entire cluster.

        Args:
            cluster: MySQL cluster to check
            metrics: Dictionary of instance_id -> metrics

        Returns:
            Dictionary of instance_id -> health check results
        """
        results: dict[str, list[HealthCheckResult]] = {}

        # Check primary
        if cluster.primary:
            primary_metrics = metrics.get(cluster.primary.instance_id)
            if primary_metrics:
                results[cluster.primary.instance_id] = await self.check_instance(
                    cluster.primary, primary_metrics
                )

        # Check replicas
        for replica in cluster.replicas:
            replica_metrics = metrics.get(replica.instance_id)
            if replica_metrics:
                results[replica.instance_id] = await self.check_instance(
                    replica, replica_metrics
                )

        return results

    def evaluate_check(
        self,
        check: HealthCheck,
        value: float,
        instance_id: str,
    ) -> HealthCheckResult:
        """
        Evaluate a single check against thresholds.

        Args:
            check: Health check definition
            value: Current value
            instance_id: Instance being checked

        Returns:
            HealthCheckResult with status
        """
        timestamp = datetime.utcnow()
        status = HealthStatus.HEALTHY
        message = f"{check.description}: {value}"

        # Special handling for different check types
        if check.name in ("replication_io", "replication_sql"):
            # For these, 1 = running = healthy, 0 = stopped = critical
            if value == 0:
                status = HealthStatus.CRITICAL if hasattr(HealthStatus, "CRITICAL") else HealthStatus.UNHEALTHY
                message = f"{check.description} is stopped"
            else:
                status = HealthStatus.HEALTHY
                message = f"{check.description} is running"
        elif check.name == "innodb_buffer_pool":
            # For buffer pool, lower is worse
            if value < check.critical_threshold:
                status = HealthStatus.UNHEALTHY
                message = f"Buffer pool hit rate {value:.1f}% is below critical threshold"
            elif value < check.warning_threshold:
                status = HealthStatus.DEGRADED
                message = f"Buffer pool hit rate {value:.1f}% is below warning threshold"
        else:
            # Standard threshold check (higher is worse)
            if value >= check.critical_threshold:
                status = HealthStatus.UNHEALTHY
                message = f"{check.description} {value} exceeds critical threshold"
            elif value >= check.warning_threshold:
                status = HealthStatus.DEGRADED
                message = f"{check.description} {value} exceeds warning threshold"

        return HealthCheckResult(
            check_name=check.name,
            status=status,
            value=value,
            message=message,
            timestamp=timestamp,
            instance_id=instance_id,
            threshold=check.warning_threshold,
        )

    def _check_replication(
        self,
        instance: MySQLInstance,
        metrics: InstanceMetrics,
    ) -> list[HealthCheckResult]:
        """Check replication health."""
        results: list[HealthCheckResult] = []

        # Check replication lag
        if metrics.replication_lag_seconds is not None:
            check = self.checks["replication_lag"]
            results.append(
                self.evaluate_check(
                    check,
                    metrics.replication_lag_seconds,
                    instance.instance_id,
                )
            )

        # Check IO thread
        io_check = self.checks["replication_io"]
        io_value = 1.0 if metrics.replication_io_running else 0.0
        results.append(
            self.evaluate_check(io_check, io_value, instance.instance_id)
        )

        # Check SQL thread
        sql_check = self.checks["replication_sql"]
        sql_value = 1.0 if metrics.replication_sql_running else 0.0
        results.append(
            self.evaluate_check(sql_check, sql_value, instance.instance_id)
        )

        # Check seconds behind master
        if metrics.seconds_behind_master is not None:
            check = self.checks["seconds_behind_master"]
            results.append(
                self.evaluate_check(
                    check,
                    metrics.seconds_behind_master,
                    instance.instance_id,
                )
            )

        return results

    def _check_connections(
        self,
        instance: MySQLInstance,
        metrics: InstanceMetrics,
    ) -> list[HealthCheckResult]:
        """Check connection pool health."""
        results: list[HealthCheckResult] = []

        if metrics.connections_max > 0:
            usage_pct = (
                metrics.connections_current / metrics.connections_max
            ) * 100
            check = self.checks["connection_usage"]
            results.append(
                self.evaluate_check(check, usage_pct, instance.instance_id)
            )

        return results

    def _check_buffer_pool(
        self,
        instance: MySQLInstance,
        metrics: InstanceMetrics,
    ) -> list[HealthCheckResult]:
        """Check InnoDB buffer pool health."""
        results: list[HealthCheckResult] = []

        if metrics.innodb_buffer_pool_hit_rate > 0:
            check = self.checks["innodb_buffer_pool"]
            results.append(
                self.evaluate_check(
                    check,
                    metrics.innodb_buffer_pool_hit_rate,
                    instance.instance_id,
                )
            )

        return results

    def get_instance_health_summary(
        self,
        results: list[HealthCheckResult],
    ) -> HealthStatus:
        """
        Get overall health status from check results.

        Args:
            results: List of health check results

        Returns:
            Overall HealthStatus
        """
        if not results:
            return HealthStatus.UNKNOWN

        statuses = [r.status for r in results]

        if HealthStatus.UNHEALTHY in statuses:
            return HealthStatus.UNHEALTHY
        elif HealthStatus.DEGRADED in statuses:
            return HealthStatus.DEGRADED
        else:
            return HealthStatus.HEALTHY
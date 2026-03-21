"""
Prometheus metrics exporter.
"""


from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, Info

from ..discovery.models import MySQLCluster, MySQLInstance
from .alert_manager import AlertSeverity
from .collector import InstanceMetrics
from .health_checker import HealthStatus


class PrometheusExporter:
    """
    Exports metrics in Prometheus format.

    Provides Prometheus-compatible metrics for ClawSQL
    operations and MySQL cluster state.
    """

    def __init__(self, registry: CollectorRegistry | None = None):
        """
        Initialize the Prometheus exporter.

        Args:
            registry: Optional custom Prometheus registry
        """
        self.registry = registry or CollectorRegistry()
        self._setup_metrics()

    def _setup_metrics(self) -> None:
        """Initialize Prometheus metrics."""
        # MySQL instance metrics
        self.mysql_replication_lag = Gauge(
            "clawsql_mysql_replication_lag_seconds",
            "Replication lag in seconds",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_connections = Gauge(
            "clawsql_mysql_connections_current",
            "Current number of connections",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_connections_max = Gauge(
            "clawsql_mysql_connections_max",
            "Maximum connections",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_queries_per_second = Gauge(
            "clawsql_mysql_queries_per_second",
            "Queries per second",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_threads_running = Gauge(
            "clawsql_mysql_threads_running",
            "Number of running threads",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_innodb_buffer_pool_hit_rate = Gauge(
            "clawsql_mysql_innodb_buffer_pool_hit_rate",
            "InnoDB buffer pool hit rate percentage",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.mysql_uptime_seconds = Gauge(
            "clawsql_mysql_uptime_seconds",
            "MySQL server uptime in seconds",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        # Health metrics
        self.instance_health = Gauge(
            "clawsql_instance_health_status",
            "Instance health status (1=healthy, 0.5=degraded, 0=unhealthy)",
            ["instance_host", "instance_port", "cluster_id"],
            registry=self.registry,
        )

        self.cluster_health = Gauge(
            "clawsql_cluster_health_status",
            "Cluster health status (1=healthy, 0.5=degraded, 0=unhealthy)",
            ["cluster_id"],
            registry=self.registry,
        )

        # Failover metrics
        self.failover_operations = Counter(
            "clawsql_failover_operations_total",
            "Total number of failover operations",
            ["cluster_id", "status"],
            registry=self.registry,
        )

        self.failover_duration = Histogram(
            "clawsql_failover_duration_seconds",
            "Duration of failover operations",
            ["cluster_id"],
            registry=self.registry,
        )

        self.failover_in_progress = Gauge(
            "clawsql_failover_in_progress",
            "Whether a failover is currently in progress",
            ["cluster_id"],
            registry=self.registry,
        )

        # Alert metrics
        self.active_alerts = Gauge(
            "clawsql_active_alerts_total",
            "Number of active alerts",
            ["severity"],
            registry=self.registry,
        )

        self.alerts_triggered = Counter(
            "clawsql_alerts_triggered_total",
            "Total alerts triggered",
            ["severity", "check_name"],
            registry=self.registry,
        )

        # Discovery metrics
        self.instances_discovered = Gauge(
            "clawsql_instances_discovered_total",
            "Total discovered instances",
            ["cluster_id"],
            registry=self.registry,
        )

        self.discovery_operations = Counter(
            "clawsql_discovery_operations_total",
            "Total discovery operations",
            ["status"],
            registry=self.registry,
        )

        # API metrics
        self.api_requests = Counter(
            "clawsql_api_requests_total",
            "Total API requests",
            ["method", "endpoint", "status_code"],
            registry=self.registry,
        )

        self.api_request_duration = Histogram(
            "clawsql_api_request_duration_seconds",
            "API request duration",
            ["method", "endpoint"],
            registry=self.registry,
        )

        # System info
        self.system_info = Info(
            "clawsql",
            "ClawSQL system information",
            registry=self.registry,
        )
        self.system_info.info({"version": "0.1.0"})

    def update_metrics(
        self,
        instance: MySQLInstance,
        metrics: InstanceMetrics,
    ) -> None:
        """
        Update Prometheus metrics from collected instance metrics.

        Args:
            instance: MySQL instance
            metrics: Collected metrics
        """
        labels = {
            "instance_host": instance.host,
            "instance_port": str(instance.port),
            "cluster_id": instance.cluster_id or "unknown",
        }

        # Update gauges
        if metrics.replication_lag_seconds is not None:
            self.mysql_replication_lag.labels(**labels).set(
                metrics.replication_lag_seconds
            )

        self.mysql_connections.labels(**labels).set(metrics.connections_current)
        self.mysql_connections_max.labels(**labels).set(metrics.connections_max)
        self.mysql_queries_per_second.labels(**labels).set(metrics.queries_per_second)
        self.mysql_threads_running.labels(**labels).set(metrics.threads_running)
        self.mysql_innodb_buffer_pool_hit_rate.labels(**labels).set(
            metrics.innodb_buffer_pool_hit_rate
        )
        self.mysql_uptime_seconds.labels(**labels).set(metrics.uptime_seconds)

    def update_health_status(
        self,
        instance: MySQLInstance,
        status: HealthStatus,
    ) -> None:
        """
        Update instance health status metric.

        Args:
            instance: MySQL instance
            status: Health status
        """
        labels = {
            "instance_host": instance.host,
            "instance_port": str(instance.port),
            "cluster_id": instance.cluster_id or "unknown",
        }

        status_values = {
            HealthStatus.HEALTHY: 1.0,
            HealthStatus.DEGRADED: 0.5,
            HealthStatus.UNHEALTHY: 0.0,
            HealthStatus.UNKNOWN: -1.0,
        }

        self.instance_health.labels(**labels).set(
            status_values.get(status, -1.0)
        )

    def update_cluster_health(
        self,
        cluster: MySQLCluster,
    ) -> None:
        """
        Update cluster health status metric.

        Args:
            cluster: MySQL cluster
        """
        status_values = {
            HealthStatus.HEALTHY: 1.0,
            HealthStatus.DEGRADED: 0.5,
            HealthStatus.UNHEALTHY: 0.0,
            HealthStatus.UNKNOWN: -1.0,
        }

        self.cluster_health.labels(cluster_id=cluster.cluster_id).set(
            status_values.get(cluster.health_status, -1.0)
        )

        self.instances_discovered.labels(cluster_id=cluster.cluster_id).set(
            cluster.instance_count
        )

    def record_failover(
        self,
        cluster_id: str,
        success: bool,
        duration_seconds: float,
    ) -> None:
        """
        Record a failover operation.

        Args:
            cluster_id: Cluster identifier
            success: Whether failover succeeded
            duration_seconds: Failover duration
        """
        status = "success" if success else "failed"
        self.failover_operations.labels(
            cluster_id=cluster_id,
            status=status,
        ).inc()

        self.failover_duration.labels(cluster_id=cluster_id).observe(
            duration_seconds
        )

    def set_failover_in_progress(
        self,
        cluster_id: str,
        in_progress: bool,
    ) -> None:
        """
        Set failover in progress status.

        Args:
            cluster_id: Cluster identifier
            in_progress: Whether failover is in progress
        """
        self.failover_in_progress.labels(cluster_id=cluster_id).set(
            1 if in_progress else 0
        )

    def update_alerts(
        self,
        critical_count: int,
        warning_count: int,
        info_count: int,
    ) -> None:
        """
        Update active alerts metrics.

        Args:
            critical_count: Number of critical alerts
            warning_count: Number of warning alerts
            info_count: Number of info alerts
        """
        self.active_alerts.labels(severity="critical").set(critical_count)
        self.active_alerts.labels(severity="warning").set(warning_count)
        self.active_alerts.labels(severity="info").set(info_count)

    def record_alert_triggered(
        self,
        severity: AlertSeverity,
        check_name: str,
    ) -> None:
        """
        Record an alert being triggered.

        Args:
            severity: Alert severity
            check_name: Name of the check that triggered
        """
        self.alerts_triggered.labels(
            severity=severity.value,
            check_name=check_name,
        ).inc()

    def record_api_request(
        self,
        method: str,
        endpoint: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        """
        Record an API request.

        Args:
            method: HTTP method
            endpoint: API endpoint
            status_code: Response status code
            duration_seconds: Request duration
        """
        self.api_requests.labels(
            method=method,
            endpoint=endpoint,
            status_code=str(status_code),
        ).inc()

        self.api_request_duration.labels(
            method=method,
            endpoint=endpoint,
        ).observe(duration_seconds)

    def record_discovery(
        self,
        status: str,
    ) -> None:
        """
        Record a discovery operation.

        Args:
            status: Discovery status (success/failed)
        """
        self.discovery_operations.labels(status=status).inc()

    def get_metrics_output(self) -> str:
        """
        Generate Prometheus metrics output.

        Returns:
            Prometheus-formatted metrics string
        """
        from prometheus_client import generate_latest

        return generate_latest(self.registry).decode("utf-8")

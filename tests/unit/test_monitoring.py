"""Unit tests for monitoring module - collector, health_checker, alert_manager, exporters."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from clawsql.core.discovery.models import (
    InstanceRole,
    InstanceState,
    MySQLCluster,
    MySQLInstance,
)
from clawsql.core.monitoring.alert_manager import Alert, AlertManager, AlertSeverity
from clawsql.core.monitoring.collector import InstanceMetrics, MetricsCollector
from clawsql.core.monitoring.exporters import PrometheusExporter
from clawsql.core.monitoring.health_checker import (
    HealthCheck,
    HealthChecker,
    HealthCheckResult,
    HealthStatus,
)


class TestInstanceMetrics:
    """Tests for InstanceMetrics dataclass."""

    def test_metrics_creation(self) -> None:
        """Test creating instance metrics."""
        metrics = InstanceMetrics(
            instance_id="mysql-primary:3306",
            connections_current=10,
            connections_max=100,
        )

        assert metrics.instance_id == "mysql-primary:3306"
        assert metrics.connections_current == 10
        assert metrics.connections_max == 100

    def test_metrics_defaults(self) -> None:
        """Test default values for metrics."""
        metrics = InstanceMetrics(instance_id="test:3306")

        assert metrics.replication_lag_seconds is None
        assert metrics.replication_io_running is False
        assert metrics.replication_sql_running is False
        assert metrics.connections_current == 0
        assert metrics.queries_per_second == 0.0

    def test_metrics_to_dict(self) -> None:
        """Test metrics to_dict conversion."""
        metrics = InstanceMetrics(
            instance_id="mysql-primary:3306",
            connections_current=10,
            connections_max=100,
            queries_per_second=150.5,
        )

        result = metrics.to_dict()

        assert result["instance_id"] == "mysql-primary:3306"
        assert result["connections_current"] == 10
        assert result["connections_max"] == 100
        assert result["queries_per_second"] == 150.5
        assert "timestamp" in result


class TestMetricsCollector:
    """Tests for MetricsCollector class."""

    def test_collector_initialization(self) -> None:
        """Test collector initialization."""
        collector = MetricsCollector(
            collection_interval=30.0,
            retention_hours=48,
        )

        assert collector.collection_interval == 30.0
        assert collector.retention_hours == 48

    def test_collector_defaults(self) -> None:
        """Test default collector values."""
        collector = MetricsCollector()

        assert collector.collection_interval == 15.0
        assert collector.retention_hours == 24

    @pytest.mark.asyncio
    async def test_collect_instance(self) -> None:
        """Test collecting metrics from instance."""
        collector = MetricsCollector()
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            role=InstanceRole.PRIMARY,
        )

        metrics = await collector.collect_instance(instance)

        assert metrics.instance_id == "mysql-primary:3306"

    @pytest.mark.asyncio
    async def test_collect_instance_with_connection(self) -> None:
        """Test collecting metrics with connection factory."""
        collector = MetricsCollector()
        instance = MySQLInstance(host="mysql-primary", port=3306)

        mock_conn = AsyncMock()
        mock_conn.close = AsyncMock()

        async def connection_factory(inst):
            return mock_conn

        collector.connection_factory = connection_factory

        with patch.object(collector, "_query_status", return_value={}):
            with patch.object(collector, "_query_replication", return_value=None):
                metrics = await collector.collect_instance(instance)

        assert metrics.instance_id == "mysql-primary:3306"

    def test_get_latest_metrics(self) -> None:
        """Test getting latest metrics."""
        collector = MetricsCollector()

        # No metrics yet
        assert collector.get_latest_metrics("nonexistent") is None

        # Add metrics
        metrics1 = InstanceMetrics(instance_id="test:3306", connections_current=5)
        metrics2 = InstanceMetrics(instance_id="test:3306", connections_current=10)

        collector._metrics_history["test:3306"] = [metrics1, metrics2]

        latest = collector.get_latest_metrics("test:3306")
        assert latest == metrics2

    def test_get_metrics_history(self) -> None:
        """Test getting metrics history."""
        collector = MetricsCollector(retention_hours=1)

        # Add historical metrics
        now = datetime.utcnow()
        old_metrics = InstanceMetrics(
            instance_id="test:3306",
            timestamp=now - timedelta(hours=2),
        )
        recent_metrics = InstanceMetrics(
            instance_id="test:3306",
            timestamp=now - timedelta(minutes=30),
        )

        collector._metrics_history["test:3306"] = [old_metrics, recent_metrics]

        history = collector.get_metrics_history("test:3306", hours=1)

        assert len(history) == 1
        assert history[0] == recent_metrics

    def test_prune_history(self) -> None:
        """Test pruning old metrics."""
        collector = MetricsCollector(retention_hours=1)

        now = datetime.utcnow()
        old_metrics = InstanceMetrics(
            instance_id="test:3306",
            timestamp=now - timedelta(hours=2),
        )
        new_metrics = InstanceMetrics(
            instance_id="test:3306",
            timestamp=now,
        )

        collector._metrics_history["test:3306"] = [old_metrics, new_metrics]
        collector._prune_history("test:3306")

        assert len(collector._metrics_history["test:3306"]) == 1
        assert collector._metrics_history["test:3306"][0] == new_metrics

    def test_parse_status(self) -> None:
        """Test parsing MySQL status."""
        collector = MetricsCollector()
        metrics = InstanceMetrics(instance_id="test:3306")

        status = {
            "Threads_connected": "50",
            "Threads_running": "5",
            "max_connections": "1000",
            "Queries_per_second": "250.5",
            "Slow_queries": "10",
            "Innodb_buffer_pool_reads": "100",
            "Innodb_buffer_pool_read_requests": "10000",
            "Uptime": "86400",
        }

        result = collector._parse_status(metrics, status)

        assert result.connections_current == 50
        assert result.threads_running == 5
        assert result.threads_connected == 50
        assert result.slow_queries_count == 10
        assert result.uptime_seconds == 86400
        # Hit rate = (1 - 100/10000) * 100 = 99%
        assert result.innodb_buffer_pool_hit_rate == pytest.approx(99.0, rel=0.1)

    def test_parse_replication(self) -> None:
        """Test parsing replication status."""
        collector = MetricsCollector()
        metrics = InstanceMetrics(instance_id="test:3306")

        replication = {
            "Slave_IO_Running": "Yes",
            "Slave_SQL_Running": "Yes",
            "Seconds_Behind_Master": 0.5,
        }

        result = collector._parse_replication(metrics, replication)

        assert result.replication_io_running is True
        assert result.replication_sql_running is True
        assert result.seconds_behind_master == 0.5
        assert result.replication_lag_seconds == 0.5


class TestHealthChecker:
    """Tests for HealthChecker class."""

    @pytest.fixture
    def health_checker(self) -> HealthChecker:
        """Create a health checker instance."""
        return HealthChecker()

    @pytest.fixture
    def sample_instance(self) -> MySQLInstance:
        """Create a sample instance."""
        return MySQLInstance(
            host="mysql-replica",
            port=3306,
            role=InstanceRole.REPLICA,
            state=InstanceState.ONLINE,
        )

    @pytest.fixture
    def sample_metrics(self) -> InstanceMetrics:
        """Create sample metrics."""
        return InstanceMetrics(
            instance_id="mysql-replica:3306",
            replication_lag_seconds=0.5,
            replication_io_running=True,
            replication_sql_running=True,
            connections_current=50,
            connections_max=100,
            innodb_buffer_pool_hit_rate=99.5,
        )

    def test_health_checker_initialization(self, health_checker: HealthChecker) -> None:
        """Test health checker initialization."""
        assert "replication_lag" in health_checker.checks
        assert "connection_usage" in health_checker.checks

    def test_health_checker_custom_checks(self) -> None:
        """Test health checker with custom checks."""
        custom = {
            "custom_check": HealthCheck(
                name="custom_check",
                description="Custom check",
                critical_threshold=100.0,
                warning_threshold=50.0,
            )
        }

        checker = HealthChecker(custom_checks=custom)

        assert "custom_check" in checker.checks
        assert checker.checks["custom_check"].critical_threshold == 100.0

    def test_evaluate_check_healthy(self, health_checker: HealthChecker) -> None:
        """Test evaluating healthy check result."""
        check = health_checker.checks["replication_lag"]
        result = health_checker.evaluate_check(check, 5.0, "test:3306")

        assert result.status == HealthStatus.HEALTHY
        assert result.value == 5.0

    def test_evaluate_check_warning(self, health_checker: HealthChecker) -> None:
        """Test evaluating warning check result."""
        check = health_checker.checks["replication_lag"]
        # Warning threshold is 30.0, critical is 60.0
        result = health_checker.evaluate_check(check, 45.0, "test:3306")

        assert result.status == HealthStatus.DEGRADED

    def test_evaluate_check_critical(self, health_checker: HealthChecker) -> None:
        """Test evaluating critical check result."""
        check = health_checker.checks["replication_lag"]
        result = health_checker.evaluate_check(check, 120.0, "test:3306")

        assert result.status == HealthStatus.UNHEALTHY

    def test_evaluate_replication_io_stopped(
        self, health_checker: HealthChecker
    ) -> None:
        """Test evaluating stopped replication IO thread."""
        check = health_checker.checks["replication_io"]
        # 0 means stopped
        result = health_checker.evaluate_check(check, 0.0, "test:3306")

        assert result.status == HealthStatus.UNHEALTHY

    def test_evaluate_replication_io_running(
        self, health_checker: HealthChecker
    ) -> None:
        """Test evaluating running replication IO thread."""
        check = health_checker.checks["replication_io"]
        # 1 means running
        result = health_checker.evaluate_check(check, 1.0, "test:3306")

        assert result.status == HealthStatus.HEALTHY

    def test_evaluate_buffer_pool_low(self, health_checker: HealthChecker) -> None:
        """Test evaluating low buffer pool hit rate."""
        check = health_checker.checks["innodb_buffer_pool"]
        # Below critical threshold (90%)
        result = health_checker.evaluate_check(check, 85.0, "test:3306")

        assert result.status == HealthStatus.UNHEALTHY

    @pytest.mark.asyncio
    async def test_check_instance(
        self,
        health_checker: HealthChecker,
        sample_instance: MySQLInstance,
        sample_metrics: InstanceMetrics,
    ) -> None:
        """Test checking instance health."""
        results = await health_checker.check_instance(sample_instance, sample_metrics)

        assert len(results) > 0
        for result in results:
            assert result.instance_id == "mysql-replica:3306"

    def test_get_instance_health_summary_healthy(
        self, health_checker: HealthChecker
    ) -> None:
        """Test health summary for healthy instance."""
        results = [
            HealthCheckResult(
                check_name="check1",
                status=HealthStatus.HEALTHY,
                value=10.0,
                message="OK",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
            HealthCheckResult(
                check_name="check2",
                status=HealthStatus.HEALTHY,
                value=20.0,
                message="OK",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
        ]

        summary = health_checker.get_instance_health_summary(results)
        assert summary == HealthStatus.HEALTHY

    def test_get_instance_health_summary_degraded(
        self, health_checker: HealthChecker
    ) -> None:
        """Test health summary for degraded instance."""
        results = [
            HealthCheckResult(
                check_name="check1",
                status=HealthStatus.HEALTHY,
                value=10.0,
                message="OK",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
            HealthCheckResult(
                check_name="check2",
                status=HealthStatus.DEGRADED,
                value=20.0,
                message="Warning",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
        ]

        summary = health_checker.get_instance_health_summary(results)
        assert summary == HealthStatus.DEGRADED

    def test_get_instance_health_summary_unhealthy(
        self, health_checker: HealthChecker
    ) -> None:
        """Test health summary for unhealthy instance."""
        results = [
            HealthCheckResult(
                check_name="check1",
                status=HealthStatus.HEALTHY,
                value=10.0,
                message="OK",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
            HealthCheckResult(
                check_name="check2",
                status=HealthStatus.UNHEALTHY,
                value=20.0,
                message="Critical",
                timestamp=datetime.utcnow(),
                instance_id="test:3306",
            ),
        ]

        summary = health_checker.get_instance_health_summary(results)
        assert summary == HealthStatus.UNHEALTHY


class TestHealthCheckResult:
    """Tests for HealthCheckResult dataclass."""

    def test_result_creation(self) -> None:
        """Test creating health check result."""
        result = HealthCheckResult(
            check_name="replication_lag",
            status=HealthStatus.DEGRADED,
            value=45.0,
            message="Replication lag exceeds warning threshold",
            timestamp=datetime.utcnow(),
            instance_id="mysql-replica:3306",
            threshold=30.0,
        )

        assert result.check_name == "replication_lag"
        assert result.status == HealthStatus.DEGRADED
        assert result.value == 45.0

    def test_result_to_dict(self) -> None:
        """Test converting result to dict."""
        result = HealthCheckResult(
            check_name="replication_lag",
            status=HealthStatus.DEGRADED,
            value=45.0,
            message="Warning",
            timestamp=datetime.utcnow(),
            instance_id="mysql-replica:3306",
            threshold=30.0,
        )

        d = result.to_dict()

        assert d["check_name"] == "replication_lag"
        assert d["status"] == "degraded"
        assert d["value"] == 45.0


class TestAlert:
    """Tests for Alert dataclass."""

    def test_alert_creation(self) -> None:
        """Test creating an alert."""
        alert = Alert(
            instance_id="mysql-replica:3306",
            check_name="replication_lag",
            severity=AlertSeverity.WARNING,
            message="Replication lag is high",
            value=45.0,
            threshold=30.0,
        )

        assert alert.instance_id == "mysql-replica:3306"
        assert alert.severity == AlertSeverity.WARNING
        assert alert.is_active is True

    def test_alert_is_active(self) -> None:
        """Test alert active status."""
        alert = Alert(instance_id="test:3306")

        assert alert.is_active is True

        alert.resolved_at = datetime.utcnow()
        assert alert.is_active is False

    def test_alert_duration(self) -> None:
        """Test alert duration calculation."""
        alert = Alert(
            instance_id="test:3306",
            triggered_at=datetime.utcnow() - timedelta(minutes=5),
        )

        duration = alert.duration_seconds
        assert duration >= 300  # At least 5 minutes
        assert duration < 310  # Less than 5 min 10 sec

    def test_alert_to_dict(self) -> None:
        """Test alert to_dict conversion."""
        alert = Alert(
            alert_id="alert-123",
            instance_id="test:3306",
            check_name="replication_lag",
            severity=AlertSeverity.WARNING,
            message="Warning",
            value=45.0,
        )

        d = alert.to_dict()

        assert d["alert_id"] == "alert-123"
        assert d["instance_id"] == "test:3306"
        assert d["severity"] == "warning"
        assert d["is_active"] is True


class TestAlertManager:
    """Tests for AlertManager class."""

    @pytest.fixture
    def alert_manager(self) -> AlertManager:
        """Create an alert manager instance."""
        return AlertManager(cooldown_minutes=5)

    @pytest.fixture
    def health_result_unhealthy(self) -> HealthCheckResult:
        """Create an unhealthy health check result."""
        return HealthCheckResult(
            check_name="replication_lag",
            status=HealthStatus.UNHEALTHY,
            value=120.0,
            message="Critical replication lag",
            timestamp=datetime.utcnow(),
            instance_id="mysql-replica:3306",
            threshold=60.0,
        )

    @pytest.fixture
    def health_result_healthy(self) -> HealthCheckResult:
        """Create a healthy health check result."""
        return HealthCheckResult(
            check_name="replication_lag",
            status=HealthStatus.HEALTHY,
            value=5.0,
            message="OK",
            timestamp=datetime.utcnow(),
            instance_id="mysql-replica:3306",
            threshold=30.0,
        )

    def test_alert_manager_initialization(self, alert_manager: AlertManager) -> None:
        """Test alert manager initialization."""
        assert alert_manager.cooldown_minutes == 5
        assert len(alert_manager._active_alerts) == 0

    def test_process_unhealthy_result(
        self,
        alert_manager: AlertManager,
        health_result_unhealthy: HealthCheckResult,
    ) -> None:
        """Test processing unhealthy result creates alert."""
        alert = alert_manager.process_health_result(health_result_unhealthy)

        assert alert is not None
        assert alert.severity == AlertSeverity.CRITICAL
        assert alert.instance_id == "mysql-replica:3306"
        assert len(alert_manager._active_alerts) == 1

    def test_process_healthy_result_resolves_alert(
        self,
        alert_manager: AlertManager,
        health_result_unhealthy: HealthCheckResult,
        health_result_healthy: HealthCheckResult,
    ) -> None:
        """Test healthy result resolves existing alert."""
        # First create an alert
        alert_manager.process_health_result(health_result_unhealthy)
        assert len(alert_manager._active_alerts) == 1

        # Then resolve it with healthy result
        alert_manager.process_health_result(health_result_healthy)
        assert len(alert_manager._active_alerts) == 0

    def test_cooldown_prevents_duplicate(
        self,
        alert_manager: AlertManager,
        health_result_unhealthy: HealthCheckResult,
    ) -> None:
        """Test cooldown prevents duplicate alerts."""
        # First alert
        alert1 = alert_manager.process_health_result(health_result_unhealthy)
        assert alert1 is not None

        # Immediate second alert (should be blocked by cooldown)
        alert2 = alert_manager.process_health_result(health_result_unhealthy)
        assert alert2 is None

    def test_acknowledge_alert(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test acknowledging an alert."""
        alert = alert_manager.process_health_result(health_result_unhealthy)

        result = alert_manager.acknowledge_alert(
            alert.alert_id, acknowledged_by="admin"
        )

        assert result is True
        assert alert.acknowledged is True
        assert alert.acknowledged_by == "admin"

    def test_acknowledge_nonexistent_alert(self, alert_manager: AlertManager) -> None:
        """Test acknowledging non-existent alert."""
        result = alert_manager.acknowledge_alert("nonexistent-id")
        assert result is False

    def test_resolve_alert(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test resolving an alert."""
        alert = alert_manager.process_health_result(health_result_unhealthy)

        result = alert_manager.resolve_alert(alert.alert_id)

        assert result is True
        assert len(alert_manager._active_alerts) == 0

    def test_get_active_alerts(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test getting active alerts."""
        alert_manager.process_health_result(health_result_unhealthy)

        active = alert_manager.get_active_alerts()

        assert len(active) == 1

    def test_get_active_alerts_by_instance(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test filtering active alerts by instance."""
        alert_manager.process_health_result(health_result_unhealthy)

        active = alert_manager.get_active_alerts(instance_id="mysql-replica:3306")
        assert len(active) == 1

        active = alert_manager.get_active_alerts(instance_id="other:3306")
        assert len(active) == 0

    def test_get_alert_stats(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test getting alert statistics."""
        alert_manager.process_health_result(health_result_unhealthy)

        stats = alert_manager.get_stats()

        assert stats["active_alerts"] == 1
        assert stats["critical_alerts"] == 1

    def test_clear_alerts(
        self, alert_manager: AlertManager, health_result_unhealthy: HealthCheckResult
    ) -> None:
        """Test clearing alerts."""
        alert_manager.process_health_result(health_result_unhealthy)

        count = alert_manager.clear_alerts()

        assert count == 1
        assert len(alert_manager._active_alerts) == 0


class TestPrometheusExporter:
    """Tests for PrometheusExporter class."""

    def test_exporter_initialization(self) -> None:
        """Test exporter initialization."""
        exporter = PrometheusExporter()

        assert exporter.registry is not None
        assert exporter.mysql_replication_lag is not None
        assert exporter.mysql_connections is not None

    def test_update_metrics(self) -> None:
        """Test updating metrics."""
        exporter = PrometheusExporter()
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            cluster_id="test-cluster",
        )
        metrics = InstanceMetrics(
            instance_id="mysql-primary:3306",
            connections_current=50,
            connections_max=100,
            queries_per_second=150.5,
            threads_running=5,
            innodb_buffer_pool_hit_rate=99.5,
            uptime_seconds=86400,
        )

        # Should not raise
        exporter.update_metrics(instance, metrics)

    def test_update_health_status(self) -> None:
        """Test updating health status."""
        exporter = PrometheusExporter()
        instance = MySQLInstance(host="mysql-primary", port=3306, cluster_id="test")

        exporter.update_health_status(instance, HealthStatus.HEALTHY)
        exporter.update_health_status(instance, HealthStatus.DEGRADED)
        exporter.update_health_status(instance, HealthStatus.UNHEALTHY)

    def test_update_cluster_health(self) -> None:
        """Test updating cluster health."""
        exporter = PrometheusExporter()
        primary = MySQLInstance(
            host="primary", port=3306,
            role=InstanceRole.PRIMARY, state=InstanceState.ONLINE
        )
        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)

        exporter.update_cluster_health(cluster)

    def test_record_failover(self) -> None:
        """Test recording failover."""
        exporter = PrometheusExporter()

        exporter.record_failover(
            cluster_id="test-cluster",
            success=True,
            duration_seconds=15.5,
        )

    def test_set_failover_in_progress(self) -> None:
        """Test setting failover in progress."""
        exporter = PrometheusExporter()

        exporter.set_failover_in_progress("test-cluster", True)
        exporter.set_failover_in_progress("test-cluster", False)

    def test_update_alerts(self) -> None:
        """Test updating alert metrics."""
        exporter = PrometheusExporter()

        exporter.update_alerts(
            critical_count=2,
            warning_count=5,
            info_count=10,
        )

    def test_record_api_request(self) -> None:
        """Test recording API request."""
        exporter = PrometheusExporter()

        exporter.record_api_request(
            method="GET",
            endpoint="/api/v1/instances",
            status_code=200,
            duration_seconds=0.05,
        )

    def test_get_metrics_output(self) -> None:
        """Test getting metrics output."""
        exporter = PrometheusExporter()

        output = exporter.get_metrics_output()

        assert isinstance(output, str)
        assert "clawsql" in output


class TestEnums:
    """Tests for monitoring enums."""

    def test_health_status_values(self) -> None:
        """Test HealthStatus enum values."""
        assert HealthStatus.HEALTHY.value == "healthy"
        assert HealthStatus.DEGRADED.value == "degraded"
        assert HealthStatus.UNHEALTHY.value == "unhealthy"
        assert HealthStatus.UNKNOWN.value == "unknown"

    def test_alert_severity_values(self) -> None:
        """Test AlertSeverity enum values."""
        assert AlertSeverity.INFO.value == "info"
        assert AlertSeverity.WARNING.value == "warning"
        assert AlertSeverity.CRITICAL.value == "critical"

"""Unit tests for failover module."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from clawsql.core.discovery.models import (
    FailoverState,
    FailureType,
    InstanceRole,
    InstanceState,
    MySQLCluster,
    MySQLInstance,
)
from clawsql.core.failover.detector import FailureDetector, FailureEvent
from clawsql.core.failover.executor import FailoverExecutor, FailoverOperation
from clawsql.core.failover.recovery import RecoveryManager


class TestFailureEvent:
    """Tests for FailureEvent dataclass."""

    def test_failure_event_creation(self) -> None:
        """Test creating a failure event."""
        event = FailureEvent(
            failure_type=FailureType.PRIMARY_UNREACHABLE,
            instance_id="mysql-primary:3306",
            cluster_id="test-cluster",
            details={"message": "Primary not responding"},
        )

        assert event.failure_type == FailureType.PRIMARY_UNREACHABLE
        assert event.instance_id == "mysql-primary:3306"
        assert event.confirmed is False

    def test_failure_event_to_dict(self) -> None:
        """Test converting event to dict."""
        event = FailureEvent(
            failure_type=FailureType.REPLICATION_STOPPED,
            instance_id="mysql-replica:3306",
            cluster_id="test-cluster",
            details={"message": "Replication stopped"},
        )

        d = event.to_dict()

        assert d["failure_type"] == "replication_stopped"
        assert d["instance_id"] == "mysql-replica:3306"


class TestFailureDetector:
    """Tests for FailureDetector class."""

    @pytest.fixture
    def health_checker(self) -> "HealthChecker":
        """Create a health checker instance."""
        from clawsql.core.monitoring.health_checker import HealthChecker
        return HealthChecker()

    @pytest.fixture
    def metrics_collector(self) -> "MetricsCollector":
        """Create a metrics collector instance."""
        from clawsql.core.monitoring.collector import MetricsCollector
        return MetricsCollector()

    @pytest.fixture
    def detector(self, health_checker: "HealthChecker", metrics_collector: "MetricsCollector") -> FailureDetector:
        """Create a failure detector instance."""
        return FailureDetector(health_checker=health_checker, metrics_collector=metrics_collector)

    @pytest.fixture
    def sample_instance(self) -> MySQLInstance:
        """Create a sample instance."""
        return MySQLInstance(
            host="mysql-primary",
            port=3306,
            role=InstanceRole.PRIMARY,
            state=InstanceState.ONLINE,
        )

    def test_detector_initialization(self, detector: FailureDetector) -> None:
        """Test detector initialization."""
        assert detector is not None
        assert detector.health_checker is not None
        assert detector.metrics is not None

    @pytest.mark.asyncio
    async def test_check_primary_health(
        self, detector: FailureDetector, sample_instance: MySQLInstance
    ) -> None:
        """Test checking primary health."""
        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(sample_instance)

        event = await detector.check_primary_health(cluster)

        # Should return None for a healthy primary with no metrics
        # or a FailureEvent if unhealthy
        assert event is None or isinstance(event, FailureEvent)


class TestFailoverOperation:
    """Tests for FailoverOperation dataclass."""

    def test_operation_creation(self) -> None:
        """Test creating a failover operation."""
        operation = FailoverOperation(
            cluster_id="test-cluster",
            old_primary_id="mysql-primary:3306",
            new_primary_id="mysql-replica:3306",
            manual=True,
            reason="Planned maintenance",
        )

        assert operation.cluster_id == "test-cluster"
        assert operation.state == FailoverState.IDLE
        assert operation.manual is True

    def test_operation_duration(self) -> None:
        """Test operation duration calculation."""
        operation = FailoverOperation(
            cluster_id="test",
            started_at=datetime.utcnow() - timedelta(seconds=30),
            completed_at=datetime.utcnow(),
        )

        assert operation.duration_seconds is not None
        assert operation.duration_seconds >= 30

    def test_operation_duration_not_started(self) -> None:
        """Test duration when not started."""
        operation = FailoverOperation(cluster_id="test")

        assert operation.duration_seconds is None

    def test_operation_add_step(self) -> None:
        """Test adding step to operation."""
        operation = FailoverOperation(cluster_id="test")

        operation.add_step("Starting failover")
        operation.add_step("Selecting candidate")

        assert len(operation.steps) == 2
        assert "Starting failover" in operation.steps[0]

    def test_operation_to_dict(self) -> None:
        """Test converting operation to dict."""
        operation = FailoverOperation(
            operation_id="op-123",
            cluster_id="test-cluster",
            old_primary_id="mysql-primary:3306",
            new_primary_id="mysql-replica:3306",
            state=FailoverState.COMPLETED,
            manual=False,
            reason="Automatic failover",
        )

        d = operation.to_dict()

        assert d["operation_id"] == "op-123"
        assert d["cluster_id"] == "test-cluster"
        assert d["state"] == "completed"
        assert d["manual"] is False


class TestFailoverExecutor:
    """Tests for FailoverExecutor class."""

    @pytest.fixture
    def mock_orchestrator(self) -> MagicMock:
        """Create mock orchestrator client."""
        client = MagicMock()
        client.request_failover = AsyncMock(return_value={"success": True})
        client.relocate_replicas = AsyncMock(return_value=True)
        return client

    @pytest.fixture
    def mock_prometheus(self) -> MagicMock:
        """Create mock prometheus exporter."""
        exporter = MagicMock()
        exporter.set_failover_in_progress = MagicMock()
        exporter.record_failover = MagicMock()
        return exporter

    @pytest.fixture
    def executor(
        self, mock_orchestrator: MagicMock, mock_prometheus: MagicMock
    ) -> FailoverExecutor:
        """Create a failover executor instance."""
        return FailoverExecutor(
            orchestrator_client=mock_orchestrator,
            prometheus_exporter=mock_prometheus,
        )

    @pytest.fixture
    def sample_cluster(self) -> MySQLCluster:
        """Create a sample cluster with primary and replicas."""
        primary = MySQLInstance(
            host="mysql-primary",
            port=3306,
            role=InstanceRole.PRIMARY,
            state=InstanceState.ONLINE,
        )
        replica1 = MySQLInstance(
            host="mysql-replica-1",
            port=3306,
            role=InstanceRole.REPLICA,
            state=InstanceState.ONLINE,
            replication_lag=0.5,
        )
        replica2 = MySQLInstance(
            host="mysql-replica-2",
            port=3306,
            role=InstanceRole.REPLICA,
            state=InstanceState.ONLINE,
            replication_lag=1.0,
        )

        cluster = MySQLCluster(cluster_id="test-cluster", name="Test Cluster")
        cluster.set_primary(primary)
        cluster.add_replica(replica1)
        cluster.add_replica(replica2)
        return cluster

    def test_executor_initialization(self, executor: FailoverExecutor) -> None:
        """Test executor initialization."""
        assert executor._current_operation is None
        assert len(executor._operation_history) == 0

    def test_register_hooks(self, executor: FailoverExecutor) -> None:
        """Test registering pre/post failover hooks."""
        hook1 = MagicMock()
        hook2 = MagicMock()

        executor.register_pre_failover_hook(hook1)
        executor.register_post_failover_hook(hook2)

        assert hook1 in executor._pre_failover_hooks
        assert hook2 in executor._post_failover_hooks

    @pytest.mark.asyncio
    async def test_select_candidate(
        self, executor: FailoverExecutor, sample_cluster: MySQLCluster
    ) -> None:
        """Test selecting failover candidate."""
        candidate = await executor.select_candidate(sample_cluster)

        assert candidate is not None
        assert candidate.role == InstanceRole.REPLICA
        # Should select replica with lowest lag
        assert candidate.host == "mysql-replica-1"

    @pytest.mark.asyncio
    async def test_select_candidate_no_replicas(
        self, executor: FailoverExecutor
    ) -> None:
        """Test selecting candidate when no replicas."""
        cluster = MySQLCluster(cluster_id="test", name="Test")

        candidate = await executor.select_candidate(cluster)

        assert candidate is None

    @pytest.mark.asyncio
    async def test_select_candidate_all_offline(
        self, executor: FailoverExecutor
    ) -> None:
        """Test selecting candidate when all replicas offline."""
        cluster = MySQLCluster(cluster_id="test", name="Test")
        replica = MySQLInstance(
            host="mysql-replica",
            port=3306,
            role=InstanceRole.REPLICA,
            state=InstanceState.OFFLINE,
        )
        cluster.add_replica(replica)

        candidate = await executor.select_candidate(cluster)

        assert candidate is None

    @pytest.mark.asyncio
    async def test_promote_instance(
        self,
        executor: FailoverExecutor,
        sample_cluster: MySQLCluster,
        mock_orchestrator: MagicMock,
    ) -> None:
        """Test promoting instance."""
        replica = sample_cluster.replicas[0]

        result = await executor.promote_instance(replica, sample_cluster)

        assert result is True
        mock_orchestrator.request_failover.assert_called_once()

    @pytest.mark.asyncio
    async def test_reconfigure_replicas(
        self,
        executor: FailoverExecutor,
        mock_orchestrator: MagicMock,
    ) -> None:
        """Test reconfiguring replicas."""
        new_primary = MySQLInstance(
            host="mysql-replica-1",
            port=3306,
            role=InstanceRole.PRIMARY,
        )
        replicas = [
            MySQLInstance(
                host="mysql-replica-2",
                port=3306,
                role=InstanceRole.REPLICA,
            ),
        ]

        result = await executor.reconfigure_replicas(new_primary, replicas)

        assert result is True

    @pytest.mark.asyncio
    async def test_update_routing(self, executor: FailoverExecutor, sample_cluster: MySQLCluster) -> None:
        """Test updating routing."""
        new_primary = sample_cluster.replicas[0]

        result = await executor.update_routing(sample_cluster, new_primary)

        assert result is True

    def test_get_current_operation(self, executor: FailoverExecutor) -> None:
        """Test getting current operation."""
        assert executor.get_current_operation() is None

        executor._current_operation = FailoverOperation(cluster_id="test")
        assert executor.get_current_operation() is not None

    def test_get_operation_history(
        self, executor: FailoverExecutor
    ) -> None:
        """Test getting operation history."""
        op1 = FailoverOperation(cluster_id="cluster-a", started_at=datetime.utcnow())
        op2 = FailoverOperation(cluster_id="cluster-b", started_at=datetime.utcnow())

        executor._operation_history = [op1, op2]

        history = executor.get_operation_history()

        assert len(history) == 2

    def test_get_operation_history_filtered(
        self, executor: FailoverExecutor
    ) -> None:
        """Test getting filtered operation history."""
        op1 = FailoverOperation(cluster_id="cluster-a")
        op2 = FailoverOperation(cluster_id="cluster-b")

        executor._operation_history = [op1, op2]

        history = executor.get_operation_history(cluster_id="cluster-a")

        assert len(history) == 1
        assert history[0].cluster_id == "cluster-a"

    def test_get_operation(self, executor: FailoverExecutor) -> None:
        """Test getting specific operation."""
        op = FailoverOperation(operation_id="op-123", cluster_id="test")
        executor._operation_history = [op]

        found = executor.get_operation("op-123")
        not_found = executor.get_operation("nonexistent")

        assert found == op
        assert not_found is None


class TestRecoveryManager:
    """Tests for RecoveryManager class."""

    @pytest.fixture
    def orchestrator_client(self) -> MagicMock:
        """Create mock orchestrator client."""
        from unittest.mock import MagicMock
        client = MagicMock()
        client.discover_instance = AsyncMock(return_value=True)
        return client

    @pytest.fixture
    def metrics_collector(self) -> "MetricsCollector":
        """Create a metrics collector instance."""
        from clawsql.core.monitoring.collector import MetricsCollector
        return MetricsCollector()

    @pytest.fixture
    def recovery_manager(self, orchestrator_client: MagicMock, metrics_collector: "MetricsCollector") -> RecoveryManager:
        """Create a recovery manager instance."""
        return RecoveryManager(orchestrator_client=orchestrator_client, metrics_collector=metrics_collector)

    @pytest.fixture
    def sample_instance(self) -> MySQLInstance:
        """Create a sample instance."""
        return MySQLInstance(
            host="mysql-primary",
            port=3306,
            role=InstanceRole.PRIMARY,
            state=InstanceState.FAILED,
        )

    def test_recovery_manager_initialization(
        self, recovery_manager: RecoveryManager
    ) -> None:
        """Test recovery manager initialization."""
        assert recovery_manager is not None


class TestFailoverState:
    """Tests for FailoverState enum."""

    def test_failover_state_values(self) -> None:
        """Test FailoverState enum values."""
        assert FailoverState.IDLE.value == "idle"
        assert FailoverState.DETECTING.value == "detecting"
        assert FailoverState.CANDIDATE_SELECTION.value == "candidate_selection"
        assert FailoverState.PROMOTING.value == "promoting"
        assert FailoverState.RECONFIGURING.value == "reconfiguring"
        assert FailoverState.COMPLETED.value == "completed"
        assert FailoverState.FAILED.value == "failed"


class TestFailureType:
    """Tests for FailureType enum."""

    def test_failure_type_values(self) -> None:
        """Test FailureType enum values."""
        assert FailureType.PRIMARY_UNREACHABLE.value == "primary_unreachable"
        assert FailureType.PRIMARY_NOT_WRITING.value == "primary_not_writing"
        assert FailureType.REPLICATION_STOPPED.value == "replication_stopped"
        assert FailureType.REPLICATION_LAG_HIGH.value == "replication_lag_high"
        assert FailureType.DISK_FULL.value == "disk_full"
        assert FailureType.MEMORY_EXHAUSTED.value == "memory_exhausted"
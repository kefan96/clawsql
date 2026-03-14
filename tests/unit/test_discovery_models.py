"""Unit tests for discovery models."""

import pytest
from datetime import datetime

from clawsql.core.discovery.models import (
    AlertSeverity,
    FailoverState,
    FailureType,
    HealthStatus,
    InstanceRole,
    InstanceState,
    MySQLCluster,
    MySQLInstance,
)


class TestMySQLInstance:
    """Tests for MySQLInstance dataclass."""

    def test_instance_creation(self) -> None:
        """Test creating a MySQL instance."""
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            server_id=1,
            role=InstanceRole.PRIMARY,
            state=InstanceState.ONLINE,
            version="8.0.35",
        )

        assert instance.host == "mysql-primary"
        assert instance.port == 3306
        assert instance.server_id == 1
        assert instance.role == InstanceRole.PRIMARY
        assert instance.state == InstanceState.ONLINE
        assert instance.version == "8.0.35"

    def test_instance_id_property(self) -> None:
        """Test instance_id property generates correct identifier."""
        instance = MySQLInstance(host="db-server", port=3307)
        assert instance.instance_id == "db-server:3307"

    def test_is_primary_property(self) -> None:
        """Test is_primary property returns correct boolean."""
        primary = MySQLInstance(host="primary", port=3306, role=InstanceRole.PRIMARY)
        replica = MySQLInstance(host="replica", port=3306, role=InstanceRole.REPLICA)
        unknown = MySQLInstance(host="unknown", port=3306, role=InstanceRole.UNKNOWN)

        assert primary.is_primary is True
        assert replica.is_primary is False
        assert unknown.is_primary is False

    def test_is_replica_property(self) -> None:
        """Test is_replica property returns correct boolean."""
        primary = MySQLInstance(host="primary", port=3306, role=InstanceRole.PRIMARY)
        replica = MySQLInstance(host="replica", port=3306, role=InstanceRole.REPLICA)
        unknown = MySQLInstance(host="unknown", port=3306, role=InstanceRole.UNKNOWN)

        assert primary.is_replica is False
        assert replica.is_replica is True
        assert unknown.is_replica is False

    def test_is_online_property(self) -> None:
        """Test is_online property returns correct boolean."""
        online = MySQLInstance(host="online", port=3306, state=InstanceState.ONLINE)
        offline = MySQLInstance(host="offline", port=3306, state=InstanceState.OFFLINE)
        maintenance = MySQLInstance(host="maint", port=3306, state=InstanceState.MAINTENANCE)

        assert online.is_online is True
        assert offline.is_online is False
        assert maintenance.is_online is False

    def test_is_healthy_property(self) -> None:
        """Test is_healthy property returns correct boolean."""
        healthy = MySQLInstance(
            host="healthy",
            port=3306,
            state=InstanceState.ONLINE,
            role=InstanceRole.PRIMARY,
        )
        offline = MySQLInstance(
            host="offline",
            port=3306,
            state=InstanceState.OFFLINE,
            role=InstanceRole.PRIMARY,
        )
        unknown_role = MySQLInstance(
            host="unknown",
            port=3306,
            state=InstanceState.ONLINE,
            role=InstanceRole.UNKNOWN,
        )

        assert healthy.is_healthy is True
        assert offline.is_healthy is False
        assert unknown_role.is_healthy is False

    def test_to_dict(self) -> None:
        """Test to_dict conversion."""
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            server_id=1,
            role=InstanceRole.PRIMARY,
            state=InstanceState.ONLINE,
            version="8.0.35",
            cluster_id="test-cluster",
            labels={"env": "test"},
        )

        result = instance.to_dict()

        assert result["instance_id"] == "mysql-primary:3306"
        assert result["host"] == "mysql-primary"
        assert result["port"] == 3306
        assert result["server_id"] == 1
        assert result["role"] == "primary"
        assert result["state"] == "online"
        assert result["version"] == "8.0.35"
        assert result["cluster_id"] == "test-cluster"
        assert result["labels"] == {"env": "test"}
        assert "last_seen" in result

    def test_default_values(self) -> None:
        """Test default values for optional fields."""
        instance = MySQLInstance(host="test", port=3306)

        assert instance.server_id is None
        assert instance.role == InstanceRole.UNKNOWN
        assert instance.state == InstanceState.OFFLINE
        assert instance.version is None
        assert instance.replication_lag is None
        assert instance.cluster_id is None
        assert instance.labels == {}
        assert instance.extra == {}


class TestMySQLCluster:
    """Tests for MySQLCluster dataclass."""

    def test_cluster_creation(self) -> None:
        """Test creating a MySQL cluster."""
        cluster = MySQLCluster(
            cluster_id="test-cluster",
            name="Test Cluster",
            description="A test cluster",
        )

        assert cluster.cluster_id == "test-cluster"
        assert cluster.name == "Test Cluster"
        assert cluster.description == "A test cluster"
        assert cluster.primary is None
        assert cluster.replicas == []

    def test_instance_count_empty(self) -> None:
        """Test instance_count with empty cluster."""
        cluster = MySQLCluster(cluster_id="empty", name="Empty")
        assert cluster.instance_count == 0

    def test_instance_count_with_primary_only(self) -> None:
        """Test instance_count with only primary."""
        primary = MySQLInstance(host="primary", port=3306)
        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)

        assert cluster.instance_count == 1

    def test_instance_count_with_replicas(self) -> None:
        """Test instance_count with primary and replicas."""
        primary = MySQLInstance(host="primary", port=3306, role=InstanceRole.PRIMARY)
        replica1 = MySQLInstance(host="replica1", port=3306)
        replica2 = MySQLInstance(host="replica2", port=3306)

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(replica1)
        cluster.add_replica(replica2)

        assert cluster.instance_count == 3

    def test_healthy_count(self) -> None:
        """Test healthy_count property."""
        primary = MySQLInstance(
            host="primary", port=3306,
            role=InstanceRole.PRIMARY, state=InstanceState.ONLINE
        )
        healthy_replica = MySQLInstance(
            host="replica1", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.ONLINE
        )
        unhealthy_replica = MySQLInstance(
            host="replica2", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.OFFLINE
        )

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(healthy_replica)
        cluster.add_replica(unhealthy_replica)

        assert cluster.healthy_count == 2

    def test_health_status_healthy(self) -> None:
        """Test health_status when all instances healthy."""
        primary = MySQLInstance(
            host="primary", port=3306,
            role=InstanceRole.PRIMARY, state=InstanceState.ONLINE
        )
        replica = MySQLInstance(
            host="replica", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.ONLINE
        )

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(replica)

        assert cluster.health_status == HealthStatus.HEALTHY

    def test_health_status_degraded(self) -> None:
        """Test health_status when some instances unhealthy."""
        primary = MySQLInstance(
            host="primary", port=3306,
            role=InstanceRole.PRIMARY, state=InstanceState.ONLINE
        )
        healthy_replica = MySQLInstance(
            host="replica1", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.ONLINE
        )
        unhealthy_replica = MySQLInstance(
            host="replica2", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.OFFLINE
        )

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(healthy_replica)
        cluster.add_replica(unhealthy_replica)

        # 2/3 healthy = 66% > 50%, so degraded
        assert cluster.health_status == HealthStatus.DEGRADED

    def test_health_status_unhealthy(self) -> None:
        """Test health_status when most instances unhealthy."""
        primary = MySQLInstance(
            host="primary", port=3306,
            role=InstanceRole.PRIMARY, state=InstanceState.OFFLINE
        )
        replica = MySQLInstance(
            host="replica", port=3306,
            role=InstanceRole.REPLICA, state=InstanceState.OFFLINE
        )

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(replica)

        # 0/2 healthy = 0% < 50%, so unhealthy
        assert cluster.health_status == HealthStatus.UNHEALTHY

    def test_health_status_empty_cluster(self) -> None:
        """Test health_status for empty cluster."""
        cluster = MySQLCluster(cluster_id="empty", name="Empty")
        assert cluster.health_status == HealthStatus.UNKNOWN

    def test_get_instance(self) -> None:
        """Test get_instance method."""
        primary = MySQLInstance(host="primary", port=3306)
        replica = MySQLInstance(host="replica", port=3306)

        cluster = MySQLCluster(cluster_id="test", name="Test")
        cluster.set_primary(primary)
        cluster.add_replica(replica)

        found_primary = cluster.get_instance("primary", 3306)
        found_replica = cluster.get_instance("replica", 3306)
        not_found = cluster.get_instance("nonexistent", 3306)

        assert found_primary == primary
        assert found_replica == replica
        assert not_found is None

    def test_set_primary(self) -> None:
        """Test set_primary method sets role and cluster_id."""
        instance = MySQLInstance(host="primary", port=3306)
        cluster = MySQLCluster(cluster_id="test", name="Test")

        cluster.set_primary(instance)

        assert cluster.primary == instance
        assert instance.role == InstanceRole.PRIMARY
        assert instance.cluster_id == "test"

    def test_add_replica(self) -> None:
        """Test add_replica method sets role and cluster_id."""
        instance = MySQLInstance(host="replica", port=3306)
        cluster = MySQLCluster(cluster_id="test", name="Test")

        cluster.add_replica(instance)

        assert instance in cluster.replicas
        assert instance.role == InstanceRole.REPLICA
        assert instance.cluster_id == "test"

    def test_to_dict(self) -> None:
        """Test to_dict conversion."""
        primary = MySQLInstance(
            host="primary", port=3306,
            server_id=1, role=InstanceRole.PRIMARY, state=InstanceState.ONLINE
        )
        replica = MySQLInstance(
            host="replica", port=3306,
            server_id=2, role=InstanceRole.REPLICA, state=InstanceState.ONLINE
        )

        cluster = MySQLCluster(
            cluster_id="test-cluster",
            name="Test Cluster",
            description="A test cluster",
        )
        cluster.set_primary(primary)
        cluster.add_replica(replica)

        result = cluster.to_dict()

        assert result["cluster_id"] == "test-cluster"
        assert result["name"] == "Test Cluster"
        assert result["description"] == "A test cluster"
        assert result["instance_count"] == 2
        assert result["health_status"] == "healthy"
        assert result["primary"]["instance_id"] == "primary:3306"
        assert len(result["replicas"]) == 1


class TestEnums:
    """Tests for enum classes."""

    def test_instance_role_values(self) -> None:
        """Test InstanceRole enum values."""
        assert InstanceRole.PRIMARY.value == "primary"
        assert InstanceRole.REPLICA.value == "replica"
        assert InstanceRole.UNKNOWN.value == "unknown"

    def test_instance_state_values(self) -> None:
        """Test InstanceState enum values."""
        assert InstanceState.ONLINE.value == "online"
        assert InstanceState.OFFLINE.value == "offline"
        assert InstanceState.RECOVERING.value == "recovering"
        assert InstanceState.FAILED.value == "failed"
        assert InstanceState.MAINTENANCE.value == "maintenance"

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

    def test_failover_state_values(self) -> None:
        """Test FailoverState enum values."""
        assert FailoverState.IDLE.value == "idle"
        assert FailoverState.DETECTING.value == "detecting"
        assert FailoverState.CANDIDATE_SELECTION.value == "candidate_selection"
        assert FailoverState.PROMOTING.value == "promoting"
        assert FailoverState.RECONFIGURING.value == "reconfiguring"
        assert FailoverState.COMPLETED.value == "completed"
        assert FailoverState.FAILED.value == "failed"

    def test_failure_type_values(self) -> None:
        """Test FailureType enum values."""
        assert FailureType.PRIMARY_UNREACHABLE.value == "primary_unreachable"
        assert FailureType.PRIMARY_NOT_WRITING.value == "primary_not_writing"
        assert FailureType.REPLICATION_STOPPED.value == "replication_stopped"
        assert FailureType.REPLICATION_LAG_HIGH.value == "replication_lag_high"
        assert FailureType.DISK_FULL.value == "disk_full"
        assert FailureType.MEMORY_EXHAUSTED.value == "memory_exhausted"
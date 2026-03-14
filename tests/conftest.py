"""Pytest configuration and shared fixtures for ClawSQL tests."""

import asyncio
from datetime import datetime
from typing import Any, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from clawsql.config.settings import Settings
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
from clawsql.main import create_app


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def test_settings() -> Settings:
    """Create test settings."""
    return Settings(
        app_name="ClawSQL Test",
        debug=True,
        api__token_secret="test-secret-key-for-testing-only",
    )


@pytest.fixture
def client(test_settings: Settings) -> Generator[TestClient, None, None]:
    """Create test client."""
    app = create_app(test_settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_instance() -> MySQLInstance:
    """Create a sample MySQL instance."""
    return MySQLInstance(
        host="mysql-primary",
        port=3306,
        server_id=1,
        role=InstanceRole.PRIMARY,
        state=InstanceState.ONLINE,
        version="8.0.35",
        replication_lag=None,
        cluster_id="test-cluster",
        labels={"datacenter": "dc1", "env": "test"},
    )


@pytest.fixture
def sample_replica() -> MySQLInstance:
    """Create a sample MySQL replica instance."""
    return MySQLInstance(
        host="mysql-replica-1",
        port=3306,
        server_id=2,
        role=InstanceRole.REPLICA,
        state=InstanceState.ONLINE,
        version="8.0.35",
        replication_lag=0.5,
        cluster_id="test-cluster",
        labels={"datacenter": "dc1", "env": "test"},
    )


@pytest.fixture
def sample_replica_2() -> MySQLInstance:
    """Create a second sample MySQL replica instance."""
    return MySQLInstance(
        host="mysql-replica-2",
        port=3306,
        server_id=3,
        role=InstanceRole.REPLICA,
        state=InstanceState.ONLINE,
        version="8.0.35",
        replication_lag=1.2,
        cluster_id="test-cluster",
        labels={"datacenter": "dc2", "env": "test"},
    )


@pytest.fixture
def sample_offline_replica() -> MySQLInstance:
    """Create an offline replica instance."""
    return MySQLInstance(
        host="mysql-replica-offline",
        port=3306,
        server_id=4,
        role=InstanceRole.REPLICA,
        state=InstanceState.OFFLINE,
        version="8.0.35",
        replication_lag=None,
        cluster_id="test-cluster",
        labels={"datacenter": "dc1", "env": "test"},
    )


@pytest.fixture
def sample_cluster(
    sample_instance: MySQLInstance,
    sample_replica: MySQLInstance,
    sample_replica_2: MySQLInstance,
) -> MySQLCluster:
    """Create a sample MySQL cluster."""
    cluster = MySQLCluster(
        cluster_id="test-cluster",
        name="Test Cluster",
        description="A test MySQL cluster",
    )
    cluster.set_primary(sample_instance)
    cluster.add_replica(sample_replica)
    cluster.add_replica(sample_replica_2)
    return cluster


@pytest.fixture
def sample_degraded_cluster(
    sample_instance: MySQLInstance,
    sample_replica: MySQLInstance,
    sample_offline_replica: MySQLInstance,
) -> MySQLCluster:
    """Create a degraded cluster with one offline replica."""
    cluster = MySQLCluster(
        cluster_id="degraded-cluster",
        name="Degraded Cluster",
    )
    cluster.set_primary(sample_instance)
    cluster.add_replica(sample_replica)
    cluster.add_replica(sample_offline_replica)
    return cluster


# Mock database connection
@pytest.fixture
def mock_db_connection() -> MagicMock:
    """Create a mock database connection."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    return mock_conn


# Mock Orchestrator responses
@pytest.fixture
def mock_orchestrator_response() -> dict[str, Any]:
    """Sample Orchestrator API response."""
    return {
        "Code": "OK",
        "Message": "Success",
        "Details": {
            "ClusterName": "test-cluster",
            "ClusterAlias": "Test Cluster",
            "MasterKey": {"Hostname": "mysql-primary", "Port": 3306},
            "Replicas": [
                {"Key": {"Hostname": "mysql-replica-1", "Port": 3306}},
                {"Key": {"Hostname": "mysql-replica-2", "Port": 3306}},
            ],
        },
    }


@pytest.fixture
def mock_orchestrator_topology() -> dict[str, Any]:
    """Sample Orchestrator topology response."""
    return {
        "Code": "OK",
        "Details": {
            "Alias": "mysql-primary:3306",
            "Key": {"Hostname": "mysql-primary", "Port": 3306},
            "ServerID": 1,
            "Version": "8.0.35",
            "ReadOnly": False,
            "IsLastCheckValid": 1,
            "IsUpToDate": 1,
            "IsRecentlyChecked": 1,
            "SecondsSinceLastSeen": 0,
            "CountReplicas": 2,
            "Replicas": [
                {
                    "Alias": "mysql-replica-1:3306",
                    "Key": {"Hostname": "mysql-replica-1", "Port": 3306},
                    "ServerID": 2,
                    "ReadOnly": True,
                    "IsLastCheckValid": 1,
                    "ReplicationLagSeconds": 0,
                    "Replicas": [],
                },
                {
                    "Alias": "mysql-replica-2:3306",
                    "Key": {"Hostname": "mysql-replica-2", "Port": 3306},
                    "ServerID": 3,
                    "ReadOnly": True,
                    "IsLastCheckValid": 1,
                    "ReplicationLagSeconds": 1,
                    "Replicas": [],
                },
            ],
        },
    }


# Mock ProxySQL responses
@pytest.fixture
def mock_proxysql_servers() -> list[dict[str, Any]]:
    """Sample ProxySQL server list."""
    return [
        {
            "hostgroup_id": 10,
            "hostname": "mysql-primary",
            "port": 3306,
            "status": "ONLINE",
            "weight": 1,
            "compression": 0,
            "max_connections": 1000,
            "max_replication_lag": 0,
            "use_ssl": 0,
        },
        {
            "hostgroup_id": 20,
            "hostname": "mysql-replica-1",
            "port": 3306,
            "status": "ONLINE",
            "weight": 1,
            "compression": 0,
            "max_connections": 1000,
            "max_replication_lag": 10,
            "use_ssl": 0,
        },
        {
            "hostgroup_id": 20,
            "hostname": "mysql-replica-2",
            "port": 3306,
            "status": "ONLINE",
            "weight": 1,
            "compression": 0,
            "max_connections": 1000,
            "max_replication_lag": 10,
            "use_ssl": 0,
        },
    ]


@pytest.fixture
def mock_proxysql_hostgroups() -> list[dict[str, Any]]:
    """Sample ProxySQL hostgroups."""
    return [
        {"hostgroup_id": 10, "name": "writers", "comment": "Write operations"},
        {"hostgroup_id": 20, "name": "readers", "comment": "Read operations"},
    ]


# Mock MySQL query results
@pytest.fixture
def mock_mysql_show_slave_status() -> list[tuple]:
    """Sample SHOW SLAVE STATUS result."""
    return [
        (
            1,  # Slave_IO_State
            "mysql-primary",  # Master_Host
            3306,  # Master_Port
            60,  # Connect_Retry
            "Yes",  # Slave_IO_Running
            "Yes",  # Slave_SQL_Running
            None,  # Last_IO_Error
            None,  # Last_SQL_Error
            0,  # Seconds_Behind_Master
            1,  # Master_Server_Id
        )
    ]


@pytest.fixture
def mock_mysql_show_master_status() -> list[tuple]:
    """Sample SHOW MASTER STATUS result."""
    return [
        (
            "mysql-bin.000001",  # File
            154,  # Position
            None,  # Binlog_Do_DB
            None,  # Binlog_Ignore_DB
            None,  # Executed_Gtid_Set
        )
    ]


@pytest.fixture
def mock_mysql_show_status() -> dict[str, str]:
    """Sample SHOW GLOBAL STATUS result."""
    return {
        "Threads_connected": "10",
        "Threads_running": "2",
        "Connections": "1000",
        "Queries": "50000",
        "Uptime": "86400",
        "Innodb_buffer_pool_read_requests": "100000",
        "Innodb_buffer_pool_reads": "1000",
    }


@pytest.fixture
def mock_mysql_show_variables() -> dict[str, str]:
    """Sample SHOW GLOBAL VARIABLES result."""
    return {
        "server_id": "1",
        "version": "8.0.35",
        "read_only": "OFF",
        "max_connections": "1000",
        "innodb_buffer_pool_size": "134217728",
    }


# Mock HTTP responses
@pytest.fixture
def mock_aiohttp_session() -> AsyncMock:
    """Create a mock aiohttp session."""
    mock_session = AsyncMock()
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value={"status": "ok"})
    mock_response.text = AsyncMock(return_value="OK")
    mock_session.get = AsyncMock(return_value=mock_response)
    mock_session.post = AsyncMock(return_value=mock_response)
    return mock_session


# Alert fixtures
@pytest.fixture
def sample_alert_data() -> dict[str, Any]:
    """Sample alert data."""
    return {
        "alert_id": "alert-001",
        "instance_id": "mysql-replica-1:3306",
        "check_name": "replication_lag",
        "severity": "warning",
        "message": "Replication lag is high: 5.2 seconds",
        "value": 5.2,
        "threshold": 5.0,
        "triggered_at": datetime.utcnow().isoformat(),
    }


# Metrics fixtures
@pytest.fixture
def sample_metrics() -> dict[str, float]:
    """Sample metrics data."""
    return {
        "connections_current": 10,
        "connections_max": 1000,
        "queries_per_second": 150.5,
        "replication_lag_seconds": 0.5,
        "innodb_buffer_pool_hit_rate": 0.99,
        "uptime_seconds": 86400,
    }


# Configuration fixtures
@pytest.fixture
def sample_config() -> dict[str, Any]:
    """Sample configuration data."""
    return {
        "failover": {
            "auto_failover_enabled": True,
            "timeout_seconds": 30,
            "min_replicas_for_failover": 2,
            "confirmation_checks": 3,
        },
        "monitoring": {
            "collection_interval": 15.0,
            "health_check_interval": 10.0,
            "alert_cooldown_minutes": 5,
        },
        "discovery": {
            "network_segments": ["172.18.0.0/24"],
            "port_range": [3306, 3306],
            "timeout": 2.0,
            "max_concurrent": 100,
        },
    }


# Valid API token for testing
@pytest.fixture
def valid_token(test_settings: Settings) -> str:
    """Generate a valid JWT token for testing."""
    from clawsql.utils.security import TokenManager

    manager = TokenManager(
        secret_key=test_settings.api.token_secret,
        expiry_hours=24,
    )
    return manager.create_token(user_id="test-user", permissions=["read", "write"])


# Auth headers
@pytest.fixture
def auth_headers(valid_token: str) -> dict[str, str]:
    """Create authorization headers."""
    return {"Authorization": f"Bearer {valid_token}"}
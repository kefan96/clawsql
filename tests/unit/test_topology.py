"""Unit tests for Orchestrator client and topology management."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from clawsql.core.discovery.models import InstanceRole, InstanceState, MySQLInstance
from clawsql.core.discovery.topology import (
    OrchestratorClient,
    OrchestratorConfig,
    OrchestratorError,
)


class TestOrchestratorConfig:
    """Tests for OrchestratorConfig dataclass."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = OrchestratorConfig()

        assert config.url == "http://orchestrator:3000"
        assert config.timeout == 30.0
        assert config.tls_enabled is False
        assert config.tls_cert is None
        assert config.tls_key is None

    def test_custom_config(self) -> None:
        """Test custom configuration values."""
        config = OrchestratorConfig(
            url="https://orchestrator.example.com:8443",
            timeout=60.0,
            tls_enabled=True,
            tls_cert="/path/to/cert.pem",
            tls_key="/path/to/key.pem",
        )

        assert config.url == "https://orchestrator.example.com:8443"
        assert config.timeout == 60.0
        assert config.tls_enabled is True
        assert config.tls_cert == "/path/to/cert.pem"
        assert config.tls_key == "/path/to/key.pem"


class TestOrchestratorClient:
    """Tests for OrchestratorClient class."""

    @pytest.fixture
    def client(self) -> OrchestratorClient:
        """Create an Orchestrator client for testing."""
        return OrchestratorClient(
            config=OrchestratorConfig(url="http://test-orchestrator:3000")
        )

    @pytest.fixture
    def mock_session(self) -> MagicMock:
        """Create a mock aiohttp session."""
        session = MagicMock()
        session.closed = False
        return session

    def test_client_initialization(self) -> None:
        """Test client initialization."""
        client = OrchestratorClient()

        assert client.config is not None
        assert client.base_url == "http://orchestrator:3000"
        assert client._session is None

    def test_client_with_config(self, client: OrchestratorClient) -> None:
        """Test client with custom config."""
        assert client.base_url == "http://test-orchestrator:3000"

    @pytest.mark.asyncio
    async def test_connect(self, client: OrchestratorClient) -> None:
        """Test establishing connection."""
        with patch("aiohttp.ClientSession") as mock_session_class:
            await client.connect()

            mock_session_class.assert_called_once()
            assert client._session is not None

    @pytest.mark.asyncio
    async def test_close(self, client: OrchestratorClient) -> None:
        """Test closing connection."""
        client._session = AsyncMock()
        client._session.closed = False

        await client.close()

        client._session.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test using client as async context manager."""
        async with OrchestratorClient() as client:
            assert client._session is not None

    @pytest.mark.asyncio
    async def test_health_check_success(self, client: OrchestratorClient) -> None:
        """Test successful health check."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.get = MagicMock(return_value=mock_response)
        client._session = mock_session

        result = await client.health_check()

        assert result is True

    @pytest.mark.asyncio
    async def test_health_check_failure(self, client: OrchestratorClient) -> None:
        """Test failed health check."""
        mock_response = AsyncMock()
        mock_response.status = 500
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_session = AsyncMock()
        mock_session.get.return_value = mock_response
        client._session = mock_session

        result = await client.health_check()

        assert result is False

    @pytest.mark.asyncio
    async def test_health_check_exception(self, client: OrchestratorClient) -> None:
        """Test health check with exception."""
        mock_session = AsyncMock()
        mock_session.get.side_effect = Exception("Connection error")
        client._session = mock_session

        result = await client.health_check()

        assert result is False

    @pytest.mark.asyncio
    async def test_get_clusters(self, client: OrchestratorClient) -> None:
        """Test getting cluster list."""
        mock_response_data = [
            {"cluster_name": "cluster-a"},
            {"cluster_name": "cluster-b"},
        ]

        with patch.object(client, "_get", return_value=mock_response_data):
            clusters = await client.get_clusters()

        assert clusters == ["cluster-a", "cluster-b"]

    @pytest.mark.asyncio
    async def test_get_topology(self, client: OrchestratorClient) -> None:
        """Test getting cluster topology."""
        topology_data = {
            "Alias": "mysql-primary:3306",
            "Key": {"Hostname": "mysql-primary", "Port": 3306},
            "ServerID": 1,
            "Version": "8.0.35",
            "IsPrimary": True,
            "IsLastCheckValid": 1,
            "Child": [
                {
                    "Key": {"Hostname": "mysql-replica-1", "Port": 3306},
                    "ServerID": 2,
                    "IsReplica": True,
                    "IsLastCheckValid": 1,
                }
            ],
        }

        with patch.object(client, "_get", return_value=topology_data):
            cluster = await client.get_topology("test-cluster")

        assert cluster is not None
        assert cluster.cluster_id == "test-cluster"
        assert cluster.primary is not None
        assert cluster.primary.host == "mysql-primary"
        assert len(cluster.replicas) == 1

    @pytest.mark.asyncio
    async def test_get_topology_not_found(self, client: OrchestratorClient) -> None:
        """Test getting topology for non-existent cluster."""
        with patch.object(client, "_get", side_effect=OrchestratorError("Not found")):
            cluster = await client.get_topology("nonexistent")

        assert cluster is None

    @pytest.mark.asyncio
    async def test_get_instance(self, client: OrchestratorClient) -> None:
        """Test getting instance details."""
        instance_data = {
            "Hostname": "mysql-primary",
            "Port": 3306,
            "ServerID": 1,
            "Version": "8.0.35",
            "IsPrimary": True,
            "IsLastCheckValid": 1,
        }

        with patch.object(client, "_get", return_value=instance_data):
            instance = await client.get_instance("mysql-primary", 3306)

        assert instance is not None
        assert instance.host == "mysql-primary"
        assert instance.port == 3306
        assert instance.role == InstanceRole.PRIMARY

    @pytest.mark.asyncio
    async def test_get_instance_not_found(self, client: OrchestratorClient) -> None:
        """Test getting non-existent instance."""
        with patch.object(client, "_get", side_effect=OrchestratorError("Not found")):
            instance = await client.get_instance("nonexistent", 3306)

        assert instance is None

    @pytest.mark.asyncio
    async def test_discover_instance(self, client: OrchestratorClient) -> None:
        """Test discovering an instance."""
        with patch.object(client, "_post", return_value={"Code": "OK"}):
            result = await client.discover_instance("mysql-new", 3306)

        assert result is True

    @pytest.mark.asyncio
    async def test_discover_instance_failure(self, client: OrchestratorClient) -> None:
        """Test failed instance discovery."""
        with patch.object(client, "_post", side_effect=OrchestratorError("Failed")):
            result = await client.discover_instance("mysql-new", 3306)

        assert result is False

    @pytest.mark.asyncio
    async def test_forget_instance(self, client: OrchestratorClient) -> None:
        """Test forgetting an instance."""
        with patch.object(client, "_post", return_value={"Code": "OK"}):
            result = await client.forget_instance("mysql-old", 3306)

        assert result is True

    @pytest.mark.asyncio
    async def test_begin_maintenance(self, client: OrchestratorClient) -> None:
        """Test starting maintenance mode."""
        with patch.object(client, "_post", return_value={"Code": "OK"}):
            result = await client.begin_maintenance(
                "mysql-replica", 3306, "Planned maintenance", 60
            )

        assert result is True

    @pytest.mark.asyncio
    async def test_end_maintenance(self, client: OrchestratorClient) -> None:
        """Test ending maintenance mode."""
        with patch.object(client, "_post", return_value={"Code": "OK"}):
            result = await client.end_maintenance("mysql-replica", 3306)

        assert result is True

    @pytest.mark.asyncio
    async def test_get_replication_analysis(self, client: OrchestratorClient) -> None:
        """Test getting replication analysis."""
        analysis_data = [
            {
                "analysis": "No issues",
                "cluster": "test-cluster",
            }
        ]

        with patch.object(client, "_get", return_value=analysis_data):
            result = await client.get_replication_analysis()

        assert result == analysis_data

    @pytest.mark.asyncio
    async def test_request_failover(self, client: OrchestratorClient) -> None:
        """Test requesting failover."""
        failover_result = {
            "Code": "OK",
            "Message": "Failover completed",
            "Details": {
                "Successor": {"Hostname": "mysql-replica-1", "Port": 3306}
            },
        }

        with patch.object(client, "_post", return_value=failover_result):
            result = await client.request_failover("mysql-primary", 3306)

        assert result == failover_result

    @pytest.mark.asyncio
    async def test_request_failover_with_destination(
        self, client: OrchestratorClient
    ) -> None:
        """Test requesting failover to specific destination."""
        failover_result = {
            "Code": "OK",
            "Message": "Failover completed",
        }

        with patch.object(client, "_post", return_value=failover_result):
            result = await client.request_failover(
                "mysql-primary", 3306, "mysql-replica-2"
            )

        assert result == failover_result

    @pytest.mark.asyncio
    async def test_relocate_replicas(self, client: OrchestratorClient) -> None:
        """Test relocating replicas."""
        with patch.object(client, "_post", return_value={"Code": "OK"}):
            result = await client.relocate_replicas(
                "mysql-primary", 3306, "mysql-new-primary", 3306
            )

        assert result is True

    @pytest.mark.asyncio
    async def test_relocate_replicas_failure(self, client: OrchestratorClient) -> None:
        """Test failed replica relocation."""
        with patch.object(client, "_post", side_effect=OrchestratorError("Failed")):
            result = await client.relocate_replicas(
                "mysql-primary", 3306, "mysql-new-primary", 3306
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_get_request(self, client: OrchestratorClient) -> None:
        """Test GET request to API."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"data": "test"})
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.get = MagicMock(return_value=mock_response)
        client._session = mock_session

        result = await client._get("/api/test")

        assert result == {"data": "test"}

    @pytest.mark.asyncio
    async def test_get_request_error(self, client: OrchestratorClient) -> None:
        """Test GET request with error response."""
        mock_response = AsyncMock()
        mock_response.status = 500
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.get = MagicMock(return_value=mock_response)
        client._session = mock_session

        with pytest.raises(OrchestratorError):
            await client._get("/api/test")

    @pytest.mark.asyncio
    async def test_post_request(self, client: OrchestratorClient) -> None:
        """Test POST request to API."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"result": "ok"})
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.post = MagicMock(return_value=mock_response)
        client._session = mock_session

        result = await client._post("/api/test", json={"key": "value"})

        assert result == {"result": "ok"}

    def test_parse_instance(self, client: OrchestratorClient) -> None:
        """Test parsing instance data."""
        data = {
            "Hostname": "mysql-primary",
            "Port": 3306,
            "ServerID": 1,
            "Version": "8.0.35",
            "IsPrimary": True,
            "IsLastCheckValid": 1,
            "ClusterName": "test-cluster",
        }

        instance = client._parse_instance(data)

        assert instance is not None
        assert instance.host == "mysql-primary"
        assert instance.port == 3306
        assert instance.server_id == 1
        assert instance.version == "8.0.35"
        assert instance.role == InstanceRole.PRIMARY
        assert instance.state == InstanceState.ONLINE

    def test_parse_instance_replica(self, client: OrchestratorClient) -> None:
        """Test parsing replica instance data."""
        data = {
            "Key": {"Hostname": "mysql-replica", "Port": 3306},
            "ServerID": 2,
            "IsReplica": True,
            "IsLastCheckValid": 1,
            "ReplicationLagSeconds": 0.5,
        }

        instance = client._parse_instance(data)

        assert instance is not None
        assert instance.host == "mysql-replica"
        assert instance.role == InstanceRole.REPLICA
        assert instance.replication_lag == 0.5

    def test_parse_instance_maintenance(self, client: OrchestratorClient) -> None:
        """Test parsing instance in maintenance mode."""
        data = {
            "Hostname": "mysql-maint",
            "Port": 3306,
            "IsPrimary": True,
            "IsLastCheckValid": 1,
            "in_maintenance": True,
        }

        instance = client._parse_instance(data)

        assert instance is not None
        assert instance.state == InstanceState.MAINTENANCE

    def test_parse_instance_empty(self, client: OrchestratorClient) -> None:
        """Test parsing empty instance data."""
        instance = client._parse_instance({})

        assert instance is None

    def test_parse_instance_none(self, client: OrchestratorClient) -> None:
        """Test parsing None instance data."""
        instance = client._parse_instance(None)

        assert instance is None


class TestOrchestratorError:
    """Tests for OrchestratorError exception."""

    def test_error_message(self) -> None:
        """Test error message."""
        error = OrchestratorError("Test error")

        assert str(error) == "Test error"
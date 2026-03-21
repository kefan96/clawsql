"""Unit tests for network scanner and instance registry."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from clawsql.core.discovery.models import InstanceRole, InstanceState, MySQLInstance
from clawsql.core.discovery.scanner import InstanceRegistry, NetworkScanner


class TestNetworkScanner:
    """Tests for NetworkScanner class."""

    def test_scanner_initialization(self) -> None:
        """Test scanner initialization with default values."""
        scanner = NetworkScanner(
            network_segments=["192.168.1.0/24"],
        )

        assert scanner.network_segments == ["192.168.1.0/24"]
        assert scanner.mysql_port_range == (3306, 3306)
        assert scanner.scan_timeout == 2.0
        assert scanner.max_concurrent == 100
        assert scanner.credentials == {}

    def test_scanner_custom_values(self) -> None:
        """Test scanner initialization with custom values."""
        scanner = NetworkScanner(
            network_segments=["10.0.0.0/16"],
            mysql_port_range=(3306, 3308),
            scan_timeout=5.0,
            max_concurrent=50,
            credentials={"user": "monitor", "password": "secret"},
        )

        assert scanner.network_segments == ["10.0.0.0/16"]
        assert scanner.mysql_port_range == (3306, 3308)
        assert scanner.scan_timeout == 5.0
        assert scanner.max_concurrent == 50
        assert scanner.credentials == {"user": "monitor", "password": "secret"}

    def test_expand_networks_single_ip(self) -> None:
        """Test expanding single IP address."""
        scanner = NetworkScanner(network_segments=["192.168.1.1"])
        ips = scanner._expand_networks()

        assert ips == ["192.168.1.1"]

    def test_expand_networks_small_subnet(self) -> None:
        """Test expanding small subnet."""
        scanner = NetworkScanner(network_segments=["192.168.1.0/30"])
        ips = scanner._expand_networks()

        # /30 network has 2 usable hosts (192.168.1.1 and 192.168.1.2)
        assert len(ips) == 2
        assert "192.168.1.1" in ips
        assert "192.168.1.2" in ips

    def test_expand_networks_multiple_segments(self) -> None:
        """Test expanding multiple network segments."""
        scanner = NetworkScanner(
            network_segments=["192.168.1.0/30", "10.0.0.1"]
        )
        ips = scanner._expand_networks()

        assert len(ips) == 3
        assert "192.168.1.1" in ips
        assert "192.168.1.2" in ips
        assert "10.0.0.1" in ips

    @pytest.mark.asyncio
    async def test_check_port_open(self) -> None:
        """Test checking open port."""
        scanner = NetworkScanner(network_segments=["127.0.0.1"])

        with patch("asyncio.open_connection", new_callable=AsyncMock) as mock_conn:
            mock_reader = AsyncMock()
            mock_writer = AsyncMock()
            mock_conn.return_value = (mock_reader, mock_writer)

            result = await scanner._check_port("192.168.1.1", 3306)

            assert result is True
            mock_conn.assert_called_once()

    @pytest.mark.asyncio
    async def test_check_port_closed(self) -> None:
        """Test checking closed port."""
        scanner = NetworkScanner(network_segments=["127.0.0.1"])

        with patch("asyncio.open_connection", side_effect=ConnectionRefusedError):
            result = await scanner._check_port("192.168.1.1", 3306)
            assert result is False

    @pytest.mark.asyncio
    async def test_check_port_timeout(self) -> None:
        """Test checking port with timeout."""
        scanner = NetworkScanner(network_segments=["127.0.0.1"], scan_timeout=0.1)

        with patch("asyncio.open_connection", side_effect=asyncio.TimeoutError):
            result = await scanner._check_port("192.168.1.1", 3306)
            assert result is False

    def test_connect_and_probe_success(self) -> None:
        """Test successful MySQL probe."""
        scanner = NetworkScanner(
            network_segments=["127.0.0.1"],
            credentials={"user": "monitor", "password": "secret"},
        )

        mock_connection = MagicMock()
        mock_cursor = MagicMock()

        # Mock cursor execute and fetchone for version, server_id, and slave status
        mock_cursor.execute.side_effect = None
        mock_cursor.fetchone.side_effect = [
            ("8.0.35",),  # VERSION()
            (1,),  # server_id
            None,  # SHOW SLAVE STATUS (no rows = primary)
            ("mysql-bin.000001", 154),  # SHOW MASTER STATUS
        ]
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_connection.cursor.return_value = mock_cursor

        with patch("pymysql.connect", return_value=mock_connection):
            result = scanner._connect_and_probe("mysql-primary", 3306)

        assert result is not None
        assert result["version"] == "8.0.35"
        assert result["server_id"] == 1
        assert result["role_hint"] == "primary"

    def test_connect_and_probe_replica(self) -> None:
        """Test MySQL probe detecting replica."""
        scanner = NetworkScanner(network_segments=["127.0.0.1"])

        mock_connection = MagicMock()
        mock_cursor = MagicMock()

        mock_cursor.fetchone.side_effect = [
            ("8.0.35",),  # VERSION()
            (2,),  # server_id
            ("some_slave_data",),  # SHOW SLAVE STATUS (has rows = replica)
        ]
        mock_cursor.dictfetchone.return_value = {
            "Seconds_Behind_Master": 0.5
        }
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_connection.cursor.return_value = mock_cursor

        with patch("pymysql.connect", return_value=mock_connection):
            result = scanner._connect_and_probe("mysql-replica", 3306)

        assert result is not None
        assert result["role_hint"] == "replica"
        assert result["replication_lag"] == 0.5

    def test_connect_and_probe_failure(self) -> None:
        """Test MySQL probe failure handling."""
        scanner = NetworkScanner(network_segments=["127.0.0.1"])

        with patch("pymysql.connect", side_effect=Exception("Connection failed")):
            result = scanner._connect_and_probe("mysql-offline", 3306)

        assert result is None

    @pytest.mark.skip(reason="Difficult to mock run_in_executor across threads; tested via integration tests")
    @pytest.mark.asyncio
    async def test_probe_instance(self) -> None:
        """Test probe_instance method."""
        from clawsql.core.discovery import scanner as scanner_module

        scanner = NetworkScanner(
            network_segments=["127.0.0.1"],
            credentials={"user": "monitor", "password": "secret"},
        )

        # Create a mock executor result
        async def mock_executor(*args, **kwargs):
            return {
                "version": "8.0.35",
                "server_id": 1,
                "role_hint": "primary",
            }

        # Patch the ThreadPoolExecutor context manager
        with patch.object(scanner_module, "ThreadPoolExecutor") as mock_executor_class:
            mock_executor_instance = MagicMock()
            mock_executor_class.return_value.__enter__ = MagicMock(return_value=mock_executor_instance)
            mock_executor_class.return_value.__exit__ = MagicMock(return_value=False)

            # Patch the event loop's run_in_executor
            with patch("asyncio.AbstractEventLoop.run_in_executor", new=AsyncMock(side_effect=mock_executor)):
                instance = await scanner.probe_instance("mysql-primary", 3306)

        assert instance is not None
        assert instance.host == "mysql-primary"
        assert instance.port == 3306
        assert instance.state == InstanceState.ONLINE
        assert instance.version == "8.0.35"
        assert instance.role == InstanceRole.PRIMARY


class TestInstanceRegistry:
    """Tests for InstanceRegistry class."""

    def test_registry_initialization(self) -> None:
        """Test registry initialization."""
        registry = InstanceRegistry()

        assert registry.count() == 0
        assert registry.get_all() == []

    def test_register_instance(self) -> None:
        """Test registering an instance."""
        registry = InstanceRegistry()
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            role=InstanceRole.PRIMARY,
        )

        registry.register(instance)

        assert registry.count() == 1
        assert registry.get("mysql-primary:3306") == instance

    def test_register_instance_with_cluster(self) -> None:
        """Test registering instance with cluster assignment."""
        registry = InstanceRegistry()
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            cluster_id="test-cluster",
        )

        registry.register(instance)

        cluster_instances = registry.get_by_cluster("test-cluster")
        assert len(cluster_instances) == 1
        assert cluster_instances[0] == instance

    def test_unregister_instance(self) -> None:
        """Test unregistering an instance."""
        registry = InstanceRegistry()
        instance = MySQLInstance(
            host="mysql-primary",
            port=3306,
            cluster_id="test-cluster",
        )
        registry.register(instance)

        result = registry.unregister("mysql-primary:3306")

        assert result is True
        assert registry.count() == 0
        assert registry.get_by_cluster("test-cluster") == []

    def test_unregister_nonexistent(self) -> None:
        """Test unregistering non-existent instance."""
        registry = InstanceRegistry()

        result = registry.unregister("nonexistent:3306")

        assert result is False

    def test_get_instance(self) -> None:
        """Test getting an instance by ID."""
        registry = InstanceRegistry()
        instance = MySQLInstance(host="mysql-primary", port=3306)
        registry.register(instance)

        found = registry.get("mysql-primary:3306")
        not_found = registry.get("nonexistent:3306")

        assert found == instance
        assert not_found is None

    def test_get_all(self) -> None:
        """Test getting all instances."""
        registry = InstanceRegistry()
        instance1 = MySQLInstance(host="primary", port=3306)
        instance2 = MySQLInstance(host="replica", port=3306)
        registry.register(instance1)
        registry.register(instance2)

        all_instances = registry.get_all()

        assert len(all_instances) == 2
        assert instance1 in all_instances
        assert instance2 in all_instances

    def test_get_by_cluster(self) -> None:
        """Test getting instances by cluster."""
        registry = InstanceRegistry()
        instance1 = MySQLInstance(host="primary", port=3306, cluster_id="cluster-a")
        instance2 = MySQLInstance(host="replica1", port=3306, cluster_id="cluster-a")
        instance3 = MySQLInstance(host="replica2", port=3306, cluster_id="cluster-b")
        registry.register(instance1)
        registry.register(instance2)
        registry.register(instance3)

        cluster_a = registry.get_by_cluster("cluster-a")
        cluster_b = registry.get_by_cluster("cluster-b")
        cluster_c = registry.get_by_cluster("cluster-c")

        assert len(cluster_a) == 2
        assert len(cluster_b) == 1
        assert cluster_c == []

    def test_get_by_state(self) -> None:
        """Test getting instances by state."""
        registry = InstanceRegistry()
        online = MySQLInstance(host="online", port=3306, state=InstanceState.ONLINE)
        offline = MySQLInstance(host="offline", port=3306, state=InstanceState.OFFLINE)
        maintenance = MySQLInstance(
            host="maintenance", port=3306, state=InstanceState.MAINTENANCE
        )
        registry.register(online)
        registry.register(offline)
        registry.register(maintenance)

        online_instances = registry.get_by_state(InstanceState.ONLINE)
        offline_instances = registry.get_by_state(InstanceState.OFFLINE)
        maintenance_instances = registry.get_by_state(InstanceState.MAINTENANCE)

        assert len(online_instances) == 1
        assert len(offline_instances) == 1
        assert len(maintenance_instances) == 1
        assert online_instances[0] == online

    def test_clear(self) -> None:
        """Test clearing all instances."""
        registry = InstanceRegistry()
        instance1 = MySQLInstance(host="primary", port=3306, cluster_id="test")
        instance2 = MySQLInstance(host="replica", port=3306, cluster_id="test")
        registry.register(instance1)
        registry.register(instance2)

        registry.clear()

        assert registry.count() == 0
        assert registry.get_by_cluster("test") == []

    def test_count(self) -> None:
        """Test counting instances."""
        registry = InstanceRegistry()

        assert registry.count() == 0

        registry.register(MySQLInstance(host="primary", port=3306))
        assert registry.count() == 1

        registry.register(MySQLInstance(host="replica", port=3306))
        assert registry.count() == 2

        registry.unregister("primary:3306")
        assert registry.count() == 1

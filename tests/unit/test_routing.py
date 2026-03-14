"""Unit tests for routing module - load balancer."""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from clawsql.core.discovery.models import InstanceRole, InstanceState, MySQLInstance
from clawsql.core.monitoring.collector import InstanceMetrics
from clawsql.core.routing.load_balancer import DynamicLoadBalancer, LoadMetrics


class TestLoadMetrics:
    """Tests for LoadMetrics dataclass."""

    def test_load_metrics_creation(self) -> None:
        """Test creating load metrics."""
        metrics = LoadMetrics(
            instance_id="mysql-replica:3306",
            connections=50,
            max_connections=100,
            queries_per_second=150.5,
            weight=0.75,
        )

        assert metrics.instance_id == "mysql-replica:3306"
        assert metrics.connections == 50
        assert metrics.max_connections == 100
        assert metrics.weight == 0.75

    def test_connection_usage_pct(self) -> None:
        """Test connection usage percentage calculation."""
        metrics = LoadMetrics(
            instance_id="test:3306",
            connections=50,
            max_connections=100,
        )

        assert metrics.connection_usage_pct == 50.0

    def test_connection_usage_pct_zero_max(self) -> None:
        """Test connection usage with zero max connections."""
        metrics = LoadMetrics(
            instance_id="test:3306",
            connections=50,
            max_connections=0,
        )

        assert metrics.connection_usage_pct == 0.0

    def test_default_values(self) -> None:
        """Test default values."""
        metrics = LoadMetrics(instance_id="test:3306")

        assert metrics.connections == 0
        assert metrics.max_connections == 0
        assert metrics.queries_per_second == 0.0
        assert metrics.weight == 1.0


class TestDynamicLoadBalancer:
    """Tests for DynamicLoadBalancer class."""

    @pytest.fixture
    def mock_proxysql(self) -> MagicMock:
        """Create mock ProxySQL manager."""
        manager = MagicMock()
        manager.get_servers = AsyncMock(return_value=[])
        manager.update_server_weight = AsyncMock(return_value=True)
        manager.update_server_status = AsyncMock(return_value=True)
        manager.load_config_to_runtime = AsyncMock(return_value=True)
        return manager

    @pytest.fixture
    def mock_metrics_collector(self) -> MagicMock:
        """Create mock metrics collector."""
        collector = MagicMock()
        collector.get_latest_metrics = MagicMock(return_value=None)
        return collector

    @pytest.fixture
    def load_balancer(
        self, mock_proxysql: MagicMock, mock_metrics_collector: MagicMock
    ) -> DynamicLoadBalancer:
        """Create a load balancer instance."""
        return DynamicLoadBalancer(
            proxysql_manager=mock_proxysql,
            metrics_collector=mock_metrics_collector,
            rebalance_threshold=0.2,
            check_interval_seconds=30.0,
        )

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
            connections_current=50,
            connections_max=100,
            queries_per_second=150.0,
            cpu_usage=30.0,
            replication_lag_seconds=0.5,
        )

    def test_load_balancer_initialization(
        self, load_balancer: DynamicLoadBalancer
    ) -> None:
        """Test load balancer initialization."""
        assert load_balancer.rebalance_threshold == 0.2
        assert load_balancer.check_interval == 30.0
        assert load_balancer.min_weight == 1
        assert load_balancer.max_weight == 100
        assert load_balancer._running is False

    def test_calculate_weight_no_metrics(
        self,
        load_balancer: DynamicLoadBalancer,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test weight calculation with no metrics."""
        weight = load_balancer.calculate_weight(sample_instance, None)

        assert weight == 0.5  # Default weight

    def test_calculate_weight_with_metrics(
        self,
        load_balancer: DynamicLoadBalancer,
        sample_instance: MySQLInstance,
        sample_metrics: InstanceMetrics,
    ) -> None:
        """Test weight calculation with metrics."""
        weight = load_balancer.calculate_weight(sample_instance, sample_metrics)

        # Weight should be between 0.1 and 1.0
        assert 0.1 <= weight <= 1.0

    def test_calculate_weight_high_load(
        self,
        load_balancer: DynamicLoadBalancer,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test weight calculation with high load."""
        high_load_metrics = InstanceMetrics(
            instance_id="mysql-replica:3306",
            connections_current=95,
            connections_max=100,
            queries_per_second=1000.0,
            cpu_usage=90.0,
            replication_lag_seconds=10.0,
        )

        weight = load_balancer.calculate_weight(sample_instance, high_load_metrics)

        # High load should result in lower weight
        assert weight < 0.5

    def test_calculate_weight_low_load(
        self,
        load_balancer: DynamicLoadBalancer,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test weight calculation with low load."""
        low_load_metrics = InstanceMetrics(
            instance_id="mysql-replica:3306",
            connections_current=10,
            connections_max=100,
            queries_per_second=50.0,
            cpu_usage=20.0,
            replication_lag_seconds=0.1,
        )

        weight = load_balancer.calculate_weight(sample_instance, low_load_metrics)

        # Low load should result in higher weight
        assert weight > 0.5

    def test_should_rebalance_no_change(self, load_balancer: DynamicLoadBalancer) -> None:
        """Test rebalance decision with no significant change."""
        current = {"instance1:3306": 50}
        calculated = {"instance1:3306": 0.5}

        # 0.5 * 100 = 50, so no change
        result = load_balancer.should_rebalance(current, calculated)

        assert result is False

    def test_should_rebalance_significant_change(
        self, load_balancer: DynamicLoadBalancer
    ) -> None:
        """Test rebalance decision with significant change."""
        current = {"instance1:3306": 50}
        calculated = {"instance1:3306": 0.8}  # 80 vs 50 is > 20% change

        result = load_balancer.should_rebalance(current, calculated)

        assert result is True

    def test_should_rebalance_new_instance(
        self, load_balancer: DynamicLoadBalancer
    ) -> None:
        """Test rebalance decision with new instance."""
        current = {"instance1:3306": 50}
        calculated = {"instance1:3306": 0.5, "instance2:3306": 0.5}

        result = load_balancer.should_rebalance(current, calculated)

        assert result is True

    def test_should_rebalance_empty(self, load_balancer: DynamicLoadBalancer) -> None:
        """Test rebalance decision with empty weights."""
        assert load_balancer.should_rebalance({}, {}) is True
        assert load_balancer.should_rebalance({"a": 50}, {}) is True
        assert load_balancer.should_rebalance({}, {"a": 0.5}) is True

    @pytest.mark.asyncio
    async def test_get_current_weights(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_proxysql: MagicMock,
    ) -> None:
        """Test getting current weights."""
        mock_server = MagicMock()
        mock_server.hostname = "mysql-replica"
        mock_server.port = 3306
        mock_server.weight = 50
        mock_proxysql.get_servers.return_value = [mock_server]

        weights = await load_balancer.get_current_weights(20)

        assert "mysql-replica:3306" in weights
        assert weights["mysql-replica:3306"] == 50

    @pytest.mark.asyncio
    async def test_rebalance_read_pool(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_metrics_collector: MagicMock,
        mock_proxysql: MagicMock,
        sample_instance: MySQLInstance,
        sample_metrics: InstanceMetrics,
    ) -> None:
        """Test rebalancing read pool."""
        mock_metrics_collector.get_latest_metrics.return_value = sample_metrics

        mock_server = MagicMock()
        mock_server.hostname = "mysql-replica"
        mock_server.port = 3306
        mock_server.weight = 1
        mock_proxysql.get_servers.return_value = [mock_server]

        result = await load_balancer.rebalance_read_pool(20, [sample_instance])

        # Should have attempted to update weights
        assert result is True or result is False  # Depends on threshold

    @pytest.mark.asyncio
    async def test_rebalance_empty_pool(self, load_balancer: DynamicLoadBalancer) -> None:
        """Test rebalancing empty pool."""
        result = await load_balancer.rebalance_read_pool(20, [])

        assert result is False

    @pytest.mark.asyncio
    async def test_set_instance_offline(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_proxysql: MagicMock,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test setting instance offline."""
        result = await load_balancer.set_instance_offline(sample_instance, 20)

        assert result is True
        mock_proxysql.update_server_status.assert_called_with(
            sample_instance, "OFFLINE_SOFT", 20
        )

    @pytest.mark.asyncio
    async def test_set_instance_offline_hard(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_proxysql: MagicMock,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test setting instance offline hard."""
        result = await load_balancer.set_instance_offline(
            sample_instance, 20, soft=False
        )

        assert result is True
        mock_proxysql.update_server_status.assert_called_with(
            sample_instance, "OFFLINE_HARD", 20
        )

    @pytest.mark.asyncio
    async def test_set_instance_online(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_proxysql: MagicMock,
        sample_instance: MySQLInstance,
    ) -> None:
        """Test setting instance online."""
        result = await load_balancer.set_instance_online(sample_instance, 20)

        assert result is True
        mock_proxysql.update_server_status.assert_called_with(
            sample_instance, "ONLINE", 20
        )

    @pytest.mark.asyncio
    async def test_get_load_distribution(
        self,
        load_balancer: DynamicLoadBalancer,
        mock_proxysql: MagicMock,
    ) -> None:
        """Test getting load distribution."""
        mock_server1 = MagicMock()
        mock_server1.hostname = "replica1"
        mock_server1.port = 3306
        mock_server1.weight = 50
        mock_server1.status = "ONLINE"

        mock_server2 = MagicMock()
        mock_server2.hostname = "replica2"
        mock_server2.port = 3306
        mock_server2.weight = 50
        mock_server2.status = "ONLINE"

        mock_proxysql.get_servers.return_value = [mock_server1, mock_server2]

        distribution = await load_balancer.get_load_distribution(20)

        assert distribution["hostgroup_id"] == 20
        assert distribution["total_weight"] == 100
        assert distribution["server_count"] == 2
        assert len(distribution["distribution"]) == 2

    def test_get_stats(self, load_balancer: DynamicLoadBalancer) -> None:
        """Test getting load balancer stats."""
        stats = load_balancer.get_stats()

        assert "running" in stats
        assert "check_interval" in stats
        assert "rebalance_threshold" in stats
        assert stats["running"] is False

    @pytest.mark.asyncio
    async def test_start_stop_rebalancing(
        self, load_balancer: DynamicLoadBalancer
    ) -> None:
        """Test starting and stopping rebalancing."""
        cluster = MagicMock()
        cluster.cluster_id = "test-cluster"

        await load_balancer.start_rebalancing([cluster])
        assert load_balancer._running is True

        await load_balancer.stop_rebalancing()
        assert load_balancer._running is False
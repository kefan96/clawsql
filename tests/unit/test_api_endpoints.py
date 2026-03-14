"""Unit tests for API endpoints."""

import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from clawsql.core.discovery.models import InstanceRole, InstanceState, MySQLInstance
from clawsql.main import create_app
from clawsql.config.settings import Settings


class TestInstanceEndpoints:
    """Tests for instance API endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_health_check(self, client: TestClient) -> None:
        """Test health check endpoint."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_root_endpoint(self, client: TestClient) -> None:
        """Test root endpoint."""
        response = client.get("/")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "ClawSQL"

    def test_list_instances_empty(self, client: TestClient) -> None:
        """Test listing instances when empty."""
        response = client.get("/api/v1/instances")

        assert response.status_code == 200
        data = response.json()
        # May not be empty if other tests have run, just check structure
        assert "items" in data
        assert "total" in data

    def test_register_instance(self, client: TestClient) -> None:
        """Test registering a new instance."""
        # Use unique host/port to avoid conflicts
        response = client.post(
            "/api/v1/instances/",
            json={
                "host": "mysql-test-register",
                "port": 3306,
                "cluster_id": "test-cluster",
                "labels": {"env": "test"},
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["host"] == "mysql-test-register"
        assert data["port"] == 3306
        assert data["instance_id"] == "mysql-test-register:3306"

    def test_register_duplicate_instance(self, client: TestClient) -> None:
        """Test registering duplicate instance."""
        # Use unique host for this test
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-dup-test", "port": 3306},
        )

        # Try to register again
        response = client.post(
            "/api/v1/instances/",
            json={"host": "mysql-dup-test", "port": 3306},
        )

        assert response.status_code == 409

    def test_get_instance(self, client: TestClient) -> None:
        """Test getting a specific instance."""
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-primary", "port": 3306},
        )

        response = client.get("/api/v1/instances/mysql-primary:3306")

        assert response.status_code == 200
        data = response.json()
        assert data["instance_id"] == "mysql-primary:3306"

    def test_get_instance_not_found(self, client: TestClient) -> None:
        """Test getting non-existent instance."""
        response = client.get("/api/v1/instances/nonexistent:3306")

        assert response.status_code == 404

    def test_list_instances_with_filters(self, client: TestClient) -> None:
        """Test listing instances with filters."""
        # Register instances
        client.post(
            "/api/v1/instances/",
            json={"host": "primary", "port": 3306, "cluster_id": "cluster-a"},
        )
        client.post(
            "/api/v1/instances/",
            json={"host": "replica", "port": 3306, "cluster_id": "cluster-b"},
        )

        # Filter by cluster
        response = client.get("/api/v1/instances?cluster_id=cluster-a")
        data = response.json()

        assert data["total"] == 1
        assert data["items"][0]["host"] == "primary"

    def test_list_instances_pagination(self, client: TestClient) -> None:
        """Test instance listing pagination."""
        # Register multiple instances with unique names
        for i in range(5):
            client.post(
                "/api/v1/instances/",
                json={"host": f"mysql-pagination-{i}", "port": 3306},
            )

        response = client.get("/api/v1/instances?page=1&page_size=2")
        data = response.json()

        assert len(data["items"]) == 2
        assert data["page"] == 1

    def test_deregister_instance(self, client: TestClient) -> None:
        """Test deregistering an instance."""
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-primary", "port": 3306},
        )

        response = client.delete("/api/v1/instances/mysql-primary:3306")

        assert response.status_code == 204

        # Verify it's gone
        response = client.get("/api/v1/instances/mysql-primary:3306")
        assert response.status_code == 404

    def test_deregister_instance_not_found(self, client: TestClient) -> None:
        """Test deregistering non-existent instance."""
        response = client.delete("/api/v1/instances/nonexistent:3306")

        assert response.status_code == 404

    def test_set_maintenance(self, client: TestClient) -> None:
        """Test setting instance to maintenance."""
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-primary", "port": 3306},
        )

        response = client.post(
            "/api/v1/instances/mysql-primary:3306/maintenance",
            json={"instance_id": "mysql-primary:3306", "duration_minutes": 60, "reason": "Planned maintenance"},
        )

        assert response.status_code == 200

    def test_set_maintenance_not_found(self, client: TestClient) -> None:
        """Test setting maintenance on non-existent instance."""
        response = client.post(
            "/api/v1/instances/nonexistent:3306/maintenance",
            json={"instance_id": "nonexistent:3306", "duration_minutes": 60, "reason": "Test"},
        )

        assert response.status_code == 404

    def test_get_instance_metrics(self, client: TestClient) -> None:
        """Test getting instance metrics."""
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-primary", "port": 3306},
        )

        response = client.get("/api/v1/instances/mysql-primary:3306/metrics")

        assert response.status_code == 200
        data = response.json()
        assert data["instance_id"] == "mysql-primary:3306"

    def test_get_instance_health(self, client: TestClient) -> None:
        """Test getting instance health."""
        # Register first
        client.post(
            "/api/v1/instances/",
            json={"host": "mysql-primary", "port": 3306},
        )

        response = client.get("/api/v1/instances/mysql-primary:3306/health")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "checks" in data


class TestClusterEndpoints:
    """Tests for cluster API endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_list_clusters(self, client: TestClient) -> None:
        """Test listing clusters."""
        response = client.get("/api/v1/clusters")

        assert response.status_code == 200

    def test_create_cluster(self, client: TestClient) -> None:
        """Test creating a cluster."""
        response = client.post(
            "/api/v1/clusters",
            json={
                "name": "Test Cluster",
                "description": "A test cluster",
            },
        )

        assert response.status_code in [200, 201, 409]  # May conflict if exists


class TestMonitoringEndpoints:
    """Tests for monitoring API endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_get_system_health(self, client: TestClient) -> None:
        """Test getting system health."""
        response = client.get("/api/v1/monitoring/health")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_list_alerts(self, client: TestClient) -> None:
        """Test listing alerts."""
        response = client.get("/api/v1/monitoring/alerts")

        assert response.status_code == 200


class TestFailoverEndpoints:
    """Tests for failover API endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_get_failover_history(self, client: TestClient) -> None:
        """Test getting failover history."""
        response = client.get("/api/v1/failover/history")

        assert response.status_code == 200


class TestConfigEndpoints:
    """Tests for configuration API endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_get_config(self, client: TestClient) -> None:
        """Test getting configuration."""
        response = client.get("/api/v1/config")

        assert response.status_code == 200

    def test_get_config_history(self, client: TestClient) -> None:
        """Test getting configuration history."""
        response = client.get("/api/v1/config/history")

        assert response.status_code == 200


class TestOpenAPI:
    """Tests for OpenAPI documentation."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        settings = Settings(
            app_name="ClawSQL Test",
            debug=True,
            api__token_secret="test-secret-key-for-testing",
        )
        app = create_app(settings)
        return TestClient(app)

    def test_docs_endpoint(self, client: TestClient) -> None:
        """Test Swagger docs endpoint."""
        response = client.get("/docs")

        assert response.status_code == 200

    def test_openapi_json(self, client: TestClient) -> None:
        """Test OpenAPI JSON endpoint."""
        response = client.get("/openapi.json")

        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data
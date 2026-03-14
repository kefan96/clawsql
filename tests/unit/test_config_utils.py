"""Unit tests for config and utils modules."""

import pytest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from clawsql.config.settings import Settings, get_settings
from clawsql.config.audit import AuditLog, AuditEntry, AuditAction
from clawsql.config.versioning import ConfigStore
from clawsql.utils.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ClawSQLError,
    ClusterNotFoundError,
    ConfigurationError,
    ConnectionError,
    DiscoveryError,
    FailoverError,
    FailoverInProgressError,
    InstanceNotFoundError,
    MonitoringError,
    NoCandidateError,
    OrchestratorError,
    ProxySQLError,
    ValidationError,
)
from clawsql.utils.security import (
    APIKeyManager,
    TokenManager,
    generate_credentials,
    generate_token,
    hash_password,
    hash_string,
    verify_password,
)


class TestSettings:
    """Tests for Settings configuration."""

    def test_settings_default_values(self) -> None:
        """Test default settings values."""
        settings = Settings()

        assert settings.app_name == "ClawSQL"
        assert settings.app_version == "0.1.0"
        assert settings.debug is False
        assert settings.api.host == "0.0.0.0"
        assert settings.api.port == 8080

    def test_settings_nested_values(self) -> None:
        """Test nested settings values."""
        settings = Settings()

        assert settings.database.host == "localhost"
        assert settings.database.port == 3306
        assert settings.orchestrator.url == "http://orchestrator:3000"
        assert settings.proxysql.admin_port == 6032

    def test_get_settings_cached(self) -> None:
        """Test get_settings returns cached instance."""
        settings1 = get_settings()
        settings2 = get_settings()

        assert settings1 is settings2


class TestAuditLog:
    """Tests for AuditLog class."""

    @pytest.fixture
    def audit_log(self) -> AuditLog:
        """Create an audit log instance."""
        return AuditLog()

    def test_audit_entry_creation(self) -> None:
        """Test creating an audit entry."""
        entry = AuditEntry(
            action=AuditAction.CONFIG_UPDATE,
            actor="admin",
            resource_type="config",
            resource_id="failover.auto_failover_enabled",
            details={"old_value": True, "new_value": False},
        )

        assert entry.action == AuditAction.CONFIG_UPDATE
        assert entry.actor == "admin"
        assert entry.resource_type == "config"

    def test_log_event(self, audit_log: AuditLog) -> None:
        """Test logging an audit event."""
        entry = audit_log.log(
            action=AuditAction.FAILOVER_EXECUTE,
            resource_type="cluster",
            resource_id="cluster-1",
            actor="system",
            details={"old_primary": "mysql-1", "new_primary": "mysql-2"},
        )

        assert entry is not None
        assert entry.action == AuditAction.FAILOVER_EXECUTE

    def test_get_entries(self, audit_log: AuditLog) -> None:
        """Test getting audit entries."""
        audit_log.log(AuditAction.CONFIG_UPDATE, "config", "test")
        entries = audit_log.get_entries(limit=10)

        assert len(entries) > 0

    def test_get_entries_by_action(self, audit_log: AuditLog) -> None:
        """Test filtering entries by action."""
        audit_log.log(AuditAction.CONFIG_UPDATE, "config", "resource-a")
        audit_log.log(AuditAction.FAILOVER_EXECUTE, "cluster", "resource-b")

        entries = audit_log.get_entries(action=AuditAction.CONFIG_UPDATE)

        for entry in entries:
            assert entry.action == AuditAction.CONFIG_UPDATE


class TestConfigStore:
    """Tests for ConfigStore class."""

    @pytest.fixture
    def config_store(self) -> ConfigStore:
        """Create a config store instance with a unique temp path."""
        import tempfile
        import os
        temp_dir = tempfile.mkdtemp()
        store = ConfigStore(storage_path=Path(temp_dir))
        return store

    def test_create_version(self, config_store: ConfigStore) -> None:
        """Test creating a config version."""
        config = {"failover": {"enabled": True}}
        version = config_store.update(config, reason="Initial config")

        assert version is not None
        assert version.config["failover"]["enabled"] is True

    def test_get_version(self, config_store: ConfigStore) -> None:
        """Test getting a config version."""
        config = {"key": "value"}
        created = config_store.update(config)

        retrieved = config_store.get_version(created.version_id)

        assert retrieved is not None

    def test_get_current(self, config_store: ConfigStore) -> None:
        """Test getting current config."""
        config_store.update({"test": {"v": 1}})
        config_store.update({"test": {"v": 2}})

        current = config_store.get_current()

        assert current["test"]["v"] == 2

    def test_get_history(self, config_store: ConfigStore) -> None:
        """Test getting version history."""
        config_store.update({"test": {"v": 1}})
        config_store.update({"test": {"v": 2}})

        history = config_store.get_history()

        # Should have at least the 2 versions we created
        assert len(history) >= 2

    def test_rollback(self, config_store: ConfigStore) -> None:
        """Test rolling back to previous version."""
        v1 = config_store.update({"test": {"v": 1}})
        config_store.update({"test": {"v": 2}})

        result = config_store.rollback(v1.version_id)

        assert result is not None
        assert result.config["test"]["v"] == 1


class TestExceptions:
    """Tests for custom exceptions."""

    def test_clawsql_error(self) -> None:
        """Test base ClawSQL error."""
        error = ClawSQLError("Test error", code="TEST_ERROR", details={"key": "value"})

        assert error.message == "Test error"
        assert error.code == "TEST_ERROR"
        assert error.details == {"key": "value"}

    def test_clawsql_error_to_dict(self) -> None:
        """Test error to_dict conversion."""
        error = ClawSQLError("Test error", code="TEST")
        d = error.to_dict()

        assert d["error"] == "TEST"
        assert d["message"] == "Test error"

    def test_instance_not_found_error(self) -> None:
        """Test InstanceNotFoundError."""
        error = InstanceNotFoundError("mysql-primary:3306")

        assert error.code == "INSTANCE_NOT_FOUND"
        assert "mysql-primary:3306" in error.message

    def test_cluster_not_found_error(self) -> None:
        """Test ClusterNotFoundError."""
        error = ClusterNotFoundError("cluster-1")

        assert error.code == "CLUSTER_NOT_FOUND"
        assert "cluster-1" in error.message

    def test_failover_error(self) -> None:
        """Test FailoverError."""
        error = FailoverError(
            "Failover failed",
            cluster_id="cluster-1",
            operation_id="op-123",
        )

        assert error.code == "FAILOVER_ERROR"
        assert error.details["cluster_id"] == "cluster-1"

    def test_failover_in_progress_error(self) -> None:
        """Test FailoverInProgressError."""
        error = FailoverInProgressError("cluster-1")

        assert error.code == "FAILOVER_IN_PROGRESS"

    def test_no_candidate_error(self) -> None:
        """Test NoCandidateError."""
        error = NoCandidateError("cluster-1")

        assert error.code == "NO_CANDIDATE"

    def test_configuration_error(self) -> None:
        """Test ConfigurationError."""
        error = ConfigurationError("Invalid config", config_path="failover.enabled")

        assert error.code == "CONFIGURATION_ERROR"
        assert error.details["config_path"] == "failover.enabled"

    def test_validation_error(self) -> None:
        """Test ValidationError."""
        error = ValidationError("Invalid value", field="port", value=-1)

        assert error.code == "VALIDATION_ERROR"
        assert error.details["field"] == "port"

    def test_authentication_error(self) -> None:
        """Test AuthenticationError."""
        error = AuthenticationError("Invalid token")

        assert error.code == "AUTHENTICATION_ERROR"

    def test_authorization_error(self) -> None:
        """Test AuthorizationError."""
        error = AuthorizationError("Access denied", resource="/admin", action="write")

        assert error.code == "AUTHORIZATION_ERROR"
        assert error.details["resource"] == "/admin"

    def test_connection_error(self) -> None:
        """Test ConnectionError."""
        error = ConnectionError("Failed to connect", host="mysql", port=3306)

        assert error.code == "CONNECTION_ERROR"
        assert error.details["host"] == "mysql"

    def test_discovery_error(self) -> None:
        """Test DiscoveryError."""
        error = DiscoveryError("Scan failed", network_segment="10.0.0.0/24")

        assert error.code == "DISCOVERY_ERROR"

    def test_monitoring_error(self) -> None:
        """Test MonitoringError."""
        error = MonitoringError("Collection failed", instance_id="mysql:3306")

        assert error.code == "MONITORING_ERROR"

    def test_proxysql_error(self) -> None:
        """Test ProxySQLError."""
        error = ProxySQLError("Query failed", hostgroup=10)

        assert error.code == "PROXYSQL_ERROR"

    def test_orchestrator_error(self) -> None:
        """Test OrchestratorError."""
        error = OrchestratorError("API failed", endpoint="/api/clusters")

        assert error.code == "ORCHESTRATOR_ERROR"


class TestSecurity:
    """Tests for security utilities."""

    def test_hash_password(self) -> None:
        """Test password hashing."""
        password = "secret123"
        hashed = hash_password(password)

        assert hashed != password
        assert hashed.startswith("$2b$")  # bcrypt prefix

    def test_verify_password_correct(self) -> None:
        """Test password verification with correct password."""
        password = "secret123"
        hashed = hash_password(password)

        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self) -> None:
        """Test password verification with incorrect password."""
        hashed = hash_password("secret123")

        assert verify_password("wrong", hashed) is False

    def test_generate_token(self) -> None:
        """Test token generation."""
        token = generate_token(32)

        assert len(token) == 64  # 32 bytes = 64 hex chars
        assert isinstance(token, str)

    def test_generate_token_unique(self) -> None:
        """Test token uniqueness."""
        token1 = generate_token()
        token2 = generate_token()

        assert token1 != token2

    def test_hash_string(self) -> None:
        """Test string hashing."""
        value = "test_string"
        hashed = hash_string(value)

        assert len(hashed) == 64  # SHA-256 produces 64 hex chars
        assert hashed != value

    def test_hash_string_consistent(self) -> None:
        """Test string hash consistency."""
        value = "test_string"
        hash1 = hash_string(value)
        hash2 = hash_string(value)

        assert hash1 == hash2


class TestTokenManager:
    """Tests for TokenManager class."""

    @pytest.fixture
    def token_manager(self) -> TokenManager:
        """Create a token manager instance."""
        return TokenManager(
            secret_key="test-secret-key-for-testing",
            expiry_hours=24,
        )

    def test_create_token(self, token_manager: TokenManager) -> None:
        """Test creating a token."""
        token = token_manager.create_token("user123")

        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_token_with_claims(self, token_manager: TokenManager) -> None:
        """Test creating token with additional claims."""
        token = token_manager.create_token(
            "user123",
            claims={"role": "admin", "permissions": ["read", "write"]},
        )

        payload = token_manager.validate_token(token)

        assert payload is not None
        assert payload["sub"] == "user123"
        assert payload["role"] == "admin"

    def test_validate_token_valid(self, token_manager: TokenManager) -> None:
        """Test validating a valid token."""
        token = token_manager.create_token("user123")
        payload = token_manager.validate_token(token)

        assert payload is not None
        assert payload["sub"] == "user123"

    def test_validate_token_invalid(self, token_manager: TokenManager) -> None:
        """Test validating an invalid token."""
        payload = token_manager.validate_token("invalid.token.here")

        assert payload is None

    def test_validate_token_wrong_secret(self) -> None:
        """Test validating token with wrong secret."""
        manager1 = TokenManager(secret_key="secret1")
        manager2 = TokenManager(secret_key="secret2")

        token = manager1.create_token("user123")
        payload = manager2.validate_token(token)

        assert payload is None

    def test_refresh_token(self, token_manager: TokenManager) -> None:
        """Test refreshing a token."""
        original = token_manager.create_token("user123", claims={"role": "admin"})
        refreshed = token_manager.refresh_token(original)

        assert refreshed is not None
        assert refreshed != original

        payload = token_manager.validate_token(refreshed)
        assert payload["sub"] == "user123"
        assert payload["role"] == "admin"

    def test_refresh_token_invalid(self, token_manager: TokenManager) -> None:
        """Test refreshing an invalid token."""
        refreshed = token_manager.refresh_token("invalid.token")

        assert refreshed is None

    def test_get_token_subject(self, token_manager: TokenManager) -> None:
        """Test getting token subject."""
        token = token_manager.create_token("user123")
        subject = token_manager.get_token_subject(token)

        assert subject == "user123"

    def test_revoke_token(self, token_manager: TokenManager) -> None:
        """Test revoking token."""
        token = token_manager.create_token("user123")
        result = token_manager.revoke_token(token)

        assert result is True


class TestAPIKeyManager:
    """Tests for APIKeyManager class."""

    @pytest.fixture
    def key_manager(self) -> APIKeyManager:
        """Create an API key manager instance."""
        return APIKeyManager(key_prefix="clawsql")

    def test_generate_key(self, key_manager: APIKeyManager) -> None:
        """Test generating an API key."""
        key = key_manager.generate_key("test-key")

        assert key is not None
        assert key.startswith("clawsql_")

    def test_generate_key_with_permissions(self, key_manager: APIKeyManager) -> None:
        """Test generating key with permissions."""
        key = key_manager.generate_key(
            "admin-key",
            permissions=["read", "write", "admin"],
        )

        info = key_manager.validate_key(key)

        assert info is not None
        assert "read" in info["permissions"]
        assert "admin" in info["permissions"]

    def test_generate_key_with_expiry(self, key_manager: APIKeyManager) -> None:
        """Test generating key with expiry."""
        key = key_manager.generate_key("temp-key", expiry_days=7)

        info = key_manager.validate_key(key)
        assert info is not None
        assert "expires_at" in info

    def test_validate_key_valid(self, key_manager: APIKeyManager) -> None:
        """Test validating a valid key."""
        key = key_manager.generate_key("test-key")
        info = key_manager.validate_key(key)

        assert info is not None
        assert info["name"] == "test-key"

    def test_validate_key_invalid(self, key_manager: APIKeyManager) -> None:
        """Test validating an invalid key."""
        info = key_manager.validate_key("invalid_key")

        assert info is None

    def test_validate_key_expired(self, key_manager: APIKeyManager) -> None:
        """Test validating an expired key."""
        key = key_manager.generate_key("expiring", expiry_days=-1)

        info = key_manager.validate_key(key)

        assert info is None  # Expired key should return None

    def test_revoke_key(self, key_manager: APIKeyManager) -> None:
        """Test revoking a key."""
        key = key_manager.generate_key("test-key")

        assert key_manager.validate_key(key) is not None

        result = key_manager.revoke_key(key)

        assert result is True
        assert key_manager.validate_key(key) is None

    def test_revoke_key_nonexistent(self, key_manager: APIKeyManager) -> None:
        """Test revoking non-existent key."""
        result = key_manager.revoke_key("nonexistent")

        assert result is False

    def test_list_keys(self, key_manager: APIKeyManager) -> None:
        """Test listing keys."""
        key_manager.generate_key("key1")
        key_manager.generate_key("key2")

        keys = key_manager.list_keys()

        assert len(keys) == 2


class TestGenerateCredentials:
    """Tests for generate_credentials function."""

    def test_generate_credentials(self) -> None:
        """Test generating random credentials."""
        creds = generate_credentials()

        assert "username" in creds
        assert "password" in creds
        assert creds["username"].startswith("user_")

    def test_generate_credentials_unique(self) -> None:
        """Test credentials uniqueness."""
        creds1 = generate_credentials()
        creds2 = generate_credentials()

        assert creds1["username"] != creds2["username"]
        assert creds1["password"] != creds2["password"]
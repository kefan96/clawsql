"""
Application settings using Pydantic BaseSettings.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """
    Database connection settings for ClawSQL metadata storage.

    Supports two backends:
    - SQLite (default): Zero-config, file-based storage. Good for most deployments.
    - MySQL: For users who want centralized metadata or have backup infrastructure.

    Set DB_TYPE=mysql to use MySQL instead of SQLite.
    """

    model_config = SettingsConfigDict(env_prefix="DB_")

    type: Literal["sqlite", "mysql"] = Field(
        default="sqlite",
        description="Database type: 'sqlite' (default) or 'mysql'",
    )
    # SQLite settings
    sqlite_path: str = Field(
        default="/data/clawsql.db",
        description="Path to SQLite database file (used when type=sqlite)",
    )
    # MySQL settings (used when type=mysql)
    host: str = Field(default="localhost", description="Database host (MySQL only)")
    port: int = Field(default=3306, ge=1, le=65535, description="Database port (MySQL only)")
    name: str = Field(default="clawsql", description="Database name (MySQL only)")
    user: str = Field(default="clawsql", description="Database user (MySQL only)")
    password: str = Field(default="", description="Database password (MySQL only)")
    pool_size: int = Field(default=10, ge=1, le=100, description="Connection pool size (MySQL only)")

    @property
    def is_sqlite(self) -> bool:
        """Check if using SQLite backend."""
        return self.type == "sqlite"

    @property
    def is_mysql(self) -> bool:
        """Check if using MySQL backend."""
        return self.type == "mysql"

    def get_connection_url(self) -> str:
        """
        Get database connection URL.

        Returns:
            Connection URL string for the configured database type
        """
        if self.is_sqlite:
            return f"sqlite+aiosqlite:///{self.sqlite_path}"
        else:
            return (
                f"mysql+aiomysql://{self.user}:{self.password}"
                f"@{self.host}:{self.port}/{self.name}"
            )


class OrchestratorSettings(BaseSettings):
    """Orchestrator connection settings."""

    model_config = SettingsConfigDict(env_prefix="ORCHESTRATOR_")

    url: str = Field(default="http://orchestrator:3000", description="Orchestrator URL")
    timeout: float = Field(default=30.0, ge=1.0, description="API timeout")
    tls_enabled: bool = Field(default=False, description="Enable TLS")
    tls_cert: str | None = Field(default=None, description="TLS certificate path")
    tls_key: str | None = Field(default=None, description="TLS key path")


class ProxySQLSettings(BaseSettings):
    """ProxySQL connection settings."""

    model_config = SettingsConfigDict(env_prefix="PROXYSQL_")

    host: str = Field(default="proxysql", description="ProxySQL host")
    admin_port: int = Field(default=6032, description="Admin port")
    mysql_port: int = Field(default=6033, description="MySQL traffic port")
    admin_user: str = Field(default="admin", description="Admin user")
    admin_password: str = Field(default="admin", description="Admin password")


class PrometheusSettings(BaseSettings):
    """Prometheus settings."""

    model_config = SettingsConfigDict(env_prefix="PROMETHEUS_")

    url: str = Field(default="http://prometheus:9090", description="Prometheus URL")
    retention_days: int = Field(default=15, ge=1, description="Metrics retention days")


class MonitoringSettings(BaseSettings):
    """Monitoring settings."""

    model_config = SettingsConfigDict(env_prefix="", env_nested_delimiter="_")

    collection_interval: float = Field(
        default=15.0, ge=1.0, description="Metrics collection interval"
    )
    health_check_interval: float = Field(
        default=10.0, ge=1.0, description="Health check interval"
    )
    alert_cooldown_minutes: int = Field(
        default=5, ge=0, description="Alert cooldown period"
    )


class FailoverSettings(BaseSettings):
    """Failover settings."""

    model_config = SettingsConfigDict(env_prefix="", env_nested_delimiter="_")

    auto_failover_enabled: bool = Field(
        default=True, description="Enable automatic failover"
    )
    timeout_seconds: int = Field(default=30, ge=10, description="Failover timeout")
    min_replicas_for_failover: int = Field(
        default=2, ge=0, description="Minimum replicas required"
    )
    confirmation_checks: int = Field(
        default=3, ge=1, description="Confirmation checks before failover"
    )


class DiscoverySettings(BaseSettings):
    """Discovery settings."""

    model_config = SettingsConfigDict(env_prefix="DISCOVERY_")

    network_segments: str = Field(
        default="172.18.0.0/24", description="Network segments to scan (comma-separated)"
    )
    port_range_start: int = Field(default=3306, description="Port range start")
    port_range_end: int = Field(default=3306, description="Port range end")
    timeout: float = Field(default=2.0, description="Scan timeout")
    max_concurrent: int = Field(default=100, description="Max concurrent scans")

    def get_network_segments(self) -> list[str]:
        """Get network segments as list."""
        return [s.strip() for s in self.network_segments.split(",")]

    def get_port_range(self) -> tuple[int, int]:
        """Get port range as tuple."""
        return (self.port_range_start, self.port_range_end)


class APISettings(BaseSettings):
    """API settings."""

    model_config = SettingsConfigDict(env_prefix="API_")

    host: str = Field(default="0.0.0.0", description="API host")
    port: int = Field(default=8080, ge=1, le=65535, description="API port")
    token_secret: str = Field(default="change-me", description="JWT secret")
    token_expiry_hours: int = Field(default=24, ge=1, description="Token expiry hours")

    @field_validator("token_secret")
    @classmethod
    def validate_secret(cls, v: str) -> str:
        if v == "change-me":
            import warnings

            warnings.warn(
                "Using default token secret. Set API_TOKEN_SECRET environment variable.",
                UserWarning,
            )
        return v


class MySQLCredentials(BaseSettings):
    """MySQL credentials for monitoring."""

    model_config = SettingsConfigDict(env_prefix="MYSQL_")

    monitor_user: str = Field(default="monitor", description="Monitor user")
    monitor_password: str = Field(default="", description="Monitor password")
    replication_user: str = Field(default="repl", description="Replication user")
    replication_password: str = Field(default="", description="Replication password")


class LogSettings(BaseSettings):
    """Logging settings."""

    model_config = SettingsConfigDict(env_prefix="LOG_")

    level: str = Field(default="INFO", description="Log level")
    format: str = Field(default="json", description="Log format (json/text)")

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: str) -> str:
        valid_levels = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}")
        return v


class Settings(BaseSettings):
    """
    Main application settings.

    Combines all setting groups and loads from environment.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application info
    app_name: str = Field(default="ClawSQL", description="Application name")
    app_version: str = Field(default="0.1.0", description="Application version")
    debug: bool = Field(default=False, description="Debug mode")

    # Nested settings
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    orchestrator: OrchestratorSettings = Field(default_factory=OrchestratorSettings)
    proxysql: ProxySQLSettings = Field(default_factory=ProxySQLSettings)
    prometheus: PrometheusSettings = Field(default_factory=PrometheusSettings)
    monitoring: MonitoringSettings = Field(default_factory=MonitoringSettings)
    failover: FailoverSettings = Field(default_factory=FailoverSettings)
    discovery: DiscoverySettings = Field(default_factory=DiscoverySettings)
    api: APISettings = Field(default_factory=APISettings)
    mysql: MySQLCredentials = Field(default_factory=MySQLCredentials)
    logging: LogSettings = Field(default_factory=LogSettings)


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Returns:
        Settings instance loaded from environment
    """
    return Settings()

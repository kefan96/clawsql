"""
Custom exceptions for ClawSQL.
"""

from typing import Any


class ClawSQLError(Exception):
    """Base exception for all ClawSQL errors."""

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        """
        Initialize ClawSQL error.

        Args:
            message: Error message
            code: Error code
            details: Additional error details
        """
        self.message = message
        self.code = code or "CLAWSQL_ERROR"
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
        }


class InstanceNotFoundError(ClawSQLError):
    """Raised when an instance is not found."""

    def __init__(self, instance_id: str):
        super().__init__(
            message=f"Instance not found: {instance_id}",
            code="INSTANCE_NOT_FOUND",
            details={"instance_id": instance_id},
        )


class ClusterNotFoundError(ClawSQLError):
    """Raised when a cluster is not found."""

    def __init__(self, cluster_id: str):
        super().__init__(
            message=f"Cluster not found: {cluster_id}",
            code="CLUSTER_NOT_FOUND",
            details={"cluster_id": cluster_id},
        )


class FailoverError(ClawSQLError):
    """Raised when a failover operation fails."""

    def __init__(
        self,
        message: str,
        cluster_id: str | None = None,
        operation_id: str | None = None,
    ):
        details = {}
        if cluster_id:
            details["cluster_id"] = cluster_id
        if operation_id:
            details["operation_id"] = operation_id

        super().__init__(
            message=message,
            code="FAILOVER_ERROR",
            details=details,
        )


class FailoverInProgressError(ClawSQLError):
    """Raised when a failover is already in progress."""

    def __init__(self, cluster_id: str):
        super().__init__(
            message=f"Failover already in progress for cluster: {cluster_id}",
            code="FAILOVER_IN_PROGRESS",
            details={"cluster_id": cluster_id},
        )


class NoCandidateError(ClawSQLError):
    """Raised when no suitable candidate is found for promotion."""

    def __init__(self, cluster_id: str):
        super().__init__(
            message=f"No suitable candidate found for promotion in cluster: {cluster_id}",
            code="NO_CANDIDATE",
            details={"cluster_id": cluster_id},
        )


class ConfigurationError(ClawSQLError):
    """Raised for configuration-related errors."""

    def __init__(
        self,
        message: str,
        config_path: str | None = None,
    ):
        details = {}
        if config_path:
            details["config_path"] = config_path

        super().__init__(
            message=message,
            code="CONFIGURATION_ERROR",
            details=details,
        )


class ValidationError(ClawSQLError):
    """Raised for validation errors."""

    def __init__(
        self,
        message: str,
        field: str | None = None,
        value: Any | None = None,
    ):
        details = {}
        if field:
            details["field"] = field
        if value is not None:
            details["value"] = str(value)

        super().__init__(
            message=message,
            code="VALIDATION_ERROR",
            details=details,
        )


class AuthenticationError(ClawSQLError):
    """Raised for authentication errors."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(
            message=message,
            code="AUTHENTICATION_ERROR",
        )


class AuthorizationError(ClawSQLError):
    """Raised for authorization errors."""

    def __init__(
        self,
        message: str = "Access denied",
        resource: str | None = None,
        action: str | None = None,
    ):
        details = {}
        if resource:
            details["resource"] = resource
        if action:
            details["action"] = action

        super().__init__(
            message=message,
            code="AUTHORIZATION_ERROR",
            details=details,
        )


class ConnectionError(ClawSQLError):
    """Raised for connection errors."""

    def __init__(
        self,
        message: str,
        host: str | None = None,
        port: int | None = None,
    ):
        details = {}
        if host:
            details["host"] = host
        if port:
            details["port"] = port

        super().__init__(
            message=message,
            code="CONNECTION_ERROR",
            details=details,
        )


class DiscoveryError(ClawSQLError):
    """Raised for discovery-related errors."""

    def __init__(
        self,
        message: str,
        network_segment: str | None = None,
    ):
        details = {}
        if network_segment:
            details["network_segment"] = network_segment

        super().__init__(
            message=message,
            code="DISCOVERY_ERROR",
            details=details,
        )


class MonitoringError(ClawSQLError):
    """Raised for monitoring-related errors."""

    def __init__(
        self,
        message: str,
        instance_id: str | None = None,
    ):
        details = {}
        if instance_id:
            details["instance_id"] = instance_id

        super().__init__(
            message=message,
            code="MONITORING_ERROR",
            details=details,
        )


class ProxySQLError(ClawSQLError):
    """Raised for ProxySQL-related errors."""

    def __init__(
        self,
        message: str,
        hostgroup: int | None = None,
    ):
        details = {}
        if hostgroup is not None:
            details["hostgroup"] = hostgroup

        super().__init__(
            message=message,
            code="PROXYSQL_ERROR",
            details=details,
        )


class OrchestratorError(ClawSQLError):
    """Raised for Orchestrator-related errors."""

    def __init__(
        self,
        message: str,
        endpoint: str | None = None,
    ):
        details = {}
        if endpoint:
            details["endpoint"] = endpoint

        super().__init__(
            message=message,
            code="ORCHESTRATOR_ERROR",
            details=details,
        )

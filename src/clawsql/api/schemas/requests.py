"""
API request schemas using Pydantic.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


# Instance schemas
class InstanceBase(BaseModel):
    """Base schema for MySQL instance."""

    host: str = Field(..., description="MySQL instance hostname or IP")
    port: int = Field(3306, ge=1, le=65535, description="MySQL port")
    cluster_id: Optional[str] = Field(None, description="Cluster to assign instance to")
    labels: Optional[dict[str, str]] = Field(default_factory=dict, description="Instance labels")


class InstanceCreateRequest(InstanceBase):
    """Request to register a new MySQL instance."""

    @field_validator("host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        if not v:
            raise ValueError("Host cannot be empty")
        return v.strip()


class InstanceDiscoverRequest(BaseModel):
    """Request to discover instances in a network."""

    network_segments: list[str] = Field(
        ...,
        min_length=1,
        description="CIDR network segments to scan",
    )
    port_range: Optional[tuple[int, int]] = Field(
        (3306, 3306),
        description="Port range to scan",
    )
    credentials_id: Optional[str] = Field(None, description="ID of stored credentials")

    @field_validator("network_segments")
    @classmethod
    def validate_segments(cls, v: list[str]) -> list[str]:
        import ipaddress

        validated = []
        for segment in v:
            try:
                ipaddress.ip_network(segment, strict=False)
                validated.append(segment)
            except ValueError:
                raise ValueError(f"Invalid network segment: {segment}")
        return validated


class MaintenanceRequest(BaseModel):
    """Request to put instance in maintenance."""

    instance_id: str = Field(..., description="Instance ID")
    duration_minutes: int = Field(60, ge=5, le=1440, description="Duration in minutes")
    reason: str = Field(..., min_length=1, description="Reason for maintenance")


# Cluster schemas
class ClusterCreateRequest(BaseModel):
    """Request to create a new cluster."""

    name: str = Field(..., min_length=1, max_length=100, description="Cluster name")
    description: Optional[str] = Field(None, description="Cluster description")
    primary_instance: Optional[InstanceCreateRequest] = Field(
        None, description="Initial primary instance"
    )
    settings: Optional[dict[str, Any]] = Field(
        default_factory=dict, description="Cluster settings"
    )


class ClusterUpdateRequest(BaseModel):
    """Request to update a cluster."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


# Failover schemas
class FailoverRequest(BaseModel):
    """Request to execute a failover."""

    cluster_id: str = Field(..., description="Cluster to failover")
    target_instance_id: Optional[str] = Field(
        None, description="Specific instance to promote"
    )
    reason: str = Field(..., min_length=1, description="Reason for failover")
    auto_confirm: bool = Field(False, description="Skip confirmation")


class FailoverCancelRequest(BaseModel):
    """Request to cancel a failover."""

    reason: str = Field(..., description="Reason for cancellation")


# Configuration schemas
class ConfigUpdateRequest(BaseModel):
    """Request to update configuration."""

    config_path: str = Field(..., description="Configuration key path")
    value: dict[str, Any] = Field(..., description="Configuration value")
    reason: str = Field(..., min_length=1, description="Reason for change")


class ConfigRollbackRequest(BaseModel):
    """Request to rollback configuration."""

    version_id: str = Field(..., description="Version to rollback to")
    reason: str = Field(..., description="Reason for rollback")


# Alert schemas
class AlertAcknowledgeRequest(BaseModel):
    """Request to acknowledge an alert."""

    acknowledged_by: Optional[str] = Field(None, description="User acknowledging")
    notes: Optional[str] = Field(None, description="Acknowledgment notes")


class AlertResolveRequest(BaseModel):
    """Request to resolve an alert."""

    resolved_by: Optional[str] = Field(None, description="User resolving")
    resolution_notes: Optional[str] = Field(None, description="Resolution notes")


# Token schemas
class TokenRequest(BaseModel):
    """Request to create an API token."""

    name: str = Field(..., description="Token name")
    permissions: Optional[list[str]] = Field(
        default_factory=list, description="Token permissions"
    )
    expiry_days: Optional[int] = Field(None, ge=1, le=365, description="Days until expiry")


class TokenRefreshRequest(BaseModel):
    """Request to refresh a token."""

    token: str = Field(..., description="Current token")


# Authentication schemas
class LoginRequest(BaseModel):
    """Request to login."""

    username: str = Field(..., description="Username")
    password: str = Field(..., description="Password")


# Query parameters (not request bodies but useful for validation)
class PaginationParams(BaseModel):
    """Pagination parameters."""

    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")


class InstanceFilterParams(BaseModel):
    """Filter parameters for instance listing."""

    cluster_id: Optional[str] = None
    state: Optional[str] = None
    role: Optional[str] = None
    health: Optional[str] = None

    @field_validator("state")
    @classmethod
    def validate_state(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        valid_states = ("online", "offline", "recovering", "failed", "maintenance")
        if v.lower() not in valid_states:
            raise ValueError(f"Invalid state: {v}")
        return v.lower()

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        valid_roles = ("primary", "replica", "unknown")
        if v.lower() not in valid_roles:
            raise ValueError(f"Invalid role: {v}")
        return v.lower()


class AlertFilterParams(BaseModel):
    """Filter parameters for alert listing."""

    active_only: bool = Field(True, description="Show only active alerts")
    severity: Optional[str] = None
    instance_id: Optional[str] = None
    check_name: Optional[str] = None

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        valid_severities = ("info", "warning", "critical")
        if v.lower() not in valid_severities:
            raise ValueError(f"Invalid severity: {v}")
        return v.lower()


class MetricsQueryParams(BaseModel):
    """Query parameters for metrics."""

    hours: int = Field(1, ge=1, le=24, description="Hours of history")
    metrics: Optional[list[str]] = Field(None, description="Specific metrics to include")
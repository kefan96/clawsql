"""
API response schemas using Pydantic.
"""

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# Common response schemas
class BaseResponse(BaseModel):
    """Base response schema."""

    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ErrorResponse(BaseResponse):
    """Error response."""

    error: str = Field(..., description="Error code")
    message: str = Field(..., description="Error message")
    details: dict[str, Any] | None = Field(None, description="Additional details")


class SuccessResponse(BaseResponse):
    """Generic success response."""

    success: bool = True
    message: str = "Operation completed successfully"


class PaginatedResponse(BaseResponse, Generic[T]):
    """Generic paginated response."""

    items: list[T] = Field(default_factory=list)
    total: int = Field(0, ge=0, description="Total items")
    page: int = Field(1, ge=1, description="Current page")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")

    @property
    def has_next(self) -> bool:
        """Check if there are more pages."""
        return self.page * self.page_size < self.total

    @property
    def total_pages(self) -> int:
        """Get total number of pages."""
        return (self.total + self.page_size - 1) // self.page_size


# Instance response schemas
class InstanceResponse(BaseModel):
    """Response for instance data."""

    instance_id: str
    host: str
    port: int
    server_id: int | None = None
    role: str
    state: str
    version: str | None = None
    cluster_id: str | None = None
    replication_lag: float | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    last_seen: datetime | None = None
    created_at: datetime | None = None


class InstanceListResponse(PaginatedResponse[InstanceResponse]):
    """Paginated list of instances."""

    pass


class InstanceMetricsResponse(BaseModel):
    """Response for instance metrics."""

    instance_id: str
    timestamp: datetime
    replication_lag_seconds: float | None = None
    replication_io_running: bool = False
    replication_sql_running: bool = False
    connections_current: int = 0
    connections_max: int = 0
    queries_per_second: float = 0.0
    innodb_buffer_pool_hit_rate: float = 0.0
    uptime_seconds: int = 0


class InstanceHealthResponse(BaseModel):
    """Response for instance health."""

    instance_id: str
    status: str
    checks: list[dict[str, Any]] = Field(default_factory=list)
    checked_at: datetime = Field(default_factory=datetime.utcnow)


# Cluster response schemas
class ClusterResponse(BaseModel):
    """Response for cluster data."""

    cluster_id: str
    name: str
    description: str | None = None
    primary: InstanceResponse | None = None
    replicas: list[InstanceResponse] = Field(default_factory=list)
    instance_count: int = 0
    health_status: str = "unknown"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ClusterListResponse(BaseModel):
    """List of clusters."""

    clusters: list[ClusterResponse]
    total: int


class ClusterTopologyResponse(BaseModel):
    """Response for cluster topology."""

    cluster_id: str
    cluster_name: str
    primary: InstanceResponse | None = None
    replicas: list[InstanceResponse] = Field(default_factory=list)
    replication_chains: list[dict[str, Any]] = Field(default_factory=list)
    topology_valid: bool = True


# Failover response schemas
class FailoverResponse(BaseModel):
    """Response for failover operation."""

    operation_id: str
    cluster_id: str
    old_primary_id: str | None = None
    new_primary_id: str | None = None
    state: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_seconds: float | None = None
    steps: list[str] = Field(default_factory=list)
    error: str | None = None
    manual: bool = False


class FailoverCandidateResponse(BaseModel):
    """Response for failover candidate."""

    instance_id: str
    host: str
    port: int
    replication_lag: float | None = None
    priority_score: float = 0.0
    is_healthy: bool = True


class FailoverHistoryResponse(BaseModel):
    """Response for failover history."""

    operations: list[FailoverResponse]
    total: int


# Alert response schemas
class AlertResponse(BaseModel):
    """Response for alert data."""

    alert_id: str
    instance_id: str
    check_name: str
    severity: str
    message: str
    value: float = 0.0
    threshold: float = 0.0
    triggered_at: datetime
    resolved_at: datetime | None = None
    acknowledged: bool = False
    acknowledged_by: str | None = None
    duration_seconds: float | None = None


class AlertListResponse(BaseModel):
    """List of alerts."""

    alerts: list[AlertResponse]
    total: int
    critical_count: int = 0
    warning_count: int = 0


# Monitoring response schemas
class SystemHealthResponse(BaseModel):
    """Response for system health."""

    status: str = "healthy"
    components: dict[str, dict[str, Any]] = Field(default_factory=dict)
    uptime_seconds: float = 0.0
    version: str = "0.1.0"


class PrometheusMetricsResponse(BaseModel):
    """Response for Prometheus metrics."""

    metrics: str
    content_type: str = "text/plain; version=0.0.4; charset=utf-8"


# Configuration response schemas
class ConfigResponse(BaseModel):
    """Response for configuration."""

    config: dict[str, Any]
    version_id: str
    version_number: int
    last_updated: datetime


class ConfigHistoryResponse(BaseModel):
    """Response for configuration history."""

    versions: list[dict[str, Any]]
    total: int


class ConfigDiffResponse(BaseModel):
    """Response for configuration diff."""

    version1: str
    version2: str
    added: dict[str, Any] = Field(default_factory=dict)
    removed: dict[str, Any] = Field(default_factory=dict)
    changed: dict[str, Any] = Field(default_factory=dict)


# Discovery response schemas
class DiscoveryResponse(BaseModel):
    """Response for discovery operation."""

    task_id: str
    status: str = "pending"
    network_segments: list[str]
    instances_found: int = 0
    instances: list[InstanceResponse] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None


# Token response schemas
class TokenResponse(BaseModel):
    """Response for token creation."""

    token: str
    token_type: str = "bearer"
    expires_at: datetime | None = None
    permissions: list[str] = Field(default_factory=list)


class LoginResponse(BaseModel):
    """Response for login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = 86400  # seconds
    user: dict[str, Any] = Field(default_factory=dict)


# Routing response schemas
class RoutingStatusResponse(BaseModel):
    """Response for routing status."""

    hostgroups: list[dict[str, Any]]
    servers: list[dict[str, Any]]
    rules: list[dict[str, Any]]


class LoadDistributionResponse(BaseModel):
    """Response for load distribution."""

    hostgroup_id: int
    total_weight: int
    server_count: int
    distribution: list[dict[str, Any]]


# Statistics response schemas
class SystemStatsResponse(BaseModel):
    """Response for system statistics."""

    instances_total: int = 0
    instances_online: int = 0
    instances_offline: int = 0
    clusters_total: int = 0
    clusters_healthy: int = 0
    alerts_active: int = 0
    alerts_critical: int = 0
    failovers_today: int = 0
    uptime_seconds: float = 0.0

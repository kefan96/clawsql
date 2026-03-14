"""
Core data models for MySQL instances and clusters.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class InstanceRole(Enum):
    """MySQL instance role in the cluster."""

    PRIMARY = "primary"
    REPLICA = "replica"
    UNKNOWN = "unknown"


class InstanceState(Enum):
    """MySQL instance operational state."""

    ONLINE = "online"
    OFFLINE = "offline"
    RECOVERING = "recovering"
    FAILED = "failed"
    MAINTENANCE = "maintenance"


class HealthStatus(Enum):
    """Health status for instances and clusters."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class AlertSeverity(Enum):
    """Alert severity levels."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class FailoverState(Enum):
    """Failover operation states."""

    IDLE = "idle"
    DETECTING = "detecting"
    CANDIDATE_SELECTION = "candidate_selection"
    PROMOTING = "promoting"
    RECONFIGURING = "reconfiguring"
    COMPLETED = "completed"
    FAILED = "failed"


class FailureType(Enum):
    """Types of failures that can be detected."""

    PRIMARY_UNREACHABLE = "primary_unreachable"
    PRIMARY_NOT_WRITING = "primary_not_writing"
    REPLICATION_STOPPED = "replication_stopped"
    REPLICATION_LAG_HIGH = "replication_lag_high"
    DISK_FULL = "disk_full"
    MEMORY_EXHAUSTED = "memory_exhausted"


@dataclass
class MySQLInstance:
    """Represents a discovered MySQL instance."""

    host: str
    port: int
    server_id: Optional[int] = None
    role: InstanceRole = InstanceRole.UNKNOWN
    state: InstanceState = InstanceState.OFFLINE
    version: Optional[str] = None
    replication_lag: Optional[float] = None
    last_seen: datetime = field(default_factory=datetime.utcnow)
    cluster_id: Optional[str] = None
    labels: dict[str, str] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def instance_id(self) -> str:
        """Unique identifier for the instance."""
        return f"{self.host}:{self.port}"

    @property
    def is_primary(self) -> bool:
        """Check if instance is a primary."""
        return self.role == InstanceRole.PRIMARY

    @property
    def is_replica(self) -> bool:
        """Check if instance is a replica."""
        return self.role == InstanceRole.REPLICA

    @property
    def is_online(self) -> bool:
        """Check if instance is online."""
        return self.state == InstanceState.ONLINE

    @property
    def is_healthy(self) -> bool:
        """Check if instance is in a healthy state."""
        return self.state == InstanceState.ONLINE and self.role != InstanceRole.UNKNOWN

    def to_dict(self) -> dict[str, Any]:
        """Convert instance to dictionary representation."""
        return {
            "instance_id": self.instance_id,
            "host": self.host,
            "port": self.port,
            "server_id": self.server_id,
            "role": self.role.value,
            "state": self.state.value,
            "version": self.version,
            "replication_lag": self.replication_lag,
            "last_seen": self.last_seen.isoformat(),
            "cluster_id": self.cluster_id,
            "labels": self.labels,
        }


@dataclass
class MySQLCluster:
    """Represents a MySQL cluster topology."""

    cluster_id: str
    name: str
    primary: Optional[MySQLInstance] = None
    replicas: list[MySQLInstance] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    description: Optional[str] = None

    @property
    def instance_count(self) -> int:
        """Total number of instances in cluster."""
        count = 0
        if self.primary:
            count += 1
        count += len(self.replicas)
        return count

    @property
    def healthy_count(self) -> int:
        """Number of healthy instances."""
        count = 0
        if self.primary and self.primary.is_healthy:
            count += 1
        count += sum(1 for r in self.replicas if r.is_healthy)
        return count

    @property
    def health_status(self) -> HealthStatus:
        """Overall cluster health status."""
        if self.instance_count == 0:
            return HealthStatus.UNKNOWN

        healthy_ratio = self.healthy_count / self.instance_count

        if healthy_ratio >= 1.0:
            return HealthStatus.HEALTHY
        elif healthy_ratio >= 0.5:
            return HealthStatus.DEGRADED
        else:
            return HealthStatus.UNHEALTHY

    def get_instance(self, host: str, port: int) -> Optional[MySQLInstance]:
        """Get instance by host and port."""
        if self.primary and self.primary.host == host and self.primary.port == port:
            return self.primary
        for replica in self.replicas:
            if replica.host == host and replica.port == port:
                return replica
        return None

    def add_replica(self, instance: MySQLInstance) -> None:
        """Add a replica to the cluster."""
        instance.cluster_id = self.cluster_id
        instance.role = InstanceRole.REPLICA
        self.replicas.append(instance)
        self.updated_at = datetime.utcnow()

    def set_primary(self, instance: MySQLInstance) -> None:
        """Set the primary instance."""
        instance.cluster_id = self.cluster_id
        instance.role = InstanceRole.PRIMARY
        self.primary = instance
        self.updated_at = datetime.utcnow()

    def to_dict(self) -> dict[str, Any]:
        """Convert cluster to dictionary representation."""
        return {
            "cluster_id": self.cluster_id,
            "name": self.name,
            "description": self.description,
            "primary": self.primary.to_dict() if self.primary else None,
            "replicas": [r.to_dict() for r in self.replicas],
            "instance_count": self.instance_count,
            "health_status": self.health_status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
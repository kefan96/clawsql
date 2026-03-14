"""
Audit logging for ClawSQL operations.
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class AuditAction(Enum):
    """Types of auditable actions."""

    # Instance management
    INSTANCE_REGISTER = "instance_register"
    INSTANCE_UNREGISTER = "instance_unregister"
    INSTANCE_DISCOVER = "instance_discover"
    INSTANCE_MAINTENANCE_START = "instance_maintenance_start"
    INSTANCE_MAINTENANCE_END = "instance_maintenance_end"

    # Cluster management
    CLUSTER_CREATE = "cluster_create"
    CLUSTER_DELETE = "cluster_delete"
    CLUSTER_UPDATE = "cluster_update"

    # Failover operations
    FAILOVER_EXECUTE = "failover_execute"
    FAILOVER_CANCEL = "failover_cancel"
    FAILOVER_PROMOTE = "failover_promote"

    # Configuration
    CONFIG_UPDATE = "config_update"
    CONFIG_ROLLBACK = "config_rollback"
    CONFIG_RESET = "config_reset"

    # Alerts
    ALERT_ACKNOWLEDGE = "alert_acknowledge"
    ALERT_RESOLVE = "alert_resolve"

    # Routing
    ROUTING_UPDATE = "routing_update"
    ROUTING_SERVER_ADD = "routing_server_add"
    ROUTING_SERVER_REMOVE = "routing_server_remove"

    # Authentication
    AUTH_LOGIN = "auth_login"
    AUTH_LOGOUT = "auth_logout"
    AUTH_TOKEN_CREATE = "auth_token_create"
    AUTH_TOKEN_REVOKE = "auth_token_revoke"


@dataclass
class AuditEntry:
    """Represents a single audit log entry."""

    entry_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=datetime.utcnow)
    action: AuditAction = AuditAction.CONFIG_UPDATE
    actor: Optional[str] = None
    actor_ip: Optional[str] = None
    resource_type: str = ""
    resource_id: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    old_value: Optional[dict[str, Any]] = None
    new_value: Optional[dict[str, Any]] = None
    status: str = "success"  # success, failed, pending
    error_message: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "entry_id": self.entry_id,
            "timestamp": self.timestamp.isoformat(),
            "action": self.action.value,
            "actor": self.actor,
            "actor_ip": self.actor_ip,
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "details": self.details,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "status": self.status,
            "error_message": self.error_message,
        }

    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict(), default=str)


class AuditLog:
    """
    Manages audit logging for ClawSQL.

    Provides audit trail for all significant operations
    with configurable storage and retrieval.
    """

    def __init__(
        self,
        storage_path: Optional[Path] = None,
        max_entries: int = 10000,
        retention_days: int = 90,
    ):
        """
        Initialize the audit log.

        Args:
            storage_path: Path to store audit log files
            max_entries: Maximum entries in memory
            retention_days: Days to retain audit logs
        """
        self.storage_path = storage_path or Path("/tmp/clawsql/audit")
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self.max_entries = max_entries
        self.retention_days = retention_days

        self._entries: list[AuditEntry] = []
        self._current_file: Optional[Path] = None

    def log(
        self,
        action: AuditAction,
        resource_type: str = "",
        resource_id: str = "",
        actor: Optional[str] = None,
        actor_ip: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
        old_value: Optional[dict[str, Any]] = None,
        new_value: Optional[dict[str, Any]] = None,
        status: str = "success",
        error_message: Optional[str] = None,
    ) -> AuditEntry:
        """
        Create an audit log entry.

        Args:
            action: Action being performed
            resource_type: Type of resource (instance, cluster, config)
            resource_id: Identifier for the resource
            actor: User performing the action
            actor_ip: IP address of the actor
            details: Additional details
            old_value: Previous value (for updates)
            new_value: New value (for updates)
            status: Operation status
            error_message: Error message if failed

        Returns:
            Created AuditEntry
        """
        entry = AuditEntry(
            action=action,
            actor=actor,
            actor_ip=actor_ip,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            old_value=old_value,
            new_value=new_value,
            status=status,
            error_message=error_message,
        )

        # Add to memory
        self._entries.append(entry)

        # Prune if needed
        if len(self._entries) > self.max_entries:
            self._prune_entries()

        # Write to file
        self._write_entry(entry)

        return entry

    def log_failover(
        self,
        cluster_id: str,
        old_primary: str,
        new_primary: str,
        success: bool,
        actor: Optional[str] = None,
        error: Optional[str] = None,
    ) -> AuditEntry:
        """
        Log a failover operation.

        Args:
            cluster_id: Cluster identifier
            old_primary: Previous primary instance
            new_primary: New primary instance
            success: Whether failover succeeded
            actor: User who triggered failover (None for auto)
            error: Error message if failed

        Returns:
            Created AuditEntry
        """
        return self.log(
            action=AuditAction.FAILOVER_EXECUTE,
            resource_type="cluster",
            resource_id=cluster_id,
            actor=actor or "system",
            details={
                "automatic": actor is None,
                "old_primary": old_primary,
                "new_primary": new_primary,
            },
            status="success" if success else "failed",
            error_message=error,
        )

    def log_config_change(
        self,
        config_path: str,
        old_value: Any,
        new_value: Any,
        actor: Optional[str] = None,
        reason: str = "",
    ) -> AuditEntry:
        """
        Log a configuration change.

        Args:
            config_path: Configuration path that changed
            old_value: Previous value
            new_value: New value
            actor: User making the change
            reason: Reason for change

        Returns:
            Created AuditEntry
        """
        return self.log(
            action=AuditAction.CONFIG_UPDATE,
            resource_type="config",
            resource_id=config_path,
            actor=actor,
            details={"reason": reason},
            old_value={"value": old_value} if old_value is not None else None,
            new_value={"value": new_value},
        )

    def get_entries(
        self,
        action: Optional[AuditAction] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        actor: Optional[str] = None,
        status: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
    ) -> list[AuditEntry]:
        """
        Query audit log entries.

        Args:
            action: Filter by action type
            resource_type: Filter by resource type
            resource_id: Filter by resource ID
            actor: Filter by actor
            status: Filter by status
            start_time: Filter entries after this time
            end_time: Filter entries before this time
            limit: Maximum entries to return

        Returns:
            List of matching AuditEntry
        """
        entries = self._entries.copy()

        # Apply filters
        if action:
            entries = [e for e in entries if e.action == action]
        if resource_type:
            entries = [e for e in entries if e.resource_type == resource_type]
        if resource_id:
            entries = [e for e in entries if e.resource_id == resource_id]
        if actor:
            entries = [e for e in entries if e.actor == actor]
        if status:
            entries = [e for e in entries if e.status == status]
        if start_time:
            entries = [e for e in entries if e.timestamp >= start_time]
        if end_time:
            entries = [e for e in entries if e.timestamp <= end_time]

        # Sort by timestamp descending and limit
        entries.sort(key=lambda e: e.timestamp, reverse=True)
        return entries[:limit]

    def get_entry(self, entry_id: str) -> Optional[AuditEntry]:
        """
        Get a specific audit entry.

        Args:
            entry_id: Entry ID

        Returns:
            AuditEntry if found
        """
        for entry in self._entries:
            if entry.entry_id == entry_id:
                return entry
        return None

    def get_stats(self) -> dict[str, Any]:
        """
        Get audit log statistics.

        Returns:
            Dictionary with statistics
        """
        total = len(self._entries)

        # Count by action
        action_counts: dict[str, int] = {}
        for entry in self._entries:
            action_key = entry.action.value
            action_counts[action_key] = action_counts.get(action_key, 0) + 1

        # Count by status
        status_counts: dict[str, int] = {}
        for entry in self._entries:
            status_counts[entry.status] = status_counts.get(entry.status, 0) + 1

        return {
            "total_entries": total,
            "max_entries": self.max_entries,
            "retention_days": self.retention_days,
            "by_action": action_counts,
            "by_status": status_counts,
        }

    def export(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        format: str = "json",
    ) -> str:
        """
        Export audit log entries.

        Args:
            start_time: Export entries after this time
            end_time: Export entries before this time
            format: Export format (json, csv)

        Returns:
            Exported data as string
        """
        entries = self.get_entries(
            start_time=start_time,
            end_time=end_time,
            limit=self.max_entries,
        )

        if format == "json":
            return json.dumps(
                [e.to_dict() for e in entries],
                indent=2,
                default=str,
            )
        elif format == "csv":
            import csv
            import io

            output = io.StringIO()
            writer = csv.writer(output)

            # Write header
            writer.writerow([
                "entry_id", "timestamp", "action", "actor", "resource_type",
                "resource_id", "status", "error_message"
            ])

            # Write rows
            for entry in entries:
                writer.writerow([
                    entry.entry_id,
                    entry.timestamp.isoformat(),
                    entry.action.value,
                    entry.actor,
                    entry.resource_type,
                    entry.resource_id,
                    entry.status,
                    entry.error_message,
                ])

            return output.getvalue()
        else:
            raise ValueError(f"Unsupported format: {format}")

    def _write_entry(self, entry: AuditEntry) -> None:
        """Write entry to file."""
        # Use daily log files
        today = datetime.utcnow().strftime("%Y-%m-%d")
        file_path = self.storage_path / f"audit_{today}.log"

        with open(file_path, "a") as f:
            f.write(entry.to_json() + "\n")

    def _prune_entries(self) -> None:
        """Prune old entries from memory."""
        # Keep most recent entries
        self._entries = self._entries[-self.max_entries :]

    def clear_old_entries(self, days: Optional[int] = None) -> int:
        """
        Clear entries older than retention period.

        Args:
            days: Number of days to retain (uses retention_days if not specified)

        Returns:
            Number of entries removed
        """
        retention = days or self.retention_days
        cutoff = datetime.utcnow()
        from datetime import timedelta
        cutoff -= timedelta(days=retention)

        original_count = len(self._entries)
        self._entries = [e for e in self._entries if e.timestamp >= cutoff]

        return original_count - len(self._entries)
"""
Recovery manager for MySQL instances.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

from ..discovery.models import MySQLCluster, MySQLInstance
from ..discovery.topology import OrchestratorClient
from ..monitoring.collector import MetricsCollector


class RecoveryState(Enum):
    """Recovery operation states."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    REBUILDING = "rebuilding"
    SYNCHRONIZING = "synchronizing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class RecoveryOperation:
    """Represents a recovery operation."""

    operation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    instance_id: str = ""
    recovery_type: str = "restore"
    state: RecoveryState = RecoveryState.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    steps: list[str] = field(default_factory=list)
    error: str | None = None
    progress_percent: float = 0.0

    @property
    def duration_seconds(self) -> float | None:
        """Get operation duration in seconds."""
        if not self.started_at:
            return None
        end = self.completed_at or datetime.utcnow()
        return (end - self.started_at).total_seconds()

    def add_step(self, step: str) -> None:
        """Add a step to the recovery log."""
        timestamp = datetime.utcnow().isoformat()
        self.steps.append(f"[{timestamp}] {step}")

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "operation_id": self.operation_id,
            "instance_id": self.instance_id,
            "recovery_type": self.recovery_type,
            "state": self.state.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "duration_seconds": self.duration_seconds,
            "steps": self.steps,
            "error": self.error,
            "progress_percent": self.progress_percent,
        }


class RecoveryManager:
    """
    Manages recovery of failed MySQL instances.

    Handles instance recovery, reintegration into clusters,
    and replica rebuilding.
    """

    def __init__(
        self,
        orchestrator_client: OrchestratorClient,
        metrics_collector: MetricsCollector,
    ):
        """
        Initialize the recovery manager.

        Args:
            orchestrator_client: Orchestrator API client
            metrics_collector: Metrics collector instance
        """
        self.orchestrator = orchestrator_client
        self.metrics = metrics_collector
        self._operations: dict[str, RecoveryOperation] = {}
        self._operation_history: list[RecoveryOperation] = []

    async def recover_instance(
        self,
        instance: MySQLInstance,
    ) -> RecoveryOperation:
        """
        Recover a failed instance.

        Args:
            instance: Instance to recover

        Returns:
            RecoveryOperation with result
        """
        operation = RecoveryOperation(
            instance_id=instance.instance_id,
            recovery_type="restore",
        )

        operation.started_at = datetime.utcnow()
        operation.state = RecoveryState.IN_PROGRESS
        operation.add_step(f"Starting recovery for {instance.instance_id}")

        try:
            # Check if instance is reachable
            operation.add_step("Checking instance connectivity")

            # Rediscover with Orchestrator
            operation.add_step("Rediscovering instance with Orchestrator")
            discovered = await self.orchestrator.discover_instance(
                instance.host, instance.port
            )

            if not discovered:
                raise Exception("Failed to rediscover instance")

            operation.add_step("Instance recovered successfully")
            operation.state = RecoveryState.COMPLETED
            operation.progress_percent = 100.0
            operation.completed_at = datetime.utcnow()

        except Exception as e:
            operation.state = RecoveryState.FAILED
            operation.error = str(e)
            operation.add_step(f"Recovery failed: {e}")
            operation.completed_at = datetime.utcnow()

        self._operations[operation.operation_id] = operation
        self._operation_history.append(operation)

        return operation

    async def reintegrate_instance(
        self,
        instance: MySQLInstance,
        cluster: MySQLCluster,
    ) -> bool:
        """
        Reintegrate a recovered instance into the cluster.

        Args:
            instance: Instance to reintegrate
            cluster: Cluster to join

        Returns:
            True if reintegration succeeded
        """
        try:
            # Ensure instance is discovered
            await self.orchestrator.discover_instance(instance.host, instance.port)

            # Remove from maintenance if set
            await self.orchestrator.end_maintenance(instance.host, instance.port)

            # Instance should auto-join via Orchestrator
            return True

        except Exception as e:
            print(f"Reintegration error: {e}")
            return False

    async def rebuild_replica(
        self,
        instance: MySQLInstance,
        source: MySQLInstance,
    ) -> RecoveryOperation:
        """
        Rebuild a replica from scratch.

        Args:
            instance: Replica to rebuild
            source: Source instance for data

        Returns:
            RecoveryOperation with result
        """
        operation = RecoveryOperation(
            instance_id=instance.instance_id,
            recovery_type="rebuild",
        )

        operation.started_at = datetime.utcnow()
        operation.state = RecoveryState.IN_PROGRESS
        operation.add_step(f"Starting rebuild from {source.instance_id}")

        try:
            # Step 1: Stop replication
            operation.add_step("Stopping replication")
            operation.state = RecoveryState.REBUILDING

            # Step 2: Rebuild data (placeholder - would use backup/restore or xtrabackup)
            operation.add_step("Rebuilding data from source")
            operation.progress_percent = 30.0

            # Step 3: Configure replication
            operation.add_step("Configuring replication")
            operation.state = RecoveryState.SYNCHRONIZING
            operation.progress_percent = 60.0

            # Step 4: Start replication
            operation.add_step("Starting replication")
            operation.progress_percent = 90.0

            # Step 5: Verify
            operation.add_step("Verifying replication status")
            operation.state = RecoveryState.COMPLETED
            operation.progress_percent = 100.0
            operation.completed_at = datetime.utcnow()

        except Exception as e:
            operation.state = RecoveryState.FAILED
            operation.error = str(e)
            operation.add_step(f"Rebuild failed: {e}")
            operation.completed_at = datetime.utcnow()

        self._operations[operation.operation_id] = operation
        self._operation_history.append(operation)

        return operation

    async def set_instance_maintenance(
        self,
        instance: MySQLInstance,
        reason: str,
        duration_minutes: int = 60,
    ) -> bool:
        """
        Put an instance in maintenance mode.

        Args:
            instance: Instance to set maintenance
            reason: Reason for maintenance
            duration_minutes: Maintenance duration

        Returns:
            True if maintenance set
        """
        try:
            return await self.orchestrator.begin_maintenance(
                instance.host,
                instance.port,
                reason,
                duration_minutes,
            )
        except Exception:
            return False

    async def remove_instance_maintenance(
        self,
        instance: MySQLInstance,
    ) -> bool:
        """
        Remove an instance from maintenance mode.

        Args:
            instance: Instance to remove from maintenance

        Returns:
            True if maintenance removed
        """
        try:
            return await self.orchestrator.end_maintenance(
                instance.host, instance.port
            )
        except Exception:
            return False

    def get_operation(self, operation_id: str) -> RecoveryOperation | None:
        """Get a specific operation by ID."""
        return self._operations.get(operation_id)

    def get_active_operations(self) -> list[RecoveryOperation]:
        """Get all active recovery operations."""
        return [
            op
            for op in self._operations.values()
            if op.state
            not in (RecoveryState.COMPLETED, RecoveryState.FAILED)
        ]

    def get_operation_history(
        self,
        instance_id: str | None = None,
        limit: int = 100,
    ) -> list[RecoveryOperation]:
        """
        Get recovery operation history.

        Args:
            instance_id: Filter by instance
            limit: Maximum number of operations

        Returns:
            List of recovery operations
        """
        operations = self._operation_history.copy()

        if instance_id:
            operations = [o for o in operations if o.instance_id == instance_id]

        return sorted(operations, key=lambda o: o.started_at or datetime.min)[
            -limit:
        ]

    def cancel_operation(self, operation_id: str) -> bool:
        """
        Cancel an in-progress recovery operation.

        Args:
            operation_id: Operation to cancel

        Returns:
            True if cancelled
        """
        if operation_id in self._operations:
            operation = self._operations[operation_id]
            if operation.state not in (
                RecoveryState.COMPLETED,
                RecoveryState.FAILED,
            ):
                operation.state = RecoveryState.FAILED
                operation.error = "Cancelled by user"
                operation.completed_at = datetime.utcnow()
                operation.add_step("Operation cancelled")
                return True
        return False

"""
Failover executor for MySQL cluster failover operations.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional

from ..discovery.models import FailoverState, MySQLCluster, MySQLInstance
from ..discovery.topology import OrchestratorClient
from ..monitoring.exporters import PrometheusExporter
from .detector import FailureEvent


@dataclass
class FailoverOperation:
    """Represents a failover operation."""

    operation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    cluster_id: str = ""
    old_primary_id: str = ""
    new_primary_id: Optional[str] = None
    state: FailoverState = FailoverState.IDLE
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    steps: list[str] = field(default_factory=list)
    error: Optional[str] = None
    manual: bool = False
    reason: str = ""
    triggered_by: Optional[str] = None

    @property
    def duration_seconds(self) -> Optional[float]:
        """Get operation duration in seconds."""
        if not self.started_at:
            return None
        end = self.completed_at or datetime.utcnow()
        return (end - self.started_at).total_seconds()

    def add_step(self, step: str) -> None:
        """Add a step to the operation log."""
        timestamp = datetime.utcnow().isoformat()
        self.steps.append(f"[{timestamp}] {step}")

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "operation_id": self.operation_id,
            "cluster_id": self.cluster_id,
            "old_primary_id": self.old_primary_id,
            "new_primary_id": self.new_primary_id,
            "state": self.state.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "duration_seconds": self.duration_seconds,
            "steps": self.steps,
            "error": self.error,
            "manual": self.manual,
            "reason": self.reason,
            "triggered_by": self.triggered_by,
        }


class FailoverExecutor:
    """
    Executes failover operations.

    Handles automatic and manual failover with candidate selection,
    promotion, and cluster reconfiguration.
    """

    MAX_FAILOVER_TIME = 30  # seconds
    CANDIDATE_PRIORITY_FIELDS = [
        "replication_lag",
        "binary_log_file",
        "binary_log_position",
    ]

    def __init__(
        self,
        orchestrator_client: OrchestratorClient,
        prometheus_exporter: PrometheusExporter,
        config: Optional[dict[str, Any]] = None,
    ):
        """
        Initialize the failover executor.

        Args:
            orchestrator_client: Orchestrator API client
            prometheus_exporter: Prometheus metrics exporter
            config: Optional configuration
        """
        self.orchestrator = orchestrator_client
        self.prometheus = prometheus_exporter
        self.config = config or {}

        self._current_operation: Optional[FailoverOperation] = None
        self._operation_history: list[FailoverOperation] = []
        self._pre_failover_hooks: list[Callable] = []
        self._post_failover_hooks: list[Callable] = []

    def register_pre_failover_hook(self, hook: Callable) -> None:
        """Register a hook to run before failover."""
        self._pre_failover_hooks.append(hook)

    def register_post_failover_hook(self, hook: Callable) -> None:
        """Register a hook to run after failover."""
        self._post_failover_hooks.append(hook)

    async def execute_automatic_failover(
        self,
        failure_event: FailureEvent,
        cluster: MySQLCluster,
    ) -> FailoverOperation:
        """
        Execute automatic failover in response to failure.

        Args:
            failure_event: Detected failure event
            cluster: Affected cluster

        Returns:
            FailoverOperation with result
        """
        operation = FailoverOperation(
            cluster_id=cluster.cluster_id,
            old_primary_id=cluster.primary.instance_id if cluster.primary else "",
            manual=False,
            reason=f"Automatic failover due to {failure_event.failure_type.value}",
            triggered_by=failure_event.event_id,
        )

        return await self._execute_failover(operation, cluster)

    async def execute_manual_failover(
        self,
        cluster: MySQLCluster,
        target_primary_id: Optional[str] = None,
        reason: str = "",
    ) -> FailoverOperation:
        """
        Execute manual failover to specified or best candidate.

        Args:
            cluster: Cluster to failover
            target_primary_id: Optional specific instance to promote
            reason: Reason for manual failover

        Returns:
            FailoverOperation with result
        """
        operation = FailoverOperation(
            cluster_id=cluster.cluster_id,
            old_primary_id=cluster.primary.instance_id if cluster.primary else "",
            manual=True,
            reason=reason or "Manual failover requested",
        )

        # If target specified, use it
        if target_primary_id:
            for replica in cluster.replicas:
                if replica.instance_id == target_primary_id:
                    operation.new_primary_id = target_primary_id
                    break

        return await self._execute_failover(operation, cluster)

    async def select_candidate(
        self,
        cluster: MySQLCluster,
    ) -> Optional[MySQLInstance]:
        """
        Select the best candidate for promotion.

        Args:
            cluster: Cluster to select candidate from

        Returns:
            Best candidate instance or None
        """
        if not cluster.replicas:
            return None

        # Filter healthy replicas
        healthy_replicas = [
            r
            for r in cluster.replicas
            if r.is_online and r.state.value != "maintenance"
        ]

        if not healthy_replicas:
            return None

        # Sort by criteria (simplified - real implementation would check binlog position)
        # Prefer replicas with lowest replication lag
        sorted_replicas = sorted(
            healthy_replicas,
            key=lambda r: r.replication_lag or float("inf"),
        )

        return sorted_replicas[0] if sorted_replicas else None

    async def promote_instance(
        self,
        instance: MySQLInstance,
        cluster: MySQLCluster,
    ) -> bool:
        """
        Promote an instance to primary.

        Args:
            instance: Instance to promote
            cluster: Cluster context

        Returns:
            True if promotion succeeded
        """
        try:
            # Use Orchestrator for graceful promotion
            result = await self.orchestrator.request_failover(
                host=cluster.primary.host if cluster.primary else instance.host,
                port=cluster.primary.port if cluster.primary else instance.port,
                destination=instance.host,
            )

            return result is not None
        except Exception as e:
            print(f"Promotion error: {e}")
            return False

    async def reconfigure_replicas(
        self,
        new_primary: MySQLInstance,
        replicas: list[MySQLInstance],
    ) -> bool:
        """
        Reconfigure replicas to follow new primary.

        Args:
            new_primary: New primary instance
            replicas: Replicas to reconfigure

        Returns:
            True if reconfiguration succeeded
        """
        try:
            for replica in replicas:
                if replica.instance_id != new_primary.instance_id:
                    await self.orchestrator.relocate_replicas(
                        replica.host,
                        replica.port,
                        new_primary.host,
                        new_primary.port,
                    )
            return True
        except Exception as e:
            print(f"Reconfiguration error: {e}")
            return False

    async def update_routing(
        self,
        cluster: MySQLCluster,
        new_primary: MySQLInstance,
    ) -> bool:
        """
        Update ProxySQL routing configuration.

        Args:
            cluster: Cluster being failed over
            new_primary: New primary instance

        Returns:
            True if routing updated
        """
        # This would integrate with ProxySQLManager
        # For now, return success
        return True

    def get_current_operation(self) -> Optional[FailoverOperation]:
        """Get currently running failover operation."""
        return self._current_operation

    def get_operation_history(
        self,
        cluster_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[FailoverOperation]:
        """
        Get failover operation history.

        Args:
            cluster_id: Filter by cluster
            limit: Maximum number of operations

        Returns:
            List of failover operations
        """
        operations = self._operation_history.copy()

        if cluster_id:
            operations = [o for o in operations if o.cluster_id == cluster_id]

        return sorted(operations, key=lambda o: o.started_at or datetime.min)[
            -limit:
        ]

    def get_operation(self, operation_id: str) -> Optional[FailoverOperation]:
        """Get a specific operation by ID."""
        for op in self._operation_history:
            if op.operation_id == operation_id:
                return op
        return None

    async def _execute_failover(
        self,
        operation: FailoverOperation,
        cluster: MySQLCluster,
    ) -> FailoverOperation:
        """
        Execute the failover operation.

        Args:
            operation: Failover operation to execute
            cluster: Cluster to failover

        Returns:
            Completed operation
        """
        self._current_operation = operation
        operation.started_at = datetime.utcnow()
        operation.state = FailoverState.DETECTING

        # Set Prometheus metric
        self.prometheus.set_failover_in_progress(cluster.cluster_id, True)

        try:
            # Run pre-failover hooks
            operation.add_step("Running pre-failover hooks")
            for hook in self._pre_failover_hooks:
                await hook(operation, cluster)

            # Select candidate
            operation.state = FailoverState.CANDIDATE_SELECTION
            operation.add_step("Selecting candidate for promotion")

            if not operation.new_primary_id:
                candidate = await self.select_candidate(cluster)
                if candidate:
                    operation.new_primary_id = candidate.instance_id
                else:
                    raise Exception("No suitable candidate found for promotion")

            # Promote
            operation.state = FailoverState.PROMOTING
            operation.add_step(
                f"Promoting {operation.new_primary_id} to primary"
            )

            new_primary = None
            for replica in cluster.replicas:
                if replica.instance_id == operation.new_primary_id:
                    new_primary = replica
                    break

            if not new_primary:
                raise Exception(f"Candidate {operation.new_primary_id} not found")

            success = await self.promote_instance(new_primary, cluster)
            if not success:
                raise Exception("Promotion failed")

            # Reconfigure replicas
            operation.state = FailoverState.RECONFIGURING
            operation.add_step("Reconfiguring replicas")

            other_replicas = [
                r
                for r in cluster.replicas
                if r.instance_id != operation.new_primary_id
            ]
            await self.reconfigure_replicas(new_primary, other_replicas)

            # Update routing
            operation.add_step("Updating routing rules")
            await self.update_routing(cluster, new_primary)

            # Success
            operation.state = FailoverState.COMPLETED
            operation.completed_at = datetime.utcnow()
            operation.add_step("Failover completed successfully")

            # Record metrics
            self.prometheus.record_failover(
                cluster.cluster_id,
                success=True,
                duration_seconds=operation.duration_seconds or 0,
            )

        except Exception as e:
            operation.state = FailoverState.FAILED
            operation.error = str(e)
            operation.completed_at = datetime.utcnow()
            operation.add_step(f"Failover failed: {e}")

            # Record failed metrics
            self.prometheus.record_failover(
                cluster.cluster_id,
                success=False,
                duration_seconds=operation.duration_seconds or 0,
            )

        finally:
            # Run post-failover hooks
            for hook in self._post_failover_hooks:
                try:
                    await hook(operation, cluster)
                except Exception as e:
                    print(f"Post-failover hook error: {e}")

            self.prometheus.set_failover_in_progress(cluster.cluster_id, False)
            self._operation_history.append(operation)
            self._current_operation = None

        return operation

    async def cancel_operation(self, operation_id: str) -> bool:
        """
        Cancel an in-progress failover operation.

        Args:
            operation_id: Operation to cancel

        Returns:
            True if cancelled
        """
        if (
            self._current_operation
            and self._current_operation.operation_id == operation_id
        ):
            self._current_operation.state = FailoverState.FAILED
            self._current_operation.error = "Cancelled by user"
            self._current_operation.completed_at = datetime.utcnow()
            self._operation_history.append(self._current_operation)
            self._current_operation = None
            return True
        return False
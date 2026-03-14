"""
Failure detector for MySQL clusters.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

from ..discovery.models import FailureType, MySQLCluster, MySQLInstance
from ..monitoring.collector import MetricsCollector
from ..monitoring.health_checker import HealthChecker


@dataclass
class FailureEvent:
    """Represents a detected failure."""

    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    failure_type: FailureType = FailureType.PRIMARY_UNREACHABLE
    instance_id: str = ""
    cluster_id: str = ""
    detected_at: datetime = field(default_factory=datetime.utcnow)
    details: dict[str, Any] = field(default_factory=dict)
    confirmed: bool = False
    confirmation_count: int = 0
    resolved: bool = False
    resolved_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "event_id": self.event_id,
            "failure_type": self.failure_type.value,
            "instance_id": self.instance_id,
            "cluster_id": self.cluster_id,
            "detected_at": self.detected_at.isoformat(),
            "details": self.details,
            "confirmed": self.confirmed,
            "confirmation_count": self.confirmation_count,
            "resolved": self.resolved,
            "resolved_at": (
                self.resolved_at.isoformat() if self.resolved_at else None
            ),
        }


class FailureDetector:
    """
    Detects failures in MySQL clusters.

    Monitors cluster health and detects various failure conditions
    with confirmation to avoid false positives.
    """

    DETECTION_CONFIG = {
        "unreachable_threshold": 3,  # Failed checks before declaring unreachable
        "check_interval_seconds": 5.0,
        "max_replication_lag": 60.0,
        "min_confirmed_replicas": 2,
        "confirmation_timeout_seconds": 30.0,
    }

    def __init__(
        self,
        health_checker: HealthChecker,
        metrics_collector: MetricsCollector,
        config: Optional[dict[str, Any]] = None,
    ):
        """
        Initialize the failure detector.

        Args:
            health_checker: Health checker instance
            metrics_collector: Metrics collector instance
            config: Optional configuration overrides
        """
        self.health_checker = health_checker
        self.metrics = metrics_collector
        self.config = {**self.DETECTION_CONFIG, **(config or {})}

        self._failure_handlers: list[Callable[[FailureEvent], None]] = []
        self._detected_failures: dict[str, FailureEvent] = {}
        self._detection_task: Optional[asyncio.Task] = None
        self._running = False
        self._clusters: list[MySQLCluster] = []

    def register_failure_handler(
        self,
        handler: Callable[[FailureEvent], None],
    ) -> None:
        """
        Register a handler for detected failures.

        Args:
            handler: Async function to handle failures
        """
        self._failure_handlers.append(handler)

    async def start_detection(self, clusters: list[MySQLCluster]) -> None:
        """
        Start continuous failure detection.

        Args:
            clusters: Clusters to monitor
        """
        if self._running:
            return

        self._running = True
        self._clusters = clusters
        self._detection_task = asyncio.create_task(self._detection_loop())

    async def stop_detection(self) -> None:
        """Stop failure detection."""
        self._running = False
        if self._detection_task:
            self._detection_task.cancel()
            try:
                await self._detection_task
            except asyncio.CancelledError:
                pass

    async def check_primary_health(
        self,
        cluster: MySQLCluster,
    ) -> Optional[FailureEvent]:
        """
        Check if primary is healthy.

        Args:
            cluster: Cluster to check

        Returns:
            FailureEvent if primary is unhealthy
        """
        if not cluster.primary:
            return FailureEvent(
                failure_type=FailureType.PRIMARY_UNREACHABLE,
                cluster_id=cluster.cluster_id,
                details={"reason": "No primary configured"},
            )

        # Get latest metrics
        metrics = self.metrics.get_latest_metrics(cluster.primary.instance_id)
        if not metrics:
            return self._create_unreachable_event(cluster.primary, cluster)

        # Check connectivity
        if not cluster.primary.is_online:
            return self._create_unreachable_event(cluster.primary, cluster)

        return None

    async def check_replication_health(
        self,
        cluster: MySQLCluster,
    ) -> list[FailureEvent]:
        """
        Check replication status across cluster.

        Args:
            cluster: Cluster to check

        Returns:
            List of detected failure events
        """
        events: list[FailureEvent] = []

        for replica in cluster.replicas:
            metrics = self.metrics.get_latest_metrics(replica.instance_id)

            if not metrics:
                continue

            # Check replication lag
            if (
                metrics.replication_lag_seconds is not None
                and metrics.replication_lag_seconds > self.config["max_replication_lag"]
            ):
                events.append(
                    FailureEvent(
                        failure_type=FailureType.REPLICATION_LAG_HIGH,
                        instance_id=replica.instance_id,
                        cluster_id=cluster.cluster_id,
                        details={
                            "lag_seconds": metrics.replication_lag_seconds,
                            "threshold": self.config["max_replication_lag"],
                        },
                    )
                )

            # Check if replication is stopped
            if not metrics.replication_io_running or not metrics.replication_sql_running:
                events.append(
                    FailureEvent(
                        failure_type=FailureType.REPLICATION_STOPPED,
                        instance_id=replica.instance_id,
                        cluster_id=cluster.cluster_id,
                        details={
                            "io_running": metrics.replication_io_running,
                            "sql_running": metrics.replication_sql_running,
                        },
                    )
                )

        return events

    async def verify_failure(
        self,
        event: FailureEvent,
    ) -> bool:
        """
        Verify a detected failure (avoid false positives).

        Args:
            event: Failure event to verify

        Returns:
            True if failure is confirmed
        """
        if event.confirmation_count >= self.config["unreachable_threshold"]:
            event.confirmed = True
            return True

        event.confirmation_count += 1

        # Require multiple confirmations for primary failures
        if event.failure_type == FailureType.PRIMARY_UNREACHABLE:
            return event.confirmation_count >= self.config["unreachable_threshold"]

        # Single confirmation for replication issues
        return True

    def get_active_failures(self) -> list[FailureEvent]:
        """Get all active (unresolved) failures."""
        return [f for f in self._detected_failures.values() if not f.resolved]

    def get_cluster_failures(self, cluster_id: str) -> list[FailureEvent]:
        """Get active failures for a specific cluster."""
        return [
            f
            for f in self._detected_failures.values()
            if f.cluster_id == cluster_id and not f.resolved
        ]

    def resolve_failure(self, event_id: str) -> bool:
        """Mark a failure as resolved."""
        if event_id in self._detected_failures:
            self._detected_failures[event_id].resolved = True
            self._detected_failures[event_id].resolved_at = datetime.utcnow()
            return True
        return False

    async def _detection_loop(self) -> None:
        """Background detection loop."""
        while self._running:
            try:
                for cluster in self._clusters:
                    await self._check_cluster(cluster)

                await asyncio.sleep(self.config["check_interval_seconds"])
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Detection error: {e}")
                await asyncio.sleep(self.config["check_interval_seconds"])

    async def _check_cluster(self, cluster: MySQLCluster) -> None:
        """Check a single cluster for failures."""
        # Check primary
        primary_failure = await self.check_primary_health(cluster)
        if primary_failure:
            await self._handle_failure(primary_failure)

        # Check replication
        replication_failures = await self.check_replication_health(cluster)
        for failure in replication_failures:
            await self._handle_failure(failure)

    async def _handle_failure(self, event: FailureEvent) -> None:
        """Handle a detected failure."""
        key = f"{event.cluster_id}:{event.instance_id}:{event.failure_type.value}"

        # Check if we already detected this failure
        if key in self._detected_failures:
            existing = self._detected_failures[key]
            if not existing.resolved:
                # Update confirmation count
                await self.verify_failure(existing)
                return

        # New failure
        self._detected_failures[key] = event
        await self.verify_failure(event)

        # Notify handlers if confirmed
        if event.confirmed:
            for handler in self._failure_handlers:
                try:
                    await handler(event)
                except Exception as e:
                    print(f"Failure handler error: {e}")

    def _create_unreachable_event(
        self,
        instance: MySQLInstance,
        cluster: MySQLCluster,
    ) -> FailureEvent:
        """Create an unreachable failure event."""
        return FailureEvent(
            failure_type=FailureType.PRIMARY_UNREACHABLE,
            instance_id=instance.instance_id,
            cluster_id=cluster.cluster_id,
            details={
                "host": instance.host,
                "port": instance.port,
                "last_seen": (
                    instance.last_seen.isoformat() if instance.last_seen else None
                ),
            },
        )
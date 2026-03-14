"""
Alert manager for MySQL cluster monitoring.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional

from .health_checker import HealthCheckResult, HealthStatus


class AlertSeverity(Enum):
    """Alert severity levels."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class Alert:
    """Represents an alert."""

    alert_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    instance_id: str = ""
    check_name: str = ""
    severity: AlertSeverity = AlertSeverity.WARNING
    message: str = ""
    value: float = 0.0
    threshold: float = 0.0
    triggered_at: datetime = field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None

    @property
    def is_active(self) -> bool:
        """Check if alert is still active."""
        return self.resolved_at is None

    @property
    def duration_seconds(self) -> float:
        """Get alert duration in seconds."""
        end = self.resolved_at or datetime.utcnow()
        return (end - self.triggered_at).total_seconds()

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "alert_id": self.alert_id,
            "instance_id": self.instance_id,
            "check_name": self.check_name,
            "severity": self.severity.value,
            "message": self.message,
            "value": self.value,
            "threshold": self.threshold,
            "triggered_at": self.triggered_at.isoformat(),
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "acknowledged": self.acknowledged,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at": (
                self.acknowledged_at.isoformat() if self.acknowledged_at else None
            ),
            "is_active": self.is_active,
            "duration_seconds": self.duration_seconds,
        }


class AlertManager:
    """
    Manages alerts and notifications.

    Provides alert creation, tracking, acknowledgment,
    and resolution with cooldown support.
    """

    def __init__(
        self,
        cooldown_minutes: int = 5,
        max_alerts_history: int = 1000,
    ):
        """
        Initialize the alert manager.

        Args:
            cooldown_minutes: Minutes between duplicate alerts
            max_alerts_history: Maximum alerts to keep in history
        """
        self.cooldown_minutes = cooldown_minutes
        self.max_alerts_history = max_alerts_history
        self._active_alerts: dict[str, Alert] = {}
        self._alert_history: list[Alert] = []
        self._last_alert_time: dict[str, datetime] = {}
        self._notification_handlers: list[callable] = []

    def register_notification_handler(self, handler: callable) -> None:
        """
        Register a notification handler.

        Args:
            handler: Async function to handle notifications
        """
        self._notification_handlers.append(handler)

    def process_health_result(
        self,
        result: HealthCheckResult,
    ) -> Optional[Alert]:
        """
        Process health check result and potentially create alert.

        Args:
            result: Health check result to process

        Returns:
            Alert if created, None otherwise
        """
        # Only create alerts for non-healthy status
        if result.status == HealthStatus.HEALTHY:
            # Check if we need to resolve an existing alert
            return self._resolve_alert_if_exists(result)

        # Check cooldown
        alert_key = f"{result.instance_id}:{result.check_name}"
        if not self._should_create_alert(alert_key):
            return None

        # Map health status to severity
        severity = self._map_severity(result.status)

        # Create alert
        alert = Alert(
            instance_id=result.instance_id,
            check_name=result.check_name,
            severity=severity,
            message=result.message,
            value=result.value,
            threshold=result.threshold,
            triggered_at=result.timestamp,
        )

        # Store alert
        self._active_alerts[alert_key] = alert
        self._alert_history.append(alert)
        self._last_alert_time[alert_key] = datetime.utcnow()

        # Prune history
        self._prune_history()

        return alert

    def acknowledge_alert(
        self,
        alert_id: str,
        acknowledged_by: Optional[str] = None,
    ) -> bool:
        """
        Acknowledge an alert.

        Args:
            alert_id: Alert ID to acknowledge
            acknowledged_by: User who acknowledged

        Returns:
            True if acknowledged
        """
        for alert in self._active_alerts.values():
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                alert.acknowledged_by = acknowledged_by
                alert.acknowledged_at = datetime.utcnow()
                return True

        for alert in self._alert_history:
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                alert.acknowledged_by = acknowledged_by
                alert.acknowledged_at = datetime.utcnow()
                return True

        return False

    def resolve_alert(self, alert_id: str) -> bool:
        """
        Mark an alert as resolved.

        Args:
            alert_id: Alert ID to resolve

        Returns:
            True if resolved
        """
        for key, alert in list(self._active_alerts.items()):
            if alert.alert_id == alert_id:
                alert.resolved_at = datetime.utcnow()
                del self._active_alerts[key]
                return True

        return False

    def get_active_alerts(
        self,
        instance_id: Optional[str] = None,
        severity: Optional[AlertSeverity] = None,
    ) -> list[Alert]:
        """
        Get active (unresolved) alerts.

        Args:
            instance_id: Filter by instance
            severity: Filter by severity

        Returns:
            List of active alerts
        """
        alerts = list(self._active_alerts.values())

        if instance_id:
            alerts = [a for a in alerts if a.instance_id == instance_id]

        if severity:
            alerts = [a for a in alerts if a.severity == severity]

        return sorted(alerts, key=lambda a: a.triggered_at, reverse=True)

    def get_alert_history(
        self,
        instance_id: Optional[str] = None,
        severity: Optional[AlertSeverity] = None,
        limit: int = 100,
    ) -> list[Alert]:
        """
        Get alert history.

        Args:
            instance_id: Filter by instance
            severity: Filter by severity
            limit: Maximum number of alerts

        Returns:
            List of historical alerts
        """
        alerts = self._alert_history.copy()

        if instance_id:
            alerts = [a for a in alerts if a.instance_id == instance_id]

        if severity:
            alerts = [a for a in alerts if a.severity == severity]

        return sorted(alerts, key=lambda a: a.triggered_at, reverse=True)[:limit]

    def get_alert(self, alert_id: str) -> Optional[Alert]:
        """
        Get a specific alert by ID.

        Args:
            alert_id: Alert ID

        Returns:
            Alert if found
        """
        # Check active alerts first
        for alert in self._active_alerts.values():
            if alert.alert_id == alert_id:
                return alert

        # Check history
        for alert in self._alert_history:
            if alert.alert_id == alert_id:
                return alert

        return None

    def clear_alerts(self, instance_id: Optional[str] = None) -> int:
        """
        Clear alerts.

        Args:
            instance_id: Only clear for this instance (optional)

        Returns:
            Number of alerts cleared
        """
        if instance_id:
            count = 0
            for key in list(self._active_alerts.keys()):
                if self._active_alerts[key].instance_id == instance_id:
                    self._active_alerts[key].resolved_at = datetime.utcnow()
                    del self._active_alerts[key]
                    count += 1
            return count
        else:
            count = len(self._active_alerts)
            for alert in self._active_alerts.values():
                alert.resolved_at = datetime.utcnow()
            self._active_alerts.clear()
            return count

    def _should_create_alert(self, alert_key: str) -> bool:
        """Check if alert should be created based on cooldown."""
        last_time = self._last_alert_time.get(alert_key)
        if last_time is None:
            return True

        cooldown = timedelta(minutes=self.cooldown_minutes)
        return datetime.utcnow() - last_time > cooldown

    def _resolve_alert_if_exists(self, result: HealthCheckResult) -> Optional[Alert]:
        """Resolve alert if exists for healthy result."""
        alert_key = f"{result.instance_id}:{result.check_name}"

        if alert_key in self._active_alerts:
            alert = self._active_alerts[alert_key]
            alert.resolved_at = datetime.utcnow()
            del self._active_alerts[alert_key]
            return alert

        return None

    def _map_severity(self, status: HealthStatus) -> AlertSeverity:
        """Map health status to alert severity."""
        mapping = {
            HealthStatus.UNHEALTHY: AlertSeverity.CRITICAL,
            HealthStatus.DEGRADED: AlertSeverity.WARNING,
            HealthStatus.UNKNOWN: AlertSeverity.INFO,
            HealthStatus.HEALTHY: AlertSeverity.INFO,
        }
        return mapping.get(status, AlertSeverity.INFO)

    def _prune_history(self) -> None:
        """Prune old alerts from history."""
        if len(self._alert_history) > self.max_alerts_history:
            # Keep most recent alerts
            self._alert_history = sorted(
                self._alert_history,
                key=lambda a: a.triggered_at,
                reverse=True,
            )[: self.max_alerts_history]

    async def send_notification(
        self,
        alert: Alert,
        channels: Optional[list[str]] = None,
    ) -> None:
        """
        Send alert notification via configured channels.

        Args:
            alert: Alert to send
            channels: Notification channels (email, slack, etc.)
        """
        for handler in self._notification_handlers:
            try:
                await handler(alert, channels)
            except Exception as e:
                print(f"Notification handler error: {e}")

    def get_stats(self) -> dict[str, Any]:
        """Get alert statistics."""
        active = list(self._active_alerts.values())

        return {
            "active_alerts": len(active),
            "critical_alerts": sum(
                1 for a in active if a.severity == AlertSeverity.CRITICAL
            ),
            "warning_alerts": sum(
                1 for a in active if a.severity == AlertSeverity.WARNING
            ),
            "info_alerts": sum(
                1 for a in active if a.severity == AlertSeverity.INFO
            ),
            "total_history": len(self._alert_history),
            "acknowledged": sum(1 for a in active if a.acknowledged),
        }
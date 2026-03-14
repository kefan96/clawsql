"""
Monitoring API endpoints.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import PlainTextResponse

from ..schemas.requests import AlertAcknowledgeRequest, AlertResolveRequest
from ..schemas.responses import (
    AlertListResponse,
    AlertResponse,
    PrometheusMetricsResponse,
    SystemHealthResponse,
    SystemStatsResponse,
    SuccessResponse,
)
from ...core.monitoring.alert_manager import Alert, AlertManager, AlertSeverity
from ...core.monitoring.exporters import PrometheusExporter

router = APIRouter()

# Global instances
_alert_manager: Optional[AlertManager] = None
_prometheus_exporter: Optional[PrometheusExporter] = None


def get_alert_manager() -> AlertManager:
    """Get or create alert manager."""
    global _alert_manager
    if _alert_manager is None:
        _alert_manager = AlertManager()
    return _alert_manager


def get_prometheus_exporter() -> PrometheusExporter:
    """Get or create Prometheus exporter."""
    global _prometheus_exporter
    if _prometheus_exporter is None:
        _prometheus_exporter = PrometheusExporter()
    return _prometheus_exporter


@router.get(
    "/health",
    response_model=SystemHealthResponse,
    summary="Get system health",
)
async def get_system_health() -> SystemHealthResponse:
    """Get overall system health status."""
    return SystemHealthResponse(
        status="healthy",
        components={
            "orchestrator": {"status": "healthy", "latency_ms": 5},
            "proxysql": {"status": "healthy", "connections": 50},
            "prometheus": {"status": "healthy"},
            "database": {"status": "healthy", "pool_size": 10},
        },
        uptime_seconds=86400.0,
        version="0.1.0",
    )


@router.get(
    "/alerts",
    response_model=AlertListResponse,
    summary="List alerts",
)
async def list_alerts(
    active_only: bool = Query(True, description="Show only active alerts"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    instance_id: Optional[str] = Query(None, description="Filter by instance"),
    limit: int = Query(50, ge=1, le=200, description="Maximum alerts"),
    alert_manager: AlertManager = Depends(get_alert_manager),
) -> AlertListResponse:
    """List current alerts."""
    severity_enum = None
    if severity:
        severity_enum = AlertSeverity(severity.lower())

    alerts = alert_manager.get_active_alerts(
        instance_id=instance_id,
        severity=severity_enum,
    )

    if not active_only:
        alerts.extend(
            alert_manager.get_alert_history(
                instance_id=instance_id,
                severity=severity_enum,
                limit=limit,
            )
        )

    # Limit results
    alerts = alerts[:limit]

    # Count by severity
    critical_count = sum(1 for a in alerts if a.severity == AlertSeverity.CRITICAL)
    warning_count = sum(1 for a in alerts if a.severity == AlertSeverity.WARNING)

    return AlertListResponse(
        alerts=[_alert_to_response(a) for a in alerts],
        total=len(alerts),
        critical_count=critical_count,
        warning_count=warning_count,
    )


@router.get(
    "/alerts/{alert_id}",
    response_model=AlertResponse,
    summary="Get alert details",
)
async def get_alert(
    alert_id: str,
    alert_manager: AlertManager = Depends(get_alert_manager),
) -> AlertResponse:
    """Get details of a specific alert."""
    alert = alert_manager.get_alert(alert_id)
    if not alert:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    return _alert_to_response(alert)


@router.post(
    "/alerts/{alert_id}/acknowledge",
    response_model=SuccessResponse,
    summary="Acknowledge an alert",
)
async def acknowledge_alert(
    alert_id: str,
    request: AlertAcknowledgeRequest,
    alert_manager: AlertManager = Depends(get_alert_manager),
) -> SuccessResponse:
    """Acknowledge an alert."""
    success = alert_manager.acknowledge_alert(
        alert_id,
        acknowledged_by=request.acknowledged_by,
    )

    if not success:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    return SuccessResponse(message=f"Alert {alert_id} acknowledged")


@router.post(
    "/alerts/{alert_id}/resolve",
    response_model=SuccessResponse,
    summary="Resolve an alert",
)
async def resolve_alert(
    alert_id: str,
    request: AlertResolveRequest,
    alert_manager: AlertManager = Depends(get_alert_manager),
) -> SuccessResponse:
    """Resolve an alert."""
    success = alert_manager.resolve_alert(alert_id)

    if not success:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    return SuccessResponse(message=f"Alert {alert_id} resolved")


@router.get(
    "/metrics/prometheus",
    response_class=PlainTextResponse,
    summary="Get Prometheus metrics",
)
async def prometheus_metrics(
    exporter: PrometheusExporter = Depends(get_prometheus_exporter),
) -> PlainTextResponse:
    """Get metrics in Prometheus format."""
    metrics = exporter.get_metrics_output()
    return PlainTextResponse(
        content=metrics,
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get(
    "/stats",
    response_model=SystemStatsResponse,
    summary="Get system statistics",
)
async def get_system_stats() -> SystemStatsResponse:
    """Get system statistics."""
    return SystemStatsResponse(
        instances_total=5,
        instances_online=4,
        instances_offline=1,
        clusters_total=2,
        clusters_healthy=2,
        alerts_active=0,
        alerts_critical=0,
        failovers_today=0,
        uptime_seconds=86400.0,
    )


@router.websocket("/ws/metrics")
async def metrics_websocket(websocket: WebSocket):
    """WebSocket for real-time metrics streaming."""
    await websocket.accept()

    try:
        import asyncio
        import json

        while True:
            # Send mock metrics
            metrics = {
                "timestamp": datetime.utcnow().isoformat(),
                "instances": {
                    "online": 4,
                    "offline": 1,
                    "total": 5,
                },
                "alerts": {
                    "active": 0,
                    "critical": 0,
                    "warning": 0,
                },
                "clusters": {
                    "healthy": 2,
                    "degraded": 0,
                    "unhealthy": 0,
                },
            }

            await websocket.send_json(metrics)
            await asyncio.sleep(5)

    except WebSocketDisconnect:
        pass


def _alert_to_response(alert: Alert) -> AlertResponse:
    """Convert Alert to response schema."""
    return AlertResponse(
        alert_id=alert.alert_id,
        instance_id=alert.instance_id,
        check_name=alert.check_name,
        severity=alert.severity.value,
        message=alert.message,
        value=alert.value,
        threshold=alert.threshold,
        triggered_at=alert.triggered_at,
        resolved_at=alert.resolved_at,
        acknowledged=alert.acknowledged,
        acknowledged_by=alert.acknowledged_by,
        duration_seconds=alert.duration_seconds,
    )
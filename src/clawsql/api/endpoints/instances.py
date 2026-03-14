"""
Instance management API endpoints.
"""

import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..schemas.requests import (
    InstanceCreateRequest,
    InstanceDiscoverRequest,
    MaintenanceRequest,
    InstanceFilterParams,
    PaginationParams,
)
from ..schemas.responses import (
    DiscoveryResponse,
    InstanceHealthResponse,
    InstanceListResponse,
    InstanceMetricsResponse,
    InstanceResponse,
    SuccessResponse,
)
from ...core.discovery.models import InstanceRole, InstanceState, MySQLInstance
from ...core.discovery.scanner import InstanceRegistry, NetworkScanner

router = APIRouter()

# Global instance registry (would be dependency-injected in production)
_instance_registry: Optional[InstanceRegistry] = None


def get_instance_registry() -> InstanceRegistry:
    """Get or create instance registry."""
    global _instance_registry
    if _instance_registry is None:
        _instance_registry = InstanceRegistry()
    return _instance_registry


@router.get(
    "/",
    response_model=InstanceListResponse,
    summary="List all MySQL instances",
    description="List all discovered and registered MySQL instances with optional filtering.",
)
async def list_instances(
    cluster_id: Optional[str] = Query(None, description="Filter by cluster"),
    state: Optional[str] = Query(None, description="Filter by state"),
    role: Optional[str] = Query(None, description="Filter by role"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> InstanceListResponse:
    """
    List all MySQL instances.

    - **cluster_id**: Filter by cluster
    - **state**: Filter by state (online, offline, etc.)
    - **role**: Filter by role (primary, replica)
    """
    instances = registry.get_all()

    # Apply filters
    if cluster_id:
        instances = [i for i in instances if i.cluster_id == cluster_id]
    if state:
        instances = [i for i in instances if i.state.value == state.lower()]
    if role:
        instances = [i for i in instances if i.role.value == role.lower()]

    # Paginate
    total = len(instances)
    start = (page - 1) * page_size
    end = start + page_size
    page_instances = instances[start:end]

    return InstanceListResponse(
        items=[_instance_to_response(i) for i in page_instances],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{instance_id}",
    response_model=InstanceResponse,
    summary="Get instance details",
)
async def get_instance(
    instance_id: str,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> InstanceResponse:
    """Get details of a specific MySQL instance."""
    instance = registry.get(instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )

    return _instance_to_response(instance)


@router.post(
    "/",
    response_model=InstanceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new instance",
)
async def register_instance(
    request: InstanceCreateRequest,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> InstanceResponse:
    """
    Manually register a MySQL instance.

    The instance will be validated and added to the registry.
    """
    # Check if already registered
    instance_id = f"{request.host}:{request.port}"
    existing = registry.get(instance_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Instance already registered: {instance_id}",
        )

    # Create instance
    instance = MySQLInstance(
        host=request.host,
        port=request.port,
        cluster_id=request.cluster_id,
        labels=request.labels or {},
        state=InstanceState.OFFLINE,
        role=InstanceRole.UNKNOWN,
        last_seen=datetime.utcnow(),
    )

    registry.register(instance)

    return _instance_to_response(instance)


@router.delete(
    "/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deregister an instance",
)
async def deregister_instance(
    instance_id: str,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> None:
    """Remove an instance from management."""
    success = registry.unregister(instance_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )


@router.post(
    "/discover",
    response_model=DiscoveryResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Discover instances in network",
)
async def discover_instances(
    request: InstanceDiscoverRequest,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> DiscoveryResponse:
    """
    Trigger instance discovery in specified network segments.

    Returns immediately with task ID, results are available via polling.
    """
    import uuid

    task_id = str(uuid.uuid4())

    # Create scanner
    scanner = NetworkScanner(
        network_segments=request.network_segments,
        mysql_port_range=request.port_range or (3306, 3306),
    )

    # Run discovery in background (simplified for demo)
    instances = await scanner.discover_instances()

    # Register discovered instances
    for instance in instances:
        registry.register(instance)

    return DiscoveryResponse(
        task_id=task_id,
        status="completed",
        network_segments=request.network_segments,
        instances_found=len(instances),
        instances=[_instance_to_response(i) for i in instances],
        completed_at=datetime.utcnow(),
    )


@router.post(
    "/{instance_id}/maintenance",
    response_model=SuccessResponse,
    summary="Put instance in maintenance mode",
)
async def set_maintenance(
    instance_id: str,
    request: MaintenanceRequest,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> SuccessResponse:
    """Put instance in maintenance mode."""
    instance = registry.get(instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )

    instance.state = InstanceState.MAINTENANCE
    instance.extra["maintenance_reason"] = request.reason
    instance.extra["maintenance_duration"] = request.duration_minutes

    return SuccessResponse(
        message=f"Instance {instance_id} set to maintenance mode"
    )


@router.delete(
    "/{instance_id}/maintenance",
    response_model=SuccessResponse,
    summary="Remove instance from maintenance",
)
async def remove_maintenance(
    instance_id: str,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> SuccessResponse:
    """Remove instance from maintenance mode."""
    instance = registry.get(instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )

    if instance.state != InstanceState.MAINTENANCE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Instance is not in maintenance mode: {instance_id}",
        )

    instance.state = InstanceState.ONLINE
    instance.extra.pop("maintenance_reason", None)
    instance.extra.pop("maintenance_duration", None)

    return SuccessResponse(
        message=f"Instance {instance_id} removed from maintenance mode"
    )


@router.get(
    "/{instance_id}/metrics",
    response_model=InstanceMetricsResponse,
    summary="Get instance metrics",
)
async def get_instance_metrics(
    instance_id: str,
    hours: int = Query(1, ge=1, le=24, description="Hours of history"),
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> InstanceMetricsResponse:
    """Get metrics for a specific instance."""
    instance = registry.get(instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )

    # Return mock metrics (would come from MetricsCollector in production)
    return InstanceMetricsResponse(
        instance_id=instance_id,
        timestamp=datetime.utcnow(),
        replication_lag_seconds=instance.replication_lag,
        replication_io_running=True,
        replication_sql_running=True,
        connections_current=50,
        connections_max=1000,
        queries_per_second=150.5,
        innodb_buffer_pool_hit_rate=98.5,
        uptime_seconds=864000,
    )


@router.get(
    "/{instance_id}/health",
    response_model=InstanceHealthResponse,
    summary="Get instance health",
)
async def get_instance_health(
    instance_id: str,
    registry: InstanceRegistry = Depends(get_instance_registry),
) -> InstanceHealthResponse:
    """Get current health status of an instance."""
    instance = registry.get(instance_id)
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_id}",
        )

    # Return mock health (would come from HealthChecker in production)
    checks = [
        {
            "check_name": "connectivity",
            "status": "healthy",
            "value": 1.0,
            "message": "Instance is reachable",
        },
        {
            "check_name": "replication_lag",
            "status": "healthy" if not instance.is_replica else "healthy",
            "value": instance.replication_lag or 0.0,
            "message": "Replication lag within threshold",
        },
    ]

    return InstanceHealthResponse(
        instance_id=instance_id,
        status="healthy" if instance.is_online else "unhealthy",
        checks=checks,
    )


def _instance_to_response(instance: MySQLInstance) -> InstanceResponse:
    """Convert MySQLInstance to response schema."""
    return InstanceResponse(
        instance_id=instance.instance_id,
        host=instance.host,
        port=instance.port,
        server_id=instance.server_id,
        role=instance.role.value,
        state=instance.state.value,
        version=instance.version,
        cluster_id=instance.cluster_id,
        replication_lag=instance.replication_lag,
        labels=instance.labels,
        last_seen=instance.last_seen,
        created_at=instance.last_seen,  # Simplified
    )
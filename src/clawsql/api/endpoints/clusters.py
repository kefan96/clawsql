"""
Cluster management API endpoints.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ...core.discovery.models import InstanceRole, InstanceState, MySQLCluster, MySQLInstance
from ..schemas.requests import (
    ClusterCreateRequest,
    ClusterUpdateRequest,
)
from ..schemas.responses import (
    ClusterListResponse,
    ClusterResponse,
    ClusterTopologyResponse,
    InstanceResponse,
    SuccessResponse,
)

router = APIRouter()

# In-memory cluster storage (would be database in production)
_clusters: dict[str, MySQLCluster] = {}


def get_clusters() -> dict[str, MySQLCluster]:
    """Get cluster storage."""
    return _clusters


@router.get(
    "/",
    response_model=ClusterListResponse,
    summary="List all clusters",
)
async def list_clusters(
    health_status: str | None = Query(None, description="Filter by health status"),
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> ClusterListResponse:
    """List all managed MySQL clusters."""
    cluster_list = list(clusters.values())

    if health_status:
        cluster_list = [
            c for c in cluster_list if c.health_status.value == health_status.lower()
        ]

    return ClusterListResponse(
        clusters=[_cluster_to_response(c) for c in cluster_list],
        total=len(cluster_list),
    )


@router.get(
    "/{cluster_id}",
    response_model=ClusterResponse,
    summary="Get cluster details",
)
async def get_cluster(
    cluster_id: str,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> ClusterResponse:
    """Get details of a specific cluster."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    return _cluster_to_response(clusters[cluster_id])


@router.post(
    "/",
    response_model=ClusterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new cluster",
)
async def create_cluster(
    request: ClusterCreateRequest,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> ClusterResponse:
    """Create a new cluster configuration."""
    import uuid

    cluster_id = str(uuid.uuid4())[:8]

    cluster = MySQLCluster(
        cluster_id=cluster_id,
        name=request.name,
        description=request.description,
    )

    # Add primary instance if provided
    if request.primary_instance:
        primary = MySQLInstance(
            host=request.primary_instance.host,
            port=request.primary_instance.port,
            role=InstanceRole.PRIMARY,
            state=InstanceState.ONLINE,
            cluster_id=cluster_id,
            labels=request.primary_instance.labels or {},
        )
        cluster.set_primary(primary)

    clusters[cluster_id] = cluster

    return _cluster_to_response(cluster)


@router.put(
    "/{cluster_id}",
    response_model=ClusterResponse,
    summary="Update cluster",
)
async def update_cluster(
    cluster_id: str,
    request: ClusterUpdateRequest,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> ClusterResponse:
    """Update cluster configuration."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    cluster = clusters[cluster_id]

    if request.name:
        cluster.name = request.name
    if request.description is not None:
        cluster.description = request.description

    cluster.updated_at = datetime.utcnow()

    return _cluster_to_response(cluster)


@router.delete(
    "/{cluster_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete cluster",
)
async def delete_cluster(
    cluster_id: str,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> None:
    """Remove a cluster from management."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    del clusters[cluster_id]


@router.get(
    "/{cluster_id}/topology",
    response_model=ClusterTopologyResponse,
    summary="Get cluster topology",
)
async def get_cluster_topology(
    cluster_id: str,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> ClusterTopologyResponse:
    """Get detailed topology information for a cluster."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    cluster = clusters[cluster_id]

    # Build replication chains (simplified)
    replication_chains = []
    if cluster.primary and cluster.replicas:
        chain = {
            "primary": cluster.primary.instance_id,
            "replicas": [r.instance_id for r in cluster.replicas],
        }
        replication_chains.append(chain)

    return ClusterTopologyResponse(
        cluster_id=cluster.cluster_id,
        cluster_name=cluster.name,
        primary=_instance_to_response(cluster.primary) if cluster.primary else None,
        replicas=[_instance_to_response(r) for r in cluster.replicas],
        replication_chains=replication_chains,
        topology_valid=cluster.primary is not None,
    )


@router.get(
    "/{cluster_id}/metrics",
    summary="Get cluster metrics",
)
async def get_cluster_metrics(
    cluster_id: str,
    hours: int = Query(1, ge=1, le=24, description="Hours of history"),
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> dict:
    """Get aggregated metrics for a cluster."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    cluster = clusters[cluster_id]

    # Return mock aggregated metrics
    return {
        "cluster_id": cluster_id,
        "cluster_name": cluster.name,
        "instance_count": cluster.instance_count,
        "healthy_count": cluster.healthy_count,
        "health_status": cluster.health_status.value,
        "metrics": {
            "total_connections": 250,
            "total_qps": 1500.5,
            "avg_replication_lag": 0.5,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.post(
    "/{cluster_id}/sync",
    response_model=SuccessResponse,
    summary="Sync cluster with Orchestrator",
)
async def sync_cluster(
    cluster_id: str,
    clusters: dict[str, MySQLCluster] = Depends(get_clusters),
) -> SuccessResponse:
    """Force synchronization with Orchestrator."""
    if cluster_id not in clusters:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cluster not found: {cluster_id}",
        )

    # Would trigger sync with Orchestrator
    return SuccessResponse(
        message=f"Cluster {cluster_id} synchronized with Orchestrator"
    )


def _cluster_to_response(cluster: MySQLCluster) -> ClusterResponse:
    """Convert MySQLCluster to response schema."""
    return ClusterResponse(
        cluster_id=cluster.cluster_id,
        name=cluster.name,
        description=cluster.description,
        primary=_instance_to_response(cluster.primary) if cluster.primary else None,
        replicas=[_instance_to_response(r) for r in cluster.replicas],
        instance_count=cluster.instance_count,
        health_status=cluster.health_status.value,
        created_at=cluster.created_at,
        updated_at=cluster.updated_at,
    )


def _instance_to_response(instance: MySQLInstance | None) -> InstanceResponse | None:
    """Convert MySQLInstance to response schema."""
    if not instance:
        return None

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
        created_at=instance.last_seen,
    )

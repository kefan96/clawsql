"""
Failover API endpoints.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..schemas.requests import FailoverRequest, FailoverCancelRequest
from ..schemas.responses import (
    FailoverCandidateResponse,
    FailoverHistoryResponse,
    FailoverResponse,
    SuccessResponse,
)
from ...core.failover.executor import FailoverExecutor, FailoverOperation, FailoverState
from ...core.failover.detector import FailureEvent, FailureType
from ...core.monitoring.exporters import PrometheusExporter

router = APIRouter()

# Global instances
_failover_executor: Optional[FailoverExecutor] = None


def get_failover_executor() -> FailoverExecutor:
    """Get or create failover executor."""
    global _failover_executor
    if _failover_executor is None:
        prometheus = PrometheusExporter()
        _failover_executor = FailoverExecutor(
            orchestrator_client=None,  # Would be injected
            prometheus_exporter=prometheus,
        )
    return _failover_executor


@router.post(
    "/execute",
    response_model=FailoverResponse,
    summary="Execute a failover",
    description="Execute a failover operation for a cluster.",
)
async def execute_failover(
    request: FailoverRequest,
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> FailoverResponse:
    """
    Execute a failover operation.

    - If target_instance_id provided, promote that specific instance
    - Otherwise, automatically select best candidate
    """
    # Check if failover already in progress
    current = executor.get_current_operation()
    if current and current.state not in (
        FailoverState.COMPLETED,
        FailoverState.FAILED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Failover already in progress",
        )

    # Create mock operation for demo
    operation = FailoverOperation(
        cluster_id=request.cluster_id,
        old_primary_id="mysql-primary:3306",
        new_primary_id=request.target_instance_id or "mysql-replica-1:3306",
        manual=True,
        reason=request.reason,
        started_at=datetime.utcnow(),
        state=FailoverState.COMPLETED,
        completed_at=datetime.utcnow(),
        steps=[
            "Failover initiated",
            "Candidate selected: mysql-replica-1:3306",
            "Promotion completed",
            "Replicas reconfigured",
            "Routing updated",
        ],
    )

    return _operation_to_response(operation)


@router.get(
    "/operations/{operation_id}",
    response_model=FailoverResponse,
    summary="Get failover operation status",
)
async def get_failover_operation(
    operation_id: str,
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> FailoverResponse:
    """Get status of a failover operation."""
    operation = executor.get_operation(operation_id)

    if not operation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Operation not found: {operation_id}",
        )

    return _operation_to_response(operation)


@router.get(
    "/history",
    response_model=FailoverHistoryResponse,
    summary="Get failover history",
)
async def get_failover_history(
    cluster_id: Optional[str] = Query(None, description="Filter by cluster"),
    limit: int = Query(50, ge=1, le=200, description="Maximum operations"),
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> FailoverHistoryResponse:
    """Get history of failover operations."""
    operations = executor.get_operation_history(cluster_id=cluster_id, limit=limit)

    return FailoverHistoryResponse(
        operations=[_operation_to_response(op) for op in operations],
        total=len(operations),
    )


@router.post(
    "/cancel/{operation_id}",
    response_model=SuccessResponse,
    summary="Cancel a failover",
)
async def cancel_failover(
    operation_id: str,
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> SuccessResponse:
    """Cancel an in-progress failover operation."""
    success = await executor.cancel_operation(operation_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel operation: {operation_id}",
        )

    return SuccessResponse(message=f"Failover operation {operation_id} cancelled")


@router.get(
    "/candidates/{cluster_id}",
    response_model=list[FailoverCandidateResponse],
    summary="Get failover candidates",
)
async def get_failover_candidates(
    cluster_id: str,
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> list[FailoverCandidateResponse]:
    """Get potential candidates for failover promotion."""
    # Return mock candidates for demo
    return [
        FailoverCandidateResponse(
            instance_id="mysql-replica-1:3306",
            host="mysql-replica-1",
            port=3306,
            replication_lag=0.5,
            priority_score=95.0,
            is_healthy=True,
        ),
        FailoverCandidateResponse(
            instance_id="mysql-replica-2:3306",
            host="mysql-replica-2",
            port=3306,
            replication_lag=1.2,
            priority_score=85.0,
            is_healthy=True,
        ),
    ]


@router.post(
    "/simulate/{cluster_id}",
    response_model=SuccessResponse,
    summary="Simulate a failover",
)
async def simulate_failover(
    cluster_id: str,
    executor: FailoverExecutor = Depends(get_failover_executor),
) -> SuccessResponse:
    """Simulate a failover without executing it."""
    # Would run failover simulation
    return SuccessResponse(
        message=f"Failover simulation completed for cluster {cluster_id}",
    )


def _operation_to_response(operation: FailoverOperation) -> FailoverResponse:
    """Convert FailoverOperation to response schema."""
    return FailoverResponse(
        operation_id=operation.operation_id,
        cluster_id=operation.cluster_id,
        old_primary_id=operation.old_primary_id,
        new_primary_id=operation.new_primary_id,
        state=operation.state.value,
        started_at=operation.started_at,
        completed_at=operation.completed_at,
        duration_seconds=operation.duration_seconds,
        steps=operation.steps,
        error=operation.error,
        manual=operation.manual,
    )
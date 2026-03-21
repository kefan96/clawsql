"""
API endpoints package.
"""

from fastapi import APIRouter

from .clusters import router as clusters_router
from .config import router as config_router
from .failover import router as failover_router
from .instances import router as instances_router
from .monitoring import router as monitoring_router

# Main API router
router = APIRouter()

# Include sub-routers
router.include_router(instances_router, prefix="/instances", tags=["instances"])
router.include_router(clusters_router, prefix="/clusters", tags=["clusters"])
router.include_router(monitoring_router, prefix="/monitoring", tags=["monitoring"])
router.include_router(failover_router, prefix="/failover", tags=["failover"])
router.include_router(config_router, prefix="/config", tags=["configuration"])

__all__ = [
    "router",
    "instances_router",
    "clusters_router",
    "monitoring_router",
    "failover_router",
    "config_router",
]

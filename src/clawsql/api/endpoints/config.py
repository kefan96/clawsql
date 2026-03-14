"""
Configuration API endpoints.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..schemas.requests import ConfigUpdateRequest, ConfigRollbackRequest
from ..schemas.responses import (
    ConfigDiffResponse,
    ConfigHistoryResponse,
    ConfigResponse,
    SuccessResponse,
)
from ...config.versioning import ConfigStore, ConfigVersion

router = APIRouter()

# Global config store
_config_store: Optional[ConfigStore] = None


def get_config_store() -> ConfigStore:
    """Get or create config store."""
    global _config_store
    if _config_store is None:
        _config_store = ConfigStore()
    return _config_store


@router.get(
    "/",
    response_model=ConfigResponse,
    summary="Get current configuration",
)
async def get_config(
    store: ConfigStore = Depends(get_config_store),
) -> ConfigResponse:
    """Get current configuration."""
    config = store.get_current()
    history = store.get_history(limit=1)

    latest_version = history[0] if history else None

    return ConfigResponse(
        config=config,
        version_id=latest_version.version_id if latest_version else "initial",
        version_number=latest_version.version_number if latest_version else 1,
        last_updated=latest_version.created_at if latest_version else datetime.utcnow(),
    )


@router.get(
    "/history",
    response_model=ConfigHistoryResponse,
    summary="Get configuration history",
)
async def get_config_history(
    limit: int = Query(50, ge=1, le=200, description="Maximum versions"),
    store: ConfigStore = Depends(get_config_store),
) -> ConfigHistoryResponse:
    """Get configuration change history."""
    versions = store.get_history(limit=limit)

    return ConfigHistoryResponse(
        versions=[
            {
                "version_id": v.version_id,
                "version_number": v.version_number,
                "created_at": v.created_at.isoformat(),
                "created_by": v.created_by,
                "reason": v.reason,
            }
            for v in versions
        ],
        total=len(versions),
    )


@router.get(
    "/defaults",
    summary="Get default configuration",
)
async def get_default_config(
    store: ConfigStore = Depends(get_config_store),
) -> dict[str, Any]:
    """Get the default configuration values."""
    return store._defaults


@router.get(
    "/versions/{version_id}",
    response_model=ConfigResponse,
    summary="Get configuration version",
)
async def get_config_version(
    version_id: str,
    store: ConfigStore = Depends(get_config_store),
) -> ConfigResponse:
    """Get a specific configuration version."""
    version = store.get_version(version_id)

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version not found: {version_id}",
        )

    return ConfigResponse(
        config=version.config,
        version_id=version.version_id,
        version_number=version.version_number,
        last_updated=version.created_at,
    )


@router.get(
    "/compare/{version_id1}/{version_id2}",
    response_model=ConfigDiffResponse,
    summary="Compare configuration versions",
)
async def compare_config_versions(
    version_id1: str,
    version_id2: str,
    store: ConfigStore = Depends(get_config_store),
) -> ConfigDiffResponse:
    """Compare two configuration versions."""
    diff = store.compare_versions(version_id1, version_id2)

    if "error" in diff:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=diff["error"],
        )

    return ConfigDiffResponse(
        version1=version_id1,
        version2=version_id2,
        added=diff["diff"]["added"],
        removed=diff["diff"]["removed"],
        changed=diff["diff"]["changed"],
    )


@router.post(
    "/rollback/{version_id}",
    response_model=ConfigResponse,
    summary="Rollback configuration",
)
async def rollback_config(
    version_id: str,
    store: ConfigStore = Depends(get_config_store),
) -> ConfigResponse:
    """Rollback to a previous configuration version."""
    new_version = store.rollback(version_id)

    if not new_version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cannot rollback to version: {version_id}",
        )

    return ConfigResponse(
        config=new_version.config,
        version_id=new_version.version_id,
        version_number=new_version.version_number,
        last_updated=new_version.created_at,
    )


@router.post(
    "/reset",
    response_model=ConfigResponse,
    summary="Reset to defaults",
)
async def reset_config(
    store: ConfigStore = Depends(get_config_store),
) -> ConfigResponse:
    """Reset configuration to defaults."""
    version = store.reset_to_defaults()

    return ConfigResponse(
        config=version.config,
        version_id=version.version_id,
        version_number=version.version_number,
        last_updated=version.created_at,
    )


@router.get(
    "/{config_path:path}",
    summary="Get configuration value",
)
async def get_config_value(
    config_path: str,
    store: ConfigStore = Depends(get_config_store),
) -> dict[str, Any]:
    """Get a specific configuration value by path."""
    value = store.get_value(config_path)

    if value is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Configuration path not found: {config_path}",
        )

    return {
        "path": config_path,
        "value": value,
    }


@router.put(
    "/{config_path:path}",
    response_model=ConfigResponse,
    summary="Update configuration value",
)
async def update_config(
    config_path: str,
    request: ConfigUpdateRequest,
    store: ConfigStore = Depends(get_config_store),
) -> ConfigResponse:
    """Update a configuration value."""
    # Build update dict from path
    path_parts = config_path.split(".")
    update_dict: dict[str, Any] = {}

    # Build nested dict
    current = update_dict
    for part in path_parts[:-1]:
        current[part] = {}
        current = current[part]
    current[path_parts[-1]] = request.value

    # Apply update
    version = store.update(
        updates=update_dict,
        reason=request.reason,
    )

    return ConfigResponse(
        config=store.get_current(),
        version_id=version.version_id,
        version_number=version.version_number,
        last_updated=version.created_at,
    )
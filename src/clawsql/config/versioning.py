"""
Configuration versioning for ClawSQL.
"""

import copy
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass
class ConfigVersion:
    """Represents a versioned configuration snapshot."""

    version_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    version_number: int = 1
    created_at: datetime = field(default_factory=datetime.utcnow)
    created_by: str | None = None
    reason: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    parent_version_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "version_id": self.version_id,
            "version_number": self.version_number,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "reason": self.reason,
            "parent_version_id": self.parent_version_id,
            "config": self.config,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConfigVersion":
        """Create from dictionary."""
        return cls(
            version_id=data["version_id"],
            version_number=data["version_number"],
            created_at=datetime.fromisoformat(data["created_at"]),
            created_by=data.get("created_by"),
            reason=data.get("reason", ""),
            parent_version_id=data.get("parent_version_id"),
            config=data.get("config", {}),
        )


class ConfigStore:
    """
    Manages versioned configuration storage.

    Provides configuration versioning, rollback capability,
    and audit trail for configuration changes.
    """

    def __init__(self, storage_path: Path | None = None):
        """
        Initialize the config store.

        Args:
            storage_path: Path to store configuration files
        """
        self.storage_path = storage_path or Path("/tmp/clawsql/config")
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self._versions: dict[str, ConfigVersion] = {}
        self._current_config: dict[str, Any] = {}
        self._current_version_id: str | None = None
        self._version_counter = 0

        # Default configuration
        self._defaults = self._get_defaults()

        # Load existing versions
        self._load_versions()

    def _get_defaults(self) -> dict[str, Any]:
        """Get default configuration."""
        return {
            "failover": {
                "auto_failover_enabled": True,
                "timeout_seconds": 30,
                "min_replicas_for_failover": 2,
                "confirmation_checks": 3,
                "excluded_replicas": [],
            },
            "monitoring": {
                "collection_interval": 15.0,
                "health_check_interval": 10.0,
                "alert_cooldown_minutes": 5,
                "thresholds": {
                    "replication_lag_critical": 60.0,
                    "replication_lag_warning": 30.0,
                    "connection_usage_critical": 90.0,
                    "connection_usage_warning": 75.0,
                    "buffer_pool_hit_critical": 90.0,
                    "buffer_pool_hit_warning": 95.0,
                },
            },
            "discovery": {
                "network_segments": ["172.18.0.0/24"],
                "port_range": [3306, 3306],
                "scan_timeout": 2.0,
                "max_concurrent": 100,
            },
            "routing": {
                "writer_hostgroup": 10,
                "reader_hostgroup": 20,
                "read_write_split_enabled": True,
                "default_query_rules": [
                    {"pattern": "^SELECT", "destination": 20},
                    {"pattern": ".*", "destination": 10},
                ],
            },
            "alerts": {
                "enabled_channels": ["log"],
                "email": {
                    "enabled": False,
                    "recipients": [],
                },
                "slack": {
                    "enabled": False,
                    "webhook_url": "",
                },
            },
        }

    def get_current(self) -> dict[str, Any]:
        """
        Get current configuration.

        Returns:
            Current configuration dictionary
        """
        if not self._current_config:
            return copy.deepcopy(self._defaults)
        return copy.deepcopy(self._current_config)

    def get_value(self, path: str) -> Any:
        """
        Get a specific configuration value by path.

        Args:
            path: Dot-separated path (e.g., "failover.timeout_seconds")

        Returns:
            Configuration value or None
        """
        config = self.get_current()
        parts = path.split(".")

        for part in parts:
            if isinstance(config, dict) and part in config:
                config = config[part]
            else:
                return None

        return config

    def update(
        self,
        updates: dict[str, Any],
        reason: str = "",
        user: str | None = None,
    ) -> ConfigVersion:
        """
        Update configuration and create new version.

        Args:
            updates: Configuration updates to apply
            reason: Reason for the change
            user: User making the change

        Returns:
            New ConfigVersion
        """
        # Get current config
        new_config = self.get_current()

        # Apply updates (deep merge)
        self._deep_merge(new_config, updates)

        # Create new version
        self._version_counter += 1
        version = ConfigVersion(
            version_number=self._version_counter,
            created_by=user,
            reason=reason,
            config=copy.deepcopy(new_config),
            parent_version_id=self._current_version_id,
        )

        # Store version
        self._versions[version.version_id] = version
        self._current_config = new_config
        self._current_version_id = version.version_id

        # Persist
        self._save_version(version)

        return version

    def rollback(
        self,
        version_id: str,
        user: str | None = None,
    ) -> ConfigVersion | None:
        """
        Rollback to a previous configuration version.

        Args:
            version_id: Version to rollback to
            user: User performing rollback

        Returns:
            New ConfigVersion with rolled-back config
        """
        if version_id not in self._versions:
            return None

        old_version = self._versions[version_id]

        # Create new version with old config
        self._version_counter += 1
        new_version = ConfigVersion(
            version_number=self._version_counter,
            created_by=user,
            reason=f"Rollback to version {old_version.version_number}",
            config=copy.deepcopy(old_version.config),
            parent_version_id=self._current_version_id,
        )

        # Store and apply
        self._versions[new_version.version_id] = new_version
        self._current_config = new_version.config
        self._current_version_id = new_version.version_id

        self._save_version(new_version)

        return new_version

    def get_version(self, version_id: str) -> ConfigVersion | None:
        """
        Get a specific configuration version.

        Args:
            version_id: Version ID

        Returns:
            ConfigVersion if found
        """
        return self._versions.get(version_id)

    def get_history(self, limit: int = 50) -> list[ConfigVersion]:
        """
        Get configuration version history.

        Args:
            limit: Maximum number of versions

        Returns:
            List of ConfigVersion sorted by version_number desc
        """
        versions = sorted(
            self._versions.values(),
            key=lambda v: v.version_number,
            reverse=True,
        )
        return versions[:limit]

    def compare_versions(
        self,
        version_id1: str,
        version_id2: str,
    ) -> dict[str, Any]:
        """
        Compare two configuration versions.

        Args:
            version_id1: First version ID
            version_id2: Second version ID

        Returns:
            Dictionary with differences
        """
        v1 = self._versions.get(version_id1)
        v2 = self._versions.get(version_id2)

        if not v1 or not v2:
            return {"error": "Version not found"}

        diff = self._compute_diff(v1.config, v2.config)
        return {
            "version1": version_id1,
            "version2": version_id2,
            "diff": diff,
        }

    def reset_to_defaults(self, user: str | None = None) -> ConfigVersion:
        """
        Reset configuration to defaults.

        Args:
            user: User performing reset

        Returns:
            New ConfigVersion with defaults
        """
        return self.update(
            self._defaults,
            reason="Reset to defaults",
            user=user,
        )

    def _deep_merge(self, target: dict, source: dict) -> None:
        """Deep merge source into target."""
        for key, value in source.items():
            if key in target and isinstance(target[key], dict) and isinstance(value, dict):
                self._deep_merge(target[key], value)
            else:
                target[key] = copy.deepcopy(value)

    def _compute_diff(
        self,
        config1: dict,
        config2: dict,
        path: str = "",
    ) -> dict[str, Any]:
        """Compute differences between two configs."""
        diff: dict[str, Any] = {"added": {}, "removed": {}, "changed": {}}

        keys1 = set(config1.keys())
        keys2 = set(config2.keys())

        # Added keys
        for key in keys2 - keys1:
            diff["added"][f"{path}.{key}" if path else key] = config2[key]

        # Removed keys
        for key in keys1 - keys2:
            diff["removed"][f"{path}.{key}" if path else key] = config1[key]

        # Changed keys
        for key in keys1 & keys2:
            current_path = f"{path}.{key}" if path else key

            if isinstance(config1[key], dict) and isinstance(config2[key], dict):
                nested_diff = self._compute_diff(
                    config1[key], config2[key], current_path
                )
                diff["added"].update(nested_diff["added"])
                diff["removed"].update(nested_diff["removed"])
                diff["changed"].update(nested_diff["changed"])
            elif config1[key] != config2[key]:
                diff["changed"][current_path] = {
                    "old": config1[key],
                    "new": config2[key],
                }

        return diff

    def _save_version(self, version: ConfigVersion) -> None:
        """Save version to disk."""
        file_path = self.storage_path / f"config_v{version.version_number}.json"
        with open(file_path, "w") as f:
            json.dump(version.to_dict(), f, indent=2, default=str)

    def _load_versions(self) -> None:
        """Load existing versions from disk."""
        for file_path in self.storage_path.glob("config_v*.json"):
            try:
                with open(file_path) as f:
                    data = json.load(f)
                version = ConfigVersion.from_dict(data)
                self._versions[version.version_id] = version

                if version.version_number > self._version_counter:
                    self._version_counter = version.version_number

            except Exception as e:
                print(f"Error loading version {file_path}: {e}")

        # Set current version to latest
        if self._versions:
            latest = max(self._versions.values(), key=lambda v: v.version_number)
            self._current_config = latest.config
            self._current_version_id = latest.version_id

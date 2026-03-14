"""
Utility modules for ClawSQL.
"""

from .database import DatabaseManager, ConnectionPool
from .logger import get_logger, setup_logging
from .security import TokenManager, hash_password, verify_password
from .exceptions import (
    ClawSQLError,
    InstanceNotFoundError,
    ClusterNotFoundError,
    FailoverError,
    ConfigurationError,
)

__all__ = [
    "DatabaseManager",
    "ConnectionPool",
    "get_logger",
    "setup_logging",
    "TokenManager",
    "hash_password",
    "verify_password",
    "ClawSQLError",
    "InstanceNotFoundError",
    "ClusterNotFoundError",
    "FailoverError",
    "ConfigurationError",
]
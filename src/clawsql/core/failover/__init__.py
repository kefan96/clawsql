"""
Failover module for MySQL cluster management.
"""

from .detector import FailureDetector, FailureEvent, FailureType
from .executor import FailoverExecutor, FailoverOperation, FailoverState
from .recovery import RecoveryManager, RecoveryOperation, RecoveryState

__all__ = [
    "FailureDetector",
    "FailureEvent",
    "FailureType",
    "FailoverExecutor",
    "FailoverOperation",
    "FailoverState",
    "RecoveryManager",
    "RecoveryOperation",
    "RecoveryState",
]

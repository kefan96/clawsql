"""
Logging utilities for ClawSQL.
"""

import json
import logging
import sys
from datetime import datetime


class JSONFormatter(logging.Formatter):
    """JSON log formatter for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add extra fields
        if hasattr(record, "extra") and record.extra:
            log_data["extra"] = record.extra

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class TextFormatter(logging.Formatter):
    """Human-readable text log formatter."""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as text."""
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        base = f"{timestamp} [{record.levelname:8}] {record.name}: {record.getMessage()}"

        if record.exc_info:
            base += f"\n{self.formatException(record.exc_info)}"

        return base


class ClawSQLLogger(logging.Logger):
    """Custom logger with extra field support."""

    def _log(
        self,
        level,
        msg,
        args,
        exc_info=None,
        extra=None,
        stack_info=False,
        stacklevel=1,
        **kwargs,
    ):
        """Override _log to handle extra fields."""
        if extra is None:
            extra = {}
        extra.update(kwargs)
        super()._log(
            level,
            msg,
            args,
            exc_info=exc_info,
            extra={"extra": extra} if extra else None,
            stack_info=stack_info,
            stacklevel=stacklevel,
        )


def setup_logging(
    level: str = "INFO",
    format_type: str = "json",
    log_file: str | None = None,
) -> None:
    """
    Setup logging configuration.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        format_type: Format type (json, text)
        log_file: Optional log file path
    """
    # Set custom logger class
    logging.setLoggerClass(ClawSQLLogger)

    # Get root logger
    root_logger = logging.getLogger("clawsql")
    root_logger.setLevel(getattr(logging, level.upper()))

    # Remove existing handlers
    root_logger.handlers.clear()

    # Create formatter
    if format_type == "json":
        formatter = JSONFormatter()
    else:
        formatter = TextFormatter()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, level.upper()))
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(getattr(logging, level.upper()))
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)


def get_logger(name: str = "clawsql") -> logging.Logger:
    """
    Get a logger instance.

    Args:
        name: Logger name

    Returns:
        Logger instance
    """
    return logging.getLogger(name)


class RequestContextFilter(logging.Filter):
    """Add request context to log records."""

    def __init__(self, request_id: str | None = None):
        super().__init__()
        self.request_id = request_id

    def filter(self, record: logging.LogRecord) -> bool:
        """Add request context to record."""
        if self.request_id:
            record.request_id = self.request_id
        return True


class AuditLogHandler(logging.Handler):
    """Log handler that writes to audit log."""

    def __init__(self, audit_log):
        super().__init__()
        self.audit_log = audit_log

    def emit(self, record: logging.LogRecord) -> None:
        """Emit log record to audit log."""
        try:
            # Only log important events
            if record.levelno >= logging.WARNING:
                self.audit_log.log(
                    action="log",
                    resource_type="system",
                    details={"message": record.getMessage()},
                )
        except Exception:
            self.handleError(record)

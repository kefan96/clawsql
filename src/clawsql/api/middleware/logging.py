"""
Logging middleware for ClawSQL API.
"""

import time
import uuid
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from ...utils.logger import get_logger

logger = get_logger("clawsql.api")


class RequestLogger:
    """Context manager for request logging."""

    def __init__(self, request_id: str, method: str, path: str):
        self.request_id = request_id
        self.method = method
        self.path = path
        self.start_time = time.time()

    def log_request(self, request: Request) -> None:
        """Log incoming request."""
        logger.info(
            f"Request started: {self.method} {self.path}",
            extra={
                "request_id": self.request_id,
                "method": self.method,
                "path": self.path,
                "client_ip": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent", ""),
            },
        )

    def log_response(self, response: Response) -> None:
        """Log outgoing response."""
        duration_ms = (time.time() - self.start_time) * 1000

        logger.info(
            f"Request completed: {self.method} {self.path} -> {response.status_code}",
            extra={
                "request_id": self.request_id,
                "method": self.method,
                "path": self.path,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
            },
        )


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Logging middleware for API requests.

    Logs request/response details with timing information.
    """

    def __init__(self, app, exclude_paths: set[str] | None = None):
        """
        Initialize logging middleware.

        Args:
            app: FastAPI application
            exclude_paths: Paths to exclude from logging
        """
        super().__init__(app)
        self.exclude_paths = exclude_paths or {
            "/health",
            "/metrics",
            "/favicon.ico",
        }

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with logging."""
        # Skip logging for excluded paths
        if request.url.path in self.exclude_paths:
            return await call_next(request)

        # Generate request ID
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

        # Create request logger
        request_logger = RequestLogger(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        # Log request
        request_logger.log_request(request)

        # Process request
        try:
            response = await call_next(request)

            # Add request ID to response
            response.headers["X-Request-ID"] = request_id

            # Log response
            request_logger.log_response(response)

            return response

        except Exception as e:
            # Log error
            duration_ms = (time.time() - request_logger.start_time) * 1000

            logger.error(
                f"Request failed: {request.method} {request.url.path}",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round(duration_ms, 2),
                    "error": str(e),
                },
            )
            raise


class CorrelationMiddleware(BaseHTTPMiddleware):
    """
    Correlation ID middleware.

    Adds correlation IDs to requests for distributed tracing.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Add correlation ID to request."""
        # Get or generate correlation ID
        correlation_id = request.headers.get(
            "X-Correlation-ID",
            str(uuid.uuid4()),
        )

        # Store in request state
        request.state.correlation_id = correlation_id

        # Process request
        response = await call_next(request)

        # Add correlation ID to response
        response.headers["X-Correlation-ID"] = correlation_id

        return response


class TimingMiddleware(BaseHTTPMiddleware):
    """
    Request timing middleware.

    Adds timing information to responses.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Add timing information."""
        start_time = time.time()

        response = await call_next(request)

        # Calculate duration
        duration_ms = (time.time() - start_time) * 1000

        # Add timing header
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        return response


def setup_request_logging(request: Request) -> dict:
    """
    Extract request information for logging.

    Args:
        request: FastAPI request

    Returns:
        Dictionary with request information
    """
    return {
        "request_id": getattr(request.state, "request_id", None),
        "correlation_id": getattr(request.state, "correlation_id", None),
        "method": request.method,
        "path": request.url.path,
        "query": str(request.query_params),
        "client_ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent", ""),
        "content_type": request.headers.get("content-type", ""),
        "content_length": request.headers.get("content-length", ""),
    }

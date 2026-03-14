"""
Authentication middleware for ClawSQL API.
"""

import time
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ...utils.security import TokenManager


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Authentication middleware for API requests.

    Validates JWT tokens and adds user context to requests.
    """

    # Paths that don't require authentication
    PUBLIC_PATHS = {
        "/",
        "/health",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/api/v1/monitoring/health",
        "/api/v1/monitoring/metrics/prometheus",
    }

    def __init__(
        self,
        app,
        token_manager: TokenManager,
        public_paths: Optional[set[str]] = None,
    ):
        """
        Initialize authentication middleware.

        Args:
            app: FastAPI application
            token_manager: Token manager for validation
            public_paths: Additional public paths
        """
        super().__init__(app)
        self.token_manager = token_manager
        self.public_paths = self.PUBLIC_PATHS | (public_paths or set())

    async def dispatch(self, request: Request, call_next: Callable):
        """Process request through authentication."""
        # Skip auth for public paths
        if request.url.path in self.public_paths:
            return await call_next(request)

        # Skip auth for OPTIONS requests (CORS)
        if request.method == "OPTIONS":
            return await call_next(request)

        # Check for authorization header
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "MISSING_TOKEN",
                    "message": "Authorization header required",
                },
            )

        # Extract token
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "INVALID_TOKEN_FORMAT",
                    "message": "Invalid authorization header format",
                },
            )

        token = parts[1]

        # Validate token
        payload = self.token_manager.validate_token(token)

        if not payload:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "INVALID_TOKEN",
                    "message": "Token is invalid or expired",
                },
            )

        # Check if token is revoked
        if self.token_manager.is_token_revoked(token):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "TOKEN_REVOKED",
                    "message": "Token has been revoked",
                },
            )

        # Add user info to request state
        request.state.user = payload.get("sub")
        request.state.token_payload = payload

        return await call_next(request)


# Bearer token security scheme
security = HTTPBearer()


def create_auth_dependency(token_manager: TokenManager):
    """
    Create authentication dependency for route protection.

    Args:
        token_manager: Token manager instance

    Returns:
        Dependency function for FastAPI routes
    """

    async def get_current_user(
        credentials: HTTPAuthorizationCredentials = Depends(security),
    ) -> dict:
        """
        Validate token and return user info.

        Raises:
            HTTPException: If token is invalid

        Returns:
            User info dictionary
        """
        token = credentials.credentials

        payload = token_manager.validate_token(token)

        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if token_manager.is_token_revoked(token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return {
            "user_id": payload.get("sub"),
            "permissions": payload.get("permissions", []),
            "payload": payload,
        }

    return get_current_user


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware.

    Limits requests per IP address within a time window.
    """

    def __init__(
        self,
        app,
        requests_per_minute: int = 60,
        window_seconds: int = 60,
    ):
        """
        Initialize rate limiting middleware.

        Args:
            app: FastAPI application
            requests_per_minute: Maximum requests per minute
            window_seconds: Time window in seconds
        """
        super().__init__(app)
        self.rate_limit = requests_per_minute
        self.window = window_seconds
        self._requests: dict[str, list[float]] = {}

    async def dispatch(self, request: Request, call_next: Callable):
        """Process request through rate limiting."""
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"

        # Clean old requests
        current_time = time.time()
        cutoff = current_time - self.window

        if client_ip in self._requests:
            self._requests[client_ip] = [
                t for t in self._requests[client_ip] if t > cutoff
            ]
        else:
            self._requests[client_ip] = []

        # Check rate limit
        if len(self._requests[client_ip]) >= self.rate_limit:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "RATE_LIMIT_EXCEEDED",
                    "message": f"Rate limit exceeded: {self.rate_limit} requests per minute",
                },
                headers={"Retry-After": str(self.window)},
            )

        # Record request
        self._requests[client_ip].append(current_time)

        return await call_next(request)
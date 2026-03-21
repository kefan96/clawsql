"""
ClawSQL - Main FastAPI Application Entry Point.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.endpoints import router as api_router
from .api.middleware.logging import LoggingMiddleware
from .config.settings import Settings, get_settings
from .utils.exceptions import ClawSQLError
from .utils.logger import get_logger, setup_logging
from .utils.security import TokenManager

logger = get_logger("clawsql")


@asynccontextmanager
async def lifespan(app: "App"):
    """
    Application lifespan manager.

    Handles startup and shutdown events.
    """
    # Startup
    logger.info("ClawSQL starting up...")

    settings = get_settings()
    setup_logging(
        level=settings.logging.level,
        format_type=settings.logging.format,
    )

    logger.info(
        "Configuration loaded",
        extra={
            "api_host": settings.api.host,
            "api_port": settings.api.port,
            "debug": settings.debug,
        },
    )

    # Initialize components
    app.state.settings = settings
    app.state.token_manager = TokenManager(
        secret_key=settings.api.token_secret,
        expiry_hours=settings.api.token_expiry_hours,
    )

    logger.info("ClawSQL ready to accept requests")

    yield

    # Shutdown
    logger.info("ClawSQL shutting down...")


class App(FastAPI):
    """Custom FastAPI application with ClawSQL configuration."""

    def __init__(self, settings: Settings | None = None):
        """
        Initialize ClawSQL application.

        Args:
            settings: Application settings (uses defaults if not provided)
        """
        self.settings = settings or get_settings()

        super().__init__(
            title="ClawSQL",
            description="""
## MySQL Cluster Automation and Operations Management System

ClawSQL provides comprehensive automation for MySQL cluster management:

### Features
- **Instance Discovery**: Automatically discover MySQL instances in your network
- **Cluster Monitoring**: Real-time monitoring with health checks and alerts
- **Failover Management**: Automatic and manual failover with candidate selection
- **Load Management**: Read/write splitting via ProxySQL integration
- **Configuration Management**: Versioned configuration with rollback capability

### Architecture
- Orchestrator for topology management
- ProxySQL for query routing
- Prometheus for metrics collection
- Grafana for visualization
            """,
            version="0.1.0",
            docs_url="/docs",
            redoc_url="/redoc",
            openapi_url="/openapi.json",
            lifespan=lifespan,
        )

        self._setup_middleware()
        self._setup_routes()
        self._setup_exception_handlers()


    def _setup_middleware(self) -> None:
        """Configure middleware."""
        # CORS
        self.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # Configure appropriately for production
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Request logging
        self.add_middleware(LoggingMiddleware)


    def _setup_routes(self) -> None:
        """Configure routes."""
        # Health check endpoint
        @self.get("/health", tags=["health"])
        async def health_check() -> dict[str, Any]:
            """Health check endpoint."""
            return {
                "status": "healthy",
                "version": "0.1.0",
            }

        # Root endpoint
        @self.get("/", tags=["root"])
        async def root() -> dict[str, Any]:
            """Root endpoint with API information."""
            return {
                "name": "ClawSQL",
                "version": "0.1.0",
                "description": "MySQL Cluster Automation and Operations Management",
                "docs": "/docs",
                "health": "/health",
            }

        # API routes
        self.include_router(api_router, prefix="/api/v1")


    def _setup_exception_handlers(self) -> None:
        """Configure exception handlers."""

        @self.exception_handler(ClawSQLError)
        async def clawsql_error_handler(
            request: Request,
            exc: ClawSQLError,
        ) -> JSONResponse:
            """Handle ClawSQL-specific errors."""
            logger.error(
                f"ClawSQL error: {exc.code} - {exc.message}",
                extra={
                    "error_code": exc.code,
                    "error_details": exc.details,
                },
            )

            return JSONResponse(
                status_code=400,
                content=exc.to_dict(),
            )

        @self.exception_handler(Exception)
        async def general_error_handler(
            request: Request,
            exc: Exception,
        ) -> JSONResponse:
            """Handle general errors."""
            logger.exception(f"Unhandled error: {exc}")

            return JSONResponse(
                status_code=500,
                content={
                    "error": "INTERNAL_ERROR",
                    "message": "An internal error occurred",
                },
            )


def create_app(settings: Settings | None = None) -> App:
    """
    Factory function to create ClawSQL application.

    Args:
        settings: Application settings

    Returns:
        Configured FastAPI application
    """
    return App(settings)


# Default application instance
app = create_app()


def main() -> None:
    """Main entry point for running the server."""
    import uvicorn

    settings = get_settings()

    uvicorn.run(
        "clawsql.main:app",
        host=settings.api.host,
        port=settings.api.port,
        reload=settings.debug,
        log_level=settings.logging.level.lower(),
    )


if __name__ == "__main__":
    main()

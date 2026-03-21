# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
# Start platform (bring your own MySQL)
./start.sh

# Start with demo MySQL cluster
./start.sh --demo

# Stop services
./start.sh --stop
```

## Development Commands

```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install with dev dependencies
pip install -e ".[dev]"

# Run ClawSQL API locally
clawsql
# Or: python -m uvicorn clawsql.main:app --reload

# Run tests
pytest

# Run tests with coverage
pytest --cov=src --cov-report=html

# Run only unit tests
pytest -m unit

# Format code
black src tests

# Lint
ruff check src tests

# Type check
mypy src
```

## Architecture Overview

ClawSQL is a FastAPI application that provides unified management for MySQL clusters through integrations with external tools.

### Core Modules (`src/clawsql/core/`)

- **discovery/**: Instance discovery and topology management
  - `models.py`: Core data models (`MySQLInstance`, `MySQLCluster`, enums for roles/states/health)
  - `scanner.py`: Network scanning for MySQL instances
  - `topology.py`: Orchestrator client for topology sync

- **monitoring/**: Metrics collection and alerting
  - `collector.py`: Periodic metrics collection from MySQL
  - `health_checker.py`: Threshold-based health evaluation
  - `alert_manager.py`: Alert generation and management
  - `exporters.py`: Prometheus metrics export

- **failover/**: Automatic and manual failover
  - `detector.py`: Failure detection with confirmation checks
  - `executor.py`: Failover orchestration (`FailoverOperation`, `FailoverExecutor`)
  - `recovery.py`: Instance recovery and reintegration

- **routing/**: ProxySQL integration
  - `proxysql_manager.py`: Dynamic ProxySQL configuration
  - `load_balancer.py`: Dynamic weight adjustment for read replicas

### API Layer (`src/clawsql/api/`)

- `endpoints/`: REST API endpoints (instances, clusters, failover, monitoring, config)
- `middleware/`: Authentication (JWT) and request logging
- `schemas/`: Pydantic request/response models

### Configuration

Settings loaded from environment variables via pydantic-settings. See `.env.example`.

**Metadata Storage:**
- SQLite (default): `DB_TYPE=sqlite`
- MySQL: `DB_TYPE=mysql` with connection details

**Key Settings:**
- `API_TOKEN_SECRET`: JWT secret for authentication
- `ORCHESTRATOR_URL`: Orchestrator API endpoint
- `AUTO_FAILOVER_ENABLED`: Enable/disable automatic failover
- `MYSQL_MONITOR_USER/PASSWORD`: Credentials for monitoring your MySQL instances

### Integration Points

1. **Orchestrator**: Source of truth for MySQL topology
   - Topology discovery and sync
   - Graceful failover execution
   - Replica relocation

2. **ProxySQL**: Traffic routing layer
   - Read/write splitting hostgroups
   - Dynamic server configuration via API
   - Automatic weight updates

3. **Prometheus**: Metrics storage

### Failover Flow

1. `FailureDetector` identifies primary failure
2. Multiple confirmation checks (configurable)
3. `FailoverExecutor` selects best candidate (lowest lag, best binlog position)
4. Orchestrator promotes candidate
5. Replicas reconfigured to follow new primary
6. ProxySQL routing updated

### Key Patterns

- **Async I/O**: All database and HTTP operations are async
- **Dataclasses**: Core models use `@dataclass` with `to_dict()` methods
- **Dependency injection**: Settings loaded via `get_settings()` with LRU cache
- **Pydantic validation**: All API inputs validated with Pydantic models
- **Enum types**: Used extensively for states, roles, and health status
- **Dual database support**: SQLite and MySQL for metadata storage
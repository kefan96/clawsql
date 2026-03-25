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
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run CLI
node dist/bin/clawsql.js

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Development mode with watcher
npm run dev

# Lint
npm run lint

# Format
npm run format
```

## CLI Commands

The ClawSQL CLI provides interactive management of MySQL clusters.

### Platform Lifecycle

```bash
/start [--demo]     # Start ClawSQL platform
/stop               # Stop all services
/status             # Show platform status
/cleanup            # Remove all containers and data
/doctor             # Run diagnostics and suggest fixes
```

### Configuration

```bash
/config show                    # Display current configuration
/config init                    # Interactive configuration wizard
/config set <key> <value>       # Set configuration value
/config get <key>               # Get configuration value
```

Available keys: `mysql.admin_user`, `mysql.admin_password`, `mysql.repl_user`, `mysql.repl_password`, `orchestrator.url`, `proxysql.host`, `proxysql.admin_port`, `failover.auto_enabled`, `log.level`

### Instance Management

```bash
/instances list                           # List discovered instances
/instances discover <network> [options]   # Scan network for MySQL
/instances register --host <host> [opts]  # Register instance manually
/instances remove --host <host>           # Remove instance
```

### Cluster Management

```bash
/clusters list                            # List all clusters
/clusters topology [--name <cluster>]     # Show topology
/clusters import --primary <host:port>    # Import existing topology
/clusters create --name <n> --primary <h:p> [--replicas <h:p,...>]
/clusters sync [--name <cluster>]         # Sync to ProxySQL
/clusters promote --name <n> --host <h:p> # Promote replica to primary
```

## Architecture Overview

ClawSQL is a Node.js/TypeScript application that provides unified management for MySQL clusters through integrations with external tools.

### Core Modules (`src/core/`)

- **discovery/**: Instance discovery and topology management
  - `models.ts`: Core data models (`MySQLInstance`, `MySQLCluster`, enums for roles/states/health)
  - `scanner.ts`: Network scanning for MySQL instances
  - `topology.ts`: Orchestrator client for topology sync

- **monitoring/**: Metrics collection and alerting
  - `collector.ts`: Periodic metrics collection from MySQL
  - `health_checker.ts`: Threshold-based health evaluation
  - `alert_manager.ts`: Alert generation and management
  - `exporters.ts`: Prometheus metrics export

- **failover/**: Automatic and manual failover
  - `detector.ts`: Failure detection with confirmation checks
  - `executor.ts`: Failover orchestration (`FailoverOperation`, `FailoverExecutor`)
  - `recovery.ts`: Instance recovery and reintegration

- **routing/**: ProxySQL integration
  - `proxysql_manager.ts`: Dynamic ProxySQL configuration
  - `load_balancer.ts`: Dynamic weight adjustment for read replicas

### API Layer (`src/api/`)

- `routes/`: REST API endpoints (instances, clusters, failover, monitoring, config)
- `middleware/`: Authentication (JWT) and request logging
- `schemas/`: Zod request/response models

### CLI Layer (`src/cli/`)

- `index.ts`: Main CLI entry point with interactive shell
- `registry.ts`: Command registration and context
- `commands/`: Individual command implementations
  - `start.ts`, `stop.ts`, `status.ts`, `cleanup.ts`, `doctor.ts`
  - `config.ts`, `instances.ts`, `clusters.ts`
  - `topology.ts`, `failover.ts`, `health.ts`, `sql.ts`

### Configuration

Settings loaded from environment variables via Zod schemas. See `.env.example`.

**Key Settings:**
- `API_TOKEN_SECRET`: JWT secret for authentication
- `ORCHESTRATOR_URL`: Orchestrator API endpoint
- `AUTO_FAILOVER_ENABLED`: Enable/disable automatic failover
- `MYSQL_ADMIN_USER/PASSWORD`: Credentials for your MySQL instances

**Config file location:** `~/.clawsql/config.json`

### Integration Points

1. **Orchestrator**: Source of truth for MySQL topology
   - Topology discovery and sync
   - Graceful failover execution
   - Replica relocation
   - API uses GET method for discover/forget operations

2. **ProxySQL**: Traffic routing layer
   - Read/write splitting hostgroups (10=writer, 20=reader)
   - Dynamic server configuration
   - Note: ProxySQL admin doesn't support prepared statements

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
- **Zod validation**: All settings and API inputs validated with Zod schemas
- **Enum types**: Used extensively for states, roles, and health status
- **Dual database support**: SQLite (default) and MySQL for metadata storage

## MySQL Configuration Requirements

### Orchestrator User

Orchestrator connects to MySQL using `clawsql`/`clawsql_password` (configured in `docker/orchestrator/orchestrator.conf.json`):

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
```

### Replication User

For GTID replication:

```sql
CREATE USER 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_password';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
```

## Common Issues

1. **Orchestrator API returns 404**: The Orchestrator API uses GET method (not POST) for `/api/discover/{host}/{port}`

2. **ProxySQL "Command not supported"**: ProxySQL admin interface doesn't support prepared statements. Use `query()` instead of `execute()` with interpolated parameters.

3. **ProxySQL ON DUPLICATE KEY**: Not supported. Use DELETE + INSERT pattern instead.

4. **Replication auth error**: MySQL 8.0 uses `caching_sha2_password` by default. Use `mysql_native_password` for replication users.
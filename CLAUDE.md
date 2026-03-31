# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Installation

### Via npm (Recommended for Users)

```bash
npm install -g clawsql
clawsql install           # Pull Docker images (one-time setup)
clawsql
> /start
```

### From Source (For Development)

```bash
git clone https://github.com/clawsql/clawsql.git
cd clawsql
npm install
npm run build
node dist/bin/clawsql.js
```

## Quick Start

```bash
# Using the CLI
clawsql install           # Pull images first (one-time)
clawsql
> /start                  # Start platform
> /clusters provision     # Provision a cluster interactively
> /stop                   # Stop services
```

## Development Commands

```bash
npm install               # Install dependencies
npm run build             # Build TypeScript
npm test                  # Run tests
npm run test:coverage     # Run tests with coverage
npm run dev               # Development mode with watcher
npm run lint              # Lint
npm run format            # Format
```

## CLI Commands

### Platform Lifecycle

```bash
/install [--demo]         # Pull Docker images (required before first start)
/start [--demo]           # Start ClawSQL platform
/stop                     # Stop all services
/status                   # Show platform status
/cleanup                  # Remove all containers and data
/doctor                   # Run diagnostics and suggest fixes
```

### Configuration

```bash
/config show              # Display current configuration
/config init              # Interactive configuration wizard
/config set <key> <value> # Set configuration value
/config get <key>         # Get configuration value
```

Available keys: `mysql.admin_user`, `mysql.admin_password`, `mysql.repl_user`, `mysql.repl_password`, `orchestrator.url`, `proxysql.host`, `proxysql.admin_port`, `failover.auto_enabled`, `log.level`

### Cluster Provisioning (Primary Method)

ClawSQL uses a **provisioning-first approach** - create clusters from predefined templates:

```bash
# Interactive mode
/clusters provision

# Provision with template
/clusters provision --template <name> --cluster <name> --hosts <h:p,...>

# Quick provisioning
/clusters quick <template> <cluster> <h:p,...>

# Deprovision
/clusters deprovision <cluster> --force
```

### Predefined Templates

Templates are automatically initialized on startup:

| Template | Nodes | Mode | Use Case |
|----------|-------|------|----------|
| `dev-single` | 1 | async | Development/testing |
| `dev-replica` | 2 | async | Development with redundancy |
| `standard` | 3 | async | General production |
| `ha-semisync` | 3 | semi-sync | Critical production |
| `read-heavy` | 5 | async | Analytics/reporting |
| `production-ha` | 4 | semi-sync | Mission-critical |
| `geo-distributed` | 6 | async | Multi-region |

### Cluster Management

```bash
/clusters list                        # List all clusters
/clusters topology [--name <cluster>] # Show topology
```

### Manual Operations (Advanced)

```bash
/clusters manual create --name <n> --primary <h:p> [--replicas <h:p,...>]
/clusters manual import --primary <h:p>
/clusters manual sync [--name <cluster>]
/clusters manual promote --name <n> --host <h:p>
```

### Template Management

```bash
/templates list                     # List available templates
/templates create --name <n> [--replicas <n>] [--mode <async|semi-sync>]
/templates show <name>
/templates delete <name> --force
```

### Instance Management

```bash
/instances list
/instances discover <network> [options]
/instances register --host <host> [opts]
/instances remove --host <host>
```

## Architecture Overview

ClawSQL is a Node.js/TypeScript application that provides unified management for MySQL clusters.

### Core Modules (`src/core/`)

- **discovery/**: Instance discovery and topology management
- **monitoring/**: Metrics collection and alerting
- **failover/**: Automatic and manual failover
- **provisioning/**: Template-based cluster provisioning
  - `predefined-templates.ts`: Built-in templates for common scenarios
  - `template-manager.ts`: Template CRUD and validation
  - `cluster-provisioner.ts`: Provisioning engine with replication setup
- **routing/**: ProxySQL integration

### API Layer (`src/api/`)

- `routes/`: REST API endpoints
- `middleware/`: Authentication and logging
- `schemas/`: Zod request/response models

### CLI Layer (`src/cli/`)

- `index.ts`: Main CLI entry point
- `registry.ts`: Command registration
- `commands/`: Individual command implementations
- `utils/`: Shared utilities

## MySQL Configuration Requirements

### Admin User (Required)

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### Replication User (Created Automatically)

The replication user is created automatically during provisioning.

## Common Issues

1. **Orchestrator API returns 404**: Uses GET method for `/api/discover/{host}/{port}`

2. **ProxySQL "Command not supported"**: Admin interface doesn't support prepared statements

3. **ProxySQL ON DUPLICATE KEY**: Not supported. Use DELETE + INSERT pattern

4. **Replication auth error**: MySQL 8.0 uses `caching_sha2_password` by default. Use `mysql_native_password`
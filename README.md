# ClawSQL

MySQL High Availability Management Platform with automatic failover, read/write splitting, and topology management.

## Features

- **Template-Based Provisioning**: Create clusters from predefined templates in one command
- **Automatic Failover**: Detect primary failures and promote replicas automatically
- **Read/Write Splitting**: ProxySQL integration for transparent traffic routing
- **Topology Management**: Orchestrator-powered MySQL cluster management
- **Instance Discovery**: Network scanning to find MySQL instances automatically
- **Monitoring**: Built-in Prometheus metrics and Grafana dashboards
- **Interactive CLI**: Full-featured command-line interface for all operations

## Prerequisites

- **Node.js**: v22.22+ (for CLI)
- **Container Runtime**: Docker or Podman
- **Docker Compose**: docker-compose or podman-compose

## Installation

```bash
npm install -g clawsql
```

## Quick Start

### 1. Install and Start Platform

```bash
# Install ClawSQL
npm install -g clawsql

# Pull Docker images (one-time setup)
clawsql install

# Start platform services
clawsql
> /start
```

### 2. Create MySQL Admin User

On each MySQL instance, create the admin user:

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### 3. Provision a Cluster

Choose a template and provision your cluster:

```bash
# View available templates
> /clusters provision

# Quick provision a 3-node production cluster
> /clusters quick standard mycluster mysql1:3306,mysql2:3306,mysql3:3306
Cluster "mycluster" ready at port 6033
```

That's it! ClawSQL automatically:
- Sets up GTID-based replication (first host = primary, others = replicas)
- Configures ProxySQL with a dedicated port (6033, 6034, etc.)
- Registers instances with Orchestrator for topology management

### Connect to Your Cluster

```bash
# Connect through ProxySQL (read/write split is automatic)
mysql -h 127.0.0.1 -P 6033 -u clawsql -pclawsql_password
```

## Predefined Templates

| Template | Nodes | Mode | Use Case |
|----------|-------|------|----------|
| `dev-single` | 1 | async | Development/testing, CI/CD |
| `dev-replica` | 2 | async | Development with backup |
| `standard` | 3 | async | General production workloads |
| `ha-semisync` | 3 | semi-sync | Critical production, zero data loss |
| `read-heavy` | 5 | async | Analytics, reporting, high read throughput |
| `production-ha` | 4 | semi-sync | Mission-critical, enterprise databases |
| `geo-distributed` | 6 | async | Multi-region, disaster recovery |

Templates are auto-initialized on startup. No manual creation needed.

## Demo Mode

Test ClawSQL with a pre-configured demo cluster:

```bash
# Pull demo images
clawsql install --demo

# Start with demo MySQL cluster
clawsql
> /start --demo

# Provision the demo instances into a cluster
> /clusters quick standard demo <host-ip>:3306,<host-ip>:3307,<host-ip>:3308
```

## CLI Commands

### Platform Lifecycle

```bash
/install [--demo]     # Pull Docker images (required before first start)
/start [--demo]       # Start ClawSQL platform
/stop                 # Stop all services
/status               # Show platform status
/cleanup              # Remove all containers and data
/doctor               # Run diagnostics and suggest fixes
```

### Cluster Provisioning (Primary Method)

```bash
# Interactive mode - shows template selection
/clusters provision

# Provision with template
/clusters provision --template <template> --cluster <name> --hosts <h:p,...>

# Quick provisioning (minimal arguments)
/clusters quick <template> <cluster> <h:p,...>

# Deprovision
/clusters deprovision <cluster> --force
```

### Cluster Management

```bash
/clusters list                        # List all clusters
/clusters topology [--name <name>]    # Show topology
```

### Manual Operations (Advanced)

For existing topologies or special cases:

```bash
/clusters manual import --primary <h:p>        # Import existing topology
/clusters manual create --name <n> --primary <h:p> [--replicas <h:p,...>]
/clusters manual sync [--name <cluster>]       # Sync to ProxySQL
/clusters manual promote --name <n> --host <h:p>
```

### Instance Management

```bash
/instances list                           # List discovered instances
/instances discover <network> --auto-register   # Scan network for MySQL
/instances register <host> [port]         # Register instance manually
/instances remove <host> [port]           # Remove instance
```

### Failover Operations

```bash
/failover status                        # Show failover configuration
/failover history                       # Show operation history
/failover switchover <cluster> [target] # Planned primary change
/failover failover <cluster> [target]   # Emergency failover
```

### Template Management

```bash
/templates list                     # List available templates
/templates show <name>              # Show template details
/templates create --name <name> [--replicas <n>] [--mode <async|semi-sync>]
/templates delete <name> --force    # Delete custom template
```

## Services

| Service | URL | Description |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | REST API |
| API Docs | http://localhost:8080/docs | OpenAPI documentation |
| Orchestrator | http://localhost:3000 | MySQL topology manager |
| Prometheus | http://localhost:9090 | Metrics collection |
| Grafana | http://localhost:3001 | Dashboards (admin/admin) |
| ProxySQL | localhost:6033+ | MySQL traffic (per-cluster ports) |
| OpenClaw Gateway | ws://localhost:18789 | AI agent gateway |
| OpenClaw UI | http://localhost:18790 | AI control panel |

## MySQL Configuration Requirements

### Admin User (Required)

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### MySQL Server Configuration

```ini
[mysqld]
server-id = 1                    # Unique for each server
log-bin = mysql-bin
binlog-format = ROW
gtid-mode = ON
enforce-gtid-consistency = ON
log-slave-updates = ON
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Application                          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          ProxySQL                                │
│                    (Read/Write Splitting)                        │
│    Per-Cluster Ports: 6033 (cluster1), 6034 (cluster2), ...     │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
        ┌───────▼───────┐             ┌───────▼───────┐
        │    Primary    │             │    Replica    │
        │   (Writer)    │────────────▶│   (Reader)    │
        └───────────────┘             └───────────────┘
                │                             │
                └──────────────┬──────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                         ClawSQL                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Provisioning│  │ Orchestrator│  │  Failover   │              │
│  │   Engine    │  │   Client    │  │   Engine    │              │
│  │ (Templates) │  └─────────────┘  └─────────────┘              │
│  └─────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## AI Agent Integration

ClawSQL integrates with [OpenClaw](https://github.com/openclaw/openclaw) for AI-powered database operations:

```
clawsql> show me the cluster topology
clawsql> what's the replication lag?
clawsql> help me troubleshoot replication issues
```

See **[AI Integration Documentation](docs/AI.md)** for details.

## Development

```bash
npm install
npm run build
npm test
node dist/bin/clawsql.js
```

## Documentation

- [Getting Started](docs/GET_STARTED.md) - Step-by-step tutorial
- [AI Integration](docs/AI.md) - OpenClaw AI agent setup and usage
- [API Documentation](docs/API.md) - REST API reference
- [Demo Guide](docs/DEMO.md) - Testing with demo cluster
- [Failover Documentation](docs/failover.md) - Failover architecture and operations

## License

MIT
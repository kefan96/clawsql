# ClawSQL

MySQL High Availability Management Platform with automatic failover, read/write splitting, and topology management.

## Features

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

### Via npm (Recommended)

```bash
npm install -g clawsql
```

### From Source

```bash
git clone https://github.com/clawsql/clawsql.git
cd clawsql
npm install
npm run build
```

## Quick Start

**New to ClawSQL?** See the **[Getting Started Guide](docs/GET_STARTED.md)** for a step-by-step tutorial.

### Option 1: Demo Mode (Recommended for Testing)

Start with a pre-configured demo MySQL cluster:

```bash
# Install ClawSQL
npm install -g clawsql

# Pull required Docker images (do this once)
clawsql install --demo

# Start the platform
clawsql
> /start --demo
```

This starts:
- ClawSQL platform (API, Orchestrator, ProxySQL, Prometheus, Grafana)
- Demo MySQL cluster (1 primary + 2 replicas) using host networking

After starting, register the instances using your host IP:

```bash
# Replace <host-ip> with your actual host IP (shown in startup output)
> /instances register <host-ip> 3306
> /instances register <host-ip> 3307
> /instances register <host-ip> 3308

# Set up replication (creates repl user automatically)
> /instances setup-replication --host <host-ip>:3307 --master <host-ip>:3306
> /instances setup-replication --host <host-ip>:3308 --master <host-ip>:3306

# Sync to ProxySQL
> /clusters sync
```

### Option 2: Production Mode (Bring Your Own MySQL)

Start the platform and connect to your existing MySQL instances:

```bash
# Install ClawSQL
npm install -g clawsql

# Pull required Docker images
clawsql install

# Start the interactive CLI
clawsql

# Start platform services
> /start

# Create the clawsql admin user on your MySQL instances (run on each MySQL server)
# mysql -e "CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password'; GRANT ALL ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;"

# Discover MySQL instances on your network
> /instances discover 172.18.0.0/24 --auto-register

# Or register instances manually
> /instances register mysql-primary 3306

# Set up replication (if needed)
> /instances setup-replication --host replica-host:3306 --master primary-host:3306

# Sync to ProxySQL
> /clusters sync

# Verify health
> /doctor
```

## Services

After starting, access these services:

| Service | URL | Description |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | REST API |
| API Docs | http://localhost:8080/docs | OpenAPI documentation |
| Orchestrator | http://localhost:3000 | MySQL topology manager |
| Prometheus | http://localhost:9090 | Metrics collection |
| Grafana | http://localhost:3001 | Dashboards (admin/admin) |
| ProxySQL | localhost:6033 | MySQL traffic (read/write split) |
| OpenClaw Gateway | ws://localhost:18789 | AI agent gateway |
| OpenClaw UI | http://localhost:18790 | AI control panel |

### Demo MySQL Cluster

When started with `--demo`, MySQL containers use host networking to simulate real multi-node deployments. Instances are accessible at your host IP:

| Instance | Port | Credentials |
|----------|------|-------------|
| Primary | 3306 | clawsql/clawsql_password |
| Replica 1 | 3307 | clawsql/clawsql_password |
| Replica 2 | 3308 | clawsql/clawsql_password |

> **Note:** After starting with `--demo`, register instances using your host IP:
> ```bash
> > /instances register <host-ip> 3306
> > /instances register <host-ip> 3307
> > /instances register <host-ip> 3308
> ```

## CLI Commands

### Platform Lifecycle

```bash
/install [--demo]     # Pull Docker images (required before first start)
                      # --demo: Include MySQL demo cluster images
                      # --detail: Show verbose output

/start [--demo]       # Start ClawSQL platform
                      # --demo: Start with demo MySQL cluster
                      # --pull: Force pull missing images

/stop                 # Stop all services
/status               # Show platform status (images, containers, services)
/cleanup              # Remove all containers and data
/doctor               # Run diagnostics and suggest fixes
```

### Configuration

```bash
/config show                    # Display current configuration
/config init                    # Interactive configuration wizard
/config set <key> <value>       # Set configuration value
/config get <key>               # Get configuration value
```

Available configuration keys:
- `mysql.admin_user` - MySQL admin username
- `mysql.admin_password` - MySQL admin password
- `mysql.repl_user` - MySQL replication username
- `mysql.repl_password` - MySQL replication password
- `orchestrator.url` - Orchestrator URL
- `proxysql.host` - ProxySQL hostname
- `proxysql.admin_port` - ProxySQL admin port
- `failover.auto_enabled` - Enable auto failover (true/false)
- `log.level` - Log level (DEBUG/INFO/WARNING/ERROR/SILENT)

### Instance Management

```bash
/instances list                           # List discovered instances
/instances discover <network> [options]   # Scan network for MySQL
  --user <user>           MySQL username for discovery
  --password <pass>       MySQL password
  --port <port>           Port range (default: 3306)
  --auto-register         Auto-register discovered instances

/instances register <host> [port] [options]   # Register instance manually
  <host>                  MySQL hostname or IP (use host IP for demo)
  [port]                  MySQL port (default: 3306)
  --user <user>           MySQL username (default: from config)
  --password <pass>       MySQL password

/instances remove <host> [port]   # Remove instance

/instances setup-replication --host <replica:port> --master <primary:port>
  # Configure replication (creates repl user automatically)
```

### Cluster Management

```bash
/clusters list                                    # List all clusters
/clusters topology [--name <cluster>]             # Show topology
/clusters import --primary <host:port>            # Import existing topology
/clusters create --name <name> --primary <h:p>    # Create new cluster
  --replicas <h:p,...>   Replica instances (optional)

/clusters sync [--name <cluster>]                 # Sync to ProxySQL
/clusters add-replica --name <cluster> --host <h:p>    # Add replica
/clusters remove-replica --name <cluster> --host <h:p> # Remove replica
```

### Failover Operations

```bash
/failover status                        # Show failover configuration
/failover history                       # Show operation history
/failover switchover <cluster> [target] # Planned primary change (primary healthy)
/failover failover <cluster> [target]   # Emergency failover (primary down)
/failover recover list                  # List instances pending recovery
/failover recover <instance>            # Recover specific instance
/failover recover --all                 # Recover all pending instances
```

> **Note:** For promoting replicas, use `/failover switchover` instead of `/clusters promote`.

### Additional Commands

```bash
/topology [--name <cluster>]           # Quick topology view
/sql <host:port> "<query>"             # Execute SQL query on instance
/cron list                             # List scheduled tasks
/cron create "<cron>" "<command>"      # Schedule a recurring task
/cron remove <task-id>                 # Remove scheduled task
/notify send --message "<msg>"         # Send notification
```

## MySQL Configuration Requirements

### Admin User (Required)

Create the `clawsql` admin user on your MySQL instances. This user is used by ClawSQL for topology discovery, monitoring, and management:

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### Replication User (Created Automatically)

The replication user is created automatically by ClawSQL when you run `/instances setup-replication`. If you want to set up replication manually:

```sql
CREATE USER 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_password';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
```

### MySQL Server Configuration

For replication, your MySQL instances should have:

```ini
[mysqld]
server-id = 1                    # Unique for each server
log-bin = mysql-bin
binlog-format = ROW
gtid-mode = ON
enforce-gtid-consistency = ON
log-slave-updates = ON
```

## Configuration

Configuration is managed via environment variables. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | 8080 | API server port |
| `API_TOKEN_SECRET` | change-me | JWT secret (change in production!) |
| `MYSQL_ADMIN_USER` | clawsql | MySQL admin username |
| `MYSQL_ADMIN_PASSWORD` | clawsql_password | MySQL admin password |
| `AUTO_FAILOVER_ENABLED` | true | Enable automatic failover |
| `LOG_LEVEL` | INFO | Logging level |

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
│         Port 6033 - MySQL Traffic | Port 6032 - Admin           │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
        ┌───────▼───────┐             ┌───────▼───────┐
        │    Primary    │             │    Replica    │
        │   (Writer)    │────────────▶│   (Reader)    │
        │   Port 3306   │   Repl      │   Port 3306   │
        └───────────────┘             └───────────────┘
                │                             │
                └──────────────┬──────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                         ClawSQL                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Orchestrator│  │  Failover   │  │  Monitoring │              │
│  │   Client    │  │   Engine    │  │   Service   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────────────────────────────────────────┐            │
│  │              OpenClaw AI Gateway                 │            │
│  │         Port 18789 - Gateway | Port 18790 - UI  │            │
│  └─────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## AI Agent Integration

ClawSQL integrates with [OpenClaw](https://github.com/openclaw/openclaw) for AI-powered database operations. OpenClaw starts automatically with the platform.

```
clawsql> show me the cluster topology
clawsql> what's the replication lag?
clawsql> help me troubleshoot replication issues
```

See **[AI Integration Documentation](docs/AI.md)** for details on setup, configuration, and usage.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run CLI locally
node dist/bin/clawsql.js

# Run tests
npm test

# Run with file watcher
npm run dev
```

### Project Structure

```
clawsql/
├── src/
│   ├── index.ts           # Entry point
│   ├── app.ts             # Fastify application setup
│   ├── config/            # Configuration management
│   ├── types/             # TypeScript types and interfaces
│   ├── core/              # Core business logic
│   │   ├── discovery/     # Instance discovery and topology
│   │   ├── monitoring/    # Metrics and health checks
│   │   ├── failover/      # Failover operations
│   │   └── routing/       # ProxySQL integration
│   ├── api/               # REST API routes
│   ├── cli/               # CLI commands
│   ├── utils/             # Utilities
│   └── __tests__/         # Test files
├── docker/                # Docker configurations
├── scripts/               # Utility scripts
├── package.json           # Node.js dependencies
└── tsconfig.json          # TypeScript configuration
```

## Troubleshooting

### Check Platform Health

```bash
clawsql -c "/doctor"
```

### View Logs

```bash
docker compose logs -f clawsql
docker compose logs -f orchestrator
docker compose logs -f proxysql
```

### Check MySQL Replication

```bash
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW REPLICA STATUS\G"
```

### Reset ProxySQL

```bash
docker exec proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin -e "DELETE FROM mysql_servers; LOAD MYSQL SERVERS TO RUNTIME;"
```

## Documentation

- [Getting Started](docs/GET_STARTED.md) - Step-by-step tutorial
- [AI Integration](docs/AI.md) - OpenClaw AI agent setup and usage
- [API Documentation](docs/API.md) - REST API reference
- [Demo Guide](docs/DEMO.md) - Testing with demo cluster
- [Failover Documentation](docs/failover.md) - Failover architecture and operations
- [System Architecture](docs/architecture/system_design.md) - Technical details

## License

MIT
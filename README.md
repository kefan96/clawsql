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

- **Container Runtime**: Docker or Podman
- **Docker Compose**: docker-compose or podman-compose
- **Node.js**: v18+ (for CLI development)

## Quick Start

### Option 1: Demo Mode (Recommended for Testing)

Start with a pre-configured demo MySQL cluster:

```bash
./start.sh --demo
```

This starts:
- ClawSQL platform (API, Orchestrator, ProxySQL, Prometheus, Grafana)
- Demo MySQL cluster (1 primary + 2 replicas)

### Option 2: Production Mode (Bring Your Own MySQL)

Start the platform and connect to your existing MySQL instances:

```bash
# Start platform
./start.sh

# Configure MySQL credentials
node dist/bin/clawsql.js -c "/config set mysql.admin_user root"
node dist/bin/clawsql.js -c "/config set mysql.admin_password yourpassword"

# Create Orchestrator user on your MySQL instances
mysql -e "CREATE USER 'clawsql'@'%' IDENTIFIED BY 'clawsql_password'; GRANT ALL ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;"

# Discover MySQL instances on your network
node dist/bin/clawsql.js -c "/instances discover 172.18.0.0/24 --user root --password yourpassword"

# Or register instances manually
node dist/bin/clawsql.js -c "/instances register --host mysql-primary --port 3306"

# Sync to ProxySQL
node dist/bin/clawsql.js -c "/clusters sync"

# Verify health
node dist/bin/clawsql.js -c "/doctor"
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

### Demo MySQL Cluster

When started with `--demo`:

| Instance | Port | Credentials |
|----------|------|-------------|
| Primary | 3306 | root/rootpassword |
| Replica 1 | 3307 | root/rootpassword |
| Replica 2 | 3308 | root/rootpassword |

## CLI Commands

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

/instances register --host <host> [options]   # Register instance manually
  --port <port>           MySQL port (default: 3306)
  --user <user>           MySQL username
  --password <pass>       MySQL password

/instances remove --host <host> [--port <port>]   # Remove instance
```

### Cluster Management

```bash
/clusters list                                    # List all clusters
/clusters topology [--name <cluster>]             # Show topology
/clusters import --primary <host:port>            # Import existing topology
/clusters create --name <name> --primary <h:p>    # Create new cluster
  --replicas <h:p,...>   Replica instances (optional)

/clusters sync [--name <cluster>]                 # Sync to ProxySQL
/clusters promote --name <cluster> --host <h:p>   # Promote replica to primary
/clusters add-replica --name <cluster> --host <h:p>    # Add replica
/clusters remove-replica --name <cluster> --host <h:p> # Remove replica
```

## MySQL Configuration Requirements

### Orchestrator User

Create a user for Orchestrator on your MySQL instances:

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### Replication User (for GTID replication)

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
└─────────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run CLI
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
node dist/bin/clawsql.js -c "/doctor"
```

### View Logs

```bash
docker-compose logs -f clawsql
docker-compose logs -f orchestrator
docker-compose logs -f proxysql
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

- [API Documentation](docs/API.md) - REST API reference
- [Demo Guide](docs/DEMO.md) - Testing with demo cluster
- [System Architecture](docs/architecture/system_design.md) - Technical details

## License

MIT
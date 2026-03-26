# Getting Started with ClawSQL

This guide walks you through setting up and using ClawSQL for MySQL high availability management.

## Prerequisites

- **Container Runtime**: Docker or Podman
- **Docker Compose**: `docker-compose` or `podman-compose`
- **Node.js**: v18+ (for CLI development)

## Step 1: Start the Platform

### Demo Mode (Recommended for Testing)

Start with a pre-configured demo MySQL cluster (1 primary + 2 replicas):

```bash
./start.sh --demo
```

This starts:
- ClawSQL platform (API, Orchestrator, ProxySQL, Prometheus, Grafana)
- Demo MySQL cluster (1 primary + 2 replicas)

### Production Mode (Bring Your Own MySQL)

Start the platform and connect to your existing MySQL instances:

```bash
# Start platform services only
./start.sh
```

Then configure your MySQL credentials:

```bash
# Set MySQL admin credentials
/config set mysql.admin_user root
/config set mysql.admin_password yourpassword

# Create Orchestrator user on your MySQL instances
mysql -e "CREATE USER 'clawsql'@'%' IDENTIFIED BY 'clawsql_password'; GRANT ALL ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;"
```

### Verify Services

Check platform status:

```bash
/status
```

Run diagnostics:

```bash
/doctor
```

### Access Services

| Service | URL | Description |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | REST API |
| API Docs | http://localhost:8080/docs | OpenAPI documentation |
| Orchestrator | http://localhost:3000 | MySQL topology manager |
| Prometheus | http://localhost:9090 | Metrics collection |
| Grafana | http://localhost:3001 | Dashboards (admin/admin) |
| ProxySQL MySQL | localhost:6033 | MySQL traffic (read/write split) |
| ProxySQL Admin | localhost:6032 | Admin interface (admin/admin) |

### Demo MySQL Cluster

When started with `--demo`:

| Instance | Port | Credentials |
|----------|------|-------------|
| Primary | 3306 | root/rootpassword |
| Replica 1 | 3307 | root/rootpassword |
| Replica 2 | 3308 | root/rootpassword |

## Step 2: Configure OpenClaw (AI Agent)

ClawSQL includes an AI-powered assistant for database operations using [OpenClaw](https://github.com/anthropics/openclaw).

### What is OpenClaw?

OpenClaw is an AI gateway that enables natural language interaction with ClawSQL. It can help you:
- Query cluster topology and status
- Explain replication concepts
- Guide through setup procedures
- Troubleshoot common issues

### Prerequisites

Install and configure the OpenClaw CLI:

```bash
# Install OpenClaw (example - follow OpenClaw documentation for actual installation)
npm install -g openclaw

# Configure with your AI provider credentials
openclaw config set gateway.mode local
openclaw config set gateway.url http://localhost:8081
```

### Checking Availability

Start the ClawSQL CLI and check if OpenClaw is available:

```bash
node dist/bin/clawsql.js
```

The CLI will automatically detect OpenClaw and enable AI-powered features.

### Using the AI Agent

Interact naturally with the CLI:

```
clawsql> show me the cluster topology
clawsql> what's the replication lag on replica-1?
clawsql> help me set up a new replica
clawsql> explain the failover process
clawsql> why is my replica not replicating?
```

### Supported Operations

The AI agent can assist with:
- **Topology queries**: "show me the cluster", "what's the primary?"
- **Status checks**: "check replication status", "is the cluster healthy?"
- **Guided operations**: "how do I add a replica?", "help me set up failover"
- **Troubleshooting**: "why is replication lag high?", "diagnose connection issues"
- **Explanations**: "explain read/write splitting", "how does failover work?"

### Stopping AI Operations

During AI processing, press **ESC twice** (within 500ms) to stop the current operation.

## Step 3: Register Instances

### Auto-Discovery

Scan a network for MySQL instances:

```bash
# Scan a network segment
/instances discover 172.18.0.0/24 --auto-register

# Scan with custom ports
/instances discover 192.168.1.0/24 --port-start 3306 --port-end 3307

# Scan with credentials
/instances discover 10.0.0.0/24 --user root --password mypassword --auto-register
```

### Manual Registration

Register instances individually:

```bash
# Register by host (default port 3306)
/instances register mysql-primary

# Register with specific port
/instances register mysql-replica-1 3307

# Register with credentials
/instances register mysql-new --port 3306 --user root --password mypassword
```

### View Discovered Instances

```bash
/instances list
```

### Remove Instances

```bash
/instances remove mysql-old:3306
```

## Step 4: Manage Clusters

### View Cluster Topology

```bash
# List all clusters
/clusters list

# Show topology for a specific cluster
/clusters topology --name mysql-primary

# Show all topologies
/clusters topology
```

The topology view shows:
- Primary instance (writer)
- Replica instances (readers)
- Replication lag
- Instance states (online/offline)
- ProxySQL hostgroups

### Import Existing Topology

If you have an existing MySQL replication setup:

```bash
# Import by discovering the primary (Orchestrator auto-discovers replicas)
/clusters import --primary mysql-primary:3306
```

### Create New Cluster

```bash
# Create with primary and replicas
/clusters create --name my-cluster --primary mysql-primary:3306 --replicas mysql-replica-1:3306,mysql-replica-2:3306
```

### Sync to ProxySQL

Sync cluster topology to ProxySQL for read/write splitting:

```bash
# Sync all clusters
/clusters sync

# Sync specific cluster
/clusters sync --name mysql-primary
```

### Understanding Read/Write Splitting

ProxySQL automatically routes queries:
- **Writer Hostgroup (10)**: All write queries go to the primary
- **Reader Hostgroup (20)**: All read queries are distributed among replicas

Connect your application to ProxySQL:

```bash
# Connect through ProxySQL (read/write split is automatic)
mysql -h 127.0.0.1 -P 6033 -u root -prootpassword
```

## Step 5: Failover & Switchover

### Terminology

| Term | Description |
|------|-------------|
| **Switchover** | Planned operation when primary is healthy. Old primary becomes a replica. |
| **Failover** | Emergency operation when primary is down. Promotes a replica automatically. |
| **Recovery** | Process of reintegrating a failed primary back as a replica. |

### Planned Switchover

When the primary is healthy and you want to change to a new primary:

```bash
# Auto-select best replica (lowest lag)
/failover switchover mysql-primary

# Promote specific replica
/failover switchover mysql-primary mysql-replica-1:3306
```

The switchover process:
1. Verifies primary is healthy
2. Selects the best replica (or uses specified target)
3. Gracefully promotes the new primary via Orchestrator
4. Reconfigures old primary as a replica
5. Updates ProxySQL routing

### Emergency Failover

When the primary is down:

```bash
# Auto-select best available replica
/failover failover mysql-primary

# Promote specific replica
/failover failover mysql-primary mysql-replica-2:3306
```

The failover process:
1. Verifies primary is NOT healthy
2. Selects the best replica
3. Forces promotion via Orchestrator
4. Queues old primary for recovery
5. Updates ProxySQL routing

### Recovery

After a failover, recover the old primary when it comes back online:

```bash
# List instances pending recovery
/failover recover list

# Recover a specific instance
/failover recover mysql-old-primary:3306

# Recover all pending instances
/failover recover --all
```

### View Failover History

```bash
/failover history
```

### Failover Configuration

```bash
# View current configuration
/failover status

# Enable/disable automatic failover
/config set failover.auto_enabled true

# Set confirmation checks (number of checks before triggering)
/config set failover.confirmation_checks 3
```

## Common Operations

### Check Replication Status

```bash
# Detailed replication status for an instance
/instances replication mysql-replica-1:3306
```

### Set Instance Read-Only/Writeable

```bash
# Set instance to read-only
/instances read-only mysql-replica-1:3306

# Set instance to writeable
/instances writeable mysql-primary:3306
```

### Replication Control

```bash
# Start replication
/instances start-slave mysql-replica-1:3306

# Stop replication
/instances stop-slave mysql-replica-1:3306

# Reset replication (destructive)
/instances reset-slave mysql-replica-1:3306 --confirm
```

### Relocate Replica

Move a replica to follow a different master:

```bash
/instances relocate --host mysql-replica-2:3306 --master mysql-replica-1:3306
```

### Maintenance Mode

Put an instance in maintenance mode (prevents failover promotion):

```bash
# Begin maintenance
/instances begin-maintenance mysql-replica-1:3306 --reason "Hardware upgrade" --duration 60

# End maintenance
/instances end-maintenance mysql-replica-1:3306
```

### Execute SQL Queries

```bash
# Execute SQL on an instance
/sql mysql-primary:3306 "SELECT * FROM information_schema.processlist"
```

### Schedule Tasks

```bash
# Schedule a recurring task
/cron create "0 * * * *" "/clusters sync"

# List scheduled tasks
/cron list

# Remove a scheduled task
/cron remove <task-id>
```

## Next Steps

- **[API Documentation](API.md)** - REST API reference
- **[Failover Documentation](failover.md)** - Detailed failover architecture
- **[System Architecture](architecture/system_design.md)** - Technical overview
- **[Demo Guide](DEMO.md)** - Testing with demo cluster

## Troubleshooting

### Platform Won't Start

```bash
# Check for port conflicts
/doctor

# View logs
docker-compose logs clawsql
docker-compose logs orchestrator
docker-compose logs proxysql
```

### Instance Not Discovered

1. Check MySQL is running: `docker ps` or `systemctl status mysql`
2. Verify network connectivity
3. Check credentials are correct
4. Ensure Orchestrator user exists on MySQL

### Replication Issues

```bash
# Check replication status
/instances replication mysql-replica-1:3306

# Check for errors
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G"
```

### ProxySQL Not Routing Correctly

```bash
# Sync topology
/clusters sync

# Check ProxySQL servers
mysql -h 127.0.0.1 -P 6032 -u admin -padmin -e "SELECT * FROM mysql_servers;"
```

### AI Agent Not Working

1. Verify OpenClaw is installed and configured
2. Check OpenClaw gateway is running
3. Ensure you have valid AI provider credentials

## Stop the Platform

```bash
# Stop services
/stop

# Or from shell
./start.sh --stop

# Remove all data (containers and volumes)
./start.sh --stop
docker-compose down -v
```
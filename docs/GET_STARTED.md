# Getting Started with ClawSQL

This guide walks you through setting up and using ClawSQL for MySQL high availability management.

## Prerequisites

- **Container Runtime**: Docker or Podman
- **Docker Compose**: `docker-compose` or `podman-compose`
- **Node.js**: v22.22+ (for CLI)

## Step 1: Install and Start Platform

### Installation

```bash
# Install via npm
npm install -g clawsql

# Pull required Docker images (one-time setup)
clawsql install
```

### Start Platform Services

```bash
clawsql
> /start
```

This starts:
- ClawSQL API (port 8080)
- Orchestrator (port 3000) - MySQL topology manager
- ProxySQL (port 6032 admin, 6033+ for clusters)
- Prometheus (port 9090) - Metrics
- Grafana (port 3001) - Dashboards
- OpenClaw AI Gateway (port 18789/18790)

### Verify Services

```bash
> /status
> /doctor
```

## Step 2: Prepare MySQL Instances

### Create Admin User

On each MySQL instance, create the `clawsql` admin user:

```sql
CREATE USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password';
GRANT ALL PRIVILEGES ON *.* TO 'clawsql'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

### MySQL Server Configuration

Ensure your MySQL instances have replication enabled:

```ini
[mysqld]
server-id = 1                    # Unique for each server
log-bin = mysql-bin
binlog-format = ROW
gtid-mode = ON
enforce-gtid-consistency = ON
log-slave-updates = ON
```

### Configure Credentials

Set your MySQL credentials in ClawSQL:

```bash
> /config set mysql.admin_user clawsql
> /config set mysql.admin_password clawsql_password
```

## Step 3: Provision a Cluster

ClawSQL uses **template-based provisioning** as the primary method for creating clusters. This approach automatically handles:
- Replication setup (GTID-based)
- ProxySQL configuration with dedicated port
- Orchestrator topology registration

### View Available Templates

```bash
> /clusters provision
```

**Predefined Templates:**

| Template | Nodes | Mode | Use Case |
|----------|-------|------|----------|
| `dev-single` | 1 | async | Development/testing |
| `dev-replica` | 2 | async | Development with redundancy |
| `standard` | 3 | async | General production |
| `ha-semisync` | 3 | semi-sync | Critical production |
| `read-heavy` | 5 | async | Analytics/reporting |
| `production-ha` | 4 | semi-sync | Mission-critical |
| `geo-distributed` | 6 | async | Multi-region |

### Provision Your Cluster

**Option A: Quick Provisioning (Recommended)**

```bash
> /clusters quick standard myapp mysql-primary:3306,mysql-replica1:3306,mysql-replica2:3306
Cluster "myapp" ready at port 6033
```

**Option B: Full Provisioning**

```bash
> /clusters provision --template standard --cluster myapp --hosts mysql-primary:3306,mysql-replica1:3306,mysql-replica2:3306

Provisioning Cluster
  Template: standard
  Cluster Name: myapp
  Hosts: mysql-primary:3306, mysql-replica1:3306, mysql-replica2:3306

Cluster provisioned successfully!
  Cluster ID: myapp
  Assigned Port: 6033
  Writer Hostgroup: 10
  Reader Hostgroup: 20
  Primary: mysql-primary:3306
  Replicas: mysql-replica1:3306, mysql-replica2:3306

Connect to this cluster via ProxySQL port 6033
```

### What Happens During Provisioning

1. **Port Allocation**: Each cluster gets a dedicated ProxySQL port (6033, 6034, etc.)
2. **Hostgroup Setup**: Writer and reader hostgroups are allocated
3. **Replication Setup**: GTID-based replication is configured automatically
4. **ProxySQL Configuration**: Servers added with read/write splitting
5. **Topology Registration**: Instances registered with Orchestrator

## Step 4: Connect and Use

### Connect Through ProxySQL

```bash
# Connect to your cluster (read/write split is automatic)
mysql -h 127.0.0.1 -P 6033 -u clawsql -pclawsql_password

# Write queries go to primary
mysql> INSERT INTO users (name) VALUES ('test');

# Read queries are distributed to replicas
mysql> SELECT * FROM users;
```

### View Cluster Topology

```bash
> /clusters topology --name myapp

──────────────────────────────────────────────────────────
  Cluster: myapp
──────────────────────────────────────────────────────────
  Endpoint: 127.0.0.1:6033
  Hostgroups: RW=10, RO=20

  ✓ Health: healthy

  Primary:
    ● mysql-primary:3306 [online] (RW)
      v8.0.32, id:1

  Replicas:
    ○ mysql-replica1:3306 [online] (RO)
      lag: 0s, conns: 5
    ○ mysql-replica2:3306 [online] (RO)
      lag: 0s, conns: 3
```

### List All Clusters

```bash
> /clusters list
```

## Step 5: Manage Clusters

### Deprovision a Cluster

```bash
> /clusters deprovision myapp --force
```

This removes:
- Replication configuration
- ProxySQL routing rules
- Orchestrator topology entries
- Cluster metadata

### Add More Clusters

Each cluster gets its own ProxySQL port:

```bash
# First cluster - port 6033
> /clusters quick standard app1 db1:3306,db2:3306,db3:3306

# Second cluster - port 6034
> /clusters quick ha-semisync app2 db4:3306,db5:3306,db6:3306
```

## Advanced: Manual Operations

For existing MySQL topologies or special cases, use manual operations:

### Import Existing Topology

```bash
> /clusters manual import --primary mysql-primary:3306
```

### Create Cluster Manually

```bash
> /clusters manual create --name legacy-cluster --primary mysql1:3306 --replicas mysql2:3306,mysql3:3306
```

### Sync Topology to ProxySQL

```bash
> /clusters manual sync --name legacy-cluster
```

### Promote a Replica

```bash
> /clusters manual promote --name myapp --host mysql-replica1:3306
```

## Demo Mode

Test ClawSQL with a pre-configured demo cluster:

```bash
# Pull demo images
clawsql install --demo

# Start with demo MySQL cluster
clawsql
> /start --demo

# Get your host IP from the startup output
# Then provision the demo instances
> /clusters quick standard demo <host-ip>:3306,<host-ip>:3307,<host-ip>:3308
```

Demo MySQL instances:
| Instance | Port | Credentials |
|----------|------|-------------|
| Primary | 3306 | clawsql/clawsql_password |
| Replica 1 | 3307 | clawsql/clawsql_password |
| Replica 2 | 3308 | clawsql/clawsql_password |

## Failover Operations

### Terminology

| Term | Description |
|------|-------------|
| **Switchover** | Planned operation when primary is healthy |
| **Failover** | Emergency operation when primary is down |

### Planned Switchover

```bash
# Auto-select best replica (lowest lag)
> /failover switchover myapp

# Promote specific replica
> /failover switchover myapp mysql-replica1:3306
```

### Emergency Failover

```bash
> /failover failover myapp
```

### View Failover History

```bash
> /failover history
```

### Recovery

After a failover, recover the old primary:

```bash
> /failover recover list
> /failover recover mysql-old-primary:3306
```

## Using the AI Agent

OpenClaw starts automatically with the platform:

```
clawsql> show me the cluster topology
clawsql> what's the replication lag?
clawsql> help me troubleshoot replication issues
```

See **[AI Integration](AI.md)** for setup and configuration details.

## Using Grafana

1. Open http://localhost:3001
2. Login with admin/admin
3. Prometheus data source is pre-configured
4. Import MySQL dashboards or create custom ones

## Troubleshooting

### Platform Won't Start

```bash
> /doctor
```

### Instance Connection Issues

1. Check MySQL is running
2. Verify network connectivity
3. Confirm credentials are correct
4. Ensure `clawsql` user exists with proper grants

### Replication Issues

```bash
> /instances replication mysql-replica1:3306
```

### ProxySQL Not Routing

```bash
> /clusters manual sync
```

### View Logs

```bash
docker compose logs -f clawsql
docker compose logs -f orchestrator
docker compose logs -f proxysql
```

## Stop the Platform

```bash
> /stop

# Remove all data
> /cleanup
docker compose down -v
```

## Next Steps

- **[AI Integration](AI.md)** - OpenClaw AI agent setup and usage
- **[API Documentation](API.md)** - REST API reference
- **[Failover Documentation](failover.md)** - Detailed failover architecture
- **[Demo Guide](DEMO.md)** - Testing with demo cluster
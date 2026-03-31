# ClawSQL Demo Guide

This guide shows how to use ClawSQL with a demo MySQL cluster for testing and evaluation.

**New to ClawSQL?** See the **[Getting Started Guide](GET_STARTED.md)** for a step-by-step tutorial.

## Quick Start

### Installation

```bash
# Install via npm
npm install -g clawsql

# Pull all required images (including demo MySQL)
clawsql install --demo
```

### Starting the Platform

```bash
clawsql
> /start --demo
```

This starts:
- ClawSQL platform (API, Orchestrator, ProxySQL, Prometheus, Grafana)
- Demo MySQL cluster (1 primary + 2 replicas)

### Provision the Demo Cluster

After starting, use your host IP (shown in startup output) to provision the demo cluster:

```bash
# Replace <host-ip> with your actual host IP
> /clusters quick standard demo <host-ip>:3306,<host-ip>:3307,<host-ip>:3308
Cluster "demo" ready at port 6033
```

That's it! The cluster is now ready with:
- GTID-based replication configured
- ProxySQL routing on port 6033
- Read/write splitting enabled

## Accessing Services

| Service | URL | Credentials |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | - |
| API Docs | http://localhost:8080/docs | - |
| Grafana | http://localhost:3001 | admin/admin |
| Prometheus | http://localhost:9090 | - |
| Orchestrator | http://localhost:3000 | - |
| ProxySQL Admin | localhost:6032 | admin/admin |
| ProxySQL MySQL | localhost:6033 | clawsql/clawsql_password |
| OpenClaw Gateway | ws://localhost:18789 | - |
| OpenClaw UI | http://localhost:18790 | - |

### Demo MySQL Cluster

| Instance | Port | Credentials |
|----------|------|-------------|
| Primary | 3306 | clawsql/clawsql_password |
| Replica 1 | 3307 | clawsql/clawsql_password |
| Replica 2 | 3308 | clawsql/clawsql_password |

## Demo Scenarios

### 1. Using the CLI

```bash
# Check platform status
clawsql -c "/status"

# Run diagnostics
clawsql -c "/doctor"

# View cluster topology
clawsql -c "/clusters topology"

# List available templates
clawsql -c "/clusters provision"
```

### 2. Template-Based Provisioning

Create additional clusters from predefined templates:

```bash
# View all templates
> /clusters provision

# Provision different cluster types
> /clusters quick dev-single testdb <host-ip>:3306
> /clusters quick ha-semisync production <host-ip>:3306,<host-ip>:3307,<host-ip>:3308
```

### 3. Connect via ProxySQL

```bash
# Connect through ProxySQL (read/write split automatic)
mysql -h 127.0.0.1 -P 6033 -u clawsql -pclawsql_password

# Create a test database
mysql> CREATE DATABASE testdb;
mysql> USE testdb;
mysql> CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100));

# Write queries go to primary
mysql> INSERT INTO users (name) VALUES ('Alice'), ('Bob');

# Read queries are distributed to replicas
mysql> SELECT * FROM users;
```

### 4. View Cluster Topology

```bash
> /clusters topology --name demo
```

### 5. Failover Simulation

```bash
# Run failover simulation
./scripts/simulate_failover.sh
```

This will:
1. Show current cluster state
2. Stop the primary MySQL
3. Execute failover to a replica
4. Recover the failed primary
5. Verify final state

### 6. Manual Failover

```bash
# View failover candidates
> /failover status

# Planned switchover
> /failover switchover demo

# View history
> /failover history
```

### 7. Using the AI Agent

OpenClaw starts automatically with the platform:

```
clawsql> show me the cluster topology
clawsql> what's the replication lag?
clawsql> help me troubleshoot replication issues
```

### 8. Using Grafana

1. Open http://localhost:3001
2. Login with admin/admin
3. Prometheus data source is pre-configured
4. Import MySQL dashboards or create custom ones

### 9. Load Testing (Optional)

If you have SysBench installed:

```bash
# Prepare test data
./scripts/load_data.sh prepare

# Run read/write test
./scripts/load_data.sh rw

# View query distribution in ProxySQL
mysql -h 127.0.0.1 -P 6032 -u admin -padmin -e "SELECT * FROM stats_mysql_query_digest;"

# Cleanup
./scripts/load_data.sh cleanup
```

## Provisioning Examples

### Create a HA Cluster

```bash
> /clusters provision --template ha-semisync --cluster ha-demo --hosts <host-ip>:3306,<host-ip>:3307,<host-ip>:3308
```

### Create a Read-Heavy Cluster

```bash
> /clusters provision --template read-heavy --cluster analytics --hosts db1:3306,db2:3306,db3:3306,db4:3306,db5:3306
```

### List and Manage Clusters

```bash
> /clusters list
> /clusters topology
> /clusters deprovision demo --force
```

## Troubleshooting

### Check MySQL Replication

```bash
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G"
```

### Reset Replication

```bash
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "STOP SLAVE; START SLAVE;"
```

### View Logs

```bash
docker compose logs -f clawsql
docker logs openclaw
```

### Platform Issues

```bash
> /doctor
```

## Cleanup

```bash
# Stop all services
> /stop

# Remove all data
> /cleanup
docker compose down -v
```
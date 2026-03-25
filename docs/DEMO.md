# ClawSQL Demo Guide

This guide shows how to use ClawSQL with a demo MySQL cluster for testing and evaluation.

## Quick Start

### Using start.sh

```bash
# Start with demo MySQL cluster (primary + 2 replicas)
./start.sh --demo
```

### Using CLI

```bash
# Build the project
npm run build

# Start with demo mode
node dist/bin/clawsql.js -c "/start --demo"
```

This starts:
- ClawSQL platform (API, Orchestrator, ProxySQL, Prometheus, Grafana)
- Demo MySQL cluster (1 primary + 2 replicas)

## Accessing Services

| Service | URL | Credentials |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | - |
| API Docs | http://localhost:8080/docs | - |
| Grafana | http://localhost:3001 | admin/admin |
| Prometheus | http://localhost:9090 | - |
| Orchestrator | http://localhost:3000 | - |
| ProxySQL Admin | localhost:6032 | admin/admin |
| **Demo MySQL** | | |
| Primary | localhost:3306 | root/rootpassword |
| Replica 1 | localhost:3307 | root/rootpassword |
| Replica 2 | localhost:3308 | root/rootpassword |

## Demo Scenarios

### 0. Using the CLI

The ClawSQL CLI provides an interactive way to manage your clusters:

```bash
# Check platform status
node dist/bin/clawsql.js -c "/status"

# Run diagnostics
node dist/bin/clawsql.js -c "/doctor"

# List discovered instances
node dist/bin/clawsql.js -c "/instances list"

# View cluster topology
node dist/bin/clawsql.js -c "/clusters topology"

# Sync cluster to ProxySQL
node dist/bin/clawsql.js -c "/clusters sync"
```

### 1. Instance Discovery

Discover MySQL instances in the demo network:

```bash
curl -X POST http://localhost:8080/api/v1/instances/discover \
  -H "Content-Type: application/json" \
  -d '{
    "network_segments": ["172.18.0.0/24"],
    "port_range": [3306, 3306]
  }'
```

### 2. View Cluster Topology

```bash
# List clusters
curl http://localhost:8080/api/v1/clusters

# Get topology
curl http://localhost:8080/api/v1/clusters/demo-cluster/topology
```

### 3. Health Monitoring

```bash
# System health
curl http://localhost:8080/api/v1/monitoring/health

# Active alerts
curl http://localhost:8080/api/v1/monitoring/alerts
```

### 4. Connect via ProxySQL

```bash
# Connect through ProxySQL (read/write split automatic)
mysql -h 127.0.0.1 -P 6033 -u root -prootpassword

# Run a query - routed to replica (reader hostgroup)
mysql> SELECT * FROM testdb.users;

# Run a write - routed to primary (writer hostgroup)
mysql> INSERT INTO testdb.users (name, email) VALUES ('Dave', 'dave@example.com');
```

### 5. Load Testing (Optional)

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

### 6. Failover Simulation

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

### 7. Manual Failover

```bash
# Get failover candidates
curl http://localhost:8080/api/v1/failover/candidates/demo-cluster

# Execute manual failover
curl -X POST http://localhost:8080/api/v1/failover/execute \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_id": "demo-cluster",
    "target_instance_id": "mysql-replica-1:3306",
    "reason": "Testing manual failover",
    "auto_confirm": true
  }'

# View failover history
curl http://localhost:8080/api/v1/failover/history
```

## Using Grafana

1. Open http://localhost:3001
2. Login with admin/admin
3. Prometheus data source is pre-configured
4. Import MySQL dashboards or create custom ones

## Troubleshooting

### Check MySQL Replication

```bash
# On replica
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G"
```

### Reset Replication

```bash
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "STOP SLAVE; START SLAVE;"
```

### View Logs

```bash
docker-compose logs -f clawsql
```

## Cleanup

```bash
# Stop all services
./start.sh --stop

# Remove all data
docker-compose down -v
```
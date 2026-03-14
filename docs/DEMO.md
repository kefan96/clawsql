# ClawSQL Demo Guide

This guide walks you through setting up and using the ClawSQL demo environment.

## Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for local development)
- Git

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/clawsql/clawsql.git
cd clawsql

# Copy environment configuration
cp .env.example .env

# Run the deployment script
./scripts/deploy_demo.sh
```

### 2. Verify Deployment

```bash
# Run health check
./scripts/health_check.sh

# Check API
curl http://localhost:8080/health
```

### 3. Explore the API

Open the Swagger UI documentation:
```
http://localhost:8080/docs
```

## Demo Scenarios

### Scenario 1: Instance Discovery

Discover MySQL instances in the demo network:

```bash
curl -X POST http://localhost:8080/api/v1/instances/discover \
  -H "Content-Type: application/json" \
  -d '{
    "network_segments": ["172.18.0.0/24"],
    "port_range": [3306, 3306]
  }'
```

### Scenario 2: Cluster Monitoring

Check cluster health:

```bash
# List clusters
curl http://localhost:8080/api/v1/clusters

# Get cluster topology
curl http://localhost:8080/api/v1/clusters/demo-cluster/topology

# Check system health
curl http://localhost:8080/api/v1/monitoring/health
```

### Scenario 3: Load Testing

Generate load using SysBench:

```bash
# Prepare test data
./scripts/load_data.sh prepare

# Run read/write test
./scripts/load_data.sh rw

# Run read-only test (to see read splitting)
./scripts/load_data.sh ro

# Cleanup
./scripts/load_data.sh cleanup
```

### Scenario 4: Failover Simulation

Simulate a primary failure:

```bash
./scripts/simulate_failover.sh
```

This script will:
1. Show current cluster state
2. Stop the primary MySQL instance
3. Execute failover to a replica
4. Recover the failed primary
5. Verify cluster state

### Scenario 5: Manual Failover

Execute a manual failover:

```bash
curl -X POST http://localhost:8080/api/v1/failover/execute \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_id": "demo-cluster",
    "target_instance_id": "mysql-replica-1:3306",
    "reason": "Testing manual failover",
    "auto_confirm": true
  }'
```

### Scenario 6: Configuration Management

View and update configuration:

```bash
# Get current configuration
curl http://localhost:8080/api/v1/config

# Update a setting
curl -X PUT http://localhost:8080/api/v1/config/failover.auto_failover_enabled \
  -H "Content-Type: application/json" \
  -d '{
    "config_path": "failover.auto_failover_enabled",
    "value": {"enabled": false},
    "reason": "Disabling for maintenance"
  }'

# View configuration history
curl http://localhost:8080/api/v1/config/history
```

### Scenario 7: Alert Management

View and manage alerts:

```bash
# List alerts
curl http://localhost:8080/api/v1/monitoring/alerts

# Acknowledge an alert
curl -X POST http://localhost:8080/api/v1/monitoring/alerts/{alert_id}/acknowledge \
  -H "Content-Type: application/json" \
  -d '{"acknowledged_by": "admin"}'
```

## Accessing Services

| Service | URL | Credentials |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | - |
| API Documentation | http://localhost:8080/docs | - |
| Grafana | http://localhost:3001 | admin/admin |
| Prometheus | http://localhost:9090 | - |
| Orchestrator | http://localhost:3000 | - |
| ProxySQL Admin | localhost:6032 | admin/admin |
| MySQL Primary | localhost:3306 | root/rootpassword |
| MySQL Replica 1 | localhost:3307 | root/rootpassword |
| MySQL Replica 2 | localhost:3308 | root/rootpassword |

## Connecting via MySQL Client

```bash
# Connect through ProxySQL (read/write split)
mysql -h 127.0.0.1 -P 6033 -u root -prootpassword

# Connect directly to primary
mysql -h 127.0.0.1 -P 3306 -u root -prootpassword

# Connect to replica
mysql -h 127.0.0.1 -P 3307 -u root -prootpassword
```

## Monitoring with Grafana

1. Open Grafana at http://localhost:3001
2. Login with admin/admin
3. Add Prometheus data source: http://prometheus:9090
4. Import a MySQL dashboard or create your own

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs clawsql

# Restart services
docker-compose restart
```

### MySQL replication issues

```bash
# Check replica status
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G"

# Reset replication
docker exec mysql-replica-1 mysql -uroot -prootpassword -e "STOP SLAVE; START SLAVE;"
```

### API returns 401

Make sure you're including the Authorization header with a valid token.

## Cleanup

```bash
# Stop all containers
docker-compose down

# Remove volumes
docker-compose down -v

# Remove all data
rm -rf docker/init/*.sql
```

## Next Steps

- Explore the [API documentation](./API.md)
- Read the [architecture overview](./architecture/system_design.md)
- Contribute to the project on GitHub
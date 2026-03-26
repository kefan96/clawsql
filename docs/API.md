# ClawSQL API Documentation

## Overview

ClawSQL provides a RESTful API for managing MySQL clusters. The API is available at `/api/v1/`.

## Authentication

All API endpoints (except health checks) require authentication via Bearer token.

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8080/api/v1/instances
```

## Base URL

```
http://localhost:8080/api/v1
```

## Endpoints

### Instances

#### List Instances

```http
GET /instances
```

Query Parameters:
- `cluster_id` (optional): Filter by cluster
- `state` (optional): Filter by state (online, offline, etc.)
- `role` (optional): Filter by role (primary, replica)
- `page` (default: 1): Page number
- `page_size` (default: 20): Items per page

Response:
```json
{
  "items": [
    {
      "instance_id": "mysql-primary:3306",
      "host": "mysql-primary",
      "port": 3306,
      "role": "primary",
      "state": "online",
      "version": "8.0.0"
    }
  ],
  "total": 3,
  "page": 1,
  "page_size": 20
}
```

#### Get Instance

```http
GET /instances/{instance_id}
```

Response:
```json
{
  "instance_id": "mysql-primary:3306",
  "host": "mysql-primary",
  "port": 3306,
  "server_id": 1,
  "role": "primary",
  "state": "online",
  "version": "8.0.0",
  "cluster_id": "demo-cluster",
  "replication_lag": null,
  "labels": {}
}
```

#### Register Instance

```http
POST /instances
```

Request Body:
```json
{
  "host": "mysql-new",
  "port": 3306,
  "cluster_id": "demo-cluster",
  "labels": {
    "datacenter": "dc1"
  }
}
```

#### Discover Instances

```http
POST /instances/discover
```

Request Body:
```json
{
  "network_segments": ["172.18.0.0/24"],
  "port_range": [3306, 3306]
}
```

#### Set Instance Maintenance

```http
POST /instances/{instance_id}/maintenance
```

Request Body:
```json
{
  "instance_id": "mysql-replica-1:3306",
  "duration_minutes": 60,
  "reason": "Planned maintenance"
}
```

### Clusters

#### List Clusters

```http
GET /clusters
```

Response:
```json
{
  "clusters": [
    {
      "cluster_id": "demo-cluster",
      "name": "Demo Cluster",
      "instance_count": 3,
      "health_status": "healthy"
    }
  ],
  "total": 1
}
```

#### Create Cluster

```http
POST /clusters
```

Request Body:
```json
{
  "name": "Production Cluster",
  "description": "Main production cluster",
  "primary_instance": {
    "host": "mysql-primary",
    "port": 3306
  }
}
```

#### Get Cluster Topology

```http
GET /clusters/{cluster_id}/topology
```

Response:
```json
{
  "cluster_id": "demo-cluster",
  "cluster_name": "Demo Cluster",
  "primary": {
    "instance_id": "mysql-primary:3306",
    "host": "mysql-primary",
    "port": 3306,
    "role": "primary"
  },
  "replicas": [
    {
      "instance_id": "mysql-replica-1:3306",
      "host": "mysql-replica-1",
      "port": 3306,
      "role": "replica"
    }
  ],
  "topology_valid": true
}
```

### Failover

#### Execute Failover

```http
POST /failover/execute
```

Request Body:
```json
{
  "cluster_id": "demo-cluster",
  "target_instance_id": "mysql-replica-1:3306",
  "reason": "Primary failure",
  "auto_confirm": true
}
```

Response:
```json
{
  "operation_id": "failover-123",
  "cluster_id": "demo-cluster",
  "old_primary_id": "mysql-primary:3306",
  "new_primary_id": "mysql-replica-1:3306",
  "state": "completed",
  "steps": [
    "Candidate selected",
    "Promotion completed",
    "Replicas reconfigured"
  ]
}
```

#### Get Failover History

```http
GET /failover/history
```

#### Get Failover Candidates

```http
GET /failover/candidates/{cluster_id}
```

### Monitoring

#### System Health

```http
GET /monitoring/health
```

Response:
```json
{
  "status": "healthy",
  "components": {
    "orchestrator": {"status": "healthy"},
    "proxysql": {"status": "healthy"},
    "database": {"status": "healthy"}
  }
}
```

#### List Alerts

```http
GET /monitoring/alerts
```

Query Parameters:
- `active_only` (default: true): Show only active alerts
- `severity` (optional): Filter by severity (info, warning, critical)

#### Prometheus Metrics

```http
GET /monitoring/metrics/prometheus
```

Returns metrics in Prometheus text format.

### Configuration

#### Get Configuration

```http
GET /config
```

#### Update Configuration

```http
PUT /config/{config_path}
```

Request Body:
```json
{
  "config_path": "failover.auto_failover_enabled",
  "value": false,
  "reason": "Disabling for maintenance window"
}
```

#### Configuration History

```http
GET /config/history
```

#### Rollback Configuration

```http
POST /config/rollback/{version_id}
```

### Webhooks

Webhook endpoints receive events from external systems like Orchestrator.

#### Orchestrator Failover Webhook

Receives failover events from Orchestrator and triggers ProxySQL synchronization.

```http
POST /webhooks/orchestrator/failover
```

Request Body:
```json
{
  "cluster": "mysql-primary",
  "master": "172.18.0.10:3306",
  "successor": "172.18.0.11:3306",
  "isSuccessful": true,
  "failoverType": "master"
}
```

Response:
```json
{
  "success": true,
  "message": "ProxySQL sync triggered for cluster mysql-primary"
}
```

This webhook is automatically called by Orchestrator when:
- A master failover completes
- An intermediate master failover completes

## Error Responses

All errors follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {}
}
```

Common error codes:
- `INSTANCE_NOT_FOUND`: Instance does not exist
- `CLUSTER_NOT_FOUND`: Cluster does not exist
- `FAILOVER_ERROR`: Failover operation failed
- `VALIDATION_ERROR`: Invalid request parameters
- `AUTHENTICATION_ERROR`: Invalid or missing token

## Rate Limiting

API requests are rate-limited to 60 requests per minute per IP address.

## OpenAPI Specification

Full OpenAPI specification is available at `/openapi.json` and interactive documentation at `/docs`.
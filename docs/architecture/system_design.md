# ClawSQL System Architecture

## Overview

ClawSQL is a MySQL cluster automation and operations management system designed to provide:

- **High Availability**: Automatic failover and recovery
- **Performance Optimization**: Read/write splitting and load balancing
- **Operational Insight**: Real-time monitoring and alerting
- **Simplified Management**: Unified API for cluster operations

## Architecture Diagram

```
                                    ┌─────────────────────┐
                                    │    CLI / Web UI     │
                                    └──────────┬──────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          ClawSQL API Layer                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │ Instances   │ │ Clusters    │ │ Failover    │ │ Monitoring  │   │
│  │ Endpoints   │ │ Endpoints   │ │ Endpoints   │ │ Endpoints   │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────┐
│                     Core Services Layer                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │ Discovery   │ │ Monitoring  │ │ Failover    │ │ Routing     │   │
│  │ Service     │ │ Service     │ │ Service     │ │ Service     │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────┐
│                     Integration Layer                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │Orchestrator │ │ ProxySQL    │ │ Prometheus  │ │  Database   │   │
│  │ Client      │ │ Manager     │ │ Exporter    │ │  Manager    │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────┐
│                     Infrastructure Layer                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MySQL Cluster                             │   │
│  │   ┌───────────┐     ┌───────────┐     ┌───────────┐        │   │
│  │   │  Primary  │────▶│ Replica 1 │     │ Replica 2 │        │   │
│  │   │  (Writer) │     │ (Reader)  │     │ (Reader)  │        │   │
│  │   └───────────┘     └───────────┘     └───────────┘        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │Orchestrator │ │ ProxySQL    │ │ Prometheus/ │                   │
│  │             │ │             │ │ Grafana     │                   │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Discovery Module

The Discovery Module handles automatic detection and registration of MySQL instances.

**Key Components:**
- `NetworkScanner`: Scans network segments for MySQL instances
- `OrchestratorClient`: Interfaces with Orchestrator for topology sync
- `InstanceRegistry`: In-memory storage of discovered instances

**Capabilities:**
- CIDR network scanning
- MySQL handshake detection
- Version and role detection
- Automatic topology mapping

### 2. Monitoring Module

The Monitoring Module provides real-time health and performance monitoring.

**Key Components:**
- `MetricsCollector`: Periodic metrics collection from MySQL
- `HealthChecker`: Threshold-based health evaluation
- `AlertManager`: Alert generation and notification
- `PrometheusExporter`: Metrics export in Prometheus format

**Monitored Metrics:**
- Replication lag and status
- Connection pool utilization
- Query throughput
- InnoDB buffer pool hit rate
- Server resource utilization

### 3. Failover Module

The Failover Module handles failure detection and automatic recovery.

**Key Components:**
- `FailureDetector`: Continuous failure detection with confirmation
- `FailoverExecutor`: Orchestrates failover operations
- `RecoveryManager`: Handles instance recovery and reintegration

**Failover Process:**
1. Failure detection with multiple confirmation checks
2. Candidate selection based on replication position
3. Graceful promotion via Orchestrator
4. Replica reconfiguration
5. ProxySQL routing updates

### 4. Routing Module

The Routing Module manages traffic distribution through ProxySQL.

**Key Components:**
- `ProxySQLManager`: ProxySQL configuration management
- `DynamicLoadBalancer`: Weight adjustment based on load

**Routing Features:**
- Read/write splitting
- Dynamic weight adjustment
- Connection pooling
- Query routing rules

## Data Flow

### Instance Discovery Flow

```
1. Network segment specified
2. Scanner enumerates IPs in CIDR range
3. Port probe for MySQL service
4. MySQL handshake and version detection
5. Role determination (primary/replica)
6. Registration in instance registry
7. Sync with Orchestrator
```

### Failover Flow

```
1. FailureDetector identifies issue
2. Multiple confirmation checks
3. FailureEvent created
4. FailoverExecutor invoked
5. Candidate selected (lowest lag, highest binlog position)
6. Orchestrator promotes candidate
7. Replicas reconfigured
8. ProxySQL routing updated
9. Operation logged for audit
```

## Security Considerations

### Authentication

- API token authentication using JWT
- Configurable token expiry
- Token revocation support

### Authorization

- Role-based access control
- Permission-scoped tokens
- Audit logging for all operations

### Communication

- TLS support for external connections
- Secure credential storage
- Encrypted database connections

## Performance Considerations

### Low-Latency Operations

- Async I/O throughout
- Connection pooling
- Cached topology information
- Minimal database queries during failover

### Scalability

- Horizontal scaling of API instances
- Stateless design where possible
- Event-driven architecture

## Deployment Options

### Docker Compose (Demo)

Suitable for development and testing:
- Single-node deployment
- All components in containers
- Simple configuration

### Production

For production deployments:
- Kubernetes with Helm charts
- High-availability Orchestrator
- Clustered ProxySQL
- Prometheus federation

## Configuration

Configuration is managed through:
1. Environment variables
2. `.env` files
3. Configuration database (versioned)
4. Runtime API updates

See [API.md](./API.md) for configuration endpoints.
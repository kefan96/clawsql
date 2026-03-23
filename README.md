# ClawSQL

MySQL Cluster Automation and Operations Management System

## Overview

ClawSQL is an open-source MySQL cluster automation system that provides:

- **Instance Discovery**: Automatically discover MySQL instances in your network
- **Cluster Monitoring**: Real-time monitoring with Grafana dashboards
- **Fault Handling**: Automatic and manual failover capabilities
- **Load Management**: Read/write splitting via ProxySQL
- **Configuration Management**: Centralized, versioned configuration

## Quick Start

### Prerequisites

- Docker and Docker Compose (or Podman)
- Your MySQL instances (primary + replicas)

### Start the Platform

```bash
# Clone the repository
git clone https://github.com/clawsql/clawsql.git
cd clawsql

# Start ClawSQL platform
./start.sh
```

All services will be running:

| Service | URL | Description |
|---------|-----|-------------|
| ClawSQL API | http://localhost:8080 | Main API |
| API Docs | http://localhost:8080/docs | Swagger UI |
| Grafana | http://localhost:3001 | Dashboards (admin/admin) |
| Prometheus | http://localhost:9090 | Metrics |
| Orchestrator | http://localhost:3000 | Topology management |
| ProxySQL | localhost:6033 | MySQL traffic (read/write split) |

### Register Your MySQL Instances

```bash
# Register a MySQL instance
curl -X POST http://localhost:8080/api/v1/instances \
  -H 'Content-Type: application/json' \
  -d '{"host": "your-mysql-host", "port": 3306}'

# View discovered clusters
curl http://localhost:8080/api/v1/clusters

# View cluster topology
curl http://localhost:8080/api/v1/clusters/{cluster_id}/topology
```

### Connect Your Application

Point your application to ProxySQL for automatic read/write splitting:

```bash
# Application connects here (read/write split automatic)
mysql -h localhost -P 6033 -u your_user -p
```

## Usage

### Start Commands

```bash
./start.sh              # Start platform (bring your own MySQL)
./start.sh --demo       # Start with demo MySQL cluster (for testing)
./start.sh --stop       # Stop all services
./start.sh --help       # Show help
```

### Cleanup Script

Stop all services and clean up:

```bash
./scripts/cleanup.sh           # Stop containers, keep volumes
./scripts/cleanup.sh --volumes # Remove volumes too
./scripts/cleanup.sh --all     # Remove images as well
```

### Demo Mode

Try ClawSQL with a demo MySQL cluster (primary + 2 replicas):

```bash
./start.sh --demo

# Demo MySQL access:
# Primary:   localhost:3306 (root/rootpassword)
# Replica 1: localhost:3307
# Replica 2: localhost:3308
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/instances` | GET | List all MySQL instances |
| `/api/v1/instances` | POST | Register a new instance |
| `/api/v1/clusters` | GET | List all clusters |
| `/api/v1/clusters/{id}` | GET | Get cluster details |
| `/api/v1/failover/execute` | POST | Execute failover |
| `/api/v1/monitoring/health` | GET | Get system health |
| `/api/v1/monitoring/system` | GET | Get system status |

Full API documentation at http://localhost:8080/docs when running.

## Deployment

### Docker Compose (Recommended)

The default deployment uses Docker Compose. All services run in containers:

```bash
./start.sh        # Platform services
./start.sh --demo # Platform + demo MySQL
```

Services started:
- **clawsql** - Main API application (Node.js/TypeScript)
- **orchestrator** - MySQL topology management and failover
- **proxysql** - MySQL proxy with read/write splitting
- **prometheus** - Metrics collection
- **grafana** - Monitoring dashboards

### Configuration

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_TYPE` | Metadata storage: `sqlite` or `mysql` | `sqlite` |
| `API_TOKEN_SECRET` | JWT secret (change in production!) | `change-me-in-production` |
| `ORCHESTRATOR_URL` | Orchestrator API URL | `http://orchestrator:3000` |
| `AUTO_FAILOVER_ENABLED` | Enable automatic failover | `true` |
| `MYSQL_MONITOR_USER` | User for monitoring your MySQL | `monitor` |
| `MYSQL_MONITOR_PASSWORD` | Monitor user password | (required) |

### Production Checklist

- [ ] Set `API_TOKEN_SECRET` to a strong random value
- [ ] Set `MYSQL_MONITOR_USER` and `MYSQL_MONITOR_PASSWORD` for your MySQL instances
- [ ] Configure TLS for external connections
- [ ] Set up backup for metadata database
- [ ] Review and adjust failover settings

## Development

### Requirements

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Code Quality

```bash
# Lint
npm run lint

# Format
npm run format
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
│   ├── utils/             # Utilities
│   └── __tests__/         # Test files
├── docker/                # Docker configurations
├── scripts/               # Utility scripts
├── package.json           # Node.js dependencies
└── tsconfig.json          # TypeScript configuration
```

## Architecture

### Technology Stack

- **Runtime**: Node.js 20
- **Language**: TypeScript
- **Framework**: Fastify
- **Database**: SQLite (default) or MySQL for metadata
- **Validation**: Zod
- **Metrics**: prom-client

### Key Components

1. **Orchestrator Client** - Communicates with Orchestrator for topology management
2. **ProxySQL Manager** - Configures ProxySQL for read/write splitting
3. **Metrics Collector** - Collects metrics from MySQL instances
4. **Failover Executor** - Handles automatic and manual failover
5. **Prometheus Exporter** - Exports metrics in Prometheus format

## Troubleshooting

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f clawsql
```

### Service Won't Start

```bash
# Check service status
docker-compose ps

# Restart services
docker-compose restart

# Full cleanup and restart
./scripts/cleanup.sh && ./start.sh
```

### MySQL Connection Issues

1. Verify MySQL credentials in `.env`
2. Check `MYSQL_MONITOR_USER` has correct permissions:
   ```sql
   GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';
   ```
3. Test connection: `mysql -h your-mysql -u monitor -p`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes
6. Push to the branch
7. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [Orchestrator](https://github.com/openark/orchestrator) - MySQL topology management
- [ProxySQL](https://proxysql.com/) - MySQL proxy with routing
- [Prometheus](https://prometheus.io/) - Monitoring and alerting
- [Grafana](https://grafana.com/) - Visualization platform
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

- Docker and Docker Compose
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
| `/api/v1/clusters/{id}/topology` | GET | Get cluster topology |
| `/api/v1/failover/execute` | POST | Execute failover |
| `/api/v1/monitoring/health` | GET | Get system health |
| `/api/v1/monitoring/alerts` | GET | List active alerts |

Full API documentation at http://localhost:8080/docs when running.

### Example Workflow

```bash
# 1. Register your MySQL primary
curl -X POST http://localhost:8080/api/v1/instances \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mysql-primary.example.com",
    "port": 3306,
    "cluster_id": "production"
  }'

# 2. Register replicas
curl -X POST http://localhost:8080/api/v1/instances \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mysql-replica-1.example.com",
    "port": 3306,
    "cluster_id": "production"
  }'

# 3. View cluster topology
curl http://localhost:8080/api/v1/clusters/production/topology

# 4. Check system health
curl http://localhost:8080/api/v1/monitoring/health

# 5. Connect your app to ProxySQL
# Your app now has automatic read/write splitting!
```

## Deployment

### Docker Compose (Recommended)

The default deployment uses Docker Compose. All services run in containers:

```bash
./start.sh        # Platform services
./start.sh --demo # Platform + demo MySQL
```

Services started:
- **clawsql** - Main API application
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
| `API_TOKEN_SECRET` | JWT secret (change in production!) | (required) |
| `ORCHESTRATOR_URL` | Orchestrator API URL | `http://orchestrator:3000` |
| `AUTO_FAILOVER_ENABLED` | Enable automatic failover | `true` |
| `MYSQL_MONITOR_USER` | User for monitoring your MySQL | `monitor` |
| `MYSQL_MONITOR_PASSWORD` | Monitor user password | (required) |

### Metadata Storage

ClawSQL needs a database for its own state (instances, clusters, history).

**SQLite (default)** - Zero configuration:
```bash
DB_TYPE=sqlite
```

**MySQL** - For production or centralized metadata:
```bash
DB_TYPE=mysql
DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=clawsql
DB_USER=clawsql
DB_PASSWORD=your-password
```

### Production Checklist

- [ ] Set `API_TOKEN_SECRET` to a strong random value
- [ ] Set `MYSQL_MONITOR_USER` and `MYSQL_MONITOR_PASSWORD` for your MySQL instances
- [ ] Configure TLS for external connections
- [ ] Set up backup for metadata database
- [ ] Review and adjust failover settings

## Development

### Setup

```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install with dev dependencies
pip install -e ".[dev]"
```

### Running Locally

```bash
# Run ClawSQL API (without Docker)
clawsql

# Or with more control
python -m uvicorn clawsql.main:app --reload --port 8080
```

**Note:** For full functionality, you'll also need:
- Orchestrator (for topology/HA)
- ProxySQL (for routing)
- Prometheus (optional, for metrics)

### Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific tests
pytest tests/unit/test_failover.py

# Run only unit tests
pytest -m unit
```

### Code Quality

```bash
# Format code
black src tests

# Lint
ruff check src tests

# Type check
mypy src
```

### Project Structure

```
clawsql/
├── start.sh              # One-command startup
├── docker-compose.yml    # Platform services
├── docker-compose.demo.yml  # Optional demo MySQL
├── src/clawsql/
│   ├── main.py          # Application entry point
│   ├── core/            # Core business logic
│   │   ├── discovery/   # Instance discovery
│   │   ├── monitoring/  # Metrics and health checks
│   │   ├── failover/    # Failover operations
│   │   └── routing/     # ProxySQL integration
│   ├── api/             # REST API endpoints
│   ├── config/          # Configuration management
│   └── utils/           # Utilities
├── tests/               # Test suite
├── docker/              # Docker configurations
│   ├── Dockerfile       # ClawSQL container
│   ├── orchestrator/    # Orchestrator config
│   ├── proxysql/        # ProxySQL config
│   ├── prometheus/      # Prometheus config
│   └── grafana/         # Grafana dashboards
└── docs/                # Documentation
```

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
```

### MySQL Connection Issues

1. Verify MySQL credentials in `.env`
2. Check `MYSQL_MONITOR_USER` has correct permissions:
   ```sql
   GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'monitor'@'%';
   ```
3. Test connection: `mysql -h your-mysql -u monitor -p`

### API Returns 401

Include the Authorization header with a valid token:

```bash
# Get a token first
TOKEN=$(curl -X POST http://localhost:8080/api/v1/auth/token \
  -d '{"user_id": "admin", "permissions": ["read", "write"]}' | jq -r '.token')

# Use the token
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/clusters
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pytest`)
5. Run linting (`black src tests && ruff check src tests`)
6. Commit your changes
7. Push to the branch
8. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [Orchestrator](https://github.com/openark/orchestrator) - MySQL topology management
- [ProxySQL](https://proxysql.com/) - MySQL proxy with routing
- [Prometheus](https://prometheus.io/) - Monitoring and alerting
- [Grafana](https://grafana.com/) - Visualization platform
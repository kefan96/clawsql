# ClawSQL

MySQL Cluster Automation and Operations Management System

## Overview

ClawSQL is an open-source MySQL cluster automation system that provides:

- **Instance Discovery**: Automatically discover MySQL instances in your network
- **Cluster Monitoring**: Real-time monitoring with Grafana dashboards
- **Fault Handling**: Automatic and manual failover capabilities
- **Load Management**: Read/write splitting via ProxySQL
- **Configuration Management**: Centralized, versioned configuration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ClawSQL API                             │
│                    (FastAPI - Port 8080)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Orchestrator  │    │   ProxySQL    │    │   Prometheus  │
│   (Topology)  │    │  (Routing)    │    │  (Metrics)    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  MySQL Cluster  │
                    │  Primary + Reps │
                    └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for development)

### Run Demo Environment

```bash
# Clone the repository
git clone https://github.com/clawsql/clawsql.git
cd clawsql

# Copy environment configuration
cp .env.example .env

# Start the demo environment
docker-compose up -d

# Access the services:
# - ClawSQL API: http://localhost:8080
# - API Docs: http://localhost:8080/docs
# - Grafana: http://localhost:3000 (admin/admin)
# - Prometheus: http://localhost:9090
# - Orchestrator: http://localhost:3000
```

### Run Demo Scripts

```bash
# Deploy and initialize demo environment
./scripts/deploy_demo.sh

# Simulate a failover scenario
./scripts/simulate_failover.sh

# Generate load with SysBench
./scripts/load_data.sh

# Run health checks
./scripts/health_check.sh
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/instances` | GET | List all MySQL instances |
| `/api/v1/instances` | POST | Register a new instance |
| `/api/v1/instances/discover` | POST | Trigger network discovery |
| `/api/v1/clusters` | GET | List all clusters |
| `/api/v1/clusters/{id}/topology` | GET | Get cluster topology |
| `/api/v1/monitoring/health` | GET | Get system health |
| `/api/v1/monitoring/alerts` | GET | List active alerts |
| `/api/v1/failover/execute` | POST | Execute failover |
| `/api/v1/config` | GET/PUT | Manage configuration |

Full API documentation available at `/docs` when running the server.

## Development

### Setup Development Environment

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install development dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run tests with coverage
pytest --cov=src --cov-report=html

# Format code
black src tests

# Type check
mypy src
```

### Project Structure

```
clawsql/
├── src/
│   ├── core/           # Core business logic
│   │   ├── discovery/  # Instance discovery
│   │   ├── monitoring/ # Metrics and health checks
│   │   ├── failover/   # Failover operations
│   │   └── routing/    # ProxySQL integration
│   ├── api/            # REST API
│   ├── config/         # Configuration management
│   └── utils/          # Utilities
├── tests/              # Test suite
├── scripts/            # Demo scripts
├── docker/             # Docker configurations
└── docs/               # Documentation
```

## Features

### Instance Discovery

- Network segment scanning
- MySQL handshake detection
- Automatic topology detection
- Integration with Orchestrator

### Monitoring

- Real-time metrics collection
- Configurable health checks
- Prometheus export
- Grafana dashboards

### Failover

- Automatic failure detection
- Candidate selection algorithm
- Orchestrator integration
- Manual failover support

### Load Management

- Read/write splitting
- Dynamic weight adjustment
- Connection pooling
- Query routing rules

## Configuration

Configuration is managed via environment variables or a `.env` file. See `.env.example` for all available options.

Key configurations:

| Variable | Description | Default |
|----------|-------------|---------|
| `API_HOST` | API server host | `0.0.0.0` |
| `API_PORT` | API server port | `8080` |
| `ORCHESTRATOR_URL` | Orchestrator API URL | `http://orchestrator:3000` |
| `AUTO_FAILOVER_ENABLED` | Enable automatic failover | `true` |
| `COLLECTION_INTERVAL` | Metrics collection interval | `15.0` |

## Contributing

We welcome contributions! Please see our contributing guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Orchestrator](https://github.com/openark/orchestrator) - MySQL topology management
- [ProxySQL](https://proxysql.com/) - MySQL proxy with routing
- [Prometheus](https://prometheus.io/) - Monitoring and alerting
- [Grafana](https://grafana.com/) - Visualization platform
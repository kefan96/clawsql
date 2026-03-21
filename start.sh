#!/bin/bash
#
# ClawSQL - One-Command Startup Script
#
# Usage:
#   ./start.sh              # Start platform only (bring your own MySQL)
#   ./start.sh --demo       # Start with demo MySQL cluster
#   ./start.sh --stop       # Stop all services
#   ./start.sh --help       # Show help
#
# After starting, register your MySQL instances:
#   curl -X POST http://localhost:8080/api/v1/instances \
#     -H 'Content-Type: application/json' \
#     -d '{"host": "your-mysql-host", "port": 3306}'
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default settings
DEMO_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --demo|-d)
            DEMO_MODE=true
            shift
            ;;
        --stop)
            echo -e "${BLUE}Stopping ClawSQL...${NC}"
            docker-compose down
            if [ -f docker-compose.demo.yml ]; then
                docker-compose -f docker-compose.yml -f docker-compose.demo.yml down
            fi
            echo -e "${GREEN}✓ ClawSQL stopped${NC}"
            exit 0
            ;;
        --help|-h)
            echo "ClawSQL - MySQL HA Management Platform"
            echo ""
            echo "Usage:"
            echo "  ./start.sh              Start platform (bring your own MySQL)"
            echo "  ./start.sh --demo       Start with demo MySQL cluster"
            echo "  ./start.sh --stop       Stop all services"
            echo ""
            echo "After starting, register your MySQL instances via API:"
            echo "  curl -X POST http://localhost:8080/api/v1 instances \\"
            echo "    -H 'Content-Type: application/json' \\"
            echo "    -d '{\"host\": \"your-mysql\", \"port\": 3306}'"
            echo ""
            echo "Services:"
            echo "  ClawSQL API:    http://localhost:8080"
            echo "  API Docs:       http://localhost:8080/docs"
            echo "  Orchestrator:   http://localhost:3000"
            echo "  Prometheus:     http://localhost:9090"
            echo "  Grafana:        http://localhost:3001 (admin/admin)"
            echo "  ProxySQL:       localhost:6033 (MySQL traffic)"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Run './start.sh --help' for usage"
            exit 1
            ;;
    esac
done

# Banner
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    ClawSQL v0.1.0                          ║${NC}"
echo -e "${CYAN}║            MySQL High Availability Platform                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Docker
echo -e "${BLUE}[1/4] Checking prerequisites...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    echo ""
    echo "Please install Docker first:"
    echo "  https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✓ Docker is installed${NC}"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    echo ""
    echo "Please install Docker Compose first:"
    echo "  https://docs.docker.com/compose/install/"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose is installed${NC}"

# Create .env if not exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✓ Created .env from .env.example${NC}"
    fi
fi

# Start services
echo ""
echo -e "${BLUE}[2/4] Starting services...${NC}"

if [ "$DEMO_MODE" = true ]; then
    echo -e "${YELLOW}Starting with demo MySQL cluster...${NC}"
    docker-compose -f docker-compose.yml -f docker-compose.demo.yml up -d
else
    echo -e "${YELLOW}Starting platform services (bring your own MySQL)...${NC}"
    docker-compose up -d
fi

# Wait for ClawSQL API
echo ""
echo -e "${BLUE}[3/4] Waiting for services to be ready...${NC}"

MAX_WAIT=60
WAITED=0
until curl -s http://localhost:8080/health | grep -q "healthy" 2>/dev/null; do
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo -e "${RED}✗ Timeout waiting for ClawSQL API${NC}"
        echo ""
        echo "Check logs with: docker-compose logs clawsql"
        exit 1
    fi
    echo -n "."
    sleep 2
    WAITED=$((WAITED + 2))
done
echo ""
echo -e "${GREEN}✓ ClawSQL API is ready${NC}"

# Print status
echo ""
echo -e "${BLUE}[4/4] Verifying services...${NC}"

# Check each service
check_service() {
    local name=$1
    local url=$2
    local pattern=$3

    if curl -s "$url" 2>/dev/null | grep -q "$pattern"; then
        echo -e "${GREEN}✓ $name${NC}"
        return 0
    else
        echo -e "${YELLOW}○ $name (starting...)${NC}"
        return 1
    fi
}

check_service "ClawSQL API" "http://localhost:8080/health" "healthy"
check_service "Orchestrator" "http://localhost:3000/api/health" "OK"
check_service "Prometheus" "http://localhost:9090/-/healthy" "OK"
check_service "Grafana" "http://localhost:3001/api/health" "ok"
check_service "ProxySQL" "http://localhost:6080" "" || echo -e "${GREEN}✓ ProxySQL${NC}"

if [ "$DEMO_MODE" = true ]; then
    echo ""
    echo -e "${YELLOW}Demo MySQL Cluster:${NC}"
    echo "  Primary:   localhost:3306 (root/rootpassword)"
    echo "  Replica 1: localhost:3307"
    echo "  Replica 2: localhost:3308"
fi

# Print success message
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              ClawSQL is ready!                             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Services:${NC}"
echo "  ClawSQL API:    http://localhost:8080"
echo "  API Docs:       http://localhost:8080/docs"
echo "  Orchestrator:   http://localhost:3000"
echo "  Prometheus:     http://localhost:9090"
echo "  Grafana:        http://localhost:3001 (admin/admin)"
echo "  ProxySQL:       localhost:6033 (MySQL traffic)"
echo ""
echo -e "${GREEN}Quick Start:${NC}"
echo "  1. Register your MySQL instances:"
echo "     curl -X POST http://localhost:8080/api/v1/instances \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"host\": \"your-mysql\", \"port\": 3306}'"
echo ""
echo "  2. View your cluster topology:"
echo "     curl http://localhost:8080/api/v1/clusters"
echo ""
echo "  3. Connect your app to ProxySQL:"
echo "     mysql -h localhost -P 6033 -u root -p"
echo ""
echo -e "${BLUE}Commands:${NC}"
echo "  View logs:    docker-compose logs -f clawsql"
echo "  Stop:         ./start.sh --stop"
echo "  Help:         ./start.sh --help"
echo ""
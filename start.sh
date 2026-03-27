#!/bin/bash
#
# ClawSQL - One-Command Startup Script
#
# Usage:
#   ./start.sh              # Start platform only (bring your own MySQL)
#   ./start.sh --demo       # Start with demo MySQL cluster
#   ./start.sh --stop       # Stop all services
#   ./start.sh --cleanup    # Full cleanup (stops services, removes containers)
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

# Detect container runtime
detect_runtime() {
    if command -v docker &> /dev/null; then
        if docker info &> /dev/null 2>&1; then
            # Check if it's actually Podman
            if docker --version 2>&1 | grep -qi podman; then
                echo "podman"
            else
                echo "docker"
            fi
        elif systemctl is-active podman.socket &> /dev/null 2>&1; then
            echo "podman"
        else
            echo "none"
        fi
    elif command -v podman &> /dev/null; then
        echo "podman"
    else
        echo "none"
    fi
}

# Detect compose command
detect_compose_cmd() {
    local runtime="$1"
    if command -v docker-compose &> /dev/null; then
        echo "docker-compose"
    elif [ "$runtime" = "docker" ] && docker compose version &> /dev/null 2>&1; then
        echo "docker compose"
    elif [ "$runtime" = "podman" ] && podman-compose version &> /dev/null 2>&1; then
        echo "podman-compose"
    else
        echo ""
    fi
}

# Stop conflicting systemd services
stop_conflicting_services() {
    local services_stopped=()

    # Check for proxysql service
    if systemctl is-active proxysql &> /dev/null 2>&1; then
        echo -e "${YELLOW}Stopping conflicting proxysql systemd service...${NC}"
        sudo systemctl stop proxysql 2>/dev/null || true
        services_stopped+=("proxysql")
    fi

    # Check for mysqld/mariadb service
    for svc in mysqld mariadb mysql; do
        if systemctl is-active "$svc" &> /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping conflicting $svc systemd service...${NC}"
            sudo systemctl stop "$svc" 2>/dev/null || true
            services_stopped+=("$svc")
            break
        fi
    done

    if [ ${#services_stopped[@]} -gt 0 ]; then
        echo -e "${GREEN}✓ Stopped conflicting services: ${services_stopped[*]}${NC}"
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --demo|-d)
            DEMO_MODE=true
            shift
            ;;
        --stop)
            echo -e "${BLUE}Stopping ClawSQL...${NC}"
            RUNTIME=$(detect_runtime)
            COMPOSE_CMD=$(detect_compose_cmd "$RUNTIME")
            if [ -n "$COMPOSE_CMD" ]; then
                $COMPOSE_CMD down 2>/dev/null || true
                if [ -f docker-compose.demo.yml ]; then
                    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.demo.yml down 2>/dev/null || true
                fi
            fi
            echo -e "${GREEN}✓ ClawSQL stopped${NC}"
            exit 0
            ;;
        --cleanup)
            exec ./scripts/cleanup.sh "$@"
            ;;
        --help|-h)
            echo "ClawSQL - MySQL HA Management Platform"
            echo ""
            echo "Usage:"
            echo "  ./start.sh              Start platform (bring your own MySQL)"
            echo "  ./start.sh --demo       Start with demo MySQL cluster"
            echo "  ./start.sh --stop       Stop all services"
            echo "  ./start.sh --cleanup    Full cleanup (stops and removes containers)"
            echo ""
            echo "After starting, register your MySQL instances via API:"
            echo "  curl -X POST http://localhost:8080/api/v1/instances \\"
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

# Detect runtime and compose command
RUNTIME=$(detect_runtime)
COMPOSE_CMD=$(detect_compose_cmd "$RUNTIME")

# Check prerequisites
echo -e "${BLUE}[1/4] Checking prerequisites...${NC}"

if [ "$RUNTIME" = "none" ]; then
    echo -e "${RED}✗ No container runtime found${NC}"
    echo ""
    echo "Please install Docker or Podman:"
    echo "  Docker:  https://docs.docker.com/get-docker/"
    echo "  Podman:  https://podman.io/getting-started/installation"
    exit 1
fi
echo -e "${GREEN}✓ Container runtime: ${RUNTIME}${NC}"

# For Podman, ensure socket is running
if [ "$RUNTIME" = "podman" ]; then
    if ! systemctl is-active podman.socket &> /dev/null; then
        echo -e "${YELLOW}Enabling podman socket...${NC}"
        systemctl enable --now podman.socket 2>/dev/null || true
    fi
fi

# Check container runtime is working
if ! $RUNTIME info &> /dev/null; then
    echo -e "${RED}✗ Container runtime is not running${NC}"
    echo ""
    if [ "$RUNTIME" = "docker" ]; then
        echo "Please start Docker:"
        echo "  systemctl start docker"
    else
        echo "Please ensure podman socket is running:"
        echo "  systemctl enable --now podman.socket"
    fi
    exit 1
fi
echo -e "${GREEN}✓ Container runtime is running${NC}"

# Check compose
if [ -z "$COMPOSE_CMD" ]; then
    echo -e "${RED}✗ Docker Compose / Podman Compose not found${NC}"
    echo ""
    echo "Install Docker Compose:"
    echo "  • Docker Desktop (Mac/Windows): Includes docker compose"
    echo "  • Linux (apt): apt install docker-compose-plugin"
    echo "  • Linux (dnf): dnf install docker-compose-plugin"
    echo ""
    echo "Or Podman Compose:"
    echo "  • dnf install podman-compose"
    echo "  • apt install podman-compose"
    exit 1
fi
echo -e "${GREEN}✓ Compose: ${COMPOSE_CMD}${NC}"

# Stop conflicting systemd services
stop_conflicting_services

# Create .env if not exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✓ Created .env from .env.example${NC}"
    fi
fi

# Handle metadata database configuration
# If METADATA_DB_HOST is not set, use the auto-provisioned metadata-mysql container
METADATA_PROFILE=""
if [ -z "$METADATA_DB_HOST" ] || [ "$METADATA_DB_HOST" = "" ]; then
    # Source .env to check if it's set there
    if [ -f .env ]; then
        source .env 2>/dev/null || true
    fi

    if [ -z "$METADATA_DB_HOST" ] || [ "$METADATA_DB_HOST" = "" ]; then
        echo -e "${YELLOW}No METADATA_DB_HOST set - auto-provisioning metadata MySQL container${NC}"
        export METADATA_DB_HOST=metadata-mysql
        METADATA_PROFILE="--profile metadata"
    fi
fi

# Start services
echo ""
echo -e "${BLUE}[2/4] Starting services...${NC}"

# Set HOST_IP for demo mode (used by MySQL report-host)
if [ "$DEMO_MODE" = true ]; then
    export HOST_IP=$(hostname -I | awk '{print $1}')
    echo -e "${YELLOW}Starting with demo MySQL cluster...${NC}"
    echo -e "${CYAN}Host IP: ${HOST_IP}${NC}"
    $COMPOSE_CMD $METADATA_PROFILE -f docker-compose.yml -f docker-compose.demo.yml up -d
else
    echo -e "${YELLOW}Starting platform services (bring your own MySQL)...${NC}"
    $COMPOSE_CMD $METADATA_PROFILE up -d
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
    # Get the host IP for demo instructions
    HOST_IP=$(hostname -I | awk '{print $1}')

    echo ""
    echo -e "${YELLOW}Demo MySQL Cluster (host networking):${NC}"
    echo "  Primary:   ${HOST_IP}:3306 (root/rootpassword)"
    echo "  Replica 1: ${HOST_IP}:3307"
    echo "  Replica 2: ${HOST_IP}:3308"
    echo ""
    echo -e "${GREEN}Register instances with:${NC}"
    echo "  clawsql"
    echo "  > /instances register ${HOST_IP} 3306"
    echo "  > /instances register ${HOST_IP} 3307"
    echo "  > /instances register ${HOST_IP} 3308"
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
echo "  View logs:    $COMPOSE_CMD logs -f clawsql"
echo "  Stop:         ./start.sh --stop"
echo "  Cleanup:      ./start.sh --cleanup"
echo "  Help:         ./start.sh --help"
echo ""
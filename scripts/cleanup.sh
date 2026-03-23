#!/bin/bash
#
# ClawSQL - Cleanup Script
#
# Stops all ClawSQL services and cleans up resources.
# Handles Docker, Podman, and systemd service conflicts.
#
# Usage:
#   ./scripts/cleanup.sh           # Stop containers, keep volumes
#   ./scripts/cleanup.sh --volumes # Stop containers and remove volumes
#   ./scripts/cleanup.sh --all     # Full cleanup including images
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Parse arguments
REMOVE_VOLUMES=false
REMOVE_IMAGES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --volumes|-v)
            REMOVE_VOLUMES=true
            shift
            ;;
        --all|-a)
            REMOVE_VOLUMES=true
            REMOVE_IMAGES=true
            shift
            ;;
        --help|-h)
            echo "ClawSQL Cleanup Script"
            echo ""
            echo "Usage:"
            echo "  ./scripts/cleanup.sh           Stop containers, keep volumes"
            echo "  ./scripts/cleanup.sh --volumes Stop containers and remove volumes"
            echo "  ./scripts/cleanup.sh --all     Full cleanup including images"
            echo ""
            echo "Options:"
            echo "  --volumes, -v    Remove Docker volumes (WARNING: destroys data)"
            echo "  --all, -a        Remove volumes and images"
            echo "  --help, -h       Show this help message"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              ClawSQL Cleanup Script                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

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

RUNTIME=$(detect_runtime)

if [ "$RUNTIME" = "none" ]; then
    echo -e "${YELLOW}No container runtime detected${NC}"
else
    echo -e "${GREEN}Container runtime: ${RUNTIME}${NC}"
fi

# =============================================================================
# Step 1: Stop conflicting systemd services
# =============================================================================
echo ""
echo -e "${BLUE}[1/5] Checking for conflicting systemd services...${NC}"

SERVICES_STOPPED=()

# Check for proxysql service
if systemctl is-active proxysql &> /dev/null 2>&1; then
    echo -e "${YELLOW}Stopping proxysql systemd service...${NC}"
    sudo systemctl stop proxysql 2>/dev/null || true
    sudo systemctl disable proxysql 2>/dev/null || true
    SERVICES_STOPPED+=("proxysql")
fi

# Check for mysqld/mariadb service
for svc in mysqld mariadb mysql; do
    if systemctl is-active "$svc" &> /dev/null 2>&1; then
        echo -e "${YELLOW}Stopping $svc systemd service...${NC}"
        sudo systemctl stop "$svc" 2>/dev/null || true
        SERVICES_STOPPED+=("$svc")
    fi
done

# Check for prometheus service
if systemctl is-active prometheus &> /dev/null 2>&1; then
    echo -e "${YELLOW}Stopping prometheus systemd service...${NC}"
    sudo systemctl stop prometheus 2>/dev/null || true
    SERVICES_STOPPED+=("prometheus")
fi

# Check for grafana-server service
if systemctl is-active grafana-server &> /dev/null 2>&1; then
    echo -e "${YELLOW}Stopping grafana-server systemd service...${NC}"
    sudo systemctl stop grafana-server 2>/dev/null || true
    SERVICES_STOPPED+=("grafana-server")
fi

if [ ${#SERVICES_STOPPED[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ No conflicting services found${NC}"
else
    echo -e "${GREEN}✓ Stopped services: ${SERVICES_STOPPED[*]}${NC}"
fi

# =============================================================================
# Step 2: Stop Docker/Podman containers
# =============================================================================
echo ""
echo -e "${BLUE}[2/5] Stopping containers...${NC}"

if [ "$RUNTIME" != "none" ]; then
    # List of ClawSQL containers
    CONTAINERS=(
        "clawsql"
        "orchestrator"
        "proxysql"
        "prometheus"
        "grafana"
        "mysql-primary"
        "mysql-replica-1"
        "mysql-replica-2"
    )

    STOPPED_CONTAINERS=()

    for container in "${CONTAINERS[@]}"; do
        if $RUNTIME ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
            echo -e "${YELLOW}Stopping ${container}...${NC}"
            $RUNTIME stop "$container" 2>/dev/null || true
            $RUNTIME rm "$container" 2>/dev/null || true
            STOPPED_CONTAINERS+=("$container")
        fi
    done

    # Also try docker-compose down
    if [ -f "docker-compose.yml" ]; then
        echo -e "${YELLOW}Running docker-compose down...${NC}"

        # Determine compose command
        if command -v docker-compose &> /dev/null; then
            COMPOSE_CMD="docker-compose"
        elif $RUNTIME compose version &> /dev/null 2>&1; then
            COMPOSE_CMD="$RUNTIME compose"
        else
            COMPOSE_CMD=""
        fi

        if [ -n "$COMPOSE_CMD" ]; then
            if [ "$REMOVE_VOLUMES" = true ]; then
                $COMPOSE_CMD -f docker-compose.yml down --volumes 2>/dev/null || true
                if [ -f "docker-compose.demo.yml" ]; then
                    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.demo.yml down --volumes 2>/dev/null || true
                fi
            else
                $COMPOSE_CMD -f docker-compose.yml down 2>/dev/null || true
                if [ -f "docker-compose.demo.yml" ]; then
                    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.demo.yml down 2>/dev/null || true
                fi
            fi
        fi
    fi

    if [ ${#STOPPED_CONTAINERS[@]} -eq 0 ]; then
        echo -e "${GREEN}✓ No containers to stop${NC}"
    else
        echo -e "${GREEN}✓ Stopped containers: ${STOPPED_CONTAINERS[*]}${NC}"
    fi
else
    echo -e "${YELLOW}⊘ Skipping container cleanup (no runtime)${NC}"
fi

# =============================================================================
# Step 3: Remove networks
# =============================================================================
echo ""
echo -e "${BLUE}[3/5] Removing networks...${NC}"

if [ "$RUNTIME" != "none" ]; then
    NETWORKS=$($RUNTIME network ls --format '{{.Name}}' 2>/dev/null | grep -E 'clawsql|clawsql_clawsql-network' || true)

    if [ -n "$NETWORKS" ]; then
        for network in $NETWORKS; do
            echo -e "${YELLOW}Removing network: ${network}${NC}"
            $RUNTIME network rm "$network" 2>/dev/null || true
        done
        echo -e "${GREEN}✓ Networks removed${NC}"
    else
        echo -e "${GREEN}✓ No networks to remove${NC}"
    fi
else
    echo -e "${YELLOW}⊘ Skipping network cleanup${NC}"
fi

# =============================================================================
# Step 4: Remove volumes (if requested)
# =============================================================================
echo ""
echo -e "${BLUE}[4/5] Removing volumes...${NC}"

if [ "$REMOVE_VOLUMES" = true ] && [ "$RUNTIME" != "none" ]; then
    VOLUMES=$($RUNTIME volume ls --format '{{.Name}}' 2>/dev/null | grep -E 'clawsql|orchestrator|proxysql|prometheus|grafana|mysql' || true)

    if [ -n "$VOLUMES" ]; then
        for volume in $VOLUMES; do
            echo -e "${YELLOW}Removing volume: ${volume}${NC}"
            $RUNTIME volume rm "$volume" 2>/dev/null || true
        done
        echo -e "${GREEN}✓ Volumes removed${NC}"
    else
        echo -e "${GREEN}✓ No volumes to remove${NC}"
    fi
elif [ "$REMOVE_VOLUMES" = true ]; then
    echo -e "${YELLOW}⊘ Skipping volume cleanup (no runtime)${NC}"
else
    echo -e "${BLUE}⊘ Skipping volumes (use --volumes to remove)${NC}"
fi

# =============================================================================
# Step 5: Remove images (if requested)
# =============================================================================
echo ""
echo -e "${BLUE}[5/5] Removing images...${NC}"

if [ "$REMOVE_IMAGES" = true ] && [ "$RUNTIME" != "none" ]; then
    # Remove ClawSQL built image
    if $RUNTIME images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q 'clawsql-clawsql'; then
        echo -e "${YELLOW}Removing clawsql image...${NC}"
        $RUNTIME rmi clawsql-clawsql:latest 2>/dev/null || true
    fi

    # Optionally prune dangling images
    echo -e "${YELLOW}Pruning dangling images...${NC}"
    $RUNTIME image prune -f 2>/dev/null || true

    echo -e "${GREEN}✓ Images cleaned${NC}"
elif [ "$REMOVE_IMAGES" = true ]; then
    echo -e "${YELLOW}⊘ Skipping image cleanup (no runtime)${NC}"
else
    echo -e "${BLUE}⊘ Skipping images (use --all to remove)${NC}"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Cleanup Complete                              ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$REMOVE_VOLUMES" = true ]; then
    echo -e "${YELLOW}Note: Volumes were removed. All persistent data has been deleted.${NC}"
fi

echo ""
echo "To start ClawSQL again:"
echo "  ./start.sh              # Start platform only"
echo "  ./start.sh --demo       # Start with demo MySQL cluster"
echo ""
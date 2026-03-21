#!/bin/bash
#
# ClawSQL Health Check Script
# Usage: ./scripts/health_check.sh [--demo]
#
# Without --demo: Checks platform services only (your own MySQL)
# With --demo: Also checks demo MySQL cluster
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

check_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

check_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

check_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

check_skip() {
    echo -e "${BLUE}[SKIP]${NC} $1"
}

# Parse arguments
DEMO_MODE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --demo|-d)
            DEMO_MODE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# API URL
API_URL="${API_URL:-http://localhost:8080}"

echo ""
echo "=========================================="
echo "  ClawSQL Health Check"
echo "=========================================="
echo ""

# Check ClawSQL API
echo -e "${BLUE}ClawSQL API${NC}"
if curl -s "${API_URL}/health" | grep -q "healthy"; then
    check_pass "API is healthy"
else
    check_fail "API is not responding at ${API_URL}"
fi

# Check API endpoints
echo ""
echo -e "${BLUE}API Endpoints${NC}"
if curl -s "${API_URL}/api/v1/monitoring/health" | grep -q "healthy\|status"; then
    check_pass "Monitoring endpoint working"
else
    check_warn "Monitoring endpoint not responding"
fi

# Check Orchestrator
echo ""
echo -e "${BLUE}Orchestrator${NC}"
if curl -s http://localhost:3000/api/health 2>/dev/null | grep -q "OK"; then
    check_pass "Orchestrator is healthy"
else
    check_warn "Orchestrator is not responding"
fi

# Check ProxySQL
echo ""
echo -e "${BLUE}ProxySQL${NC}"
if command -v mysql &>/dev/null; then
    if mysql -h127.0.0.1 -P6032 -uadmin -padmin -e "SELECT 1" &>/dev/null; then
        check_pass "ProxySQL admin interface is responding"
    else
        check_warn "ProxySQL is not responding (may be starting)"
    fi
else
    check_skip "MySQL client not available for ProxySQL check"
fi

# Check Prometheus
echo ""
echo -e "${BLUE}Prometheus${NC}"
if curl -s http://localhost:9090/-/healthy 2>/dev/null | grep -q "OK"; then
    check_pass "Prometheus is healthy"
else
    check_warn "Prometheus is not responding"
fi

# Check Grafana
echo ""
echo -e "${BLUE}Grafana${NC}"
if curl -s http://localhost:3001/api/health 2>/dev/null | grep -q "ok"; then
    check_pass "Grafana is healthy"
else
    check_warn "Grafana is not responding"
fi

# Demo MySQL checks (only with --demo flag)
if [ "$DEMO_MODE" = true ]; then
    echo ""
    echo -e "${BLUE}Demo MySQL Cluster${NC}"

    # Check if Docker is available
    if ! command -v docker &>/dev/null; then
        check_skip "Docker not available"
    else
        # Primary
        if docker exec mysql-primary mysqladmin ping -h localhost -uroot -prootpassword --silent 2>/dev/null; then
            check_pass "MySQL Primary is running"
        else
            check_fail "MySQL Primary is not running"
        fi

        # Replica 1
        if docker exec mysql-replica-1 mysqladmin ping -h localhost -uroot -prootpassword --silent 2>/dev/null; then
            check_pass "MySQL Replica 1 is running"
        else
            check_warn "MySQL Replica 1 is not running"
        fi

        # Replica 2
        if docker exec mysql-replica-2 mysqladmin ping -h localhost -uroot -prootpassword --silent 2>/dev/null; then
            check_pass "MySQL Replica 2 is running"
        else
            check_warn "MySQL Replica 2 is not running"
        fi

        # Replication status
        echo ""
        echo -e "${BLUE}Replication Status${NC}"

        REPL1_STATUS=$(docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}' || echo "NULL")
        if [ "$REPL1_STATUS" != "NULL" ] && [ "$REPL1_STATUS" != "" ]; then
            if [ "$REPL1_STATUS" = "0" ]; then
                check_pass "Replica 1: In sync (0s lag)"
            else
                check_warn "Replica 1: ${REPL1_STATUS}s lag"
            fi
        else
            check_warn "Replica 1: Replication not configured"
        fi

        REPL2_STATUS=$(docker exec mysql-replica-2 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}' || echo "NULL")
        if [ "$REPL2_STATUS" != "NULL" ] && [ "$REPL2_STATUS" != "" ]; then
            if [ "$REPL2_STATUS" = "0" ]; then
                check_pass "Replica 2: In sync (0s lag)"
            else
                check_warn "Replica 2: ${REPL2_STATUS}s lag"
            fi
        else
            check_warn "Replica 2: Replication not configured"
        fi
    fi
fi

# Summary
echo ""
echo "=========================================="
echo "  Health Check Complete"
echo "=========================================="
echo ""

if [ "$DEMO_MODE" = true ]; then
    echo "Tip: Run without --demo to check platform services only"
else
    echo "Tip: Run with --demo to also check demo MySQL cluster"
fi
#!/bin/bash
#
# ClawSQL Health Check Script
# This script checks the health of all components
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
    check_fail "API is not responding"
fi

# Check MySQL instances
echo ""
echo -e "${BLUE}MySQL Instances${NC}"

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

# Check replication status
echo ""
echo -e "${BLUE}Replication Status${NC}"

# Replica 1 replication
REPL1_STATUS=$(docker exec mysql-replica-1 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}' || echo "NULL")
if [ "$REPL1_STATUS" != "NULL" ] && [ "$REPL1_STATUS" != "" ]; then
    if [ "$REPL1_STATUS" = "0" ]; then
        check_pass "Replica 1 replication: In sync (0s lag)"
    else
        check_warn "Replica 1 replication: ${REPL1_STATUS}s lag"
    fi
else
    check_warn "Replica 1: Replication not configured"
fi

# Replica 2 replication
REPL2_STATUS=$(docker exec mysql-replica-2 mysql -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}' || echo "NULL")
if [ "$REPL2_STATUS" != "NULL" ] && [ "$REPL2_STATUS" != "" ]; then
    if [ "$REPL2_STATUS" = "0" ]; then
        check_pass "Replica 2 replication: In sync (0s lag)"
    else
        check_warn "Replica 2 replication: ${REPL2_STATUS}s lag"
    fi
else
    check_warn "Replica 2: Replication not configured"
fi

# Check ProxySQL
echo ""
echo -e "${BLUE}ProxySQL${NC}"
if docker exec proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin -e "SELECT 1" &>/dev/null; then
    check_pass "ProxySQL admin interface is responding"
else
    check_fail "ProxySQL is not responding"
fi

# Check Prometheus
echo ""
echo -e "${BLUE}Prometheus${NC}"
if curl -s http://localhost:9090/-/healthy | grep -q "OK"; then
    check_pass "Prometheus is healthy"
else
    check_fail "Prometheus is not responding"
fi

# Check Grafana
echo ""
echo -e "${BLUE}Grafana${NC}"
if curl -s http://localhost:3001/api/health | grep -q "ok"; then
    check_pass "Grafana is healthy"
else
    check_fail "Grafana is not responding"
fi

# Check Orchestrator
echo ""
echo -e "${BLUE}Orchestrator${NC}"
if curl -s http://localhost:3000/api/health &>/dev/null; then
    check_pass "Orchestrator is responding"
else
    check_warn "Orchestrator is not responding"
fi

# Summary
echo ""
echo "=========================================="
echo "  Health Check Complete"
echo "=========================================="
echo ""
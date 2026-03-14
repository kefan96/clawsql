#!/bin/bash
#
# ClawSQL Failover Simulation Script
# This script simulates a primary failure and demonstrates failover
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

API_URL="${API_URL:-http://localhost:8080}"

# Check if API is running
check_api() {
    if ! curl -s "${API_URL}/health" > /dev/null 2>&1; then
        log_error "ClawSQL API is not running at ${API_URL}"
        exit 1
    fi
}

# Get current cluster state
get_cluster_state() {
    log_info "Getting current cluster state..."
    curl -s "${API_URL}/api/v1/clusters" | python3 -m json.tool 2>/dev/null || echo "No clusters configured"
}

# Get instance health
get_instance_health() {
    log_info "Checking instance health..."
    curl -s "${API_URL}/api/v1/instances" | python3 -m json.tool 2>/dev/null || echo "No instances discovered"
}

# Simulate primary failure
simulate_primary_failure() {
    log_warning "Simulating primary failure..."
    log_info "Stopping MySQL primary container..."

    docker stop mysql-primary

    log_warning "Primary is now offline"
    sleep 5
}

# Check if failover is triggered
check_failover_status() {
    log_info "Checking failover status..."
    curl -s "${API_URL}/api/v1/failover/history" | python3 -m json.tool 2>/dev/null || echo "No failover history"
}

# Promote a replica manually (if auto-failover is disabled)
manual_failover() {
    log_info "Executing manual failover..."

    # Get list of candidates
    log_info "Getting failover candidates..."
    CANDIDATES=$(curl -s "${API_URL}/api/v1/failover/candidates/demo-cluster" 2>/dev/null)

    if [ -z "$CANDIDATES" ] || [ "$CANDIDATES" = "null" ]; then
        log_warning "No candidates returned from API, using first replica"
        TARGET="mysql-replica-1:3306"
    else
        # Get first candidate instance_id
        TARGET=$(echo "$CANDIDATES" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['instance_id'] if data else 'mysql-replica-1:3306')" 2>/dev/null || echo "mysql-replica-1:3306")
    fi

    log_info "Promoting $TARGET to primary..."

    curl -s -X POST "${API_URL}/api/v1/failover/execute" \
        -H "Content-Type: application/json" \
        -d "{
            \"cluster_id\": \"demo-cluster\",
            \"target_instance_id\": \"$TARGET\",
            \"reason\": \"Manual failover due to primary failure simulation\",
            \"auto_confirm\": true
        }" | python3 -m json.tool 2>/dev/null

    log_success "Failover initiated"
}

# Recover the failed primary
recover_primary() {
    log_info "Recovering the failed primary..."

    docker start mysql-primary

    log_info "Waiting for primary to recover..."
    sleep 10

    log_success "Primary recovered"
}

# Verify cluster state after recovery
verify_cluster() {
    log_info "Verifying cluster state..."
    get_cluster_state
    get_instance_health
}

# Main execution
main() {
    echo ""
    echo "=========================================="
    echo "  ClawSQL Failover Simulation"
    echo "=========================================="
    echo ""

    check_api

    echo ""
    log_info "Current cluster state:"
    get_cluster_state
    echo ""

    read -p "Press Enter to simulate primary failure..."
    simulate_primary_failure

    echo ""
    read -p "Press Enter to check failover status..."
    check_failover_status

    echo ""
    read -p "Press Enter to execute manual failover..."
    manual_failover

    echo ""
    read -p "Press Enter to recover the failed primary..."
    recover_primary

    echo ""
    log_info "Final cluster state:"
    verify_cluster

    echo ""
    log_success "Failover simulation completed"
}

# Run main
main "$@"
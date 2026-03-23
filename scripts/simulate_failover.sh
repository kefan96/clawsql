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
AUTO_FAILOVER_OCCURRED=false
# How long to wait for auto-failover (seconds). Default: 60s for demo, production would be 300s (5 min)
FAILOVER_WAIT_TIMEOUT="${FAILOVER_WAIT_TIMEOUT:-60}"

# Check if API is running
check_api() {
    if ! curl -s "${API_URL}/health" > /dev/null 2>&1; then
        log_error "ClawSQL API is not running at ${API_URL}"
        exit 1
    fi
}

# Register MySQL instances with ClawSQL
register_instances() {
    log_info "Registering MySQL instances..."

    # Register with ClawSQL API
    curl -s -X POST "${API_URL}/api/v1/instances" \
        -H "Content-Type: application/json" \
        -d '{"host": "mysql-primary", "port": 3306}' > /dev/null 2>&1

    curl -s -X POST "${API_URL}/api/v1/instances" \
        -H "Content-Type: application/json" \
        -d '{"host": "mysql-replica-1", "port": 3306}' > /dev/null 2>&1

    curl -s -X POST "${API_URL}/api/v1/instances" \
        -H "Content-Type: application/json" \
        -d '{"host": "mysql-replica-2", "port": 3306}' > /dev/null 2>&1

    # Register with Orchestrator
    curl -s "http://localhost:3000/api/discover/mysql-primary/3306" > /dev/null 2>&1
    curl -s "http://localhost:3000/api/discover/mysql-replica-1/3306" > /dev/null 2>&1
    curl -s "http://localhost:3000/api/discover/mysql-replica-2/3306" > /dev/null 2>&1

    log_info "Waiting for instances to be discovered..."
    sleep 3
}

# Get current cluster state
get_cluster_state() {
    log_info "Getting current cluster state..."

    # Try to find the current primary (not read-only)
    PRIMARY_HOST=""
    for host_port in "mysql-primary:3306" "mysql-replica-1:3306" "mysql-replica-2:3306"; do
        host=$(echo $host_port | cut -d: -f1)
        port=$(echo $host_port | cut -d: -f2)

        # Map to external port
        case $host in
            mysql-primary) ext_port=3306 ;;
            mysql-replica-1) ext_port=3307 ;;
            mysql-replica-2) ext_port=3308 ;;
        esac

        if mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
            readonly=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT @@read_only" 2>/dev/null | tail -1)
            if [ "$readonly" = "0" ]; then
                PRIMARY_HOST=$host
                break
            fi
        fi
    done

    if [ -z "$PRIMARY_HOST" ]; then
        echo "No primary found - cluster may be down"
        return
    fi

    echo "Primary: $PRIMARY_HOST:3306"

    # List replicas
    echo "Replicas:"
    for host_port in "mysql-primary:3306" "mysql-replica-1:3306" "mysql-replica-2:3306"; do
        host=$(echo $host_port | cut -d: -f1)
        if [ "$host" != "$PRIMARY_HOST" ]; then
            case $host in
                mysql-primary) ext_port=3306 ;;
                mysql-replica-1) ext_port=3307 ;;
                mysql-replica-2) ext_port=3308 ;;
            esac

            if mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
                lag=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')
                if [ -n "$lag" ]; then
                    echo "  - $host:3306 (lag: ${lag}s)"
                else
                    echo "  - $host:3306 (replication not configured)"
                fi
            fi
        fi
    done
}

# Get instance health
get_instance_health() {
    log_info "Checking instance health..."

    for host_port in "mysql-primary:3306" "mysql-replica-1:3306" "mysql-replica-2:3306"; do
        host=$(echo $host_port | cut -d: -f1)

        case $host in
            mysql-primary) ext_port=3306 ;;
            mysql-replica-1) ext_port=3307 ;;
            mysql-replica-2) ext_port=3308 ;;
        esac

        if mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
            readonly=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT @@read_only" 2>/dev/null | tail -1)
            role="REPLICA"
            if [ "$readonly" = "0" ]; then
                role="PRIMARY"
            fi

            # Check for issues
            issues=""
            if [ "$role" = "REPLICA" ]; then
                io_running=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
                sql_running=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
                if [ "$io_running" != "Yes" ] || [ "$sql_running" != "Yes" ]; then
                    issues=" (replication issues)"
                fi
            fi

            echo "  $host:3306 [$role] - healthy${issues}"
        else
            echo "  $host:3306 [DOWN] - not responding"
        fi
    done
}

# Get the current primary hostname (excluding a specific host)
get_current_primary() {
    local exclude_host="${1:-}"
    for host_port in "mysql-primary:3306" "mysql-replica-1:3306" "mysql-replica-2:3306"; do
        host=$(echo $host_port | cut -d: -f1)

        # Skip excluded host
        if [ -n "$exclude_host" ] && [ "$host" = "$exclude_host" ]; then
            continue
        fi

        case $host in
            mysql-primary) ext_port=3306 ;;
            mysql-replica-1) ext_port=3307 ;;
            mysql-replica-2) ext_port=3308 ;;
        esac

        if mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
            readonly=$(mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT @@read_only" 2>/dev/null | tail -1)
            if [ "$readonly" = "0" ]; then
                echo "$host"
                return
            fi
        fi
    done
    echo ""
}

# Simulate primary failure
simulate_primary_failure() {
    log_warning "Simulating primary failure..."

    # Find the actual current primary
    STOPPED_PRIMARY=$(get_current_primary)

    if [ -z "$STOPPED_PRIMARY" ]; then
        log_error "No primary found - cannot simulate failure"
        return 1
    fi

    log_info "Current primary is $STOPPED_PRIMARY - stopping it..."
    docker stop $STOPPED_PRIMARY

    log_warning "Primary $STOPPED_PRIMARY is now offline"
}

# Check if failover is triggered and wait for auto-failover
check_failover_status() {
    log_info "Waiting for auto-failover..."

    local POLL_INTERVAL=5
    local MAX_WAIT=$FAILOVER_WAIT_TIMEOUT

    log_info "Waiting up to ${MAX_WAIT}s for Orchestrator auto-failover..."
    log_info "Polling for new primary (checking every ${POLL_INTERVAL}s)..."

    local WAITED=0
    while [ $WAITED -lt $MAX_WAIT ]; do
        # Check if a new primary was promoted
        NEW_PRIMARY=$(get_current_primary "$STOPPED_PRIMARY")

        if [ -n "$NEW_PRIMARY" ]; then
            log_success "Auto-failover completed! New primary is $NEW_PRIMARY"
            AUTO_FAILOVER_OCCURRED=true
            return 0
        fi

        # Check replication analysis for blocking issues
        BLOCK_REASON=$(curl -s "http://localhost:3000/api/replication-analysis" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    details = data.get('Details', [])
    for item in details:
        analysis = item.get('Analysis', '')
        is_actionable = item.get('IsActionableRecovery', False)
        if not is_actionable:
            print(analysis)
except:
    pass
" 2>/dev/null)

        if [ -n "$BLOCK_REASON" ]; then
            # Only show once
            if [ $WAITED -eq 0 ]; then
                log_warning "Auto-failover blocked: $BLOCK_REASON"
            fi
        fi

        printf "."
        sleep $POLL_INTERVAL
        WAITED=$((WAITED + POLL_INTERVAL))
    done

    echo ""
    log_warning "Auto-failover did not occur within ${MAX_WAIT} seconds"

    # Show recent audit log
    log_info "Recent Orchestrator audit log:"
    curl -s "http://localhost:3000/api/audit" 2>/dev/null | python3 -c "
import sys,json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for entry in data[:5]:
            print(f'  {entry}')
    else:
        print('No audit data')
except:
    print('Could not get audit log')
" 2>/dev/null || echo "No failover history"

    AUTO_FAILOVER_OCCURRED=false
    return 1
}

# Check if auto-failover already occurred
check_auto_failover() {
    if [ "$AUTO_FAILOVER_OCCURRED" = "true" ]; then
        return 0
    else
        log_info "Proceeding with manual failover..."
        return 1
    fi
}

# Promote a replica manually (if auto-failover is disabled)
manual_failover() {
    # First check if auto-failover already happened
    if check_auto_failover; then
        log_info "Skipping manual failover - auto-failover already completed"
        return 0
    fi

    log_info "Executing manual failover..."

    # Find a healthy replica to promote (check all instances except the stopped one)
    log_info "Finding a healthy replica to promote..."
    TARGET=""
    TARGET_HOST=""
    TARGET_PORT=""

    for host_port in "mysql-primary:3306" "mysql-replica-1:3306" "mysql-replica-2:3306"; do
        host=$(echo $host_port | cut -d: -f1)

        # Skip the stopped primary
        if [ "$host" = "$STOPPED_PRIMARY" ]; then
            continue
        fi

        case $host in
            mysql-primary) ext_port=3306 ;;
            mysql-replica-1) ext_port=3307 ;;
            mysql-replica-2) ext_port=3308 ;;
        esac

        if mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
            TARGET=$host_port
            TARGET_HOST=$host
            TARGET_PORT=$ext_port
            log_info "Found candidate: $TARGET"
            break
        fi
    done

    if [ -z "$TARGET" ]; then
        log_error "No healthy replica found for failover"
        return 1
    fi

    log_info "Promoting $TARGET to primary..."

    # Manual promotion using MySQL commands
    # 1. Stop replication on target
    # 2. Make it writable
    # 3. Reconfigure other replicas to follow new primary

    log_info "Stopping replication on $TARGET_HOST..."
    mysql -h127.0.0.1 -P$TARGET_PORT -uroot -prootpassword -e "STOP SLAVE; SET GLOBAL read_only = OFF;" 2>&1 | grep -v Warning || true

    log_info "New primary $TARGET is now writable"

    # Reconfigure other instances to follow the new primary
    for other_host in "mysql-primary" "mysql-replica-1" "mysql-replica-2"; do
        # Skip the new primary and the stopped primary
        if [ "$other_host" = "$TARGET_HOST" ] || [ "$other_host" = "$STOPPED_PRIMARY" ]; then
            continue
        fi

        case $other_host in
            mysql-primary) other_port=3306 ;;
            mysql-replica-1) other_port=3307 ;;
            mysql-replica-2) other_port=3308 ;;
        esac

        if mysql -h127.0.0.1 -P$other_port -uroot -prootpassword -e "SELECT 1" 2>/dev/null | grep -q "1"; then
            log_info "Reconfiguring $other_host to follow $TARGET_HOST..."
            mysql -h127.0.0.1 -P$other_port -uroot -prootpassword -e "
                STOP SLAVE;
                CHANGE REPLICATION SOURCE TO
                    SOURCE_HOST='$TARGET_HOST',
                    SOURCE_PORT=3306,
                    SOURCE_USER='repl',
                    SOURCE_PASSWORD='replpassword',
                    SOURCE_AUTO_POSITION=1,
                    GET_SOURCE_PUBLIC_KEY=1;
                START SLAVE;
            " 2>&1 | grep -v Warning || true

            # Re-discover in Orchestrator
            curl -s "http://localhost:3000/api/discover/$other_host/3306" > /dev/null
        fi
    done

    # Re-discover new primary in Orchestrator
    curl -s "http://localhost:3000/api/discover/$TARGET_HOST/3306" > /dev/null

    log_success "Failover completed - $TARGET is now the primary"
}

# Recover the failed primary
recover_primary() {
    log_info "Recovering the failed primary..."

    if [ -z "$STOPPED_PRIMARY" ]; then
        log_warning "No stopped primary to recover"
        return
    fi

    # Find the current primary BEFORE starting the old primary (to avoid confusion)
    CURRENT_PRIMARY=$(get_current_primary "$STOPPED_PRIMARY")

    if [ -z "$CURRENT_PRIMARY" ]; then
        log_error "Cannot find current primary to replicate from"
        return 1
    fi

    log_info "Current primary is $CURRENT_PRIMARY"

    # Check if container exists and is stopped
    if docker ps -a --format '{{.Names}}' | grep -q "^${STOPPED_PRIMARY}$"; then
        if ! docker ps --format '{{.Names}}' | grep -q "^${STOPPED_PRIMARY}$"; then
            log_info "Starting existing $STOPPED_PRIMARY container..."

            # Try to start the container
            if ! docker start $STOPPED_PRIMARY 2>&1; then
                log_warning "Container start failed (Podman bind mount issue), recreating container..."

                # Remove the old container and recreate using docker-compose
                docker rm -f $STOPPED_PRIMARY 2>/dev/null || true

                # Detect compose command
                if command -v docker-compose &> /dev/null; then
                    COMPOSE_CMD="docker-compose"
                elif docker compose version &> /dev/null 2>&1; then
                    COMPOSE_CMD="docker compose"
                else
                    log_error "No compose command found"
                    return 1
                fi

                # Recreate the container without affecting dependencies
                $COMPOSE_CMD -f docker-compose.yml -f docker-compose.demo.yml up -d --no-deps $STOPPED_PRIMARY
            fi
        fi
    else
        log_warning "$STOPPED_PRIMARY container does not exist, skipping recovery"
        return
    fi

    log_info "Waiting for $STOPPED_PRIMARY to recover..."
    sleep 10

    # Reconfigure old primary as a replica of the new primary
    log_info "Recovering old primary as a replica..."

    log_info "Current primary is $CURRENT_PRIMARY, configuring $STOPPED_PRIMARY as replica..."

    # Get external port for stopped primary
    case $STOPPED_PRIMARY in
        mysql-primary) ext_port=3306 ;;
        mysql-replica-1) ext_port=3307 ;;
        mysql-replica-2) ext_port=3308 ;;
    esac

    mysql -h127.0.0.1 -P$ext_port -uroot -prootpassword -e "
        STOP SLAVE;
        SET GLOBAL read_only = ON;
        CHANGE REPLICATION SOURCE TO
            SOURCE_HOST='$CURRENT_PRIMARY',
            SOURCE_PORT=3306,
            SOURCE_USER='repl',
            SOURCE_PASSWORD='replpassword',
            SOURCE_AUTO_POSITION=1,
            GET_SOURCE_PUBLIC_KEY=1;
        START SLAVE;
    " 2>&1 | grep -v Warning || true

    # Re-discover in Orchestrator
    curl -s "http://localhost:3000/api/discover/${STOPPED_PRIMARY}/3306" > /dev/null

    log_success "Primary recovered and reconfigured as replica"
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
    register_instances

    echo ""
    log_info "Current cluster state:"
    get_cluster_state
    echo ""

    read -p "Press Enter to simulate primary failure..."
    simulate_primary_failure

    echo ""
    check_failover_status

    # Only do manual failover if auto-failover didn't occur
    if ! check_auto_failover; then
        echo ""
        read -p "Press Enter to execute manual failover..."
        manual_failover
    fi

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
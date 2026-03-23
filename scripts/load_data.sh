#!/bin/bash
#
# ClawSQL Load Generation Script
# This script uses SysBench to generate load on the MySQL cluster
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

# Configuration
# Use 127.0.0.1 instead of localhost to force TCP connection (localhost uses Unix socket)
# Port 3306 = direct MySQL, Port 6033 = via ProxySQL (read/write splitting)
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"  # Use 6033 for ProxySQL
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-rootpassword}"
MYSQL_DB="${MYSQL_DB:-sbtest}"

THREADS="${THREADS:-4}"
TABLES="${TABLES:-10}"
TABLE_SIZE="${TABLE_SIZE:-10000}"
TIME="${TIME:-60}"

# Check if sysbench is installed
check_sysbench() {
    if ! command -v sysbench &> /dev/null; then
        log_info "SysBench not found. Installing..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y sysbench
        elif command -v yum &> /dev/null; then
            sudo yum install -y sysbench
        else
            log_warning "Could not install SysBench automatically. Please install it manually."
            exit 1
        fi
    fi
    log_success "SysBench is available"
}

# Prepare database
prepare_database() {
    log_info "Preparing SysBench database..."

    # Create database
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS $MYSQL_DB" 2>/dev/null || true

    # Prepare tables
    sysbench oltp_read_write \
        --db-driver=mysql \
        --mysql-host="$MYSQL_HOST" \
        --mysql-port="$MYSQL_PORT" \
        --mysql-user="$MYSQL_USER" \
        --mysql-password="$MYSQL_PASSWORD" \
        --mysql-db="$MYSQL_DB" \
        --tables="$TABLES" \
        --table-size="$TABLE_SIZE" \
        prepare

    log_success "Database prepared with $TABLES tables of $TABLE_SIZE rows each"
}

# Run read/write test
run_read_write_test() {
    log_info "Running read/write test for $TIME seconds with $THREADS threads..."

    sysbench oltp_read_write \
        --db-driver=mysql \
        --mysql-host="$MYSQL_HOST" \
        --mysql-port="$MYSQL_PORT" \
        --mysql-user="$MYSQL_USER" \
        --mysql-password="$MYSQL_PASSWORD" \
        --mysql-db="$MYSQL_DB" \
        --tables="$TABLES" \
        --table-size="$TABLE_SIZE" \
        --threads="$THREADS" \
        --time="$TIME" \
        --report-interval=5 \
        run

    log_success "Read/write test completed"
}

# Run read-only test
run_read_only_test() {
    log_info "Running read-only test for $TIME seconds with $THREADS threads..."

    sysbench oltp_read_only \
        --db-driver=mysql \
        --mysql-host="$MYSQL_HOST" \
        --mysql-port="$MYSQL_PORT" \
        --mysql-user="$MYSQL_USER" \
        --mysql-password="$MYSQL_PASSWORD" \
        --mysql-db="$MYSQL_DB" \
        --tables="$TABLES" \
        --table-size="$TABLE_SIZE" \
        --threads="$THREADS" \
        --time="$TIME" \
        --report-interval=5 \
        run

    log_success "Read-only test completed"
}

# Run write-only test
run_write_only_test() {
    log_info "Running write-only test for $TIME seconds with $THREADS threads..."

    sysbench oltp_write_only \
        --db-driver=mysql \
        --mysql-host="$MYSQL_HOST" \
        --mysql-port="$MYSQL_PORT" \
        --mysql-user="$MYSQL_USER" \
        --mysql-password="$MYSQL_PASSWORD" \
        --mysql-db="$MYSQL_DB" \
        --tables="$TABLES" \
        --table-size="$TABLE_SIZE" \
        --threads="$THREADS" \
        --time="$TIME" \
        --report-interval=5 \
        run

    log_success "Write-only test completed"
}

# Cleanup
cleanup() {
    log_info "Cleaning up SysBench database..."

    sysbench oltp_read_write \
        --db-driver=mysql \
        --mysql-host="$MYSQL_HOST" \
        --mysql-port="$MYSQL_PORT" \
        --mysql-user="$MYSQL_USER" \
        --mysql-password="$MYSQL_PASSWORD" \
        --mysql-db="$MYSQL_DB" \
        --tables="$TABLES" \
        cleanup

    log_success "Cleanup completed"
}

# Print usage
print_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  prepare     Prepare the SysBench database"
    echo "  rw          Run read/write test"
    echo "  ro          Run read-only test"
    echo "  wo          Run write-only test"
    echo "  all         Run all tests"
    echo "  cleanup     Remove SysBench database"
    echo ""
    echo "Environment Variables:"
    echo "  MYSQL_HOST      MySQL host (default: 127.0.0.1)"
    echo "  MYSQL_PORT      MySQL port (default: 3306 direct, use 6033 for ProxySQL)"
    echo "  MYSQL_USER      MySQL user (default: root)"
    echo "  MYSQL_PASSWORD  MySQL password (default: rootpassword)"
    echo "  THREADS         Number of threads (default: 4)"
    echo "  TABLES          Number of tables (default: 10)"
    echo "  TABLE_SIZE      Rows per table (default: 10000)"
    echo "  TIME            Test duration in seconds (default: 60)"
}

# Main execution
main() {
    case "${1:-all}" in
        prepare)
            check_sysbench
            prepare_database
            ;;
        rw)
            check_sysbench
            run_read_write_test
            ;;
        ro)
            check_sysbench
            run_read_only_test
            ;;
        wo)
            check_sysbench
            run_write_only_test
            ;;
        all)
            check_sysbench
            prepare_database
            run_read_write_test
            run_read_only_test
            ;;
        cleanup)
            cleanup
            ;;
        help|--help|-h)
            print_usage
            ;;
        *)
            log_warning "Unknown command: $1"
            print_usage
            exit 1
            ;;
    esac
}

# Run main
main "$@"
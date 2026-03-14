#!/bin/bash
#
# ClawSQL Demo Environment Deployment Script
# This script sets up the complete demo environment
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Create necessary directories
create_directories() {
    log_info "Creating necessary directories..."

    mkdir -p "$PROJECT_DIR/docker/orchestrator"
    mkdir -p "$PROJECT_DIR/docker/prometheus"
    mkdir -p "$PROJECT_DIR/docker/grafana/dashboards"
    mkdir -p "$PROJECT_DIR/docker/grafana/provisioning/datasources"
    mkdir -p "$PROJECT_DIR/docker/init"

    log_success "Directories created"
}

# Create MySQL init scripts
create_init_scripts() {
    log_info "Creating MySQL initialization scripts..."

    # Primary init script
    cat > "$PROJECT_DIR/docker/init/primary.sql" << 'EOF'
-- Create replication user
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpassword';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';

-- Create monitor user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED BY 'monitorpassword';
GRANT REPLICATION CLIENT ON *.* TO 'monitor'@'%';
GRANT PROCESS ON *.* TO 'monitor'@'%';

-- Create ClawSQL user
CREATE USER IF NOT EXISTS 'clawsql'@'%' IDENTIFIED BY 'clawsqlpassword';
GRANT ALL PRIVILEGES ON clawsql.* TO 'clawsql'@'%';

FLUSH PRIVILEGES;

-- Create sample database
CREATE DATABASE IF NOT EXISTS clawsql;
CREATE DATABASE IF NOT EXISTS testdb;

USE testdb;
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (name, email) VALUES
    ('Alice', 'alice@example.com'),
    ('Bob', 'bob@example.com'),
    ('Charlie', 'charlie@example.com');
EOF

    # Replica init script
    cat > "$PROJECT_DIR/docker/init/replica.sql" << 'EOF'
-- Wait for primary to be ready
-- This will be executed after the replica starts

-- Create monitor user
CREATE USER IF NOT EXISTS 'monitor'@'%' IDENTIFIED BY 'monitorpassword';
GRANT REPLICATION CLIENT ON *.* TO 'monitor'@'%';
GRANT PROCESS ON *.* TO 'monitor'@'%';

FLUSH PRIVILEGES;
EOF

    log_success "MySQL init scripts created"
}

# Create ProxySQL config
create_proxysql_config() {
    log_info "Creating ProxySQL configuration..."

    cat > "$PROJECT_DIR/docker/proxysql/proxysql.cnf" << 'EOF'
datadir="/var/lib/proxysql"

admin_variables=
{
    admin_credentials="admin:admin;clawsql:clawsql"
    mysql_ifaces="0.0.0.0:6032"
    web_enabled=true
    web_port=6080
}

mysql_variables=
{
    threads=4
    max_connections=2048
    default_query_delay=0
    default_query_timeout=36000000
    have_compress=true
    poll_timeout=2000
    interfaces="0.0.0.0:6033"
    default_schema="information_schema"
    stacksize=1048576
    server_version="8.0.0"
    connect_timeout_server=3000
    monitor_username="monitor"
    monitor_password="monitorpassword"
    monitor_history=600000
    monitor_connect_interval=60000
    monitor_ping_interval=10000
    monitor_read_only_interval=1500
    monitor_read_only_timeout=500
    ping_interval_server_msec=120000
    ping_timeout_server=500
    commands_stats=true
    sessions_sort=true
    connect_retries_on_failure=10
}

mysql_servers=
{
    {
        address="mysql-primary"
        port=3306
        hostgroup_id=10
        max_connections=1000
    },
    {
        address="mysql-replica-1"
        port=3306
        hostgroup_id=20
        max_connections=1000
    },
    {
        address="mysql-replica-2"
        port=3306
        hostgroup_id=20
        max_connections=1000
    }
}

mysql_users=
{
    {
        username = "root"
        password = "rootpassword"
        default_hostgroup = 10
        max_connections = 1000
    },
    {
        username = "clawsql"
        password = "clawsqlpassword"
        default_hostgroup = 10
        max_connections = 1000
    }
}

mysql_query_rules=
{
    {
        rule_id=1
        active=1
        match_pattern="^SELECT"
        destination_hostgroup=20
        apply=1
    },
    {
        rule_id=100
        active=1
        match_pattern=".*"
        destination_hostgroup=10
        apply=1
    }
}
EOF

    log_success "ProxySQL config created"
}

# Create Grafana provisioning
create_grafana_provisioning() {
    log_info "Creating Grafana provisioning..."

    # Datasource
    cat > "$PROJECT_DIR/docker/grafana/provisioning/datasources/prometheus.yml" << 'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF

    log_success "Grafana provisioning created"
}

# Build and start services
start_services() {
    log_info "Building and starting services..."

    cd "$PROJECT_DIR"

    # Pull images
    docker-compose pull

    # Build ClawSQL image
    docker-compose build clawsql

    # Start all services
    docker-compose up -d

    log_success "Services started"
}

# Wait for services to be healthy
wait_for_services() {
    log_info "Waiting for services to be healthy..."

    # Wait for MySQL primary
    log_info "Waiting for MySQL primary..."
    until docker exec mysql-primary mysqladmin ping -h localhost -uroot -prootpassword --silent 2>/dev/null; do
        sleep 2
    done
    log_success "MySQL primary is ready"

    # Wait for ClawSQL API
    log_info "Waiting for ClawSQL API..."
    until curl -s http://localhost:8080/health > /dev/null 2>&1; do
        sleep 2
    done
    log_success "ClawSQL API is ready"

    # Setup replication
    setup_replication
}

# Setup MySQL replication
setup_replication() {
    log_info "Setting up MySQL replication..."

    # Get primary binlog position
    BINLOG_INFO=$(docker exec mysql-primary mysql -uroot -prootpassword -e "SHOW MASTER STATUS\G" 2>/dev/null | grep -E "File:|Position:")
    BINLOG_FILE=$(echo "$BINLOG_INFO" | grep "File:" | awk '{print $2}')
    BINLOG_POS=$(echo "$BINLOG_INFO" | grep "Position:" | awk '{print $2}')

    log_info "Primary binlog: $BINLOG_FILE, Position: $BINLOG_POS"

    # Configure replica 1
    docker exec mysql-replica-1 mysql -uroot -prootpassword -e "
        STOP SLAVE;
        CHANGE MASTER TO
            MASTER_HOST='mysql-primary',
            MASTER_PORT=3306,
            MASTER_USER='repl',
            MASTER_PASSWORD='replpassword',
            MASTER_AUTO_POSITION=1;
        START SLAVE;
    " 2>/dev/null || true

    # Configure replica 2
    docker exec mysql-replica-2 mysql -uroot -prootpassword -e "
        STOP SLAVE;
        CHANGE MASTER TO
            MASTER_HOST='mysql-primary',
            MASTER_PORT=3306,
            MASTER_USER='repl',
            MASTER_PASSWORD='replpassword',
            MASTER_AUTO_POSITION=1;
        START SLAVE;
    " 2>/dev/null || true

    log_success "MySQL replication configured"
}

# Print service URLs
print_urls() {
    echo ""
    echo "=========================================="
    echo "  ClawSQL Demo Environment Ready!"
    echo "=========================================="
    echo ""
    echo "Services:"
    echo "  - ClawSQL API:    http://localhost:8080"
    echo "  - API Docs:       http://localhost:8080/docs"
    echo "  - Grafana:        http://localhost:3001 (admin/admin)"
    echo "  - Prometheus:     http://localhost:9090"
    echo "  - Orchestrator:   http://localhost:3000"
    echo ""
    echo "MySQL Cluster:"
    echo "  - Primary:        localhost:3306 (root/rootpassword)"
    echo "  - Replica 1:      localhost:3307"
    echo "  - Replica 2:      localhost:3308"
    echo ""
    echo "ProxySQL:"
    echo "  - MySQL Traffic:  localhost:6033"
    echo "  - Admin:          localhost:6032 (admin/admin)"
    echo ""
    echo "To stop the demo:"
    echo "  docker-compose down"
    echo ""
    echo "To view logs:"
    echo "  docker-compose logs -f clawsql"
    echo ""
}

# Main execution
main() {
    log_info "Starting ClawSQL Demo Environment Setup"
    echo ""

    check_prerequisites
    create_directories
    create_init_scripts
    create_proxysql_config
    create_grafana_provisioning
    start_services
    wait_for_services
    print_urls
}

# Run main
main "$@"
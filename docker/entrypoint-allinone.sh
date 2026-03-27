#!/bin/bash
set -e

# ClawSQL All-in-One Entrypoint
# Starts all services in the correct order

echo "Starting ClawSQL All-in-One..."

# Create required directories
mkdir -p /var/log/supervisor /var/log/grafana /var/lib/grafana /var/lib/prometheus /var/lib/proxysql

# Generate default secrets if not provided
: ${API_TOKEN_SECRET:=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1)}
: ${MYSQL_ADMIN_PASSWORD:=clawsql_password}
: ${MYSQL_REPLICATION_PASSWORD:=repl_password}

export API_TOKEN_SECRET MYSQL_ADMIN_PASSWORD MYSQL_REPLICATION_PASSWORD

# Wait for dependent services if external
wait_for_service() {
    local host=$1
    local port=$2
    local name=$3
    local max_wait=30
    local count=0

    if [ -n "$host" ] && [ "$host" != "localhost" ] && [ "$host" != "127.0.0.1" ]; then
        echo "Waiting for $name at $host:$port..."
        while ! nc -z "$host" "$port" 2>/dev/null; do
            count=$((count + 1))
            if [ $count -ge $max_wait ]; then
                echo "Warning: $name not available after ${max_wait}s, continuing..."
                return 1
            fi
            sleep 1
        done
        echo "$name is ready"
    fi
}

# Wait for external MySQL if configured
if [ -n "$METADATA_DB_HOST" ]; then
    wait_for_service "$METADATA_DB_HOST" "${METADATA_DB_PORT:-3306}" "Metadata MySQL"
fi

# Update Prometheus config with correct targets
if [ -f /etc/prometheus.yml ]; then
    sed -i "s/localhost:8080/${API_HOST:-localhost}:${API_PORT:-8080}/g" /etc/prometheus.yml
fi

# Update Orchestrator config with database settings
if [ -f /etc/orchestrator.conf.json ]; then
    if [ -n "$METADATA_DB_HOST" ]; then
        sed -i "s/\"Host\":\"metadata-mysql\"/\"Host\":\"${METADATA_DB_HOST}\"/g" /etc/orchestrator.conf.json
    fi
fi

echo "Starting services via supervisord..."
exec /usr/bin/supervisord -c /etc/supervisord.conf
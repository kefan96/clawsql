#!/bin/bash
# ClawSQL ProxySQL Entrypoint
# Starts ProxySQL and configures MySQL servers/users

# Remove stale PID file if exists
rm -f /var/lib/proxysql/proxysql.pid

# Function to initialize ProxySQL
init_proxysql() {
    echo "Running ProxySQL initialization..."
    mysql -u admin -padmin -h 127.0.0.1 -P 6032 < /docker-entrypoint-initdb.d/init.sql 2>/dev/null
    echo "ProxySQL initialization complete"
}

# Start ProxySQL in foreground but run init in background first
if [ -f /docker-entrypoint-initdb.d/init.sql ]; then
    # Start ProxySQL temporarily for init
    proxysql --config /etc/proxysql.cnf &
    PROXYSQL_PID=$!

    # Wait for ProxySQL to be ready
    echo "Waiting for ProxySQL to start..."
    for i in {1..30}; do
        if mysql -u admin -padmin -h 127.0.0.1 -P 6032 -e "SELECT 1" &>/dev/null; then
            echo "ProxySQL is ready"
            break
        fi
        sleep 1
    done

    # Run initialization
    init_proxysql

    # Stop ProxySQL
    kill $PROXYSQL_PID 2>/dev/null
    wait $PROXYSQL_PID 2>/dev/null
    rm -f /var/lib/proxysql/proxysql.pid

    echo "Restarting ProxySQL..."
fi

# Start ProxySQL in foreground
exec proxysql --config /etc/proxysql.cnf
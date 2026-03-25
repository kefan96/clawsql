#!/bin/bash
# ClawSQL ProxySQL Entrypoint

# Remove stale PID file if exists
rm -f /var/lib/proxysql/proxysql.pid

# Start ProxySQL in foreground
exec proxysql --config /etc/proxysql.cnf --foreground
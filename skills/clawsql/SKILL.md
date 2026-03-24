---
name: clawsql
description: "MySQL cluster management for ClawSQL: topology discovery, health monitoring, failover operations, and query execution. Use when: (1) checking MySQL cluster status, (2) viewing topology or instance health, (3) performing failover operations, (4) executing SQL queries, (5) reviewing cluster alerts. Integrates with Orchestrator for topology, ProxySQL for routing, and Prometheus for metrics."
metadata:
  openclaw:
    emoji: "🦞"
    requires:
      bins: ["clawsql"]
      env:
        - ORCHESTRATOR_URL
        - PROXYSQL_HOST
    install:
      - id: npm
        kind: npm
        package: clawsql
        bins: ["clawsql"]
        label: Install ClawSQL CLI
---

# ClawSQL Skill

MySQL high-availability cluster management through natural language.

## When to Use

✅ **USE this skill when:**

- Checking MySQL cluster topology or instance status
- Monitoring replication lag or cluster health
- Performing or reviewing failover operations
- Executing diagnostic SQL queries
- Reviewing alerts from monitoring systems
- Scheduling periodic health checks via cron

❌ **DON'T use this skill when:**

- Local MySQL client operations → use `mysql` CLI directly
- Schema migrations → use dedicated migration tools
- Backup/restore operations → use `mysqldump` or backup tools

## Setup

```bash
# Install ClawSQL
npm install -g clawsql

# Verify configuration
clawsql -c "/config"
```

Required environment variables:

- `ORCHESTRATOR_URL` - Orchestrator API endpoint (e.g., http://orchestrator:3000)
- `PROXYSQL_HOST` - ProxySQL admin host
- `MYSQL_MONITOR_USER` / `MYSQL_MONITOR_PASSWORD` - MySQL credentials

## Common Commands

### Topology & Status

```bash
# View cluster topology
clawsql -c "/topology"

# Check instance health
clawsql -c "/health"

# List all clusters
clawsql -c "/clusters"

# Show configuration
clawsql -c "/config"
```

### Failover Operations

```bash
# Check failover status
clawsql -c "/failover status"

# View failover history
clawsql -c "/failover history"

# Execute manual failover (requires confirmation)
clawsql -c "/failover execute --cluster <name> --candidate <host:port>"
```

### SQL Queries

```bash
# Execute diagnostic queries
clawsql -c "/sql SHOW PROCESSLIST"
clawsql -c "/sql SELECT * FROM information_schema.innodb_trx"
```

## Natural Language Queries

When the OpenClaw gateway is running, you can ask questions naturally:

- "What's the status of my MySQL cluster?"
- "Show me the replication lag for all replicas"
- "Is failover enabled? What's the configuration?"
- "Which instances are currently offline?"
- "Run a health check and alert me if there are issues"

## Cron Monitoring

Set up periodic health checks via OpenClaw cron:

```bash
# Schedule hourly health check
openclaw cron add --name "clawsql:health-check" --schedule "0 * * * *" \
  --prompt "Check MySQL cluster health using clawsql skill. Alert if any instances are down or lag is high."

# Schedule daily topology review
openclaw cron add --name "clawsql:topology-review" --schedule "0 9 * * *" \
  --prompt "Review the MySQL cluster topology and report any concerns."
```

## Alerting via Channels

ClawSQL can send alerts through configured OpenClaw channels:

```bash
# Send alert to WhatsApp/Telegram/Slack
openclaw message send --to <channel> --message "⚠️ MySQL failover triggered: cluster-main promoted replica-2"
```

## Memory Integration

ClawSQL can persist cluster knowledge to OpenClaw memory:

- `memory/clawsql-cluster-state.md` - Current cluster topology snapshot
- `memory/clawsql-failover-history.md` - Failover event log
- `MEMORY.md` - Long-term preferences (notification channels, check schedules)

## Architecture

ClawSQL integrates with:

| Component      | Purpose                           |
|----------------|-----------------------------------|
| Orchestrator   | Topology discovery, failover      |
| ProxySQL       | Query routing, load balancing     |
| Prometheus     | Metrics collection, alerting      |
| MySQL          | Database instances being managed   |

## Tool Commands

The AI can invoke these ClawSQL operations:

### get_topology
Get MySQL cluster topology showing primary and replicas.

```json
{ "clusterName": "optional-cluster-name" }
```

### get_instance_health
Get health status of MySQL instances.

```json
{ "host": "optional-specific-host" }
```

### execute_sql
Execute a SQL query (SELECT/SHOW only for safety).

```json
{ "query": "SHOW PROCESSLIST" }
```

### get_failover_status
Get failover configuration and recent history.

### get_clusters
List all discovered MySQL clusters.

## Safety Notes

- Destructive SQL (DROP, DELETE, UPDATE) is blocked - use MySQL client directly
- Manual failover requires explicit confirmation
- Auto-failover must be enabled in Orchestrator configuration
- Always verify cluster health before and after operations
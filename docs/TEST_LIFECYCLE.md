# ClawSQL Full Lifecycle Test Process

This document describes the complete test process for validating ClawSQL after changes.

## Prerequisites

- Docker or Podman installed and running
- Node.js 18+ installed
- NPM_TOKEN configured (for publishing)

## Test Steps

### 1. Installation Test

```bash
# Install from npm
npm install -g clawsql

# Verify installation
which clawsql
clawsql --version
```

### 2. Platform Start Test

```bash
# Start with demo MySQL cluster
clawsql -c "/start --demo"

# Verify containers started
docker ps
```

**Expected**: All services start (clawsql, orchestrator, proxysql, prometheus, grafana, mysql-primary, mysql-replica-1, mysql-replica-2)

### 3. Status Check

```bash
clawsql -c "/status"
```

**Expected**: All containers show as running, all services healthy

### 4. Configuration Test

```bash
clawsql -c "/config set mysql.admin_password rootpassword"
clawsql -c "/config show"
```

### 5. Instance Registration

```bash
# Register MySQL instances (may need password fix first - see Known Issues)
clawsql -c "/instances register --host mysql-primary --port 3306"
clawsql -c "/instances register --host mysql-replica-1 --port 3306"
clawsql -c "/instances register --host mysql-replica-2 --port 3306"
clawsql -c "/instances list"
```

**Expected**: 3 instances registered

### 6. Cluster Management

```bash
clawsql -c "/clusters list"
clawsql -c "/topology"
clawsql -c "/clusters sync"
clawsql -c "/topology"
```

**Expected**: Cluster shows with primary and 2 replicas, ProxySQL shows all servers ONLINE

### 7. Failover Test

```bash
clawsql -c "/failover status"
clawsql -c "/failover switchover mysql-primary"
clawsql -c "/topology"
clawsql -c "/clusters sync"
```

**Expected**: Switchover completes, new primary elected, replicas follow

### 8. Doctor/Diagnostics

```bash
clawsql -c "/doctor"
```

**Expected**: No errors, minimal warnings

### 9. Stop and Cleanup

```bash
clawsql -c "/stop"
clawsql -c "/cleanup --force"
```

**Expected**: All containers removed, volumes cleaned

### 10. Development Build Test (for local changes)

```bash
# Uninstall npm version
npm uninstall -g clawsql

# Build and link local
npm run build
npm link

# Run tests
npm test

# Clear extracted files before testing
rm -rf ~/.clawsql/docker

# Re-run lifecycle tests
```

## Known Issues & Workarounds

### MySQL Authentication (MySQL 8.0)

MySQL 8.0 uses `caching_sha2_password` by default. Orchestrator requires `mysql_native_password`.

**Fix**: If auth errors occur, run on each MySQL instance:
```bash
docker exec mysql-primary mysql -uroot -prootpassword -e "ALTER USER 'clawsql'@'%' IDENTIFIED WITH mysql_native_password BY 'clawsql_password'; FLUSH PRIVILEGES;"
```

### Network Conflicts

If `docker_clawsql-network` already exists:
```bash
docker network rm -f clawsql_clawsql-network
# or
docker network rm -f docker_clawsql-network
```

### Re-extraction After Code Changes

After modifying docker-files.ts or related code, clear extracted files:
```bash
rm -rf ~/.clawsql/docker
```

## Publishing New Version

```bash
# 1. Build
npm run build

# 2. Run tests
npm test

# 3. Bump version
npm version patch --no-git-tag-version

# 4. Publish
npm publish

# 5. Commit version bump
git add package.json
git commit -m "chore: bump version to x.x.x"
git push
```

## Quick Test Script

Single command to run all tests:
```bash
clawsql -c "/start --demo" && \
clawsql -c "/status" && \
clawsql -c "/instances register --host mysql-primary --port 3306" && \
clawsql -c "/instances register --host mysql-replica-1 --port 3306" && \
clawsql -c "/instances register --host mysql-replica-2 --port 3306" && \
clawsql -c "/clusters sync" && \
clawsql -c "/topology" && \
clawsql -c "/failover switchover mysql-primary" && \
clawsql -c "/clusters sync" && \
clawsql -c "/topology" && \
clawsql -c "/stop" && \
clawsql -c "/cleanup --force"
```
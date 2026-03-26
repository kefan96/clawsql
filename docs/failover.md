# ClawSQL Failover Documentation

## Overview

The ClawSQL failover system provides high availability for MySQL clusters by automating the process of promoting replicas to primary when failures occur. The system supports both planned and unplanned primary changes.

### Key Terminology

| Term | Definition |
|------|------------|
| **Switchover** | A planned operation when the primary is healthy. Promotes a replica to primary and starts replication on the old primary. |
| **Failover** | An emergency operation when the primary is down. Promotes a replica automatically without user intervention. |
| **Manual Failover** | User-initiated failover when the primary is down. The user selects which replica to promote. |
| **Recovery** | The process of reintegrating a failed primary back into the cluster as a replica after failover. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Failover Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   CLI Command   │    │   REST API      │    │  Auto-Trigger   │         │
│  │ /failover ...   │    │ POST /failover  │    │ FailureEvent    │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┼──────────────────────┘                   │
│                                  ▼                                          │
│                    ┌─────────────────────────┐                              │
│                    │    FailoverExecutor     │                              │
│                    │  (Main Orchestrator)    │                              │
│                    └────────────┬────────────┘                              │
│                                 │                                           │
│           ┌─────────────────────┼─────────────────────┐                     │
│           │                     │                     │                     │
│           ▼                     ▼                     ▼                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ OperationRunner │  │ RecoveryManager │  │ OperationBuilder│             │
│  │ (Execute Flow)  │  │ (Track Recovery)│  │ (Create Ops)    │             │
│  └────────┬────────┘  └─────────────────┘  └─────────────────┘             │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │InstancePromoter │  │CandidateSelector│  │ ProxySQLManager │             │
│  │(Orchestrator)   │  │(Select Best)    │  │(Update Routing) │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Responsibility |
|------|----------------|
| `src/core/failover/executor.ts` | Main orchestrator for all failover operations |
| `src/core/failover/operation-runner.ts` | Template method pattern for execution flow |
| `src/core/failover/promoter.ts` | Handles promotion via Orchestrator API |
| `src/core/failover/candidate-selector.ts` | Selects the best replica for promotion |
| `src/core/failover/recovery-manager.ts` | Tracks and recovers old primaries |
| `src/core/failover/operation-builder.ts` | Factory for creating failover operations |
| `src/core/failover/types.ts` | Type definitions for failover operations |
| `src/cli/commands/failover.ts` | CLI command implementation |
| `src/api/routes/failover.ts` | REST API routes |

## Core Components

### FailoverExecutor

The main entry point for all failover operations. It coordinates between other components and maintains operation history.

```typescript
class FailoverExecutor {
  // Execute automatic failover (triggered by failure detection)
  async executeAutomaticFailover(failureEvent: FailureEvent, cluster: MySQLCluster): Promise<FailoverOperation>

  // Execute switchover (planned, primary is healthy)
  async executeSwitchover(cluster: MySQLCluster, targetPrimaryId?: string, reason?: string): Promise<FailoverOperation>

  // Execute manual failover (primary is down, user selects replica)
  async executeManualFailover(cluster: MySQLCluster, targetPrimaryId?: string, reason?: string): Promise<FailoverOperation>

  // Recovery management
  getPendingRecoveries(): PendingRecovery[]
  async recoverInstance(instanceId: string): Promise<RecoveryResult>
  async checkAndRecoverAll(): Promise<BatchRecoveryResult>
}
```

**Location:** `src/core/failover/executor.ts`

### OperationRunner

Implements the Template Method Pattern for failover execution. Defines the skeleton of the operation while allowing customization through hooks.

```typescript
class OperationRunner {
  // Register pre/post execution hooks
  registerPreHook(hook: FailoverHook): void
  registerPostHook(hook: FailoverHook): void

  // Execute the operation (template method)
  async execute(operation: FailoverOperation, cluster: MySQLCluster, isSwitchover: boolean): Promise<FailoverOperation>
}
```

**Execution Steps:**
1. Run pre-execution hooks
2. Select candidate for promotion
3. Promote instance via Orchestrator
4. Reconfigure other replicas
5. Update ProxySQL routing
6. Run post-execution hooks

**Location:** `src/core/failover/operation-runner.ts`

### InstancePromoter

Handles the actual promotion of replicas to primary by calling the Orchestrator API.

```typescript
class InstancePromoter {
  async promote(instance: MySQLInstance, cluster: MySQLCluster, isSwitchover: boolean): Promise<PromotionResult>
}
```

**Orchestrator API Calls:**
- **Switchover:** `gracefulMasterTakeover(clusterAlias, host, port)` - Graceful promotion when primary is healthy
- **Failover:** `forceMasterFailover(clusterAlias)` - Force promotion when primary is down

**Location:** `src/core/failover/promoter.ts`

### CandidateSelector

Selects the best replica to promote based on configurable strategies.

```typescript
class CandidateSelector {
  select(cluster: MySQLCluster): MySQLInstance | null
  static findReplica(cluster: MySQLCluster, targetId: string): MySQLInstance | undefined
}
```

**Default Strategy (LowestLagStrategy):**
- Filters healthy replicas (state = ONLINE)
- Sorts by replication lag (prefer lowest)
- Returns the best candidate

**Location:** `src/core/failover/candidate-selector.ts`

### RecoveryManager

Tracks instances that need recovery after failover and handles the recovery process.

```typescript
class RecoveryManager {
  queueForRecovery(recovery: PendingRecovery): void
  getPending(): PendingRecovery[]
  isPending(instanceId: string): boolean
  async recover(instanceId: string): Promise<RecoveryResult>
  async recoverAll(): Promise<BatchRecoveryResult>
  clear(instanceId: string): boolean
}
```

**Recovery Process:**
1. Verify instance is back online
2. Start replication to new primary
3. Verify replication is running (IO and SQL threads)
4. Remove from pending list

**Location:** `src/core/failover/recovery-manager.ts`

### OperationBuilder

Factory class for creating failover operations with a fluent interface.

```typescript
// Create a switchover operation
const operation = OperationBuilder.create()
  .forCluster(cluster)
  .asManual('Planned maintenance')
  .withTarget(targetInstance)
  .asIdle()
  .build();
```

**Location:** `src/core/failover/operation-builder.ts`

## Operation Types

### Switchover

A planned operation for changing the primary when the current primary is healthy.

**Characteristics:**
- Primary must be ONLINE
- Uses `gracefulMasterTakeover` Orchestrator API
- Old primary automatically becomes a replica
- Replication started on demoted primary
- No data loss guaranteed

**Validation:**
```typescript
// Validates primary is healthy
if (!cluster.primary || !isOnline(cluster.primary)) {
  return createFailedOperation(cluster,
    'Switchover requires a healthy primary. Use failover for unhealthy primary.',
    reason
  );
}
```

**CLI Usage:**
```bash
# Auto-select best replica
/failover switchover mysql-primary

# Promote specific replica
/failover switchover mysql-primary mysql-replica-1:3306
```

### Manual Failover

User-initiated emergency failover when the primary is down.

**Characteristics:**
- Primary must NOT be ONLINE (or not exist)
- Uses `forceMasterFailover` Orchestrator API
- Old primary queued for recovery
- Best candidate auto-selected if not specified

**Validation:**
```typescript
// Validates primary is NOT healthy
if (cluster.primary && isOnline(cluster.primary)) {
  return createFailedOperation(cluster,
    'Primary is healthy. Use switchover for planned primary change.',
    reason
  );
}
```

**CLI Usage:**
```bash
# Auto-select best replica
/failover failover mysql-primary

# Promote specific replica
/failover failover mysql-primary mysql-replica-2:3306
```

### Automatic Failover

System-triggered failover when a failure is detected by monitoring.

**Characteristics:**
- Triggered by `FailureEvent`
- Requires `AUTO_FAILOVER_ENABLED=true`
- Same process as manual failover
- Triggered by eventId for audit trail

**Trigger Conditions:**
```typescript
// From FailureType enum
enum FailureType {
  PRIMARY_UNREACHABLE = 'primary_unreachable',
  PRIMARY_NOT_WRITING = 'primary_not_writing',
  REPLICATION_STOPPED = 'replication_stopped',
  REPLICATION_LAG_HIGH = 'replication_lag_high',
  DISK_FULL = 'disk_full',
  MEMORY_EXHAUSTED = 'memory_exhausted',
}
```

## Orchestrator Health Checks and Failure Detection

Orchestrator is responsible for continuously monitoring MySQL instances and detecting failures. Understanding how Orchestrator performs health checks is essential for configuring failover behavior.

### Health Check Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Orchestrator Health Check Flow                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────┐      │
│   │                    Orchestrator Service                           │      │
│   │                                                                   │      │
│   │  ┌─────────────────┐      ┌─────────────────┐                   │      │
│   │  │ Discovery Poller│      │ Replication     │                   │      │
│   │  │ (every 5s)      │      │ Analyzer        │                   │      │
│   │  └────────┬────────┘      └────────┬────────┘                   │      │
│   │           │                        │                             │      │
│   │           └────────────┬───────────┘                             │      │
│   │                        ▼                                          │      │
│   │           ┌─────────────────────────┐                            │      │
│   │           │  Instance Health State  │                            │      │
│   │           │  - IsLastCheckValid     │                            │      │
│   │           │  - IsUpToDate           │                            │      │
│   │           │  - ReplicationLag       │                            │      │
│   │           └────────────┬────────────┘                            │      │
│   │                        │                                          │      │
│   └────────────────────────┼──────────────────────────────────────────┘      │
│                            │                                                 │
│                            ▼                                                 │
│               ┌─────────────────────────┐                                   │
│               │  Failure Detection      │                                   │
│               │  (blocking period: 1m)  │                                   │
│               └────────────┬────────────┘                                   │
│                            │                                                 │
│              ┌─────────────┴─────────────┐                                  │
│              ▼                           ▼                                  │
│   ┌────────────────────┐    ┌────────────────────┐                         │
│   │ Primary Unreachable│    │ Replication Issues │                         │
│   │ (no response)      │    │ (lag, stopped)     │                         │
│   └─────────┬──────────┘    └─────────┬──────────┘                         │
│             │                         │                                     │
│             └───────────┬─────────────┘                                     │
│                         ▼                                                   │
│            ┌────────────────────────┐                                       │
│            │ Auto Master Failover   │                                       │
│            │ (if enabled)           │                                       │
│            └────────────────────────┘                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Polling Mechanism

Orchestrator continuously polls all registered MySQL instances to track their health:

| Configuration | Default | Description |
|--------------|---------|-------------|
| `MySQLDiscoveryPollSeconds` | 5 | Interval between health polls for healthy instances |
| `MySQLFailedDiscoveryPollSeconds` | 5 | Interval for instances that failed previous checks |
| `MySQLConnectTimeoutSeconds` | 5 | Connection timeout for each health check |
| `MySQLDiscoveryMaxConcurrency` | 100 | Maximum concurrent discovery goroutines |

### Health Check Indicators

Orchestrator tracks instance health through several indicators:

#### IsLastCheckValid

The primary indicator of instance health. Set to `true` when the last health check succeeded.

```typescript
// How ClawSQL interprets Orchestrator health status
if (data.IsLastCheckValid === true) {
  state = InstanceState.ONLINE;
}
```

**Check Process:**
1. Orchestrator connects to MySQL on configured credentials
2. Executes basic queries (`SELECT 1`, `SHOW SLAVE STATUS`, etc.)
3. If all queries succeed, `IsLastCheckValid = true`
4. If any query fails, `IsLastCheckValid = false`

#### IsUpToDate

Indicates whether Orchestrator has recent data for the instance. An instance can be "up to date" even if `IsLastCheckValid = false` (Orchestrator knows about it, but the last check failed).

**Difference:**
- `IsLastCheckValid = false` → Instance is unreachable or unhealthy
- `IsUpToDate = false` → Orchestrator hasn't polled recently (stale data)

#### Replication Lag

Orchestrator monitors replication lag using:

```sql
-- Configured in orchestrator.conf.json
SELECT ABS(TIMESTAMPDIFF(SECOND, NOW(), ts)) FROM replication.heartbeat
```

Or the standard `SHOW SLAVE STATUS` output (`Seconds_Behind_Master`).

**Threshold:** `ReasonableReplicationLagSeconds = 10`
- Instances with lag above this threshold may be deprioritized for promotion

### Failure Detection Process

When Orchestrator detects a failure, it follows a specific process:

#### 1. Failure Identification

Orchestrator identifies several failure types:

| Failure Type | Detection Method |
|--------------|------------------|
| **Primary Unreachable** | `IsLastCheckValid = false` for primary |
| **Primary Not Writing** | Cannot execute write queries |
| **Replication Stopped** | `Slave_IO_Running = No` or `Slave_SQL_Running = No` |
| **Replication Lag High** | `Seconds_Behind_Master > ReasonableReplicationLagSeconds` |

#### 2. Blocking Period

Orchestrator uses blocking periods to prevent flapping:

- **Failure Detection Block** (`FailureDetectionPeriodBlockMinutes = 1`): Minimum time between failure detections for the same cluster
- **Recovery Block** (`RecoveryPeriodBlockMinutes = 1`): Minimum time between recovery attempts

#### 3. Automatic Failover Trigger

When `AutoMasterFailover = true`, Orchestrator automatically triggers failover:

```
Detection Flow:
1. Primary becomes unreachable (IsLastCheckValid = false)
2. Orchestrator waits for blocking period
3. Reconfirms failure (multiple checks)
4. Triggers automatic failover
5. Promotes best candidate replica
6. Reconfigures other replicas
```

### Replication Analysis API

Orchestrator provides real-time replication analysis via `/api/replication-analysis`:

```typescript
// Get replication issues from Orchestrator
const analysis = await orchestrator.getReplicationAnalysis();
```

**Analysis includes:**
- Instances with broken replication
- Instances with high lag
- Topology issues (orphaned replicas, etc.)
- Recommended actions

### Configuring Health Check Behavior

#### Orchestrator Configuration File

Key settings in `docker/orchestrator/orchestrator.conf.json`:

```json
{
  "MySQLDiscoveryPollSeconds": 5,
  "MySQLFailedDiscoveryPollSeconds": 5,
  "MySQLConnectTimeoutSeconds": 5,
  "ReasonableReplicationLagSeconds": 10,
  "FailureDetectionPeriodBlockMinutes": 1,
  "RecoveryPeriodBlockMinutes": 1,
  "AutoMasterFailover": true,
  "RecoverMasterClusterFilters": ["*"],
  "RecoverIntermediateMasterClusterFilters": ["*"]
}
```

#### Tuning for Your Environment

| Scenario | Recommended Settings |
|----------|---------------------|
| **High-traffic production** | Increase poll interval (10-15s) to reduce load |
| **Sensitive failover** | Decrease timeout (3s) for faster detection |
| **Flapping prevention** | Increase blocking periods (5-10 min) |
| **Development/testing** | Default values work well |

#### ClawSQL Configuration

ClawSQL's failover settings complement Orchestrator:

```bash
# ClawSQL failover settings
AUTO_FAILOVER_ENABLED=true
FAILOVER_CONFIRMATION_CHECKS=3
FAILOVER_TIMEOUT_SECONDS=30
```

**How they work together:**
1. Orchestrator detects failure and may trigger automatic failover
2. ClawSQL receives `FailureEvent` (if using ClawSQL's auto-failover)
3. ClawSQL's `confirmationChecks` determines how many confirmations before acting
4. ClawSQL coordinates with Orchestrator for promotion

### Health Check Endpoints

#### Check Orchestrator Health

```bash
# Via CLI
/status

# Via API
GET /api/health  # Orchestrator endpoint
```

#### Check Instance Health via ClawSQL

```bash
# View cluster topology with health status
/clusters topology --name mysql-primary
```

**Output shows:**
- Primary state (online/offline)
- Replica states
- Replication lag for each instance

### Monitoring Health Checks

Orchestrator logs all health check activity:

```bash
# View Orchestrator logs
docker logs orchestrator

# Look for health check entries
# Example: "instance mysql-primary:3306 is valid"
# Example: "instance mysql-primary:3306 is invalid: connection refused"
```

**Key log patterns:**
- `instance X is valid` → Health check passed
- `instance X is invalid: <reason>` → Health check failed
- `Replication analysis` → Periodic analysis output

## Failover States

```
┌───────────┐     ┌───────────┐     ┌──────────────────┐     ┌───────────┐
│   IDLE    │────▶│ DETECTING │────▶│CANDIDATE_SELECTION│────▶│ PROMOTING │
└───────────┘     └───────────┘     └──────────────────┘     └─────┬─────┘
                                                                  │
┌───────────┐     ┌───────────┐     ┌──────────────────┐           │
│  FAILED   │◀────│  FAILED   │◀────│  RECONFIGURING   │◀──────────┘
└───────────┘     └───────────┘     └──────────────────┘
                        │
                        ▼
                  ┌───────────┐
                  │ COMPLETED │
                  └───────────┘
```

| State | Description |
|-------|-------------|
| `IDLE` | Operation created, waiting to execute |
| `DETECTING` | Running pre-execution checks |
| `CANDIDATE_SELECTION` | Selecting best replica to promote |
| `PROMOTING` | Executing promotion via Orchestrator |
| `RECONFIGURING` | Reconfiguring replicas and updating routing |
| `COMPLETED` | Operation finished successfully |
| `FAILED` | Operation failed with error |

**Type Definition:**
```typescript
enum FailoverState {
  IDLE = 'idle',
  DETECTING = 'detecting',
  CANDIDATE_SELECTION = 'candidate_selection',
  PROMOTING = 'promoting',
  RECONFIGURING = 'reconfiguring',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
```

## Operation Flow

### Switchover Flow

```
1. Pre-execution hooks
   │
2. Select candidate for promotion
   ├── Auto-select: lowest lag, healthy replica
   └── Or use specified target
   │
3. Promote instance via Orchestrator
   └── gracefulMasterTakeover(clusterAlias, host, port)
   │
4. Start replication on demoted primary
   └── Old primary now follows new primary
   │
5. Reconfigure other replicas
   └── Redirect to follow new primary
   │
6. Update ProxySQL routing
   ├── New primary → writer hostgroup (10)
   └── Old primary → reader hostgroup (20)
   │
7. Post-execution hooks
   │
8. Operation completed
```

### Failover Flow

```
1. Pre-execution hooks
   │
2. Select candidate for promotion
   ├── Auto-select: lowest lag, healthy replica
   └── Or use specified target
   │
3. Promote instance via Orchestrator
   └── forceMasterFailover(clusterAlias)
   │
4. Queue old primary for recovery
   └── Tracked in RecoveryManager
   │
5. Reconfigure other replicas
   └── Redirect to follow new primary
   │
6. Update ProxySQL routing
   └── New primary → writer hostgroup (10)
   │
7. Post-execution hooks
   │
8. Operation completed
```

## Recovery Process

After a failover, the old primary is tracked for recovery:

### Pending Recovery Record

```typescript
interface PendingRecovery {
  clusterId: string;        // Cluster identifier
  instanceId: string;       // Old primary ID (host:port)
  host: string;             // Hostname
  port: number;             // Port
  newPrimaryId: string;     // New primary to follow
  failedAt: Date;           // When the failover occurred
  recoveredAt?: Date;       // When recovery completed
}
```

### Recovery Steps

1. **Verify instance is online**
   - Check instance state via Orchestrator
   - Must be `InstanceState.ONLINE`

2. **Start replication**
   - Configure replica to follow new primary
   - Use configured replication credentials

3. **Verify replication status**
   - Check IO thread is running
   - Check SQL thread is running
   - Wait 2 seconds for stabilization

4. **Complete recovery**
   - Remove from pending list
   - Log recovery timestamp

### CLI Commands

```bash
# List instances pending recovery
/failover recover list

# Recover a specific instance
/failover recover mysql-old-primary:3306

# Recover all pending instances
/failover recover --all
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_FAILOVER_ENABLED` | `true` | Enable/disable automatic failover |
| `FAILOVER_TIMEOUT_SECONDS` | `30` | Maximum time for failover operation |
| `FAILOVER_MIN_REPLICAS` | `2` | Minimum replicas required for failover |
| `FAILOVER_CONFIRMATION_CHECKS` | `3` | Number of confirmation checks before triggering |

### Settings Schema

```typescript
const FailoverSettingsSchema = z.object({
  autoFailoverEnabled: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(10).default(30),
  minReplicasForFailover: z.number().int().min(0).default(2),
  confirmationChecks: z.number().int().min(1).default(3),
});
```

### CLI Configuration

```bash
# View failover configuration
/config show

# Enable/disable auto-failover
/config set failover.auto_enabled true
```

## CLI Reference

### `/failover status`

Show current failover configuration and any in-progress operation.

```bash
/failover status
```

**Output:**
```
Failover Configuration
  Auto Failover Enabled: Yes
  Timeout: 30s
  Min Replicas Required: 2
  Confirmation Checks: 3
```

### `/failover history`

Show the history of failover operations.

```bash
/failover history
```

**Output:**
```
Failover/Switchover History
┌──────────┬────────────────────┬───────────────────┬───────────────────┬────────────┬──────────┐
│ ID       │ Cluster            │ Old Primary       │ New Primary       │ State      │ Type     │
├──────────┼────────────────────┼───────────────────┼───────────────────┼────────────┼──────────┤
│ a1b2c3d4 │ mysql-primary      │ 172.18.0.10:3306  │ 172.18.0.11:3306  │ completed  │ Switch   │
│ e5f6g7h8 │ mysql-replica      │ 172.18.0.12:3306  │ 172.18.0.13:3306  │ completed  │ Failover │
└──────────┴────────────────────┴───────────────────┴───────────────────┴────────────┴──────────┘
Total: 2 operations
```

### `/failover switchover`

Execute a planned primary change (primary must be healthy).

```bash
# Auto-select best replica
/failover switchover <cluster>

# Promote specific replica
/failover switchover <cluster> <target-replica>
```

**Examples:**
```bash
/failover switchover mysql-primary
/failover switchover mysql-primary 172.18.0.11:3306
```

### `/failover failover`

Execute an emergency failover (primary must be down).

```bash
# Auto-select best replica
/failover failover <cluster>

# Promote specific replica
/failover failover <cluster> <target-replica>
```

**Examples:**
```bash
/failover failover mysql-primary
/failover failover mysql-primary 172.18.0.12:3306
```

### `/failover recover`

Manage recovery of old primaries after failover.

```bash
# List pending recoveries
/failover recover list
/failover recover

# Recover specific instance
/failover recover <instance-id>

# Recover all pending
/failover recover --all
```

## API Reference

### List Failover Operations

```http
GET /api/failover?cluster_id={cluster_id}&limit={limit}
```

**Response:**
```json
{
  "items": [
    {
      "operation_id": "uuid",
      "cluster_id": "mysql-primary",
      "old_primary_id": "172.18.0.10:3306",
      "new_primary_id": "172.18.0.11:3306",
      "state": "completed",
      "started_at": "2024-01-15T10:30:00Z",
      "completed_at": "2024-01-15T10:30:05Z",
      "duration_seconds": 5.2,
      "steps": ["[2024-01-15T10:30:00Z] Selecting candidate..."],
      "error": null,
      "manual": true,
      "reason": "Manual switchover via CLI",
      "triggered_by": null
    }
  ],
  "total": 1
}
```

### Get Failover Operation

```http
GET /api/failover/{operation_id}
```

**Response:** Same as single item in list response.

### Execute Manual Failover

```http
POST /api/failover/cluster/{cluster_id}
Content-Type: application/json

{
  "target_instance_id": "172.18.0.11:3306",
  "reason": "Emergency failover due to hardware failure"
}
```

**Response:**
```json
{
  "operation_id": "uuid",
  "cluster_id": "mysql-primary",
  "old_primary_id": "172.18.0.10:3306",
  "new_primary_id": "172.18.0.11:3306",
  "state": "completed",
  "started_at": "2024-01-15T10:30:00Z",
  "completed_at": "2024-01-15T10:30:05Z",
  "duration_seconds": 5.2,
  "steps": [...],
  "error": null,
  "manual": true,
  "reason": "Emergency failover due to hardware failure",
  "triggered_by": null
}
```

### Cancel Failover Operation

```http
POST /api/failover/{operation_id}/cancel
```

**Response:**
```json
{
  "message": "Failover operation {operation_id} cancelled"
}
```

## Best Practices

### Pre-Switchover Checklist

1. Verify primary is healthy and accepting connections
2. Verify all replicas are in sync (low replication lag)
3. Notify applications of planned maintenance window
4. Have rollback plan ready

### Pre-Failover Checklist

1. Confirm primary is actually down (not network issue)
2. Verify at least one replica is healthy
3. Check replication lag on candidates
4. Prepare for potential data loss (transactions not replicated)

### Post-Failover Actions

1. Verify new primary is accepting writes
2. Update monitoring alerts
3. Recover old primary when it comes back online
4. Review operation logs for any issues
5. Update documentation if topology changed

## Troubleshooting

### Common Issues

**Switchover fails with "Primary is not healthy"**
- Check primary state: `/clusters topology`
- Verify primary is accepting connections
- Check Orchestrator health

**Failover fails with "No suitable candidate found"**
- Check replica states: `/clusters topology`
- Verify replicas are ONLINE
- Check if enough replicas exist

**Old primary not recovering**
- Check instance is back online
- Verify replication credentials
- Check network connectivity to new primary

### Debug Commands

```bash
# Check cluster topology
/clusters topology --name mysql-primary

# Check Orchestrator status
/status

# View pending recoveries
/failover recover list

# Check logs
# (Check container logs: docker logs clawsql)
```

## Automatic ProxySQL Synchronization

When Orchestrator performs automatic failover, ClawSQL automatically synchronizes ProxySQL routing through two complementary mechanisms:

### Webhook-Based Sync (Primary)

Orchestrator is configured to call a ClawSQL webhook after failover events. This provides immediate synchronization with minimal latency.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Orchestrator Failover Webhook Flow                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐                                                       │
│   │   Orchestrator   │                                                       │
│   │                  │                                                       │
│   │  1. Detects      │                                                       │
│   │     failure      │                                                       │
│   │                  │                                                       │
│   │  2. Promotes     │                                                       │
│   │     new primary  │                                                       │
│   │                  │                                                       │
│   │  3. Calls        │    POST /api/v1/webhooks/orchestrator/failover       │
│   │     webhook ─────────────────────────────────────────┐                  │
│   │                  │                                   │                  │
│   └──────────────────┘                                   │                  │
│                                                          ▼                  │
│                                             ┌────────────────────────┐      │
│                                             │   ClawSQL Webhook      │      │
│                                             │   Endpoint             │      │
│                                             │                        │      │
│                                             │  4. Validate payload   │      │
│                                             │  5. Get new topology   │      │
│                                             │  6. Sync ProxySQL      │      │
│                                             └───────────┬────────────┘      │
│                                                         │                   │
│                                                         ▼                   │
│                                             ┌────────────────────────┐      │
│                                             │     ProxySQL           │      │
│                                             │                        │      │
│                                             │  - Writer HG (10)      │      │
│                                             │    → new primary       │      │
│                                             │  - Reader HG (20)      │      │
│                                             │    → replicas          │      │
│                                             └────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Polling-Based Sync (Fallback)

A background topology watcher polls Orchestrator every 30 seconds and syncs ProxySQL if topology changes are detected. This catches any missed webhook events and handles network issues.

### Webhook Endpoint

```http
POST /api/v1/webhooks/orchestrator/failover
Content-Type: application/json

{
  "cluster": "mysql-primary",
  "master": "172.18.0.10:3306",
  "successor": "172.18.0.11:3306",
  "isSuccessful": true,
  "failoverType": "master"
}
```

### Sync Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SYNC_ENABLED` | `true` | Enable/disable automatic sync |
| `SYNC_POLL_INTERVAL_MS` | `30000` | Polling interval in milliseconds |
| `SYNC_WEBHOOK_SECRET` | - | Optional secret for webhook validation |
| `SYNC_COOLDOWN_MS` | `5000` | Minimum time between syncs per cluster |

### Sync Coordinator

The `SyncCoordinator` manages sync requests with:
- **Deduplication**: Prevents redundant syncs
- **Rate limiting**: Cooldown period between syncs
- **Topology hashing**: Only syncs when topology changes

### Orchestrator Webhook Configuration

The webhook hooks are configured in `docker/orchestrator/orchestrator.conf.json`:

```json
{
  "PostMasterFailoverProcesses": [
    "curl -s -X POST http://clawsql:8080/api/v1/webhooks/orchestrator/failover ..."
  ],
  "PostIntermediateMasterFailoverProcesses": [
    "curl -s -X POST http://clawsql:8080/api/v1/webhooks/orchestrator/failover ..."
  ]
}
```

### Manual Sync

You can also trigger sync manually:

```bash
# Sync all clusters
/clusters sync

# Sync specific cluster
/clusters sync --name mysql-primary
```

### Monitoring Sync Status

Check sync activity in ClawSQL logs:

```bash
docker logs clawsql | grep -E "(webhook|sync|topology)"
```

Key log messages:
- `"Received Orchestrator failover webhook"` - Webhook received
- `"Topology change detected"` - Polling detected change
- `"ProxySQL sync completed successfully"` - Sync finished

## Related Documentation

- [System Architecture](./architecture/system_design.md)
- [API Reference](./API.md)
- [CLAUDE.md](../CLAUDE.md) - Development guide
/**
 * ClawSQL CLI - Failover Command
 *
 * Manage failover and switchover operations.
 *
 * Terminology:
 * - Switchover: Planned, primary is healthy. Promotes a replica and fixes replication.
 * - Failover: Emergency, primary is down. Promotes a replica automatically.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';

/**
 * Failover command
 */
export const failoverCommand: Command = {
  name: 'failover',
  description: 'Manage failover and switchover operations',
  usage: '/failover <status|switchover|failover|history> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      console.log(formatter.error('Missing subcommand. Usage: /failover <status|switchover|failover|history|recover>'));
      console.log(formatter.info('  status     - Show current failover status'));
      console.log(formatter.info('  history    - Show operation history'));
      console.log(formatter.info('  switchover - Planned primary change (primary healthy)'));
      console.log(formatter.info('  failover   - Emergency failover (primary down)'));
      console.log(formatter.info('  recover    - Recover old primary after failover'));
      return;
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case 'status':
        await showStatus(ctx);
        break;
      case 'history':
        await showHistory(ctx);
        break;
      case 'switchover':
        await executeSwitchover(args.slice(1), ctx);
        break;
      case 'failover':
      case 'execute':
        await executeFailover(args.slice(1), ctx);
        break;
      case 'recover':
        await recoverInstance(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: status, history, switchover, failover, recover'));
    }
  },
};

/**
 * Show failover status
 */
async function showStatus(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const settings = ctx.settings;

  console.log(formatter.header('Failover Configuration'));

  const config = [
    { key: 'Auto Failover Enabled', value: settings.failover.autoFailoverEnabled ? chalk.green('Yes') : chalk.red('No') },
    { key: 'Timeout', value: `${settings.failover.timeoutSeconds}s` },
    { key: 'Min Replicas Required', value: String(settings.failover.minReplicasForFailover) },
    { key: 'Confirmation Checks', value: String(settings.failover.confirmationChecks) },
  ];

  for (const item of config) {
    console.log(formatter.keyValue(item.key, item.value));
  }

  // Check for current operation
  const currentOp = ctx.failoverExecutor.getCurrentOperation();
  if (currentOp) {
    console.log();
    console.log(chalk.bold('Current Operation:'));
    console.log(formatter.keyValue('  Operation ID', currentOp.operationId));
    console.log(formatter.keyValue('  State', currentOp.state));
    console.log(formatter.keyValue('  Cluster', currentOp.clusterId));
  }
}

/**
 * Show failover history
 */
async function showHistory(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const executor = ctx.failoverExecutor;

  const operations = executor.getOperationHistory();

  if (operations.length === 0) {
    console.log(formatter.info('No failover operations recorded.'));
    return;
  }

  console.log(formatter.header('Failover/Switchover History'));

  const tableData = operations.slice(-20).reverse().map(op => ({
    operation_id: op.operationId.slice(0, 8),
    cluster: op.clusterId,
    old_primary: op.oldPrimaryId,
    new_primary: op.newPrimaryId ?? '-',
    state: op.state,
    type: op.reason?.toLowerCase().includes('switchover') ? 'Switch' : 'Failover',
  }));

  console.log(formatter.table(tableData, [
    { key: 'operation_id', header: 'ID', width: 10 },
    { key: 'cluster', header: 'Cluster', width: 20 },
    { key: 'old_primary', header: 'Old Primary', width: 25 },
    { key: 'new_primary', header: 'New Primary', width: 25 },
    { key: 'state', header: 'State', width: 12 },
    { key: 'type', header: 'Type', width: 10 },
  ]));

  console.log(formatter.info(`Total: ${operations.length} operations`));
}

/**
 * Execute switchover (planned, primary is healthy)
 */
async function executeSwitchover(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length === 0) {
    console.log(formatter.error('Missing cluster. Usage: /failover switchover <cluster|instance> [target]'));
    console.log(formatter.info('  <cluster> - Cluster name (e.g., mysql-primary)'));
    console.log(formatter.info('  [target]  - Optional target replica to promote'));
    return;
  }

  const clusterOrInstance = args[0];
  const targetInstance = args.length > 1 ? args[1] : undefined;

  console.log(formatter.info('🔄 Switchover: Planned primary change (primary is healthy)'));

  try {
    const { cluster, clusterId } = await resolveCluster(ctx, clusterOrInstance);

    if (!cluster) {
      console.log(formatter.error(`Cluster '${clusterOrInstance}' not found.`));
      console.log(formatter.info('Use /clusters to list available clusters.'));
      return;
    }

    // Check primary is healthy
    if (!cluster.primary) {
      console.log(formatter.error('No primary found in cluster. Use /failover failover instead.'));
      return;
    }

    if (cluster.primary.state !== 'online') {
      console.log(formatter.error(`Primary ${cluster.primary.host}:${cluster.primary.port} is not healthy (state: ${cluster.primary.state}).`));
      console.log(formatter.info('Use /failover failover for unhealthy primary.'));
      return;
    }

    if (cluster.replicas.length === 0) {
      console.log(formatter.error('No replicas found in cluster. Cannot perform switchover.'));
      return;
    }

    console.log(formatter.info(`Cluster: ${clusterId}`));
    console.log(formatter.info(`Current Primary: ${cluster.primary.host}:${cluster.primary.port} (healthy)`));
    console.log(formatter.info(`Replicas: ${cluster.replicas.map(r => `${r.host}:${r.port}`).join(', ')}`));

    if (targetInstance) {
      console.log(formatter.info(`Target: ${targetInstance}`));
    }

    console.log(formatter.info('Executing switchover...'));

    const operation = await ctx.failoverExecutor.executeSwitchover(
      cluster,
      targetInstance,
      'Manual switchover via CLI'
    );

    handleOperationResult(operation, formatter, 'Switchover');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Switchover execution failed: ${message}`));
  }
}

/**
 * Execute failover (emergency, primary is down)
 */
async function executeFailover(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length === 0) {
    console.log(formatter.error('Missing cluster. Usage: /failover failover <cluster|instance> [target]'));
    console.log(formatter.info('  <cluster> - Cluster name (e.g., mysql-primary)'));
    console.log(formatter.info('  [target]  - Optional target replica to promote'));
    return;
  }

  const clusterOrInstance = args[0];
  const targetInstance = args.length > 1 ? args[1] : undefined;

  console.log(formatter.warning('⚠ Failover: Emergency operation (primary is down)'));

  try {
    const { cluster, clusterId } = await resolveCluster(ctx, clusterOrInstance);

    if (!cluster) {
      console.log(formatter.error(`Cluster '${clusterOrInstance}' not found.`));
      console.log(formatter.info('Use /clusters to list available clusters.'));
      return;
    }

    // Check primary is NOT healthy for failover
    if (cluster.primary && cluster.primary.state === 'online') {
      console.log(formatter.warning(`Primary ${cluster.primary.host}:${cluster.primary.port} is healthy.`));
      console.log(formatter.info('Use /failover switchover for planned primary change.'));
      return;
    }

    if (cluster.replicas.length === 0) {
      console.log(formatter.error('No replicas found in cluster. Cannot perform failover.'));
      return;
    }

    console.log(formatter.info(`Cluster: ${clusterId}`));
    if (cluster.primary) {
      console.log(formatter.info(`Old Primary: ${cluster.primary.host}:${cluster.primary.port} (${cluster.primary.state})`));
    }
    console.log(formatter.info(`Replicas: ${cluster.replicas.map(r => `${r.host}:${r.port}`).join(', ')}`));

    if (targetInstance) {
      console.log(formatter.info(`Target: ${targetInstance}`));
    }

    console.log(formatter.info('Executing failover...'));

    const operation = await ctx.failoverExecutor.executeManualFailover(
      cluster,
      targetInstance,
      'Manual failover via CLI'
    );

    handleOperationResult(operation, formatter, 'Failover');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failover execution failed: ${message}`));
  }
}

/**
 * Resolve cluster from cluster name or instance ID
 */
async function resolveCluster(
  ctx: CLIContext,
  clusterOrInstance: string
): Promise<{ cluster: Awaited<ReturnType<typeof ctx.orchestrator.getTopology>> | null; clusterId: string }> {
  let clusterId = clusterOrInstance;
  let cluster: Awaited<ReturnType<typeof ctx.orchestrator.getTopology>>;

  // Check if input looks like an instance ID (host:port format)
  if (clusterOrInstance.includes(':')) {
    const [host, portStr] = clusterOrInstance.split(':');
    const port = parseInt(portStr, 10) || 3306;

    // Try to get cluster name from the instance
    const resolvedClusterId = await ctx.orchestrator.getClusterForInstance(host, port);

    if (resolvedClusterId) {
      clusterId = resolvedClusterId;
    }

    // Get topology for the resolved cluster
    cluster = await ctx.orchestrator.getTopology(clusterId);
  } else {
    // It might be a cluster name without port, or a hostname
    cluster = await ctx.orchestrator.getTopology(clusterId);

    if (!cluster) {
      // Try with port appended
      cluster = await ctx.orchestrator.getTopology(`${clusterId}:3306`);
      if (cluster) {
        clusterId = `${clusterId}:3306`;
      }
    }
  }

  if (cluster) {
    // Use the clusterId from the cluster object
    clusterId = cluster.clusterId;
  }

  return { cluster, clusterId };
}

/**
 * Handle operation result
 */
function handleOperationResult(
  operation: Awaited<ReturnType<CLIContext['failoverExecutor']['executeSwitchover']>>,
  formatter: CLIContext['formatter'],
  operationType: string
): void {
  if (operation.state === 'completed') {
    console.log(formatter.success(`${operationType} completed successfully!`));
    console.log(formatter.keyValue('New Primary', operation.newPrimaryId || 'unknown'));
  } else {
    console.log(formatter.error(`${operationType} failed: ${operation.error}`));
    if (operation.steps.length > 0) {
      console.log(formatter.info('Operation steps:'));
      for (const step of operation.steps) {
        console.log(formatter.info(`  ${step}`));
      }
    }
  }
}

/**
 * Recover an old primary instance after failover
 */
async function recoverInstance(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const executor = ctx.failoverExecutor;

  // Show pending recoveries
  const pending = executor.getPendingRecoveries();

  if (args.length === 0 || args[0] === 'list') {
    if (pending.length === 0) {
      console.log(formatter.info('No instances pending recovery.'));
      return;
    }

    console.log(formatter.header('Instances Pending Recovery'));

    const tableData = pending.map(p => ({
      instance: p.instanceId,
      cluster: p.clusterId,
      new_primary: p.newPrimaryId,
      failed_at: p.failedAt.toISOString().slice(0, 19),
    }));

    console.log(formatter.table(tableData, [
      { key: 'instance', header: 'Instance', width: 25 },
      { key: 'cluster', header: 'Cluster', width: 25 },
      { key: 'new_primary', header: 'New Primary', width: 25 },
      { key: 'failed_at', header: 'Failed At', width: 20 },
    ]));

    console.log(formatter.info('Use /failover recover <instance> to recover a specific instance'));
    console.log(formatter.info('Use /failover recover --all to recover all pending instances'));
    return;
  }

  // Recover all
  if (args[0] === '--all') {
    console.log(formatter.info('Checking and recovering all pending instances...'));

    const result = await executor.checkAndRecoverAll();

    if (result.recovered.length > 0) {
      console.log(formatter.success(`Recovered ${result.recovered.length} instance(s):`));
      for (const id of result.recovered) {
        console.log(formatter.info(`  ${id}`));
      }
    }

    if (result.stillPending.length > 0) {
      console.log(formatter.warning(`${result.stillPending.length} instance(s) still pending:`));
      for (const id of result.stillPending) {
        console.log(formatter.info(`  ${id}`));
      }
    }

    if (result.errors.length > 0) {
      console.log(formatter.error('Errors:'));
      for (const err of result.errors) {
        console.log(formatter.error(`  ${err}`));
      }
    }

    return;
  }

  // Recover specific instance
  const instanceId = args[0];
  console.log(formatter.info(`Attempting to recover ${instanceId}...`));

  const result = await executor.recoverInstance(instanceId);

  if (result.success) {
    console.log(formatter.success(result.message));
  } else {
    console.log(formatter.error(result.message));
  }
}

export default failoverCommand;
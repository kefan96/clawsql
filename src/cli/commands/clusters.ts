/**
 * ClawSQL CLI - Clusters Command
 *
 * Manage MySQL clusters.
 */

import { Command, CLIContext } from '../registry.js';

/**
 * Clusters command
 */
export const clustersCommand: Command = {
  name: 'clusters',
  description: 'List and manage MySQL clusters',
  usage: '/clusters <list|create|import|topology|add-replica|remove-replica|promote|sync> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      await listClusters(ctx);
      return;
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case 'list':
        await listClusters(ctx);
        break;
      case 'sync':
        await syncCluster(args.slice(1), ctx);
        break;
      case 'create':
        await createCluster(args.slice(1), ctx);
        break;
      case 'import':
        await importCluster(args.slice(1), ctx);
        break;
      case 'topology':
        await showTopology(args.slice(1), ctx);
        break;
      case 'add-replica':
        await addReplica(args.slice(1), ctx);
        break;
      case 'remove-replica':
        await removeReplica(args.slice(1), ctx);
        break;
      case 'promote':
        await promoteReplica(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: list, create, import, topology, add-replica, remove-replica, promote, sync'));
    }
  },
};

/**
 * List all clusters
 */
async function listClusters(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const clusterView = ctx.clusterView;

  try {
    const views = await clusterView.getAllMergedViews();

    if (views.length === 0) {
      if (ctx.outputFormat === 'json') {
        console.log(JSON.stringify({ clusters: [] }, null, 2));
      } else {
        console.log(formatter.warning('No clusters discovered.'));
        console.log(formatter.info('Register instances with /instances register <host>'));
        console.log(formatter.info('Or create a cluster with /clusters create --name <name> --primary <host:port>'));
      }
      return;
    }

    const clusters: Array<{
      name: string;
      primary: string;
      replicas: number;
      endpoint: string;
      hostgroups: string;
      health: string;
    }> = [];

    for (const view of views) {
      clusters.push({
        name: view.displayName,
        primary: view.primary
          ? `${view.primary.host}:${view.primary.port}`
          : 'N/A',
        replicas: view.replicas.length,
        endpoint: view.endpoint
          ? `${view.endpoint.host}:${view.endpoint.port}`
          : 'N/A',
        hostgroups: view.hostgroups
          ? `${view.hostgroups.writer}/${view.hostgroups.reader}`
          : 'N/A',
        health: view.health,
      });
    }

    // JSON output
    if (ctx.outputFormat === 'json') {
      console.log(JSON.stringify({ clusters: views }, null, 2));
      return;
    }

    // Table output
    console.log(formatter.header('MySQL Clusters'));
    console.log(formatter.table(clusters, [
      { key: 'name', header: 'Cluster', width: 20 },
      { key: 'primary', header: 'Primary', width: 22 },
      { key: 'replicas', header: 'Replicas', width: 8 },
      { key: 'endpoint', header: 'Endpoint', width: 20 },
      { key: 'hostgroups', header: 'HG (W/R)', width: 12 },
      { key: 'health', header: 'Health', width: 10 },
    ]));

    console.log(formatter.info(`Total: ${clusters.length} clusters`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.outputFormat === 'json') {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(formatter.error(`Failed to list clusters: ${message}`));
    }
  }
}

/**
 * Create a new cluster
 */
async function createCluster(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  // Parse arguments
  const name = parseStringArg(args, '--name');
  const primaryStr = parseStringArg(args, '--primary');
  const replicasStr = parseStringArg(args, '--replicas');

  if (!name || !primaryStr) {
    console.log(formatter.error('Missing required arguments. Usage: /clusters create --name <name> --primary <host:port> [--replicas <host:port,...>]'));
    console.log(formatter.info('  --name <name>       Cluster name'));
    console.log(formatter.info('  --primary <host:port> Primary instance'));
    console.log(formatter.info('  --replicas <h:p,...> Replica instances (optional)'));
    return;
  }

  // Parse primary
  const primaryParts = primaryStr.split(':');
  const primaryHost = primaryParts[0];
  const primaryPort = primaryParts[1] ? parseInt(primaryParts[1], 10) : 3306;

  // Parse replicas
  const replicas: Array<{ host: string; port: number }> = [];
  if (replicasStr) {
    for (const r of replicasStr.split(',')) {
      const parts = r.trim().split(':');
      replicas.push({
        host: parts[0],
        port: parts[1] ? parseInt(parts[1], 10) : 3306,
      });
    }
  }

  console.log(formatter.header('Creating Cluster'));
  console.log(formatter.keyValue('Name', name));
  console.log(formatter.keyValue('Primary', `${primaryHost}:${primaryPort}`));
  if (replicas.length > 0) {
    console.log(formatter.keyValue('Replicas', replicas.map(r => `${r.host}:${r.port}`).join(', ')));
  }
  console.log();

  // Register primary
  console.log(formatter.info('Registering primary...'));
  try {
    const primarySuccess = await ctx.orchestrator.discoverInstance(primaryHost, primaryPort);
    if (!primarySuccess) {
      console.log(formatter.error('Failed to register primary instance'));
      return;
    }
    console.log(formatter.success(`Primary ${primaryHost}:${primaryPort} registered`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to register primary: ${message}`));
    return;
  }

  // Register replicas
  for (const replica of replicas) {
    console.log(formatter.info(`Registering replica ${replica.host}:${replica.port}...`));
    try {
      const success = await ctx.orchestrator.discoverInstance(replica.host, replica.port);
      if (success) {
        console.log(formatter.success(`Replica ${replica.host}:${replica.port} registered`));
      } else {
        console.log(formatter.warning(`Failed to register replica ${replica.host}:${replica.port}`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.warning(`Failed to register replica: ${message}`));
    }
  }

  console.log();
  console.log(formatter.success(`Cluster "${name}" created successfully!`));
  console.log(formatter.info('View topology with: /clusters topology --name ' + name));
  console.log(formatter.info('Sync to ProxySQL with: /clusters sync --name ' + name));
}

/**
 * Import an existing replication topology
 */
async function importCluster(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const primaryStr = parseStringArg(args, '--primary');

  if (!primaryStr) {
    console.log(formatter.error('Missing primary. Usage: /clusters import --primary <host:port> [--name <name>]'));
    console.log(formatter.info('This will discover the primary and all connected replicas.'));
    return;
  }

  const parts = primaryStr.split(':');
  const primaryHost = parts[0];
  const primaryPort = parts[1] ? parseInt(parts[1], 10) : 3306;

  console.log(formatter.header('Importing Cluster Topology'));
  console.log(formatter.keyValue('Primary', `${primaryHost}:${primaryPort}`));
  console.log();

  // Discover primary - Orchestrator will auto-discover replicas
  console.log(formatter.info('Discovering topology...'));
  try {
    const success = await ctx.orchestrator.discoverInstance(primaryHost, primaryPort);
    if (!success) {
      console.log(formatter.error('Failed to discover primary instance'));
      return;
    }

    // Wait a moment for Orchestrator to discover replicas
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the discovered topology
    const clusterName = await ctx.orchestrator.getClusterForInstance(primaryHost, primaryPort);
    if (!clusterName) {
      console.log(formatter.warning('Topology discovered but cluster name not resolved'));
      return;
    }

    const topology = await ctx.orchestrator.getTopology(clusterName);
    if (!topology) {
      console.log(formatter.error('Failed to get topology'));
      return;
    }

    console.log(formatter.success('Topology discovered:'));
    if (topology.primary) {
      console.log(formatter.keyValue('  Primary', `${topology.primary.host}:${topology.primary.port}`));
    }
    for (const replica of topology.replicas) {
      console.log(formatter.keyValue('  Replica', `${replica.host}:${replica.port}`));
    }

    console.log();
    console.log(formatter.info(`Cluster "${topology.name}" imported with ${topology.replicas.length} replica(s)`));
    console.log(formatter.info('View topology with: /clusters topology --name ' + topology.name));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Import failed: ${message}`));
  }
}

/**
 * Show cluster topology
 */
async function showTopology(args: string[], ctx: CLIContext): Promise<void> {
  const name = parseStringArg(args, '--name');

  if (!name) {
    // Show all topologies
    const views = await ctx.clusterView.getAllMergedViews();
    for (const view of views) {
      displayMergedTopology(view, ctx);
    }
    return;
  }

  const view = await ctx.clusterView.getMergedView(name);
  if (!view) {
    console.log(ctx.formatter.warning(`Cluster '${name}' not found.`));
    return;
  }
  displayMergedTopology(view, ctx);
}

/**
 * Display merged topology for a cluster
 */
function displayMergedTopology(view: import('../../types/index.js').MergedClusterView, ctx: CLIContext): void {
  const formatter = ctx.formatter;

  // JSON output
  if (ctx.outputFormat === 'json') {
    console.log(JSON.stringify(view, null, 2));
    return;
  }

  // Table output using formatter
  console.log(formatter.clusterTopology({
    displayName: view.displayName,
    endpoint: view.endpoint,
    hostgroups: view.hostgroups,
    primary: view.primary ? {
      host: view.primary.host,
      port: view.primary.port,
      state: view.primary.state,
      role: view.primary.role,
      version: view.primary.version,
      serverId: view.primary.serverId,
      hostgroup: view.primary.hostgroup,
      proxysqlStatus: view.primary.proxysqlStatus,
      connections: view.primary.connections,
    } : null,
    replicas: view.replicas.map(r => ({
      host: r.host,
      port: r.port,
      state: r.state,
      role: r.role,
      version: r.version,
      serverId: r.serverId,
      replicationLag: r.replicationLag,
      hostgroup: r.hostgroup,
      proxysqlStatus: r.proxysqlStatus,
      connections: r.connections,
    })),
    health: view.health,
  }));
}

/**
 * Add a replica to a cluster
 */
async function addReplica(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const name = parseStringArg(args, '--name');
  const hostStr = parseStringArg(args, '--host');

  if (!name || !hostStr) {
    console.log(formatter.error('Missing arguments. Usage: /clusters add-replica --name <cluster> --host <host:port>'));
    return;
  }

  const parts = hostStr.split(':');
  const host = parts[0];
  const port = parts[1] ? parseInt(parts[1], 10) : 3306;

  console.log(formatter.info(`Adding replica ${host}:${port} to cluster "${name}"...`));

  try {
    // Register the instance with Orchestrator
    const success = await ctx.orchestrator.discoverInstance(host, port);
    if (success) {
      console.log(formatter.success(`Replica ${host}:${port} added to cluster`));
      console.log(formatter.info('Orchestrator will configure replication automatically.'));
    } else {
      console.log(formatter.error('Failed to add replica'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to add replica: ${message}`));
  }
}

/**
 * Remove a replica from a cluster
 */
async function removeReplica(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const name = parseStringArg(args, '--name');
  const hostStr = parseStringArg(args, '--host');

  if (!name || !hostStr) {
    console.log(formatter.error('Missing arguments. Usage: /clusters remove-replica --name <cluster> --host <host:port>'));
    return;
  }

  const parts = hostStr.split(':');
  const host = parts[0];
  const port = parts[1] ? parseInt(parts[1], 10) : 3306;

  console.log(formatter.info(`Removing replica ${host}:${port} from cluster "${name}"...`));

  try {
    const success = await ctx.orchestrator.forgetInstance(host, port);
    if (success) {
      console.log(formatter.success(`Replica ${host}:${port} removed from cluster`));
    } else {
      console.log(formatter.error('Failed to remove replica'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to remove replica: ${message}`));
  }
}

/**
 * Promote a replica to primary (switchover)
 */
async function promoteReplica(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const name = parseStringArg(args, '--name');
  const hostStr = parseStringArg(args, '--host');

  if (!name || !hostStr) {
    console.log(formatter.error('Missing arguments. Usage: /clusters promote --name <cluster> --host <host:port>'));
    return;
  }

  const parts = hostStr.split(':');
  const host = parts[0];
  const port = parts[1] ? parseInt(parts[1], 10) : 3306;

  console.log(formatter.header('Promoting Replica to Primary'));
  console.log(formatter.keyValue('Cluster', name));
  console.log(formatter.keyValue('New Primary', `${host}:${port}`));
  console.log();

  // Get current topology
  try {
    const topology = await ctx.orchestrator.getTopology(name);
    if (!topology) {
      console.log(formatter.error(`Cluster "${name}" not found`));
      return;
    }

    if (topology.primary) {
      console.log(formatter.keyValue('Current Primary', `${topology.primary.host}:${topology.primary.port}`));
      console.log();

      if (topology.primary.state !== 'online') {
        console.log(formatter.warning('Current primary is not online. This will be a failover, not a switchover.'));
      }
    }
  } catch {
    // Continue anyway
  }

  console.log(formatter.info('Executing switchover...'));

  try {
    // Use Orchestrator's graceful master takeover
    const result = await ctx.orchestrator.gracefulMasterTakeover(name, host, port);

    console.log(formatter.success('Promotion completed!'));
    if (result) {
      console.log(formatter.info(`New primary: ${host}:${port}`));
    }
    console.log();
    console.log(formatter.info('Verify topology with: /clusters topology --name ' + name));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Promotion failed: ${message}`));
  }
}

/**
 * Sync cluster to ProxySQL
 */
async function syncCluster(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const name = parseStringArg(args, '--name');

  if (!name) {
    console.log(formatter.info('Syncing all clusters to ProxySQL...'));
  } else {
    console.log(formatter.info(`Syncing cluster "${name}" to ProxySQL...`));
  }

  try {
    const clusters = name
      ? [name]
      : await ctx.orchestrator.getClusters();

    for (const clusterName of clusters) {
      const topology = await ctx.orchestrator.getTopology(clusterName);
      if (!topology) continue;

      console.log(formatter.info(`Syncing ${topology.name || clusterName}...`));

      const result = await ctx.proxysql.syncCluster(
        topology,
        10, // writer hostgroup
        20, // reader hostgroup
        ctx.settings.mysql.adminUser,
        ctx.settings.mysql.adminPassword
      );

      if (result.success) {
        console.log(formatter.success(`  Synced ${result.serversAdded} server(s)`));
      } else {
        console.log(formatter.error(`  Sync failed: ${result.errors.join(', ')}`));
      }
    }

    console.log(formatter.success('ProxySQL sync complete'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Sync failed: ${message}`));
  }
}

/**
 * Parse a string argument
 */
function parseStringArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export default clustersCommand;
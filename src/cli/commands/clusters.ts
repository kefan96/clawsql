/**
 * ClawSQL CLI - Clusters Command
 *
 * Manage MySQL clusters.
 */

import { Command, CLIContext } from '../registry.js';
import { getClusterProvisioner } from '../../core/provisioning/cluster-provisioner.js';
import { getTemplateManager } from '../../core/provisioning/template-manager.js';
import { parseStringArg, parseHostPort, getErrorMessage } from '../utils/args.js';

/**
 * Clusters command
 */
export const clustersCommand: Command = {
  name: 'clusters',
  description: 'List and manage MySQL clusters',
  usage: '/clusters <list|create|import|topology|add-replica|remove-replica|promote|sync|provision|deprovision> [args...]',
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
      case 'provision':
        await provisionCluster(args.slice(1), ctx);
        break;
      case 'deprovision':
        await deprovisionCluster(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: list, create, import, topology, add-replica, remove-replica, promote, sync, provision, deprovision'));
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
  const primary = parseHostPort(primaryStr);

  // Parse replicas
  const replicas: Array<{ host: string; port: number }> = [];
  if (replicasStr) {
    for (const r of replicasStr.split(',')) {
      replicas.push(parseHostPort(r.trim()));
    }
  }

  console.log(formatter.header('Creating Cluster'));
  console.log(formatter.keyValue('Name', name));
  console.log(formatter.keyValue('Primary', `${primary.host}:${primary.port}`));
  if (replicas.length > 0) {
    console.log(formatter.keyValue('Replicas', replicas.map(r => `${r.host}:${r.port}`).join(', ')));
  }
  console.log();

  // Register primary
  console.log(formatter.info('Registering primary...'));
  try {
    const primarySuccess = await ctx.orchestrator.discoverInstance(primary.host, primary.port);
    if (!primarySuccess) {
      console.log(formatter.error('Failed to register primary instance'));
      return;
    }
    console.log(formatter.success(`Primary ${primary.host}:${primary.port} registered`));
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

  const primary = parseHostPort(primaryStr);

  console.log(formatter.header('Importing Cluster Topology'));
  console.log(formatter.keyValue('Primary', `${primary.host}:${primary.port}`));
  console.log();

  // Discover primary - Orchestrator will auto-discover replicas
  console.log(formatter.info('Discovering topology...'));
  try {
    const success = await ctx.orchestrator.discoverInstance(primary.host, primary.port);
    if (!success) {
      console.log(formatter.error('Failed to discover primary instance'));
      return;
    }

    // Wait a moment for Orchestrator to discover replicas
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the discovered topology
    const clusterName = await ctx.orchestrator.getClusterForInstance(primary.host, primary.port);
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
    console.log(formatter.error(`Import failed: ${getErrorMessage(error)}`));
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
    syncWarnings: view.syncWarnings,
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

  const { host, port } = parseHostPort(hostStr);

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
    console.log(formatter.error(`Failed to add replica: ${getErrorMessage(error)}`));
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

  const { host, port } = parseHostPort(hostStr);

  console.log(formatter.info(`Removing replica ${host}:${port} from cluster "${name}"...`));

  try {
    const success = await ctx.orchestrator.forgetInstance(host, port);
    if (success) {
      console.log(formatter.success(`Replica ${host}:${port} removed from cluster`));
    } else {
      console.log(formatter.error('Failed to remove replica'));
    }
  } catch (error) {
    console.log(formatter.error(`Failed to remove replica: ${getErrorMessage(error)}`));
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

  const { host, port } = parseHostPort(hostStr);

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
        console.log(formatter.success(`  Synced ${result.serversAdded} server(s), removed ${result.serversRemoved} stale`));
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
 * Provision a cluster from a template
 */
async function provisionCluster(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const templateName = parseStringArg(args, '--template');
  const clusterName = parseStringArg(args, '--cluster');
  const hostsStr = parseStringArg(args, '--hosts');

  if (!templateName || !clusterName || !hostsStr) {
    console.log(formatter.error('Missing required arguments. Usage: /clusters provision --template <name> --cluster <name> --hosts <h:p,h:p,...>'));
    console.log(formatter.info('  --template <name>    Template name (create with /templates create)'));
    console.log(formatter.info('  --cluster <name>     Cluster name (unique identifier)'));
    console.log(formatter.info('  --hosts <h:p,...>    Comma-separated host:port list (first becomes primary)'));
    return;
  }

  // Parse hosts
  const hosts = hostsStr.split(',').map((h) => parseHostPort(h.trim()));

  console.log(formatter.header('Provisioning Cluster'));
  console.log(formatter.keyValue('Template', templateName));
  console.log(formatter.keyValue('Cluster Name', clusterName));
  console.log(formatter.keyValue('Hosts', hosts.map((h) => `${h.host}:${h.port}`).join(', ')));
  console.log();

  // Verify template exists
  const templateManager = getTemplateManager();
  const template = await templateManager.get(templateName);
  if (!template) {
    console.log(formatter.error(`Template "${templateName}" not found`));
    console.log(formatter.info('List available templates with: /templates list'));
    return;
  }

  // Validate host count
  const validation = await templateManager.validateHosts(template, hosts);
  if (!validation.valid) {
    console.log(formatter.error(validation.error || 'Invalid host configuration'));
    return;
  }

  console.log(formatter.info('Provisioning cluster...'));

  try {
    const provisioner = getClusterProvisioner();
    const result = await provisioner.provision(templateName, clusterName, hosts);

    if (result.success) {
      console.log(formatter.success('Cluster provisioned successfully!'));
      console.log(formatter.keyValue('  Cluster ID', result.clusterId));
      console.log(formatter.keyValue('  Assigned Port', result.assignedPort.toString()));
      console.log(formatter.keyValue('  Writer Hostgroup', result.writerHostgroup.toString()));
      console.log(formatter.keyValue('  Reader Hostgroup', result.readerHostgroup.toString()));
      console.log(formatter.keyValue('  Primary', `${result.primary.host}:${result.primary.port}`));
      console.log(formatter.keyValue('  Replicas', result.replicas.map((r) => `${r.host}:${r.port}`).join(', ')));
      console.log();
      console.log(formatter.info(`Connect to this cluster via ProxySQL port ${result.assignedPort}`));
    } else {
      console.log(formatter.error(`Provisioning failed: ${result.error}`));
    }
  } catch (error) {
    console.log(formatter.error(`Provisioning failed: ${getErrorMessage(error)}`));
  }
}

/**
 * Deprovision a cluster
 */
async function deprovisionCluster(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const clusterName = parseStringArg(args, '--cluster') || args[0];
  const force = args.includes('--force');

  if (!clusterName) {
    console.log(formatter.error('Missing cluster name. Usage: /clusters deprovision <cluster> [--force]'));
    return;
  }

  // Check cluster exists
  const provisioner = getClusterProvisioner();
  const metadata = await provisioner.getClusterMetadata(clusterName);
  if (!metadata) {
    console.log(formatter.error(`Cluster "${clusterName}" not found`));
    return;
  }

  console.log(formatter.header('Deprovisioning Cluster'));
  console.log(formatter.keyValue('Cluster', clusterName));
  console.log(formatter.keyValue('Status', metadata.provisionStatus));
  if (metadata.assignedPort) {
    console.log(formatter.keyValue('Port', metadata.assignedPort.toString()));
  }
  if (metadata.writerHostgroup && metadata.readerHostgroup) {
    console.log(formatter.keyValue('Hostgroups', `${metadata.writerHostgroup}/${metadata.readerHostgroup}`));
  }
  console.log();

  if (!force) {
    console.log(formatter.warning('This will remove the cluster, stop replication, and clean up ProxySQL configuration.'));
    console.log(formatter.info('Use --force to confirm deprovisioning'));
    return;
  }

  console.log(formatter.info('Deprovisioning cluster...'));

  try {
    const result = await provisioner.deprovision(clusterName);

    if (result.success) {
      console.log(formatter.success(`Cluster "${clusterName}" deprovisioned successfully`));
    } else {
      console.log(formatter.error(`Deprovisioning failed: ${result.error}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Deprovisioning failed: ${message}`));
  }
}

export default clustersCommand;
/**
 * ClawSQL CLI - Instances Command
 *
 * Manage MySQL instances.
 */

import { Command, CLIContext } from '../registry.js';

/**
 * Instances command
 */
export const instancesCommand: Command = {
  name: 'instances',
  description: 'Manage MySQL instances',
  usage: '/instances <list|register|discover> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      console.log(formatter.error('Missing subcommand. Usage: /instances <list|register|discover>'));
      console.log(formatter.info('  list     - List discovered instances'));
      console.log(formatter.info('  register - Register a new instance'));
      console.log(formatter.info('  discover - Scan network for instances'));
      return;
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case 'list':
        await listInstances(ctx);
        break;
      case 'register':
        await registerInstance(args.slice(1), ctx);
        break;
      case 'discover':
        await discoverInstances(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: list, register, discover'));
    }
  },
};

/**
 * List discovered instances
 */
async function listInstances(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  try {
    const clusters = await orchestrator.getClusters();
    const instances: Array<{
      host: string;
      port: number;
      role: string;
      state: string;
      cluster: string;
      lag?: number;
    }> = [];

    for (const clusterName of clusters) {
      const cluster = await orchestrator.getTopology(clusterName);
      if (!cluster) continue;

      if (cluster.primary) {
        instances.push({
          host: cluster.primary.host,
          port: cluster.primary.port,
          role: 'primary',
          state: cluster.primary.state,
          cluster: clusterName,
        });
      }

      for (const replica of cluster.replicas) {
        instances.push({
          host: replica.host,
          port: replica.port,
          role: 'replica',
          state: replica.state,
          cluster: clusterName,
          lag: replica.replicationLag,
        });
      }
    }

    if (instances.length === 0) {
      console.log(formatter.warning('No instances discovered.'));
      console.log(formatter.info('Use /instances register <host> to add instances.'));
      return;
    }

    console.log(formatter.header('Discovered Instances'));
    console.log(formatter.table(instances, [
      { key: 'host', header: 'Host', width: 25 },
      { key: 'port', header: 'Port', width: 8 },
      { key: 'role', header: 'Role', width: 10 },
      { key: 'state', header: 'State', width: 10 },
      { key: 'cluster', header: 'Cluster', width: 20 },
      { key: 'lag', header: 'Lag', width: 8 },
    ]));
    console.log(formatter.info(`Total: ${instances.length} instances`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to list instances: ${message}`));
  }
}

/**
 * Register a new instance
 */
async function registerInstance(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  if (args.length === 0) {
    console.log(formatter.error('Missing host. Usage: /instances register <host> [port]'));
    return;
  }

  const host = args[0];
  const port = args.length > 1 ? parseInt(args[1], 10) : 3306;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.log(formatter.error('Invalid port number. Must be between 1 and 65535.'));
    return;
  }

  console.log(formatter.info(`Registering instance ${host}:${port}...`));

  try {
    const success = await orchestrator.discoverInstance(host, port);

    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} registered successfully.`));
    } else {
      console.log(formatter.error(`Failed to register instance ${host}:${port}.`));
      console.log(formatter.info('Make sure the MySQL instance is running and accessible.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Registration failed: ${message}`));
  }
}

/**
 * Discover instances on a network
 */
async function discoverInstances(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length === 0) {
    console.log(formatter.error('Missing network segment. Usage: /instances discover <network>'));
    console.log(formatter.info('Example: /instances discover 172.18.0.0/24'));
    return;
  }

  const network = args[0];
  console.log(formatter.info(`Scanning network ${network} for MySQL instances...`));
  console.log(formatter.warning('Network scanning is not yet implemented. Use /instances register to add instances manually.'));
}

export default instancesCommand;
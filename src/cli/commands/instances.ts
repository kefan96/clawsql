/**
 * ClawSQL CLI - Instances Command
 *
 * Manage MySQL instances.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { NetworkScanner, probeMySQLInstance } from '../../core/discovery/scanner.js';
import ora from 'ora';

/**
 * Instances command
 */
export const instancesCommand: Command = {
  name: 'instances',
  description: 'Manage MySQL instances',
  usage: '/instances <list|register|discover|remove> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      console.log(formatter.error('Missing subcommand. Usage: /instances <list|register|discover|remove>'));
      console.log(formatter.info('  list     - List discovered instances'));
      console.log(formatter.info('  register - Register a new instance'));
      console.log(formatter.info('  discover - Scan network for instances'));
      console.log(formatter.info('  remove   - Remove instance from topology'));
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
      case 'remove':
      case 'forget':
        await removeInstance(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: list, register, discover, remove'));
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
      version?: string;
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
          version: cluster.primary.version,
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
          version: replica.version,
        });
      }
    }

    if (instances.length === 0) {
      if (ctx.outputFormat === 'json') {
        console.log(JSON.stringify({ instances: [] }, null, 2));
      } else {
        console.log(formatter.warning('No instances discovered.'));
        console.log(formatter.info('Use /instances register <host> to add instances.'));
        console.log(formatter.info('Use /instances discover --network <cidr> to scan for instances.'));
      }
      return;
    }

    // JSON output
    if (ctx.outputFormat === 'json') {
      console.log(JSON.stringify({ instances }, null, 2));
      return;
    }

    // Table output
    console.log(formatter.header('Discovered Instances'));
    console.log(formatter.table(instances, [
      { key: 'host', header: 'Host', width: 25 },
      { key: 'port', header: 'Port', width: 8 },
      { key: 'role', header: 'Role', width: 10 },
      { key: 'state', header: 'State', width: 10 },
      { key: 'cluster', header: 'Cluster', width: 20 },
      { key: 'version', header: 'Version', width: 10 },
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

  // Parse arguments
  const parsed = parseInstanceArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances register <host> [port]'));
    console.log(formatter.info('  <host>        MySQL hostname or IP'));
    console.log(formatter.info('  [port]        MySQL port (default: 3306)'));
    console.log(formatter.info('  --user <u>    MySQL username'));
    console.log(formatter.info('  --password <p> MySQL password'));
    return;
  }

  const { host, port, user, password } = parsed;

  console.log(formatter.info(`Registering instance ${host}:${port}...`));

  // First, probe to verify it's MySQL
  const probe = await probeMySQLInstance(
    host,
    port,
    user || ctx.settings.mysql.adminUser,
    password || ctx.settings.mysql.adminPassword,
    5000
  );

  if (!probe.isMySQL) {
    console.log(formatter.error(`No MySQL instance found at ${host}:${port}`));
    console.log(formatter.info('Make sure the MySQL instance is running and accessible.'));
    return;
  }

  console.log(formatter.keyValue('MySQL Version', probe.version || 'unknown'));

  // Register with Orchestrator
  try {
    const success = await orchestrator.discoverInstance(host, port);

    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} registered successfully.`));
    } else {
      console.log(formatter.error(`Failed to register instance ${host}:${port}.`));
      console.log(formatter.info('Check Orchestrator logs for details.'));
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

  // Parse arguments
  const network = args.find(a => !a.startsWith('--') && a.includes('/'));
  const autoRegister = args.includes('--auto-register');
  const portStart = parseNumberArg(args, '--port-start', 3306);
  const portEnd = parseNumberArg(args, '--port-end', 3306);
  const user = parseStringArg(args, '--user') || ctx.settings.mysql.adminUser;
  const password = parseStringArg(args, '--password') || ctx.settings.mysql.adminPassword;

  if (!network) {
    console.log(formatter.error('Missing network. Usage: /instances discover <network> [options]'));
    console.log(formatter.info('  <network>       Network CIDR (e.g., 192.168.1.0/24)'));
    console.log(formatter.info('  --port-start N  Port range start (default: 3306)'));
    console.log(formatter.info('  --port-end N    Port range end (default: 3306)'));
    console.log(formatter.info('  --auto-register Register discovered instances'));
    console.log(formatter.info('  --user <u>      MySQL username'));
    console.log(formatter.info('  --password <p>  MySQL password'));
    return;
  }

  console.log(formatter.header('Network Discovery'));
  console.log(formatter.keyValue('Network', network));
  console.log(formatter.keyValue('Ports', `${portStart}-${portEnd}`));
  console.log(formatter.keyValue('Auto-register', autoRegister ? 'yes' : 'no'));
  console.log();

  // Create scanner
  const scanner = new NetworkScanner({
    network,
    portStart,
    portEnd,
    timeout: 2000,
    maxConcurrent: 50,
    user,
    password,
  });

  // Run scan with progress
  const spinner = ora('Scanning network...').start();

  const results = await scanner.scan((found, scanned) => {
    spinner.text = `Scanning... ${found} MySQL instances found (${scanned} hosts scanned)`;
  });

  spinner.succeed(`Scan complete: ${results.length} MySQL instances found`);

  if (results.length === 0) {
    console.log(formatter.warning('No MySQL instances found on the network.'));
    return;
  }

  // Display results
  console.log();
  console.log(formatter.header('Discovered MySQL Instances'));
  console.log(formatter.table(results.map(r => ({
    host: r.host,
    port: r.port,
    version: r.version || (r.isMySQL ? 'unknown' : 'N/A'),
    status: r.isMySQL ? 'MySQL' : 'Not MySQL',
    error: r.error || '',
  })), [
    { key: 'host', header: 'Host', width: 20 },
    { key: 'port', header: 'Port', width: 8 },
    { key: 'version', header: 'Version', width: 12 },
    { key: 'status', header: 'Status', width: 12 },
    { key: 'error', header: 'Note', width: 25 },
  ]));

  // Auto-register if requested
  if (autoRegister) {
    console.log();
    console.log(formatter.info('Registering discovered instances...'));

    let registered = 0;
    for (const instance of results.filter(r => r.isMySQL)) {
      try {
        const success = await ctx.orchestrator.discoverInstance(instance.host, instance.port);
        if (success) {
          registered++;
          console.log(formatter.keyValue(`  ${instance.host}:${instance.port}`, chalk.green('registered')));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(formatter.keyValue(`  ${instance.host}:${instance.port}`, chalk.red(message)));
      }
    }

    console.log();
    console.log(formatter.success(`Registered ${registered} of ${results.filter(r => r.isMySQL).length} instances`));
  } else {
    console.log();
    console.log(formatter.info('To register these instances, run:'));
    console.log(formatter.info(`  /instances discover ${network} --auto-register`));
    console.log(formatter.info('Or register individually with:'));
    console.log(formatter.info('  /instances register <host> [port]'));
  }
}

/**
 * Remove an instance from the topology
 */
async function removeInstance(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  // Parse arguments
  const parsed = parseInstanceArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances remove <host> [port]'));
    return;
  }

  const { host, port } = parsed;

  console.log(formatter.info(`Removing instance ${host}:${port} from topology...`));

  try {
    const success = await orchestrator.forgetInstance(host, port);

    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} removed from topology.`));
    } else {
      console.log(formatter.error(`Failed to remove instance ${host}:${port}.`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Removal failed: ${message}`));
  }
}

/**
 * Parse instance arguments
 */
function parseInstanceArgs(args: string[]): { host: string; port: number; user?: string; password?: string } | null {
  const hostArg = args.find(a => !a.startsWith('--') && !a.includes('/'));
  if (!hostArg) return null;

  const host = hostArg;
  const port = parseNumberArg(args, '--port', 3306) ||
    (args[1] && !args[1].startsWith('--') ? parseInt(args[1], 10) : 3306);
  const user = parseStringArg(args, '--user');
  const password = parseStringArg(args, '--password');

  return { host, port, user, password };
}

/**
 * Parse a number argument
 */
function parseNumberArg(args: string[], name: string, defaultValue: number): number {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  const val = parseInt(args[idx + 1], 10);
  return isNaN(val) ? defaultValue : val;
}

/**
 * Parse a string argument
 */
function parseStringArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export default instancesCommand;
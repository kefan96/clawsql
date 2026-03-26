/**
 * ClawSQL CLI - Instances Command
 *
 * Manage MySQL instances.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { NetworkScanner, probeMySQLInstance } from '../../core/discovery/scanner.js';
import { getMySQLClient } from '../../utils/mysql-client.js';
import ora from 'ora';

/**
 * Instances command
 */
export const instancesCommand: Command = {
  name: 'instances',
  description: 'Manage MySQL instances',
  usage: '/instances <list|register|discover|remove|replication|setup-replication|read-only|writeable|start-slave|stop-slave|reset-slave|relocate|begin-maintenance|end-maintenance> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      console.log(formatter.error('Missing subcommand. Usage: /instances <subcommand> [args...]'));
      console.log(formatter.info('  list              - List discovered instances'));
      console.log(formatter.info('  register          - Register a new instance'));
      console.log(formatter.info('  discover          - Scan network for instances'));
      console.log(formatter.info('  remove            - Remove instance from topology'));
      console.log(formatter.info('  replication       - Show detailed replication status'));
      console.log(formatter.info('  setup-replication - Configure replication (direct MySQL)'));
      console.log(formatter.info('  read-only         - Set instance read-only (via Orchestrator)'));
      console.log(formatter.info('  writeable         - Set instance writeable (via Orchestrator)'));
      console.log(formatter.info('  start-slave       - Start replication (via Orchestrator)'));
      console.log(formatter.info('  stop-slave        - Stop replication (via Orchestrator)'));
      console.log(formatter.info('  reset-slave       - Reset replication (via Orchestrator)'));
      console.log(formatter.info('  relocate          - Move replica to follow new master'));
      console.log(formatter.info('  begin-maintenance - Put instance in maintenance mode'));
      console.log(formatter.info('  end-maintenance   - Remove instance from maintenance mode'));
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
      case 'replication':
        await showReplicationStatus(args.slice(1), ctx);
        break;
      case 'setup-replication':
        await setupReplication(args.slice(1), ctx);
        break;
      case 'read-only':
        await setReadOnly(args.slice(1), ctx);
        break;
      case 'writeable':
        await setWriteable(args.slice(1), ctx);
        break;
      case 'start-slave':
        await startSlave(args.slice(1), ctx);
        break;
      case 'stop-slave':
        await stopSlave(args.slice(1), ctx);
        break;
      case 'reset-slave':
        await resetSlave(args.slice(1), ctx);
        break;
      case 'relocate':
        await relocateReplica(args.slice(1), ctx);
        break;
      case 'begin-maintenance':
        await beginMaintenance(args.slice(1), ctx);
        break;
      case 'end-maintenance':
        await endMaintenance(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: list, register, discover, remove, replication, setup-replication, read-only, writeable, start-slave, stop-slave, reset-slave, relocate, begin-maintenance, end-maintenance'));
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

/**
 * Show detailed replication status for an instance
 */
async function showReplicationStatus(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances replication <host:port>'));
    return;
  }

  const { host, port } = parsed;
  const instanceId = `${host}:${port}`;

  console.log(formatter.header(`Replication Status: ${instanceId}`));

  try {
    const mysqlClient = getMySQLClient();

    // Get SHOW SLAVE STATUS
    const status = await mysqlClient.getReplicationStatus(host, port);

    if (!status) {
      console.log(formatter.info('No replication configured (not a replica).'));
      console.log(formatter.info('This instance may be a primary or has no replication set up.'));
      return;
    }

    // Display replication status
    console.log();
    console.log(formatter.keyValue('IO Thread Running', status.ioRunning ? chalk.green('Yes') : chalk.red('No')));
    console.log(formatter.keyValue('SQL Thread Running', status.sqlRunning ? chalk.green('Yes') : chalk.red('No')));
    console.log(formatter.keyValue('Seconds Behind Master', status.secondsBehind !== null ? `${status.secondsBehind}s` : 'N/A'));

    // Show additional details via direct query
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host,
      port,
      user: ctx.settings.mysql.adminUser,
      password: ctx.settings.mysql.adminPassword,
      connectTimeout: 5000,
    });

    const [rows] = await connection.execute('SHOW SLAVE STATUS');
    const slaveStatus = (rows as Record<string, unknown>[])[0];
    await connection.end();

    if (slaveStatus) {
      console.log();
      console.log(formatter.keyValue('Master Host', String(slaveStatus.Master_Host || 'N/A')));
      console.log(formatter.keyValue('Master Port', String(slaveStatus.Master_Port || 'N/A')));
      console.log(formatter.keyValue('Master User', String(slaveStatus.Master_User || 'N/A')));
      console.log(formatter.keyValue('Relay Log File', String(slaveStatus.Relay_Log_File || 'N/A')));
      console.log(formatter.keyValue('Relay Log Pos', String(slaveStatus.Relay_Log_Pos || 'N/A')));
      console.log(formatter.keyValue('Exec Master Log Pos', String(slaveStatus.Exec_Master_Log_Pos || 'N/A')));

      if (slaveStatus.Last_IO_Error) {
        console.log();
        console.log(formatter.error('Last IO Error:'));
        console.log(formatter.info(`  ${slaveStatus.Last_IO_Error}`));
      }

      if (slaveStatus.Last_SQL_Error) {
        console.log();
        console.log(formatter.error('Last SQL Error:'));
        console.log(formatter.info(`  ${slaveStatus.Last_SQL_Error}`));
      }
    }

    console.log();
    if (status.ioRunning && status.sqlRunning) {
      console.log(formatter.success('Replication is healthy.'));
    } else {
      console.log(formatter.warning('Replication has issues. Check IO and SQL thread status.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to get replication status: ${message}`));
  }
}

/**
 * Set up replication for an instance
 */
async function setupReplication(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  // Parse arguments
  const hostArg = parseStringArg(args, '--host');
  const masterArg = parseStringArg(args, '--master');
  const user = parseStringArg(args, '--user') || 'repl';
  const password = parseStringArg(args, '--password') || 'replpassword';

  if (!hostArg || !masterArg) {
    console.log(formatter.error('Missing required arguments. Usage: /instances setup-replication --host <host:port> --master <master:port>'));
    console.log(formatter.info('  --host <host:port>     Instance to configure as replica'));
    console.log(formatter.info('  --master <master:port> Master instance to replicate from'));
    console.log(formatter.info('  --user <user>          Replication user (default: repl)'));
    console.log(formatter.info('  --password <password>  Replication password'));
    return;
  }

  // Parse host and master
  const [host, hostPortStr] = hostArg.split(':');
  const port = parseInt(hostPortStr || '3306', 10);

  const [masterHost, masterPortStr] = masterArg.split(':');
  const masterPort = parseInt(masterPortStr || '3306', 10);

  console.log(formatter.header('Setting Up Replication'));
  console.log(formatter.keyValue('Replica', `${host}:${port}`));
  console.log(formatter.keyValue('Master', `${masterHost}:${masterPort}`));
  console.log(formatter.keyValue('Replication User', user));
  console.log();

  try {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host,
      port,
      user: ctx.settings.mysql.adminUser,
      password: ctx.settings.mysql.adminPassword,
      connectTimeout: 10000,
    });

    // Stop slave first
    console.log(formatter.info('Stopping existing replication...'));
    await connection.execute('STOP SLAVE');

    // Configure replication
    console.log(formatter.info('Configuring replication...'));
    await connection.execute(`
      CHANGE MASTER TO
        MASTER_HOST = ?,
        MASTER_PORT = ?,
        MASTER_USER = ?,
        MASTER_PASSWORD = ?,
        MASTER_AUTO_POSITION = 1
    `, [masterHost, masterPort, user, password]);

    // Start slave
    console.log(formatter.info('Starting replication...'));
    await connection.execute('START SLAVE');

    // Wait and check status
    await new Promise(resolve => setTimeout(resolve, 2000));

    const [rows] = await connection.execute('SHOW SLAVE STATUS');
    const status = (rows as Record<string, unknown>[])[0];

    await connection.end();

    if (status) {
      const ioRunning = status.Slave_IO_Running === 'Yes';
      const sqlRunning = status.Slave_SQL_Running === 'Yes';

      console.log();
      console.log(formatter.keyValue('IO Thread', ioRunning ? chalk.green('Running') : chalk.red('Not running')));
      console.log(formatter.keyValue('SQL Thread', sqlRunning ? chalk.green('Running') : chalk.red('Not running')));

      if (ioRunning && sqlRunning) {
        console.log();
        console.log(formatter.success('Replication configured and running successfully!'));
      } else {
        console.log();
        console.log(formatter.warning('Replication configured but not fully running.'));
        if (status.Last_IO_Error) {
          console.log(formatter.error(`IO Error: ${status.Last_IO_Error}`));
        }
        if (status.Last_SQL_Error) {
          console.log(formatter.error(`SQL Error: ${status.Last_SQL_Error}`));
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to set up replication: ${message}`));
  }
}

/**
 * Set instance read-only (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function setReadOnly(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances read-only <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to set read-only'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  console.log(formatter.info(`Setting ${host}:${port} to read-only...`));

  try {
    const success = await orchestrator.setReadOnly(host, port);
    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} is now read-only.`));
    } else {
      console.log(formatter.error(`Failed to set ${host}:${port} read-only.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to set read-only: ${message}`));
  }
}

/**
 * Set instance writeable (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function setWriteable(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances writeable <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to set writeable'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  console.log(formatter.info(`Setting ${host}:${port} to writeable...`));

  try {
    const success = await orchestrator.setWriteable(host, port);
    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} is now writeable.`));
    } else {
      console.log(formatter.error(`Failed to set ${host}:${port} writeable.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to set writeable: ${message}`));
  }
}

/**
 * Start replication on an instance (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function startSlave(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances start-slave <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to start replication on'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  console.log(formatter.info(`Starting replication on ${host}:${port}...`));

  try {
    const success = await orchestrator.startSlave(host, port);
    if (success) {
      console.log(formatter.success(`Replication started on ${host}:${port}.`));
    } else {
      console.log(formatter.error(`Failed to start replication on ${host}:${port}.`));
      console.log(formatter.info('Ensure the instance is registered and replication is configured.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to start replication: ${message}`));
  }
}

/**
 * Stop replication on an instance (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function stopSlave(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances stop-slave <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to stop replication on'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  console.log(formatter.info(`Stopping replication on ${host}:${port}...`));

  try {
    const success = await orchestrator.stopSlave(host, port);
    if (success) {
      console.log(formatter.success(`Replication stopped on ${host}:${port}.`));
    } else {
      console.log(formatter.error(`Failed to stop replication on ${host}:${port}.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to stop replication: ${message}`));
  }
}

/**
 * Reset replication on an instance (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function resetSlave(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances reset-slave <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to reset replication on'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    console.log(formatter.warning('Warning: This removes all replication configuration!'));
    return;
  }

  const { host, port } = parsed;

  // Confirm destructive action
  console.log(formatter.warning(`This will remove all replication configuration on ${host}:${port}.`));
  console.log(formatter.info('Use /instances reset-slave --confirm <host:port> to proceed.'));

  if (!args.includes('--confirm')) {
    return;
  }

  console.log(formatter.info(`Resetting replication on ${host}:${port}...`));

  try {
    const success = await orchestrator.resetSlave(host, port);
    if (success) {
      console.log(formatter.success(`Replication reset on ${host}:${port}.`));
    } else {
      console.log(formatter.error(`Failed to reset replication on ${host}:${port}.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to reset replication: ${message}`));
  }
}

/**
 * Relocate a replica to follow a new master (via Orchestrator)
 * Requires both instances to be registered in Orchestrator
 */
async function relocateReplica(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const hostArg = parseStringArg(args, '--host');
  const masterArg = parseStringArg(args, '--master');

  if (!hostArg || !masterArg) {
    console.log(formatter.error('Missing required arguments. Usage: /instances relocate --host <host:port> --master <new-master:port>'));
    console.log(formatter.info('  --host <host:port>     Replica to relocate'));
    console.log(formatter.info('  --master <host:port>   New master to follow'));
    console.log(formatter.info('Note: Both instances must be registered in Orchestrator'));
    return;
  }

  const [host, portStr] = hostArg.split(':');
  const port = parseInt(portStr || '3306', 10);

  const [masterHost, masterPortStr] = masterArg.split(':');
  const masterPort = parseInt(masterPortStr || '3306', 10);

  console.log(formatter.header('Relocating Replica'));
  console.log(formatter.keyValue('Replica', `${host}:${port}`));
  console.log(formatter.keyValue('New Master', `${masterHost}:${masterPort}`));
  console.log();

  try {
    const success = await orchestrator.relocateReplicas(host, port, masterHost, masterPort);
    if (success) {
      console.log(formatter.success(`Replica ${host}:${port} relocated to follow ${masterHost}:${masterPort}.`));
    } else {
      console.log(formatter.error(`Failed to relocate ${host}:${port}.`));
      console.log(formatter.info('Ensure both instances are registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to relocate replica: ${message}`));
  }
}

/**
 * Put instance in maintenance mode (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function beginMaintenance(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances begin-maintenance <host:port> [--reason <reason>] [--duration <minutes>]'));
    console.log(formatter.info('  <host:port>     Instance to put in maintenance'));
    console.log(formatter.info('  --reason <r>    Reason for maintenance'));
    console.log(formatter.info('  --duration <m>  Duration in minutes (default: 60)'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  const reason = parseStringArg(args, '--reason') || 'Manual maintenance via ClawSQL';
  const duration = parseNumberArg(args, '--duration', 60);

  console.log(formatter.info(`Putting ${host}:${port} in maintenance mode...`));
  console.log(formatter.keyValue('Reason', reason));
  console.log(formatter.keyValue('Duration', `${duration} minutes`));

  try {
    const success = await orchestrator.beginMaintenance(host, port, reason, duration);
    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} is now in maintenance mode.`));
    } else {
      console.log(formatter.error(`Failed to put ${host}:${port} in maintenance mode.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to begin maintenance: ${message}`));
  }
}

/**
 * Remove instance from maintenance mode (via Orchestrator)
 * Requires instance to be registered in Orchestrator
 */
async function endMaintenance(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  const parsed = parseHostPortArgs(args);
  if (!parsed) {
    console.log(formatter.error('Missing host. Usage: /instances end-maintenance <host:port>'));
    console.log(formatter.info('  <host:port>  Instance to remove from maintenance'));
    console.log(formatter.info('Note: Instance must be registered in Orchestrator'));
    return;
  }

  const { host, port } = parsed;
  console.log(formatter.info(`Removing ${host}:${port} from maintenance mode...`));

  try {
    const success = await orchestrator.endMaintenance(host, port);
    if (success) {
      console.log(formatter.success(`Instance ${host}:${port} is no longer in maintenance mode.`));
    } else {
      console.log(formatter.error(`Failed to remove ${host}:${port} from maintenance mode.`));
      console.log(formatter.info('Ensure the instance is registered in Orchestrator.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to end maintenance: ${message}`));
  }
}

/**
 * Parse host:port argument format
 */
function parseHostPortArgs(args: string[]): { host: string; port: number } | null {
  const hostArg = args.find(a => !a.startsWith('--') && a.includes(':'));
  if (!hostArg) {
    // Try host without port
    const simpleHost = args.find(a => !a.startsWith('--') && !a.includes(':'));
    if (simpleHost) {
      return { host: simpleHost, port: 3306 };
    }
    return null;
  }

  const [host, portStr] = hostArg.split(':');
  const port = parseInt(portStr || '3306', 10);
  return { host, port };
}

export default instancesCommand;
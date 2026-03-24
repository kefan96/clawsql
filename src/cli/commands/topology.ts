/**
 * ClawSQL CLI - Topology Command
 *
 * Shows MySQL cluster topology from Orchestrator.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';

/**
 * Topology command
 */
export const topologyCommand: Command = {
  name: 'topology',
  description: 'Show MySQL cluster topology',
  usage: '/topology [cluster_name]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const orchestrator = ctx.orchestrator;

    try {
      if (args.length > 0) {
        await showClusterTopology(args[0], ctx);
      } else {
        const clusters = await orchestrator.getClusters();

        if (clusters.length === 0) {
          console.log(formatter.warning('No clusters discovered.'));
          console.log(formatter.info('Register instances with /instances register <host>'));
          return;
        }

        console.log(formatter.header('Cluster Topology'));

        for (const clusterName of clusters) {
          await showClusterTopology(clusterName, ctx);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(`Failed to get topology: ${message}`));
      console.log(formatter.info('Make sure Orchestrator is running and instances are discovered.'));
    }
  },
};

/**
 * Show topology for a specific cluster
 */
async function showClusterTopology(clusterName: string, ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const orchestrator = ctx.orchestrator;

  try {
    const cluster = await orchestrator.getTopology(clusterName);

    if (!cluster) {
      console.log(formatter.warning(`Cluster '${clusterName}' not found.`));
      return;
    }

    console.log('\n' + formatter.section(`Cluster: ${cluster.name}`));

    // Show primary
    if (cluster.primary) {
      const p = cluster.primary;
      const status = p.state === 'online' ? chalk.green('online') : chalk.red('offline');
      const info = [];
      if (p.version) info.push(`v${p.version}`);
      if (p.serverId) info.push(`id:${p.serverId}`);

      console.log(`  ${chalk.green('●')} ${chalk.bold(`${p.host}:${p.port}`)} ${status} (primary)`);
      if (info.length > 0) {
        console.log(chalk.gray(`      ${info.join(', ')}`));
      }
    } else {
      console.log(chalk.yellow('  No primary found'));
    }

    // Show replicas
    if (cluster.replicas.length > 0) {
      console.log(chalk.gray('\n  Replicas:'));
      for (const r of cluster.replicas) {
        const status = r.state === 'online' ? chalk.green('online') : chalk.red('offline');
        const lag = r.replicationLag !== undefined && r.replicationLag !== null
          ? chalk.gray(` lag:${r.replicationLag}s`)
          : '';
        console.log(`    ${chalk.blue('○')} ${r.host}:${r.port} ${status}${lag}`);
      }
    }

    console.log();
  } catch (error) {
    console.log(formatter.error(`Error getting topology for ${clusterName}`));
  }
}

export default topologyCommand;
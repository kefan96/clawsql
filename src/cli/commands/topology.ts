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
      // Get cluster name from args or fetch all clusters
      if (args.length > 0) {
        // Show specific cluster
        await showClusterTopology(args[0], ctx);
      } else {
        // Get all clusters
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

    console.log(chalk.bold(`\n📦 Cluster: ${cluster.name}`));

    // Show primary
    if (cluster.primary) {
      const primary = cluster.primary;
      const status = primary.state === 'online' ? chalk.green('[ONLINE]') : chalk.red('[OFFLINE]');
      console.log(`  ${chalk.green('●')} ${chalk.bold(primary.host)}:${primary.port} ${status} ${chalk.gray('(PRIMARY)')}`);

      if (primary.version) {
        console.log(chalk.gray(`      Version: ${primary.version}`));
      }
      if (primary.serverId) {
        console.log(chalk.gray(`      Server ID: ${primary.serverId}`));
      }
    } else {
      console.log(chalk.yellow('  ⚠ No primary found'));
    }

    // Show replicas
    if (cluster.replicas.length > 0) {
      console.log(chalk.gray('\n  Replicas:'));
      for (const replica of cluster.replicas) {
        const status = replica.state === 'online' ? chalk.green('[ONLINE]') : chalk.red('[OFFLINE]');
        const lag = replica.replicationLag !== undefined && replica.replicationLag !== null
          ? chalk.gray(` (lag: ${replica.replicationLag}s)`)
          : '';

        console.log(`    ${chalk.blue('○')} ${replica.host}:${replica.port} ${status}${lag}`);
      }
    }

    console.log();
  } catch (error) {
    console.log(formatter.error(`Error getting topology for ${clusterName}`));
  }
}

export default topologyCommand;
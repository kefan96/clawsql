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
  usage: '/clusters [sync]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const orchestrator = ctx.orchestrator;

    if (args.length > 0 && args[0].toLowerCase() === 'sync') {
      await syncClusters(ctx);
      return;
    }

    try {
      // Use the new method that provides better cluster naming
      const clustersInfo = await orchestrator.getAllClustersWithInfo();

      if (clustersInfo.length === 0) {
        console.log(formatter.warning('No clusters discovered.'));
        console.log(formatter.info('Register instances with /instances register <host>'));
        return;
      }

      console.log(formatter.header('MySQL Clusters'));

      const clusters: Array<{
        name: string;
        alias: string;
        primary: string;
        replicas: number;
      }> = [];

      for (const info of clustersInfo) {
        const cluster = await orchestrator.getTopology(info.clusterName);
        clusters.push({
          name: info.displayName,
          alias: info.clusterName,
          primary: cluster?.primary
            ? `${cluster.primary.host}:${cluster.primary.port}`
            : 'N/A',
          replicas: cluster?.replicas.length ?? 0,
        });
      }

      console.log(formatter.table(clusters, [
        { key: 'name', header: 'Cluster', width: 20 },
        { key: 'alias', header: 'Orchestrator ID', width: 25 },
        { key: 'primary', header: 'Primary', width: 25 },
        { key: 'replicas', header: 'Replicas', width: 10 },
      ]));

      console.log(formatter.info(`Total: ${clusters.length} clusters`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(`Failed to list clusters: ${message}`));
    }
  },
};

/**
 * Sync clusters from Orchestrator
 */
async function syncClusters(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  try {
    console.log(formatter.info('Syncing cluster topology from Orchestrator...'));
    const clusters = await ctx.orchestrator.getClusters();
    console.log(formatter.success(`Synced ${clusters.length} clusters.`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Sync failed: ${message}`));
  }
}

export default clustersCommand;
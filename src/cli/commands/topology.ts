/**
 * ClawSQL CLI - Topology Command
 *
 * Shows MySQL cluster topology from Orchestrator with ProxySQL routing info.
 */

import { Command, CLIContext } from '../registry.js';

/**
 * Topology command
 */
export const topologyCommand: Command = {
  name: 'topology',
  description: 'Show MySQL cluster topology with ProxySQL routing',
  usage: '/topology [cluster_name]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const clusterView = ctx.clusterView;

    try {
      if (args.length > 0) {
        const view = await clusterView.getMergedView(args[0]);
        if (!view) {
          if (ctx.outputFormat === 'json') {
            console.log(JSON.stringify({ error: `Cluster '${args[0]}' not found` }, null, 2));
          } else {
            console.log(formatter.warning(`Cluster '${args[0]}' not found.`));
          }
          return;
        }
        displayMergedTopology(view, ctx);
      } else {
        const views = await clusterView.getAllMergedViews();

        if (views.length === 0) {
          if (ctx.outputFormat === 'json') {
            console.log(JSON.stringify({ clusters: [] }, null, 2));
          } else {
            console.log(formatter.warning('No clusters discovered.'));
            console.log(formatter.info('Register instances with /instances register <host>'));
          }
          return;
        }

        // Display all clusters
        for (const view of views) {
          displayMergedTopology(view, ctx);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.outputFormat === 'json') {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.log(formatter.error(`Failed to get topology: ${message}`));
        console.log(formatter.info('Make sure Orchestrator is running and instances are discovered.'));
      }
    }
  },
};

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

export default topologyCommand;
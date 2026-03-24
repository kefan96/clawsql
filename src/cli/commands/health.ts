/**
 * ClawSQL CLI - Health Command
 *
 * Shows health status of system components.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';

/**
 * Health command
 */
export const healthCommand: Command = {
  name: 'health',
  description: 'Show system health status',
  usage: '/health [component]',
  handler: async (_args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const orchestrator = ctx.orchestrator;
    const proxysql = ctx.proxysql;

    // Collect health data
    const healthData: {
      components: Record<string, string>;
      clusters: Array<{ name: string; status: string; replicas: string }>;
    } = { components: {}, clusters: [] };

    // Check Orchestrator
    let orchestratorHealth: string;
    try {
      const isHealthy = await orchestrator.healthCheck();
      orchestratorHealth = isHealthy ? 'healthy' : 'unhealthy';
    } catch {
      orchestratorHealth = 'unreachable';
    }
    healthData.components.Orchestrator = orchestratorHealth;

    // Check ProxySQL
    let proxysqlHealth: string;
    try {
      await proxysql.connect();
      proxysqlHealth = 'healthy';
      await proxysql.close();
    } catch {
      proxysqlHealth = 'unreachable';
    }
    healthData.components.ProxySQL = proxysqlHealth;

    // Check Prometheus
    let prometheusHealth: string;
    try {
      const response = await fetch(`${ctx.settings.prometheus.url}/-/healthy`);
      prometheusHealth = response.ok ? 'healthy' : 'unhealthy';
    } catch {
      prometheusHealth = 'unreachable';
    }
    healthData.components.Prometheus = prometheusHealth;
    healthData.components['ClawSQL API'] = 'healthy';

    // Output JSON if requested
    if (ctx.outputFormat === 'json') {
      // Get cluster health for JSON output
      try {
        const clusters = await orchestrator.getClusters();
        for (const clusterName of clusters) {
          const cluster = await orchestrator.getTopology(clusterName);
          if (cluster) {
            const primaryOk = cluster.primary?.state === 'online';
            const replicaCount = cluster.replicas.length;
            const healthyReplicas = cluster.replicas.filter(r => r.state === 'online').length;
            healthData.clusters.push({
              name: clusterName,
              status: primaryOk && healthyReplicas === replicaCount ? 'ok' : 'degraded',
              replicas: `${healthyReplicas}/${replicaCount}`,
            });
          }
        }
      } catch {
        // Ignore errors getting cluster health
      }
      console.log(JSON.stringify(healthData, null, 2));
      return;
    }

    // Table output
    console.log(formatter.header('System Health'));
    console.log(formatter.keyValue('Orchestrator', colorStatus(orchestratorHealth)));
    console.log(formatter.keyValue('ProxySQL', colorStatus(proxysqlHealth)));
    console.log(formatter.keyValue('Prometheus', colorStatus(prometheusHealth)));
    console.log(formatter.keyValue('ClawSQL API', chalk.green('healthy')));

    // Try to get cluster health
    try {
      const clusters = await orchestrator.getClusters();
      if (clusters.length > 0) {
        console.log('\n' + formatter.section('Cluster Health'));

        for (const clusterName of clusters) {
          const cluster = await orchestrator.getTopology(clusterName);
          if (cluster) {
            const primaryOk = cluster.primary?.state === 'online';
            const replicaCount = cluster.replicas.length;
            const healthyReplicas = cluster.replicas.filter(r => r.state === 'online').length;
            const status = primaryOk && healthyReplicas === replicaCount
              ? chalk.green('ok')
              : chalk.yellow('degraded');

            console.log(`  ${clusterName}: ${status} (${healthyReplicas}/${replicaCount} replicas)`);
          }
        }
      }
    } catch {
      // Ignore errors getting cluster health
    }

    console.log();
  },
};

/**
 * Colorize status string
 */
function colorStatus(status: string): string {
  if (status === 'healthy') return chalk.green(status);
  if (status === 'unreachable' || status === 'unhealthy') return chalk.red(status);
  return chalk.yellow(status);
}

export default healthCommand;
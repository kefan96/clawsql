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

    console.log(formatter.header('System Health'));

    // Check Orchestrator
    let orchestratorHealth: string;
    try {
      const isHealthy = await orchestrator.healthCheck();
      orchestratorHealth = isHealthy
        ? chalk.green('healthy')
        : chalk.red('unhealthy');
    } catch {
      orchestratorHealth = chalk.red('unreachable');
    }
    console.log(formatter.keyValue('Orchestrator', orchestratorHealth));

    // Check ProxySQL
    let proxysqlHealth: string;
    try {
      await proxysql.connect();
      proxysqlHealth = chalk.green('healthy');
      await proxysql.close();
    } catch {
      proxysqlHealth = chalk.red('unreachable');
    }
    console.log(formatter.keyValue('ProxySQL', proxysqlHealth));

    // Check Prometheus
    let prometheusHealth: string;
    try {
      const response = await fetch(`${ctx.settings.prometheus.url}/-/healthy`);
      prometheusHealth = response.ok
        ? chalk.green('healthy')
        : chalk.red('unhealthy');
    } catch {
      prometheusHealth = chalk.red('unreachable');
    }
    console.log(formatter.keyValue('Prometheus', prometheusHealth));

    // API health (always healthy if we're running)
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

export default healthCommand;
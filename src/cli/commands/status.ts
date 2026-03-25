/**
 * ClawSQL CLI - Status Command
 *
 * Show the status of ClawSQL platform and services.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { spawn } from 'child_process';

/**
 * Status command
 */
export const statusCommand: Command = {
  name: 'status',
  description: 'Show platform status',
  usage: '/status [--json]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const jsonOutput = args.includes('--json');

    const status = {
      runtime: await detectRuntime(),
      containers: await getContainerStatus(),
      services: {
        clawsql: await checkService(`http://localhost:${ctx.settings.api.port}/health`, 'healthy'),
        orchestrator: await checkService('http://localhost:3000/api/health', 'OK'),
        prometheus: await checkService('http://localhost:9090/-/healthy', 'OK'),
        grafana: await checkService('http://localhost:3001/api/health', 'ok'),
        proxysql: await checkProxySQL(ctx),
      },
      clusters: await getClusterInfo(ctx),
    };

    if (jsonOutput) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(formatter.header('ClawSQL Platform Status'));

    // Runtime
    console.log(formatter.section('Container Runtime'));
    if (status.runtime) {
      console.log(formatter.keyValue('Runtime', chalk.green(status.runtime)));
    } else {
      console.log(formatter.keyValue('Runtime', chalk.red('not found')));
    }

    // Containers
    console.log(formatter.section('Containers'));
    if (status.containers.length === 0) {
      console.log(chalk.yellow('  No containers running'));
    } else {
      for (const container of status.containers) {
        const statusColor = container.status === 'running' ? chalk.green : chalk.red;
        console.log(`  ${statusColor('●')} ${container.name.padEnd(20)} ${statusColor(container.status)}`);
      }
    }

    // Services
    console.log(formatter.section('Services'));
    const serviceNames: Record<string, string> = {
      clawsql: 'ClawSQL API',
      orchestrator: 'Orchestrator',
      prometheus: 'Prometheus',
      grafana: 'Grafana',
      proxysql: 'ProxySQL',
    };

    for (const [key, label] of Object.entries(serviceNames)) {
      const serviceStatus = status.services[key as keyof typeof status.services];
      const statusIcon = serviceStatus.healthy ? chalk.green('●') : chalk.red('○');
      const statusText = serviceStatus.healthy
        ? chalk.green('healthy')
        : chalk.red(serviceStatus.error || 'unhealthy');
      console.log(`  ${statusIcon} ${label.padEnd(20)} ${statusText}`);
    }

    // Clusters
    if (status.clusters.length > 0) {
      console.log(formatter.section('MySQL Clusters'));
      for (const cluster of status.clusters) {
        const primaryStatus = cluster.primaryHealthy ? chalk.green('●') : chalk.red('○');
        console.log(`  ${primaryStatus} ${cluster.name.padEnd(20)} ${cluster.replicas} replica(s)`);
      }
    }

    console.log();
  },
};

/**
 * Service health check result
 */
interface ServiceStatus {
  healthy: boolean;
  error?: string;
}

/**
 * Container status
 */
interface ContainerInfo {
  name: string;
  status: string;
}

/**
 * Detect container runtime
 */
async function detectRuntime(): Promise<string | null> {
  const runtimes = ['docker', 'podman'];

  for (const runtime of runtimes) {
    try {
      const result = await execCommand([runtime, 'info'], true);
      if (result.success) {
        return runtime;
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Get container status
 */
async function getContainerStatus(): Promise<ContainerInfo[]> {
  const runtime = await detectRuntime();
  if (!runtime) return [];

  try {
    const result = await execCommand(
      [runtime, 'ps', '--filter', 'name=clawsql', '--filter', 'name=orchestrator',
       '--filter', 'name=proxysql', '--filter', 'name=prometheus', '--filter', 'name=grafana',
       '--format', '{{.Names}}\t{{.Status}}'],
      true
    );

    if (!result.success || !result.stdout.trim()) {
      return [];
    }

    const containers: ContainerInfo[] = [];
    for (const line of result.stdout.trim().split('\n')) {
      const [name, status] = line.split('\t');
      if (name && status) {
        containers.push({
          name,
          status: status.toLowerCase().includes('up') ? 'running' : 'stopped',
        });
      }
    }

    return containers;
  } catch {
    return [];
  }
}

/**
 * Check service health via HTTP
 */
async function checkService(url: string, expectedPattern: string): Promise<ServiceStatus> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const text = await response.text();
      if (text.toLowerCase().includes(expectedPattern.toLowerCase())) {
        return { healthy: true };
      }
    }
    return { healthy: false, error: `status ${response.status}` };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : 'unreachable' };
  }
}

/**
 * Check ProxySQL health
 */
async function checkProxySQL(ctx: CLIContext): Promise<ServiceStatus> {
  try {
    await ctx.proxysql.connect();
    await ctx.proxysql.close();
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : 'unreachable' };
  }
}

/**
 * Get cluster information
 */
async function getClusterInfo(ctx: CLIContext): Promise<Array<{ name: string; replicas: number; primaryHealthy: boolean }>> {
  try {
    const clusters = await ctx.orchestrator.getClusters();
    const result = [];

    for (const clusterName of clusters) {
      const topology = await ctx.orchestrator.getTopology(clusterName);
      if (topology) {
        result.push({
          name: topology.name || clusterName,
          replicas: topology.replicas.length,
          primaryHealthy: topology.primary?.state === 'online',
        });
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Execute a shell command
 */
function execCommand(cmd: string[], silent: boolean = false): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: silent ? 'pipe' : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (silent) {
      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });
    }

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
      });
    });

    proc.on('error', () => {
      resolve({
        success: false,
        stdout: '',
        stderr: 'Failed to execute command',
      });
    });
  });
}

export default statusCommand;
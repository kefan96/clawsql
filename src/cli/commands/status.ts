/**
 * ClawSQL CLI - Status Command
 *
 * Show the status of ClawSQL platform and services.
 */

import { Command, CLIContext } from '../registry.js';
import { theme, indicators } from '../ui/components.js';
import { spawn } from 'child_process';
import {
  getOpenClawStatus,
  isGatewayHealthy,
} from '../agent/openclaw-integration.js';
import {
  detectRuntime,
  checkImagesInstalled,
} from '../utils/docker-prereq.js';

/**
 * Platform state
 */
type PlatformState = 'running' | 'stopped' | 'not-installed' | 'no-runtime';

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

    // Detect runtime
    const runtime = await detectRuntime();

    // Check image installation status
    const imageStatus = await checkImagesInstalled(runtime);

    // Check OpenClaw status
    const openClawStatus = await getOpenClawStatus();
    const openClawGatewayHealthy = openClawStatus.available ? await isGatewayHealthy() : false;

    // Get container status
    const containers = await getContainerStatus(runtime);

    // Determine platform state
    const platformState = determinePlatformState(imageStatus, containers);

    const status = {
      runtime: runtime,
      images: imageStatus,
      platformState,
      containers,
      services: {
        clawsql: await checkService(`http://localhost:${ctx.settings.api.port}/health`, 'healthy'),
        orchestrator: await checkService('http://localhost:3000/api/health', 'OK'),
        prometheus: await checkService('http://localhost:9090/-/healthy', 'Healthy'),
        grafana: await checkService('http://localhost:3001/api/health', 'ok'),
        proxysql: await checkProxySQL(ctx),
        openclaw: {
          healthy: openClawGatewayHealthy,
          isDocker: openClawStatus.isDocker,
          isLocal: openClawStatus.isLocal,
          error: openClawStatus.available && !openClawGatewayHealthy ? 'Gateway not responding' : undefined,
        },
      },
      clusters: await getClusterInfo(ctx),
    };

    if (jsonOutput) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(formatter.header('ClawSQL Platform Status'));

    // Installation Status
    console.log(formatter.section('Installation'));
    if (imageStatus.installed.length === imageStatus.total) {
      console.log(`  ${theme.success(indicators.success)} Images:     ${theme.success(`Installed (${imageStatus.total}/${imageStatus.total})`)}`);
    } else if (imageStatus.installed.length > 0) {
      console.log(`  ${theme.warning(indicators.warning)} Images:     ${theme.warning(`Partial (${imageStatus.installed.length}/${imageStatus.total})`)}`);
    } else {
      console.log(`  ${theme.error(indicators.error)} Images:     ${theme.error('Not installed')}`);
      console.log(theme.muted('      Run: /install'));
    }

    // Platform State
    const stateDisplay: Record<PlatformState, { icon: string; text: string; color: (s: string) => string }> = {
      'running': { icon: indicators.success, text: 'Running', color: theme.success },
      'stopped': { icon: indicators.warning, text: 'Stopped', color: theme.warning },
      'not-installed': { icon: indicators.error, text: 'Not Installed', color: theme.error },
      'no-runtime': { icon: indicators.error, text: 'No Runtime', color: theme.error },
    };
    const stateInfo = stateDisplay[platformState];
    console.log(`  ${stateInfo.color(stateInfo.icon)} Platform:    ${stateInfo.color(stateInfo.text)}`);

    // Show next action suggestion
    if (platformState === 'not-installed') {
      console.log(theme.muted('      Run: /install --demo'));
    } else if (platformState === 'stopped') {
      console.log(theme.muted('      Run: /start --demo'));
    }

    // Runtime
    console.log(formatter.section('Container Runtime'));
    if (runtime) {
      console.log(formatter.keyValue('Runtime', theme.success(runtime)));
    } else {
      console.log(formatter.keyValue('Runtime', theme.error('not found')));
      console.log(theme.muted('  Install Docker or Podman to continue'));
    }

    // Containers
    console.log(formatter.section('Containers'));
    if (containers.length === 0) {
      if (imageStatus.installed.length > 0) {
        console.log(theme.warning('  No containers running'));
      } else {
        console.log(theme.muted('  No containers (images not installed)'));
      }
    } else {
      for (const container of containers) {
        const statusColor = container.status === 'running' ? theme.success : theme.error;
        console.log(`  ${statusColor(indicators.success)} ${container.name.padEnd(20)} ${statusColor(container.status)}`);
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
      openclaw: 'OpenClaw',
    };

    for (const [key, label] of Object.entries(serviceNames)) {
      const serviceStatus = status.services[key as keyof typeof status.services];

      // Handle OpenClaw special status display
      if (key === 'openclaw') {
        const ocStatus = serviceStatus as { healthy: boolean; isDocker: boolean; isLocal: boolean; error?: string };
        if (ocStatus.healthy) {
          const mode = ocStatus.isDocker ? '(Docker)' : ocStatus.isLocal ? '(local)' : '';
          console.log(`  ${theme.success(indicators.success)} ${label.padEnd(20)} ${theme.success('healthy')} ${theme.muted(mode)}`);
        } else {
          const statusText = ocStatus.error || 'not available';
          console.log(`  ${theme.error(indicators.error)} ${label.padEnd(20)} ${theme.error(statusText)}`);
        }
        continue;
      }

      const statusIcon = serviceStatus.healthy ? theme.success(indicators.success) : theme.error(indicators.error);
      const statusText = serviceStatus.healthy
        ? theme.success('healthy')
        : theme.error(serviceStatus.error || 'unhealthy');
      console.log(`  ${statusIcon} ${label.padEnd(20)} ${statusText}`);
    }

    // Clusters
    if (status.clusters.length > 0) {
      console.log(formatter.section('MySQL Clusters'));
      for (const cluster of status.clusters) {
        const primaryStatus = cluster.primaryHealthy ? theme.success(indicators.success) : theme.error(indicators.error);
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
 * Determine platform state based on images and containers
 */
function determinePlatformState(
  imageStatus: { installed: string[]; missing: string[]; total: number },
  containers: ContainerInfo[]
): PlatformState {
  // If no images installed
  if (imageStatus.installed.length === 0) {
    return 'not-installed';
  }

  // If some containers are running
  const runningContainers = containers.filter(c => c.status === 'running');
  if (runningContainers.length > 0) {
    return 'running';
  }

  // If containers exist but not running
  if (containers.length > 0) {
    return 'stopped';
  }

  // Images installed but no containers - ready to start
  return 'stopped';
}

/**
 * Get container status
 */
async function getContainerStatus(runtime: string | null): Promise<ContainerInfo[]> {
  if (!runtime) return [];

  try {
    const result = await execCommand(
      [runtime, 'ps', '-a', '--filter', 'name=clawsql', '--filter', 'name=orchestrator',
       '--filter', 'name=proxysql', '--filter', 'name=prometheus', '--filter', 'name=grafana',
       '--filter', 'name=openclaw', '--filter', 'name=mysql-primary', '--filter', 'name=mysql-replica',
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
/**
 * ClawSQL CLI - Start Command
 *
 * Start the ClawSQL platform using Docker Compose.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { ensureDockerFiles, ensureEnvFile } from '../utils/docker-files.js';
import {
  checkDockerPrerequisites,
  getDockerInstallGuidance,
  getComposeInstallGuidance,
  configureRegistryMirror,
  REGISTRY_MIRRORS,
} from '../utils/docker-prereq.js';
import {
  executeCommand,
  clearProgressCache,
} from '../utils/command-executor.js';
import { isLocalOpenClawAvailable, isDockerOpenClawAvailable } from '../agent/index.js';

/**
 * Start command
 */
export const startCommand: Command = {
  name: 'start',
  description: 'Start the ClawSQL platform',
  usage: '/start [--demo]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const demoMode = args.includes('--demo');
    const allInOneMode = args.includes('--allinone');

    // Parse --registry flag
    const registryIndex = args.indexOf('--registry');
    const registryMirror = registryIndex !== -1 && args[registryIndex + 1] ? args[registryIndex + 1] : null;

    console.log(formatter.header('Starting ClawSQL Platform'));

    if (allInOneMode) {
      console.log(formatter.info('Using all-in-one container mode'));
    }

    // Check Docker prerequisites
    const dockerInfo = await checkDockerPrerequisites();

    if (!dockerInfo.runtime) {
      console.log(formatter.error('No container runtime found (docker or podman required)'));
      console.log(getDockerInstallGuidance());
      return;
    }

    if (!dockerInfo.daemonRunning) {
      console.log(formatter.error(`${dockerInfo.runtime} daemon is not running`));
      console.log(formatter.info(`Start ${dockerInfo.runtime} and try again`));
      return;
    }

    if (!dockerInfo.composeCommand) {
      console.log(formatter.error('Docker Compose not found'));
      console.log(getComposeInstallGuidance(dockerInfo.runtime));
      return;
    }

    console.log(formatter.keyValue('Runtime', `${dockerInfo.runtime} ${dockerInfo.version}`));
    console.log(formatter.keyValue('Compose', dockerInfo.composeCommand.join(' ')));

    // Configure registry mirror if specified
    if (registryMirror && dockerInfo.runtime) {
      const mirror = REGISTRY_MIRRORS[registryMirror as keyof typeof REGISTRY_MIRRORS] || registryMirror;
      console.log(formatter.info(`Configuring registry mirror: ${mirror}`));
      const configured = await configureRegistryMirror(dockerInfo.runtime, mirror);
      if (configured) {
        console.log(formatter.success('Registry mirror configured'));
      } else {
        console.log(formatter.error('Failed to configure registry mirror'));
        console.log(formatter.info('You may need to run with sudo or configure manually'));
      }
    }

    // Ensure Docker files are extracted
    let dockerPath: string;
    try {
      dockerPath = await ensureDockerFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(message));
      return;
    }

    // Ensure .env file exists
    await ensureEnvFile();

    // Check for local OpenClaw installation
    const localOpenClawAvailable = await isLocalOpenClawAvailable();
    const dockerOpenClawAvailable = await isDockerOpenClawAvailable();
    const useLocalOpenClaw = localOpenClawAvailable || dockerOpenClawAvailable;

    if (useLocalOpenClaw) {
      console.log(formatter.success('OpenClaw gateway detected (using existing installation)'));
    } else {
      console.log(formatter.info('No local OpenClaw found - will start in Docker'));
    }

    // Build compose arguments
    const composeArgs: string[] = [];
    const composeEnv: Record<string, string> = {};
    const isPodmanCompose = dockerInfo.composeCommand[0] === 'podman-compose';

    // Select compose file based on mode
    if (allInOneMode) {
      composeArgs.push('-f', 'docker-compose.allinone.yml');
      console.log(formatter.info('Starting all-in-one container...'));
    } else if (demoMode) {
      composeArgs.push('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
      console.log(formatter.info('Starting with demo MySQL cluster...'));
      // Auto-detect host IP for demo MySQL containers' report_host
      // This ensures Orchestrator can properly discover instances using their actual IP
      const hostIp = process.env.HOST_IP || await detectHostIp();
      composeEnv.HOST_IP = hostIp;
      console.log(formatter.keyValue('Host IP', hostIp));
    } else {
      console.log(formatter.info('Starting platform services (bring your own MySQL)...'));
    }

    // Add metadata profile if no external DB configured (not for all-in-one)
    if (!allInOneMode) {
      const metadataDbHost = process.env.METADATA_DB_HOST;
      if (!metadataDbHost) {
        // podman-compose doesn't support --profile flag, use environment variable instead
        if (isPodmanCompose) {
          composeEnv.COMPOSE_PROFILES = 'metadata';
        } else {
          composeArgs.push('--profile', 'metadata');
        }
        console.log(formatter.info('Auto-provisioning metadata database...'));
      }
    }

    // Add up command
    composeArgs.push('up', '-d');

    // Skip OpenClaw service if already running locally
    // Note: --scale must come after 'up' in docker-compose
    if (useLocalOpenClaw) {
      composeArgs.push('--scale', 'openclaw=0');
    }

    // Clear progress cache for fresh start
    clearProgressCache();

    // Track progress messages shown
    const progressMessages = new Set<string>();
    const showProgress = (msg: string) => {
      if (!progressMessages.has(msg)) {
        progressMessages.add(msg);
        console.log(formatter.info(msg));
      }
    };

    // Execute compose up with abstract progress output
    console.log();
    const result = await executeCommand(dockerInfo.composeCommand, composeArgs, {
      cwd: dockerPath,
      env: Object.keys(composeEnv).length > 0 ? composeEnv : undefined,
      logCommand: demoMode ? '/start --demo' : allInOneMode ? '/start --allinone' : '/start',
      onProgress: showProgress,
    });

    if (!result.success) {
      console.log(formatter.error('Failed to start services'));
      console.log(formatter.info('Check logs: ~/.clawsql/logs/clawsql.log'));
      return;
    }

    // Wait for API to be ready
    console.log(formatter.info('Waiting for services to be ready...'));
    const apiReady = await waitForAPI(ctx, 60);

    if (!apiReady) {
      console.log(formatter.error('Timeout waiting for ClawSQL API'));
      console.log(formatter.info('Check logs: docker logs clawsql'));
      return;
    }

    // Wait for OpenClaw gateway to be ready (skip if using local)
    if (!useLocalOpenClaw) {
      console.log(formatter.info('Waiting for OpenClaw AI gateway...'));
      const openclawReady = await waitForOpenClaw(30);

      if (!openclawReady) {
        console.log(formatter.warning('OpenClaw gateway not responding (AI features may be limited)'));
        console.log(formatter.info('Check logs: docker logs openclaw'));
      } else {
        console.log(formatter.success('OpenClaw gateway is ready'));
      }
    }

    console.log(formatter.success('ClawSQL platform is ready!'));
    console.log();
    console.log(chalk.bold('Services:'));
    console.log(`  ClawSQL API:    http://localhost:${ctx.settings.api.port}`);
    console.log(`  API Docs:       http://localhost:${ctx.settings.api.port}/docs`);
    console.log(`  Orchestrator:   http://localhost:3000`);
    console.log(`  Prometheus:     http://localhost:9090`);
    console.log(`  Grafana:        http://localhost:3001 (admin/admin)`);
    console.log(`  ProxySQL:       localhost:${ctx.settings.proxysql.mysqlPort} (MySQL traffic)`);

    // Show OpenClaw info based on mode
    if (useLocalOpenClaw) {
      console.log(`  OpenClaw:       (using local installation)`);
    } else {
      console.log(`  OpenClaw:       http://localhost:18790 (AI Control UI)`);
      console.log(`  OpenClaw GW:    ws://localhost:18789 (AI Gateway)`);
    }

    if (demoMode) {
      console.log();
      console.log(chalk.bold('Demo MySQL Cluster:'));
      console.log('  Primary:   localhost:3306 (root/rootpassword)');
      console.log('  Replica 1: localhost:3307');
      console.log('  Replica 2: localhost:3308');
    }

    console.log();
    console.log(formatter.info('Run "/status" to check platform health'));
    console.log(formatter.info('Run "/doctor" to diagnose any issues'));
  },
};

/**
 * Wait for API to be ready
 */
async function waitForAPI(ctx: CLIContext, timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${ctx.settings.api.port}/health`);
      if (response.ok) {
        const data = await response.json() as { status?: string };
        if (data.status === 'healthy') {
          return true;
        }
      }
    } catch {
      // API not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Wait for OpenClaw gateway to be ready
 */
async function waitForOpenClaw(timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch('http://localhost:18789/health', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // OpenClaw not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect the host's primary IP address
 * Used for setting MySQL report_host in demo mode
 */
async function detectHostIp(): Promise<string> {
  try {
    const execa = (await import('execa')).default;
    // Get the first non-localhost IP
    const result = await execa('hostname', ['-I']);
    const ips = result.stdout.trim().split(/\s+/);
    // Find the first IP that's not localhost
    for (const ip of ips) {
      if (ip && !ip.startsWith('127.') && !ip.startsWith('169.254.')) {
        return ip;
      }
    }
    // Fallback to first IP if no suitable one found
    return ips[0] || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

export default startCommand;
/**
 * ClawSQL CLI - Start Command
 *
 * Start the ClawSQL platform using Docker Compose.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { ensureDockerFiles, ensureEnvFile } from '../utils/docker-files.js';
import {
  checkDockerPrerequisites,
  getDockerInstallGuidance,
  getComposeInstallGuidance,
} from '../utils/docker-prereq.js';

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

    console.log(formatter.header('Starting ClawSQL Platform'));

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

    // Build compose arguments
    const composeArgs: string[] = [];
    const composeEnv: Record<string, string> = {};
    const isPodmanCompose = dockerInfo.composeCommand[0] === 'podman-compose';

    // Add file flags first if demo mode
    if (demoMode) {
      composeArgs.push('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
      console.log(formatter.info('Starting with demo MySQL cluster...'));
    } else {
      console.log(formatter.info('Starting platform services (bring your own MySQL)...'));
    }

    // Add metadata profile if no external DB configured
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

    // Add up command
    composeArgs.push('up', '-d');

    // Execute compose up
    console.log();
    const result = await executeCommand(dockerInfo.composeCommand, composeArgs, {
      cwd: dockerPath,
      env: Object.keys(composeEnv).length > 0 ? composeEnv : undefined,
    });

    if (!result.success) {
      console.log(formatter.error('Failed to start services'));
      console.log(result.stderr);
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

    console.log(formatter.success('ClawSQL platform is ready!'));
    console.log();
    console.log(chalk.bold('Services:'));
    console.log(`  ClawSQL API:    http://localhost:${ctx.settings.api.port}`);
    console.log(`  API Docs:       http://localhost:${ctx.settings.api.port}/docs`);
    console.log(`  Orchestrator:   http://localhost:3000`);
    console.log(`  Prometheus:     http://localhost:9090`);
    console.log(`  Grafana:        http://localhost:3001 (admin/admin)`);
    console.log(`  ProxySQL:       localhost:${ctx.settings.proxysql.mysqlPort} (MySQL traffic)`);

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
 * Execute a command
 */
function executeCommand(
  cmd: string[],
  args: string[],
  options?: { cwd?: string; silent?: boolean; env?: Record<string, string> }
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], [...cmd.slice(1), ...args], {
      cwd: options?.cwd,
      stdio: options?.silent ? 'pipe' : 'inherit',
      env: options?.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = '';
    let stderr = '';

    if (options?.silent) {
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

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default startCommand;
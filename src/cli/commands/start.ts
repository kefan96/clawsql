/**
 * ClawSQL CLI - Start Command
 *
 * Start the ClawSQL platform using Docker Compose.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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

    // Detect container runtime
    const runtime = await detectRuntime();
    if (!runtime) {
      console.log(formatter.error('No container runtime found (docker or podman required)'));
      console.log(formatter.info('Install Docker: https://docs.docker.com/get-docker/'));
      return;
    }
    console.log(formatter.keyValue('Runtime', runtime));

    // Detect compose command
    const composeCmd = await detectComposeCommand(runtime);
    if (!composeCmd) {
      console.log(formatter.error('Docker Compose not found'));
      console.log(formatter.info('Install: pip install docker-compose'));
      return;
    }
    console.log(formatter.keyValue('Compose', composeCmd.join(' ')));

    // Find project root (where docker-compose.yml is)
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      console.log(formatter.error('Cannot find docker-compose.yml'));
      console.log(formatter.info('Run this command from the ClawSQL project directory'));
      return;
    }

    // Create .env if not exists
    const envPath = path.join(projectRoot, '.env');
    if (!fs.existsSync(envPath)) {
      const envExamplePath = path.join(projectRoot, '.env.example');
      if (fs.existsSync(envExamplePath)) {
        fs.copyFileSync(envExamplePath, envPath);
        console.log(formatter.success('Created .env from .env.example'));
      }
    }

    // Build compose arguments
    const composeArgs: string[] = [];

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
      composeArgs.push('--profile', 'metadata');
      console.log(formatter.info('Auto-provisioning metadata database...'));
    }

    // Add up command
    composeArgs.push('up', '-d');

    // Execute compose up
    console.log();
    const result = await executeCommand(composeCmd, composeArgs, { cwd: projectRoot });

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
 * Detect available container runtime
 */
async function detectRuntime(): Promise<string | null> {
  const runtimes = ['docker', 'podman'];

  for (const runtime of runtimes) {
    try {
      const result = await executeCommand([runtime], ['info'], { silent: true });
      if (result.success) {
        // Check if docker is actually podman
        if (runtime === 'docker') {
          const versionResult = await executeCommand(['docker'], ['--version'], { silent: true });
          if (versionResult.stdout.toLowerCase().includes('podman')) {
            return 'podman';
          }
        }
        return runtime;
      }
    } catch {
      // Continue to next runtime
    }
  }

  return null;
}

/**
 * Detect compose command
 */
async function detectComposeCommand(runtime: string): Promise<string[] | null> {
  // Try docker-compose first
  try {
    const result = await executeCommand(['docker-compose'], ['version'], { silent: true });
    if (result.success) {
      return ['docker-compose'];
    }
  } catch {
    // Continue
  }

  // Try docker compose plugin
  if (runtime === 'docker') {
    try {
      const result = await executeCommand(['docker'], ['compose', 'version'], { silent: true });
      if (result.success) {
        return ['docker', 'compose'];
      }
    } catch {
      // Continue
    }
  }

  // Try podman-compose
  if (runtime === 'podman') {
    try {
      const result = await executeCommand(['podman-compose'], ['version'], { silent: true });
      if (result.success) {
        return ['podman-compose'];
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Find project root directory
 */
function findProjectRoot(): string | null {
  let dir = process.cwd();

  while (dir !== '/') {
    const composePath = path.join(dir, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

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
  options?: { cwd?: string; silent?: boolean }
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], [...cmd.slice(1), ...args], {
      cwd: options?.cwd,
      stdio: options?.silent ? 'pipe' : 'inherit',
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
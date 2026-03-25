/**
 * ClawSQL CLI - Cleanup Command
 *
 * Remove all ClawSQL containers, volumes, and data.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cleanup command
 */
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Remove all containers, volumes, and data',
  usage: '/cleanup [--force]',
  handler: async (args: string[], ctx: CLIContext) => {
    const force = args.includes('--force');

    console.log(chalk.bold.red('⚠️  WARNING: This will remove all ClawSQL containers and data!'));
    console.log();

    // Confirm unless --force
    if (!force) {
      const confirmed = await ctx.confirm('Are you sure you want to continue?');
      if (!confirmed) {
        console.log(chalk.yellow('Cleanup cancelled.'));
        return;
      }
    }

    // Detect runtime
    const runtime = await detectRuntime();
    if (!runtime) {
      console.log(chalk.red('No container runtime found'));
      return;
    }

    // Find project root
    const projectRoot = findProjectRoot();

    // Stop and remove containers
    console.log(chalk.blue('Stopping containers...'));
    await stopContainers(runtime);

    // Remove volumes
    console.log(chalk.blue('Removing volumes...'));
    await removeVolumes(runtime);

    // Remove images (optional)
    console.log(chalk.blue('Removing images...'));
    await removeImages(runtime);

    // Remove local data directories
    if (projectRoot) {
      console.log(chalk.blue('Removing local data...'));
      await removeLocalData(projectRoot);
    }

    console.log();
    console.log(chalk.green('✓ Cleanup complete!'));
    console.log(chalk.gray('Run "clawsql start" to start fresh.'));
  },
};

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
 * Stop all ClawSQL containers
 */
async function stopContainers(runtime: string): Promise<void> {
  // Get all clawsql-related containers
  const result = await execCommand(
    [runtime, 'ps', '-a', '--filter', 'name=clawsql', '--filter', 'name=orchestrator',
     '--filter', 'name=proxysql', '--filter', 'name=prometheus', '--filter', 'name=grafana',
     '--filter', 'name=metadata-mysql', '--filter', 'name=mysql-', '-q'],
    true
  );

  if (result.success && result.stdout.trim()) {
    const containerIds = result.stdout.trim().split('\n').filter(Boolean);

    for (const id of containerIds) {
      await execCommand([runtime, 'rm', '-f', id], false);
    }
  }
}

/**
 * Remove volumes
 */
async function removeVolumes(runtime: string): Promise<void> {
  const volumePatterns = [
    'clawsql',
    'metadata-mysql-data',
    'proxysql-data',
    'prometheus-data',
    'grafana-data',
  ];

  for (const pattern of volumePatterns) {
    await execCommand([runtime, 'volume', 'rm', '-f', pattern], true);
  }

  // Also try to find volumes with project prefix
  const listResult = await execCommand([runtime, 'volume', 'ls', '-q'], true);
  if (listResult.success && listResult.stdout.trim()) {
    const volumes = listResult.stdout.trim().split('\n');
    for (const vol of volumes) {
      if (vol.includes('clawsql') || vol.includes('metadata') || vol.includes('proxysql') ||
          vol.includes('prometheus') || vol.includes('grafana')) {
        await execCommand([runtime, 'volume', 'rm', '-f', vol], true);
      }
    }
  }
}

/**
 * Remove images
 */
async function removeImages(runtime: string): Promise<void> {
  // Remove clawsql image (built locally)
  await execCommand([runtime, 'rmi', '-f', 'clawsql'], true);

  // Note: We don't remove base images (mysql, orchestrator, etc.) as they may be used by other projects
}

/**
 * Remove local data directories
 */
async function removeLocalData(projectRoot: string): Promise<void> {
  const dataDirs = [
    path.join(projectRoot, 'data'),
    path.join(projectRoot, 'coverage'),
  ];

  for (const dir of dataDirs) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
  }

  // Remove .env file (optional, keep for convenience)
  // const envPath = path.join(projectRoot, '.env');
  // if (fs.existsSync(envPath)) {
  //   fs.unlinkSync(envPath);
  // }
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

export default cleanupCommand;
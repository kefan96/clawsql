/**
 * ClawSQL CLI - Cleanup Command
 *
 * Remove all ClawSQL containers, volumes, and data.
 */

import { Command, CLIContext } from '../registry.js';
import { theme, indicators } from '../ui/components.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getDockerFilesDir, ensureDockerFiles } from '../utils/docker-files.js';
import { checkDockerPrerequisites } from '../utils/docker-prereq.js';

/**
 * Cleanup command
 */
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Remove all containers, volumes, and data',
  usage: '/cleanup [--force]',
  handler: async (args: string[], ctx: CLIContext) => {
    const force = args.includes('--force');

    console.log(theme.error.bold('◆ WARNING: This will remove all ClawSQL containers and data!'));
    console.log();

    // Confirm unless --force
    if (!force) {
      const confirmed = await ctx.confirm('Are you sure you want to continue?');
      if (!confirmed) {
        console.log(theme.warning('Cleanup cancelled.'));
        return;
      }
    }

    // Check Docker prerequisites
    const dockerInfo = await checkDockerPrerequisites();
    if (!dockerInfo.runtime) {
      console.log(theme.error('No container runtime found'));
      return;
    }

    // Get docker files path (extracts if needed, but we can still cleanup without it)
    let dockerPath: string | null = null;
    try {
      dockerPath = await ensureDockerFiles();
    } catch {
      // Use default path
      dockerPath = getDockerFilesDir();
    }

    // Stop and remove containers
    console.log(theme.secondary('Stopping containers...'));
    await stopContainers(dockerInfo.runtime);

    // Remove volumes
    console.log(theme.secondary('Removing volumes...'));
    await removeVolumes(dockerInfo.runtime);

    // Remove images (optional)
    console.log(theme.secondary('Removing images...'));
    await removeImages(dockerInfo.runtime);

    // Remove local data directories
    if (dockerPath && fs.existsSync(dockerPath)) {
      console.log(theme.secondary('Removing local data...'));
      await removeLocalData(dockerPath);
    }

    console.log();
    console.log(theme.success(`${indicators.check} Cleanup complete!`));
    console.log(theme.muted('Run "clawsql start" to start fresh.'));
  },
};

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
/**
 * ClawSQL CLI - Cleanup Command
 *
 * Remove all ClawSQL containers, volumes, and data.
 */

import { Command, CLIContext } from '../registry.js';
import { theme, indicators } from '../ui/components.js';
import * as path from 'path';
import * as fs from 'fs';
import { getDockerFilesDir, ensureDockerFiles } from '../utils/docker-files.js';
import { checkDockerPrerequisites } from '../utils/docker-prereq.js';
import {
  executeCommand,
  clearProgressCache,
} from '../utils/command-executor.js';

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

    // Clear progress cache and set up logging
    clearProgressCache();

    // Track progress messages shown
    const progressMessages = new Set<string>();
    const showProgress = (msg: string) => {
      if (!progressMessages.has(msg)) {
        progressMessages.add(msg);
        console.log(theme.secondary(`  ${msg}`));
      }
    };

    // Stop and remove containers
    console.log(theme.secondary('Stopping containers...'));
    await stopContainers(dockerInfo.runtime, showProgress);

    // Remove volumes
    console.log(theme.secondary('Removing volumes...'));
    await removeVolumes(dockerInfo.runtime, showProgress);

    // Remove images (optional)
    console.log(theme.secondary('Removing images...'));
    await removeImages(dockerInfo.runtime, showProgress);

    // Remove local data directories
    if (dockerPath && fs.existsSync(dockerPath)) {
      console.log(theme.secondary('Removing local data...'));
      await removeLocalData(dockerPath);
    }

    console.log(theme.success(`${indicators.check} Cleanup complete!`));
    console.log(theme.muted('Run "clawsql start" to start fresh.'));
    console.log(theme.muted('Log file: ~/.clawsql/logs/clawsql.log'));
  },
};

/**
 * Stop all ClawSQL containers
 */
async function stopContainers(runtime: string, onProgress: (msg: string) => void): Promise<void> {
  // Get all clawsql-related containers
  const result = await executeCommand(
    [runtime],
    ['ps', '-a', '--filter', 'name=clawsql', '--filter', 'name=orchestrator',
     '--filter', 'name=proxysql', '--filter', 'name=prometheus', '--filter', 'name=grafana',
     '--filter', 'name=metadata-mysql', '--filter', 'name=mysql-', '--filter', 'name=openclaw', '-q'],
    { logCommand: '/cleanup', onProgress }
  );

  if (result.success && result.stdout.trim()) {
    const containerIds = result.stdout.trim().split('\n').filter(Boolean);

    if (containerIds.length > 0) {
      // Use podman rm -af to handle dependencies (removes all specified containers)
      // The -a flag removes all matching containers, -f forces removal
      const rmResult = await executeCommand(
        [runtime, 'rm', '-f', ...containerIds],
        [],
        { logCommand: '/cleanup', onProgress }
      );

      // If individual rm fails due to dependencies, try removing all at once
      if (!rmResult.success && rmResult.stderr.includes('dependent containers')) {
        await executeCommand([runtime], ['rm', '-af', ...containerIds], {
          logCommand: '/cleanup',
          onProgress
        });
      }
    }
  }
}

/**
 * Remove volumes
 */
async function removeVolumes(runtime: string, onProgress: (msg: string) => void): Promise<void> {
  // Remove volumes by pattern (handles both clawsql_* and docker_* prefixed volumes)
  const volumePatterns = [
    'clawsql',
    'docker_openclaw-data',  // Old project name
    'docker_mysql-primary-data',
    'docker_mysql-replica-1-data',
    'docker_mysql-replica-2-data',
    'docker_proxysql-data',
    'docker_prometheus-data',
    'docker_grafana-data',
    'docker_metadata-mysql-data',
  ];

  for (const pattern of volumePatterns) {
    await executeCommand([runtime], ['volume', 'rm', '-f', pattern], {
      logCommand: '/cleanup',
      onProgress
    });
  }

  // Also try to find volumes with project prefix or known names
  const listResult = await executeCommand([runtime], ['volume', 'ls', '-q'], {
    logCommand: '/cleanup',
    onProgress
  });
  if (listResult.success && listResult.stdout.trim()) {
    const volumes = listResult.stdout.trim().split('\n');
    for (const vol of volumes) {
      // Match clawsql_, docker_ (old project), or known volume names
      if (vol.startsWith('clawsql_') || vol.startsWith('docker_') ||
          vol.includes('openclaw') || vol.includes('metadata') || vol.includes('proxysql') ||
          vol.includes('prometheus') || vol.includes('grafana') || vol.includes('mysql')) {
        await executeCommand([runtime], ['volume', 'rm', '-f', vol], {
          logCommand: '/cleanup',
          onProgress
        });
      }
    }
  }
}

/**
 * Remove images
 */
async function removeImages(runtime: string, onProgress: (msg: string) => void): Promise<void> {
  // Remove clawsql image (built locally)
  await executeCommand([runtime], ['rmi', '-f', 'clawsql'], {
    logCommand: '/cleanup',
    onProgress
  });

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

export default cleanupCommand;
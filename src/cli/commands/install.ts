/**
 * ClawSQL CLI - Install Command
 *
 * Pull all required Docker images before starting the platform.
 * This separates the preparation phase from the start phase for faster startup.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { ensureDockerFiles, ensureEnvFile } from '../utils/docker-files.js';
import {
  checkDockerPrerequisites,
  getDockerInstallGuidance,
  getComposeInstallGuidance,
} from '../utils/docker-prereq.js';
import {
  executeCommand,
  clearProgressCache,
} from '../utils/command-executor.js';
import { spawn } from 'child_process';

/**
 * Install command
 */
export const installCommand: Command = {
  name: 'install',
  description: 'Pull all required Docker images',
  usage: '/install [--demo] [--detail]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const demoMode = args.includes('--demo');
    const detailMode = args.includes('--detail') || args.includes('-v') || args.includes('--verbose');

    console.log(formatter.header('Installing ClawSQL Dependencies'));

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

    // Build compose arguments for pull
    const composeArgs: string[] = [];
    const composeEnv: Record<string, string> = {};
    const isPodmanCompose = dockerInfo.composeCommand[0] === 'podman-compose';

    // Select compose file based on mode
    if (demoMode) {
      composeArgs.push('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
      console.log(formatter.info('Installing with demo MySQL cluster images...'));
    } else {
      composeArgs.push('-f', 'docker-compose.yml');
      console.log(formatter.info('Installing platform images...'));
    }

    // Add metadata profile if no external DB configured
    const metadataDbHost = process.env.METADATA_DB_HOST;
    if (!metadataDbHost) {
      if (isPodmanCompose) {
        composeEnv.COMPOSE_PROFILES = 'metadata';
      } else {
        composeArgs.push('--profile', 'metadata');
      }
    }

    // Add pull command
    composeArgs.push('pull');

    // Show images to be pulled
    console.log();
    console.log(chalk.bold('Images:'));
    const images = getImageList(demoMode, !metadataDbHost);
    for (const img of images) {
      console.log(`  ${chalk.gray('○')} ${img}`);
    }
    console.log();

    // Clear progress cache for fresh start
    clearProgressCache();

    if (detailMode) {
      // Detailed mode: show full output with progress parsing
      console.log(chalk.bold('Pulling images:'));

      const progressMessages = new Set<string>();
      const showProgress = (msg: string) => {
        if (!progressMessages.has(msg)) {
          progressMessages.add(msg);
          if (msg.includes('✓')) {
            console.log(`  ${chalk.green(msg)}`);
          } else if (msg.includes('...')) {
            console.log(`  ${chalk.cyan(msg)}`);
          } else {
            console.log(`  ${msg}`);
          }
        }
      };

      const result = await executeCommand(dockerInfo.composeCommand, composeArgs, {
        cwd: dockerPath,
        env: Object.keys(composeEnv).length > 0 ? composeEnv : undefined,
        logCommand: demoMode ? '/install --demo --detail' : '/install --detail',
        onProgress: showProgress,
      });

      if (!result.success) {
        console.log(formatter.error('Failed to pull some images'));
        console.log(formatter.info('Check logs: ~/.clawsql/logs/clawsql.log'));
        return;
      }

      console.log();
      console.log(formatter.success('All images pulled successfully!'));
    } else {
      // Simple progress mode with streaming
      console.log(chalk.bold('Pulling images:'));

      const pulledImages = new Set<string>();
      const showProgress = (msg: string) => {
        if (!pulledImages.has(msg)) {
          pulledImages.add(msg);
          if (msg.includes('✓')) {
            console.log(`  ${chalk.green(msg)}`);
          } else if (msg.includes('...')) {
            console.log(`  ${chalk.cyan(msg)}`);
          }
        }
      };

      // Execute pull with progress tracking
      const result = await pullImagesWithProgress(
        dockerInfo.composeCommand,
        composeArgs,
        dockerPath,
        composeEnv,
        showProgress
      );

      if (!result.success) {
        console.log();
        console.log(formatter.error('Failed to pull some images'));
        console.log(formatter.info('Run "/install --detail" to see full error logs'));
        console.log(formatter.info('Check logs: ~/.clawsql/logs/clawsql.log'));
        return;
      }

      console.log();
      console.log(formatter.success('All images ready!'));
    }

    console.log();
    console.log(formatter.info('Run "/start" to launch the platform'));
    if (demoMode) {
      console.log(formatter.info('Run "/start --demo" to launch with demo MySQL cluster'));
    }
  },
};

/**
 * Pull images with real-time progress tracking
 */
async function pullImagesWithProgress(
  cmd: string[],
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  onProgress: (msg: string) => void
): Promise<{ success: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], [...cmd.slice(1), ...args], {
      cwd,
      stdio: 'pipe',
      env: env ? { ...process.env, ...env } : process.env,
    });

    let stderr = '';
    let currentImage = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();

      // Track which image is being pulled (docker compose format)
      const pullMatch = output.match(/Pulling\s+(\S+)/i);
      if (pullMatch) {
        currentImage = formatImageName(pullMatch[1]);
        onProgress(`${currentImage}...`);
      }

      // Show completion (docker compose format)
      if (output.includes('Pulled') || output.includes('already exists')) {
        if (currentImage) {
          onProgress(`${currentImage} ✓`);
          currentImage = '';
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderr += output;

      // Also parse stderr for progress info (podman outputs there)
      const pullMatch = output.match(/Trying to pull\s+(\S+)/i);
      if (pullMatch) {
        currentImage = formatImageName(pullMatch[1]);
        onProgress(`${currentImage}...`);
      }

      // Show completion from stderr (podman format)
      if (output.includes('Writing manifest to image destination')) {
        if (currentImage) {
          onProgress(`${currentImage} ✓`);
          currentImage = '';
        }
      }

      // Handle layer downloads
      if (output.includes('Copying blob') && currentImage) {
        // Image is being downloaded
      }
    });

    proc.on('close', (code) => {
      // Mark any remaining image as done
      if (currentImage) {
        onProgress(`${currentImage} ✓`);
      }
      resolve({
        success: code === 0,
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        stderr: err.message,
      });
    });
  });
}

/**
 * Format image name for display
 */
function formatImageName(image: string): string {
  // Remove registry prefix
  let shortName = image
    .replace(/^docker\.io\//i, '')
    .replace(/^ghcr\.io\//i, '')
    .replace(/^registry\.access\.redhat\.com\//i, '')
    .replace(/library\//i, '');

  // Map to friendly names
  const friendlyNames: Record<string, string> = {
    'openclaw/openclaw': 'OpenClaw',
    'mysql': 'MySQL 8.0',
    'openarkcode/orchestrator': 'Orchestrator',
    'proxysql/proxysql': 'ProxySQL',
    'prom/prometheus': 'Prometheus',
    'grafana/grafana': 'Grafana',
    'kefan96/clawsql': 'ClawSQL',
  };

  // Check if we have a friendly name
  for (const [key, friendly] of Object.entries(friendlyNames)) {
    if (shortName.includes(key)) {
      return friendly;
    }
  }

  // Truncate if too long
  if (shortName.length > 25) {
    return shortName.substring(0, 25) + '...';
  }
  return shortName;
}

/**
 * Get list of images to be pulled
 */
function getImageList(demoMode: boolean, includeMetadata: boolean): string[] {
  const images: { name: string; desc: string }[] = [];

  // Core platform images
  images.push({ name: 'OpenClaw', desc: 'AI Agent Gateway' });
  images.push({ name: 'Orchestrator', desc: 'MySQL topology management' });
  images.push({ name: 'ProxySQL', desc: 'MySQL traffic routing' });
  images.push({ name: 'Prometheus', desc: 'Metrics collection' });
  images.push({ name: 'Grafana', desc: 'Visualization dashboards' });
  images.push({ name: 'ClawSQL', desc: 'Main application' });

  // Metadata MySQL
  if (includeMetadata) {
    images.push({ name: 'MySQL 8.0', desc: 'Metadata database' });
  }

  // Demo MySQL cluster
  if (demoMode) {
    images.push({ name: 'MySQL 8.0', desc: 'Demo primary (port 3306)' });
    images.push({ name: 'MySQL 8.0', desc: 'Demo replica 1 (port 3307)' });
    images.push({ name: 'MySQL 8.0', desc: 'Demo replica 2 (port 3308)' });
  }

  return images.map(i => `${i.name} - ${i.desc}`);
}

export default installCommand;
/**
 * ClawSQL CLI - Stop Command
 *
 * Stop the ClawSQL platform.
 */

import { Command, CLIContext } from '../registry.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Stop command
 */
export const stopCommand: Command = {
  name: 'stop',
  description: 'Stop the ClawSQL platform',
  usage: '/stop',
  handler: async (_args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    console.log(formatter.header('Stopping ClawSQL Platform'));

    // Detect container runtime
    const runtime = await detectRuntime();
    if (!runtime) {
      console.log(formatter.error('No container runtime found'));
      return;
    }

    // Detect compose command
    const composeCmd = await detectComposeCommand(runtime);
    if (!composeCmd) {
      console.log(formatter.error('Docker Compose not found'));
      return;
    }

    // Find project root
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      console.log(formatter.error('Cannot find docker-compose.yml'));
      return;
    }

    // Check if demo mode was used
    const demoComposePath = path.join(projectRoot, 'docker-compose.demo.yml');
    const hasDemo = fs.existsSync(demoComposePath);

    // Build compose arguments
    const composeArgs = ['down'];
    if (hasDemo) {
      composeArgs.unshift('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
    }

    // Execute compose down
    console.log(formatter.info('Stopping services...'));
    const result = await executeCommand(composeCmd, composeArgs, { cwd: projectRoot });

    if (result.success) {
      console.log(formatter.success('ClawSQL platform stopped'));
    } else {
      console.log(formatter.error('Failed to stop services'));
      console.log(result.stderr);
    }
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
        return runtime;
      }
    } catch {
      // Continue
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

  // Try docker compose-plugin
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

export default stopCommand;
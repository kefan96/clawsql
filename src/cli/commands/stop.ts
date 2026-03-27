/**
 * ClawSQL CLI - Stop Command
 *
 * Stop the ClawSQL platform.
 */

import { Command, CLIContext } from '../registry.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getDockerFilesDir, ensureDockerFiles } from '../utils/docker-files.js';
import { checkDockerPrerequisites } from '../utils/docker-prereq.js';

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

    // Check Docker prerequisites
    const dockerInfo = await checkDockerPrerequisites();

    if (!dockerInfo.runtime) {
      console.log(formatter.error('No container runtime found'));
      return;
    }

    if (!dockerInfo.composeCommand) {
      console.log(formatter.error('Docker Compose not found'));
      return;
    }

    // Ensure Docker files are available (extracts if needed)
    let dockerPath: string;
    try {
      dockerPath = await ensureDockerFiles();
    } catch {
      // If extraction fails, try to stop containers directly
      dockerPath = getDockerFilesDir();
    }

    // Check if demo mode was used
    const demoComposePath = path.join(dockerPath, 'docker-compose.demo.yml');
    const hasDemo = fs.existsSync(demoComposePath);

    // Build compose arguments
    const composeArgs = ['down'];
    if (hasDemo) {
      composeArgs.unshift('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
    }

    // Execute compose down
    console.log(formatter.info('Stopping services...'));
    const result = await executeCommand(dockerInfo.composeCommand, composeArgs, { cwd: dockerPath });

    if (result.success) {
      console.log(formatter.success('ClawSQL platform stopped'));
    } else {
      console.log(formatter.error('Failed to stop services'));
      console.log(result.stderr);
    }
  },
};

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
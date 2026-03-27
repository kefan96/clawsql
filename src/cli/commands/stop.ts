/**
 * ClawSQL CLI - Stop Command
 *
 * Stop the ClawSQL platform.
 */

import { Command, CLIContext } from '../registry.js';
import * as path from 'path';
import * as fs from 'fs';
import { getDockerFilesDir, ensureDockerFiles } from '../utils/docker-files.js';
import { checkDockerPrerequisites } from '../utils/docker-prereq.js';
import {
  executeCommand,
  clearProgressCache,
} from '../utils/command-executor.js';

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

    // Execute compose down with abstract progress output
    console.log(formatter.info('Stopping services...'));
    const result = await executeCommand(dockerInfo.composeCommand, composeArgs, {
      cwd: dockerPath,
      logCommand: '/stop',
      onProgress: showProgress,
    });

    if (result.success) {
      console.log(formatter.success('ClawSQL platform stopped'));
    } else {
      console.log(formatter.error('Failed to stop services'));
      console.log(formatter.info('Check logs: ~/.clawsql/logs/clawsql.log'));
    }
  },
};

export default stopCommand;
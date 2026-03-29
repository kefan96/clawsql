/**
 * ClawSQL CLI - Command Executor Utility
 *
 * Executes shell commands with:
 * - Abstract progress output to console
 * - Detailed logging to file (~/.clawsql/logs/clawsql.log)
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get the ClawSQL home directory (~/.clawsql/)
 */
export function getClawSQLHome(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.clawsql');
}

/**
 * Get the log file path (~/.clawsql/logs/clawsql.log)
 */
export function getLogFilePath(): string {
  return path.join(getClawSQLHome(), 'logs', 'clawsql.log');
}

/**
 * Ensure the log directory exists
 */
export function ensureLogDir(): void {
  const logDir = path.dirname(getLogFilePath());
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Append output to the log file
 */
export function appendToLog(_command: string, output: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  ensureLogDir();
  const logPath = getLogFilePath();
  const timestamp = new Date().toISOString();
  const lines = output.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const logLine = `[${timestamp}] [${stream}] ${line}\n`;
    fs.appendFileSync(logPath, logLine);
  }
}

/**
 * Write a command header to the log file
 */
export function logCommandHeader(command: string): void {
  ensureLogDir();
  const logPath = getLogFilePath();
  const timestamp = new Date().toISOString();
  const header = `\n[${timestamp}] === ${command} ===\n`;
  fs.appendFileSync(logPath, header);
}

/**
 * Docker/docker-compose progress patterns
 * Maps output patterns to user-friendly messages with service names
 */
const PROGRESS_PATTERNS: Array<{ pattern: RegExp; message: string | ((match: RegExpMatchArray) => string) }> = [
  // Image pulling - capture the actual image name
  { pattern: /Trying to pull ([^\s]+)/i, message: (m) => `Pulling ${formatImageName(m[1])}...` },
  { pattern: /Getting image source signatures/i, message: 'Verifying image signatures...' },
  { pattern: /Copying blob/i, message: 'Downloading image layers...' },
  { pattern: /Copying config/i, message: 'Writing image config...' },
  { pattern: /Writing manifest to image destination/i, message: 'Image ready' },

  // Container creation/start - capture the container/service name
  { pattern: /podman run --name=(\S+)/i, message: (m) => `Starting ${m[1]}...` },
  { pattern: /docker run --name (\S+)/i, message: (m) => `Starting ${m[1]}...` },
  { pattern: /Creating (\S+)/i, message: (m) => `Creating ${m[1]}...` },
  { pattern: /Starting (\S+)/i, message: (m) => `Starting ${m[1]}...` },

  // Volume creation - capture volume name
  { pattern: /podman volume create.*?(\S+)/i, message: (m) => `Creating volume ${cleanVolumeName(m[1])}...` },
  { pattern: /docker volume create.*?(\S+)/i, message: (m) => `Creating volume ${cleanVolumeName(m[1])}...` },
  { pattern: /Volume (\S+) created/i, message: (m) => `Volume ${cleanVolumeName(m[1])} created ✓` },

  // Network creation
  { pattern: /podman network create.*?(\S+)/i, message: (m) => `Creating network ${m[1]}...` },
  { pattern: /docker network create.*?(\S+)/i, message: (m) => `Creating network ${m[1]}...` },
  { pattern: /Network (\S+) created/i, message: (m) => `Network ${m[1]} created ✓` },

  // Container status
  { pattern: /Container (\S+) started/i, message: (m) => `${m[1]} started ✓` },
  { pattern: /Container (\S+) created/i, message: (m) => `${m[1]} created ✓` },
  { pattern: /exit code: 0$/i, message: 'Container ready ✓' },

  // Container removal
  { pattern: /Removing container (\S+)/i, message: (m) => `Removing ${m[1]}...` },
  { pattern: /Removed container (\S+)/i, message: (m) => `${m[1]} removed ✓` },
  { pattern: /Stopping container (\S+)/i, message: (m) => `Stopping ${m[1]}...` },
  { pattern: /Stopped container (\S+)/i, message: (m) => `${m[1]} stopped ✓` },

  // Network/volume removal
  { pattern: /Removing network (\S+)/i, message: (m) => `Removing network ${m[1]}...` },
  { pattern: /Removed network (\S+)/i, message: (m) => `Network ${m[1]} removed ✓` },
  { pattern: /Removing volume (\S+)/i, message: (m) => `Removing volume ${m[1]}...` },
  { pattern: /Removed volume (\S+)/i, message: (m) => `Volume ${m[1]} removed ✓` },
];

/**
 * Format image name for display (shorten long registry paths)
 */
function formatImageName(image: string): string {
  // Remove registry prefix if it's a common one
  const shortName = image
    .replace(/^docker\.io\//, '')
    .replace(/^registry\.access\.redhat\.com\//, '')
    .replace(/^ghcr\.io\//, '');

  // If still too long, truncate
  if (shortName.length > 40) {
    return shortName.substring(0, 40) + '...';
  }
  return shortName;
}

/**
 * Clean volume name (remove docker_ prefix)
 */
function cleanVolumeName(name: string): string {
  return name.replace(/^docker_/, '').replace(/-data$/, ' data');
}

/**
 * Parse output and extract progress message
 */
function parseProgressMessage(output: string): string | null {
  for (const { pattern, message } of PROGRESS_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      if (typeof message === 'function') {
        return message(match);
      }
      return message;
    }
  }
  return null;
}

/**
 * Execute options
 */
export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  onProgress?: (message: string) => void;
  /** Command name for logging (e.g., "/start --demo") */
  logCommand?: string;
}

/**
 * Execute result
 */
export interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Track which messages have been shown to avoid repetition
 */
const shownMessages = new Set<string>();

/**
 * Execute a shell command with abstract progress output and file logging
 */
export function executeCommand(
  cmd: string[],
  args: string[],
  options?: ExecuteOptions
): Promise<ExecuteResult> {
  return new Promise((resolve) => {
    // Log command header if specified
    if (options?.logCommand) {
      logCommandHeader(options.logCommand);
    }

    const proc = spawn(cmd[0], [...cmd.slice(1), ...args], {
      cwd: options?.cwd,
      stdio: 'pipe', // Always capture output
      env: options?.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = '';
    let stderr = '';

    // Track shown messages for this execution
    const localShownMessages = new Set<string>();

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      stdout += output;

      // Log to file
      appendToLog(options?.logCommand || 'command', output, 'stdout');

      // Parse for progress message
      if (options?.onProgress) {
        const progressMsg = parseProgressMessage(output);
        if (progressMsg && !localShownMessages.has(progressMsg)) {
          localShownMessages.add(progressMsg);
          options.onProgress(progressMsg);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderr += output;

      // Log to file
      appendToLog(options?.logCommand || 'command', output, 'stderr');

      // Parse for progress message (errors can also contain useful info)
      if (options?.onProgress) {
        const progressMsg = parseProgressMessage(output);
        if (progressMsg && !localShownMessages.has(progressMsg)) {
          localShownMessages.add(progressMsg);
          options.onProgress(progressMsg);
        }
      }
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      const errorMsg = `Failed to execute command: ${err.message}`;
      appendToLog(options?.logCommand || 'command', errorMsg, 'stderr');
      resolve({
        success: false,
        stdout: '',
        stderr: errorMsg,
      });
    });
  });
}

/**
 * Execute a command with simple progress indicator
 * Shows a spinner while the command runs
 */
export async function executeWithProgress(
  cmd: string[],
  args: string[],
  options: ExecuteOptions & { initialMessage: string }
): Promise<ExecuteResult> {
  // Show initial message
  if (options.onProgress) {
    options.onProgress(options.initialMessage);
  }

  return executeCommand(cmd, args, options);
}

/**
 * Clear the shown messages cache (call at the start of each command)
 */
export function clearProgressCache(): void {
  shownMessages.clear();
}

export default executeCommand;
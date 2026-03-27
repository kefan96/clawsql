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
 * Maps output patterns to user-friendly messages
 */
const PROGRESS_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /Pulling image|Pulling from|Pulling fs layer/i, message: 'Pulling images...' },
  { pattern: /Downloading|Extracting/i, message: 'Downloading images...' },
  { pattern: /Creating network/i, message: 'Creating network...' },
  { pattern: /Creating volume/i, message: 'Creating volumes...' },
  { pattern: /Building|Step \d+\/\d+/i, message: 'Building containers...' },
  { pattern: /Creating .*Container/i, message: 'Creating containers...' },
  { pattern: /Starting .*Container/i, message: 'Starting containers...' },
  { pattern: /Network .* created/i, message: 'Network created' },
  { pattern: /Volume .* created/i, message: 'Volume created' },
  { pattern: /Container .* started/i, message: 'Container started' },
  { pattern: /Container .* created/i, message: 'Container created' },
  { pattern: /Removing container/i, message: 'Removing containers...' },
  { pattern: /Removed container/i, message: 'Container removed' },
  { pattern: /Stopping container/i, message: 'Stopping containers...' },
  { pattern: /Stopped container/i, message: 'Container stopped' },
  { pattern: /Removing network/i, message: 'Removing network...' },
  { pattern: /Removed network/i, message: 'Network removed' },
  { pattern: /Removing volume/i, message: 'Removing volumes...' },
  { pattern: /Removed volume/i, message: 'Volume removed' },
  { pattern: /Error|error|ERROR/i, message: 'Error detected' },
  { pattern: /Warning|warning|WARN/i, message: 'Warning detected' },
];

/**
 * Parse output and extract progress message
 */
function parseProgressMessage(output: string): string | null {
  for (const { pattern, message } of PROGRESS_PATTERNS) {
    if (pattern.test(output)) {
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
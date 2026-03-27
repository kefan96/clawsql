/**
 * ClawSQL CLI - OpenClaw Integration
 *
 * Integrates with OpenClaw gateway for AI-powered operations.
 * Supports both Docker-based gateway and local CLI installation.
 */

import { spawn } from 'child_process';
import { CLIContext } from '../registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_GATEWAY_URL = 'ws://localhost:18789';
const DEFAULT_GATEWAY_TOKEN = 'clawsql-openclaw-token';
const SESSION_ID = 'clawsql-session';
const DEFAULT_TIMEOUT = 120000;

const getGatewayUrl = () => process.env.OPENCLAW_GATEWAY_URL || DEFAULT_GATEWAY_URL;
const getGatewayToken = () => process.env.OPENCLAW_GATEWAY_TOKEN || DEFAULT_GATEWAY_TOKEN;

// ============================================================================
// Types
// ============================================================================

export interface OpenClawOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeout?: number;
}

export interface OpenClawStatus {
  available: boolean;
  isLocal: boolean;
  isDocker: boolean;
}

// ============================================================================
// Process Execution Utility
// ============================================================================

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Execute a command and return the result
 */
function execCommand(
  command: string,
  args: string[],
  options?: { timeout?: number; env?: Record<string, string> }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      timeout: options?.timeout || 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options?.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ success: false, stdout: '', stderr: err.message });
    });
  });
}

/**
 * Execute openclaw CLI with gateway configuration
 */
async function execOpenClaw(
  args: string[],
  options?: { timeout?: number; gatewayUrl?: string; gatewayToken?: string }
): Promise<ExecResult> {
  const gatewayUrl = options?.gatewayUrl || getGatewayUrl();
  const gatewayToken = options?.gatewayToken || getGatewayToken();

  const env: Record<string, string> = {};
  if (gatewayUrl !== DEFAULT_GATEWAY_URL) {
    env.OPENCLAW_GATEWAY_URL = gatewayUrl;
  }
  env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;

  return execCommand('openclaw', args, { timeout: options?.timeout, env });
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if OpenClaw Docker container is running
 */
export async function isDockerOpenClawAvailable(): Promise<boolean> {
  const result = await execCommand('docker', [
    'ps', '--filter', 'name=openclaw', '--filter', 'status=running',
    '--format', '{{.Names}}'
  ]);
  return result.success && result.stdout.trim() === 'openclaw';
}

/**
 * Check if OpenClaw gateway health endpoint responds
 */
export async function isGatewayHealthy(): Promise<boolean> {
  try {
    const httpUrl = getGatewayUrl().replace('ws://', 'http://').replace('wss://', 'https://');
    const response = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if local OpenClaw CLI gateway is running (not Docker)
 */
export async function isLocalOpenClawAvailable(): Promise<boolean> {
  // Docker container takes precedence
  if (await isDockerOpenClawAvailable()) {
    return false;
  }

  // Gateway must be reachable
  if (!(await isGatewayHealthy())) {
    return false;
  }

  // Verify via CLI status
  const result = await execCommand('openclaw', ['status', '--json'], { timeout: 5000 });
  if (!result.success) {
    return false;
  }

  try {
    const status = JSON.parse(result.stdout);
    return status.gateway?.mode === 'local' && !!status.gateway?.url;
  } catch {
    return false;
  }
}

/**
 * Check if any OpenClaw gateway is available (Docker or local)
 */
export async function isOpenClawAvailable(): Promise<boolean> {
  return (await isDockerOpenClawAvailable()) || (await isLocalOpenClawAvailable());
}

/**
 * Get detailed OpenClaw status
 */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const [isDocker, isLocal] = await Promise.all([
    isDockerOpenClawAvailable(),
    isLocalOpenClawAvailable(),
  ]);

  return {
    available: isDocker || isLocal,
    isDocker,
    isLocal,
  };
}

// ============================================================================
// Agent Functions
// ============================================================================

/**
 * Send a message to OpenClaw agent
 */
export async function sendToOpenClaw(
  message: string,
  options?: OpenClawOptions & { signal?: AbortSignal }
): Promise<string> {
  const args = [
    'agent',
    '--session-id', SESSION_ID,
    '--message', message,
    '--thinking', 'minimal',
  ];

  const timeout = options?.timeout || DEFAULT_TIMEOUT;
  const gatewayUrl = options?.gatewayUrl || getGatewayUrl();
  const gatewayToken = options?.gatewayToken || getGatewayToken();

  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_URL: gatewayUrl,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      } as Record<string, string>,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    // Handle abort signal
    const abortHandler = () => {
      proc.kill('SIGKILL');
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        proc.kill('SIGKILL');
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', abortHandler);
    }

    proc.on('close', (code) => {
      options?.signal?.removeEventListener('abort', abortHandler);

      if (code === 0) {
        resolve(stdout.trim());
      } else if (code === null) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      } else {
        reject(new Error(`OpenClaw agent failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      options?.signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

/**
 * Send a message to OpenClaw with streaming output
 */
export async function sendToOpenClawStream(
  message: string,
  onChunk: (chunk: string) => void,
  options?: OpenClawOptions & { signal?: AbortSignal }
): Promise<string> {
  const args = [
    'agent',
    '--session-id', SESSION_ID,
    '--message', message,
    '--thinking', 'minimal',
  ];

  const timeout = options?.timeout || DEFAULT_TIMEOUT;
  const gatewayUrl = options?.gatewayUrl || getGatewayUrl();
  const gatewayToken = options?.gatewayToken || getGatewayToken();

  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_URL: gatewayUrl,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      } as Record<string, string>,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      onChunk(chunk);
    });

    proc.stderr?.on('data', (data) => { stderr += data; });

    // Handle abort signal
    const abortHandler = () => {
      proc.kill('SIGKILL');
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        proc.kill('SIGKILL');
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', abortHandler);
    }

    proc.on('close', (code) => {
      options?.signal?.removeEventListener('abort', abortHandler);

      if (code === 0) {
        resolve(stdout.trim());
      } else if (code === null) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      } else {
        reject(new Error(`OpenClaw agent failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      options?.signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

// ============================================================================
// Cron & Notifications
// ============================================================================

/**
 * Schedule a cron job via OpenClaw
 */
export async function scheduleCron(
  name: string,
  schedule: string,
  prompt: string
): Promise<string> {
  const result = await execOpenClaw([
    'cron', 'add',
    '--name', name,
    '--schedule', schedule,
    '--prompt', prompt,
  ], { timeout: 10000 });

  if (!result.success) {
    throw new Error(`Failed to schedule cron: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

/**
 * Send a notification via OpenClaw channels
 */
export async function sendNotification(to: string, message: string): Promise<string> {
  const result = await execOpenClaw([
    'message', 'send',
    '--to', to,
    '--message', message,
  ], { timeout: 30000 });

  if (!result.success) {
    throw new Error(`Failed to send message: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

/**
 * Write to OpenClaw memory
 */
export async function writeToMemory(
  content: string,
  filename: string = 'clawsql-cluster-state.md'
): Promise<void> {
  const memoryDir = path.join(os.homedir(), '.openclaw', 'memory');

  try {
    await fs.promises.mkdir(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, filename);
    await fs.promises.appendFile(filePath, `\n\n---\n\n${content}`);
  } catch {
    // Memory write is optional - silently ignore errors
  }
}

// ============================================================================
// Agent Class
// ============================================================================

/**
 * OpenClaw-backed AI agent
 */
export class OpenClawAgent {
  private context: CLIContext;
  private _available: boolean | null = null;

  constructor(ctx: CLIContext) {
    this.context = ctx;
  }

  async isAvailable(): Promise<boolean> {
    if (this._available === null) {
      this._available = await isOpenClawAvailable();
    }
    return this._available;
  }

  async process(input: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenClaw gateway is not running. Start it with: openclaw gateway');
    }

    const contextPrompt = this.buildContextPrompt();
    return sendToOpenClaw(`${contextPrompt}\n\nUser query: ${input}`);
  }

  async scheduleHealthCheck(schedule: string = '0 * * * *'): Promise<string> {
    return scheduleCron(
      'clawsql:health-check',
      schedule,
      'Check MySQL cluster health using clawsql skill. Report any issues with instances, replication lag, or failover status.'
    );
  }

  async alert(channel: string, message: string): Promise<string> {
    return sendNotification(channel, `🦞 ClawSQL Alert: ${message}`);
  }

  private buildContextPrompt(): string {
    const { orchestrator, proxysql, failover } = this.context.settings;
    return `You are the ClawSQL assistant. You have access to MySQL cluster management tools.

Current configuration:
- Orchestrator: ${orchestrator.url}
- ProxySQL: ${proxysql.host}:${proxysql.adminPort}
- Auto-failover: ${failover.autoFailoverEnabled ? 'enabled' : 'disabled'}

Use the clawsql skill commands to answer questions about the MySQL cluster.`;
  }
}

/**
 * Create an OpenClaw agent instance
 */
export function createOpenClawAgent(ctx: CLIContext): OpenClawAgent {
  return new OpenClawAgent(ctx);
}

// ============================================================================
// Backwards Compatibility Exports
// ============================================================================

/** @deprecated Use isDockerOpenClawAvailable instead */
export const isDockerOpenClawContainerRunning = isDockerOpenClawAvailable;

/** @deprecated Use isGatewayHealthy instead */
export const isOpenClawGatewayReachable = isGatewayHealthy;

/** @deprecated Use getOpenClawStatus() or individual detection functions */
export async function ensureOpenClawRunning(timeoutSeconds: number = 30): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutSeconds * 1000) {
    if (await isGatewayHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}
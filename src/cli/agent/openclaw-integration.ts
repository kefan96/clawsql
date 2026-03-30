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
import { detectRuntime } from '../utils/docker-prereq.js';

// ============================================================================
// Configuration
// ============================================================================

export const CONFIG = {
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789',
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || 'clawsql-openclaw-token',
  sessionId: 'clawsql-session',
  defaultTimeout: 120000,
  healthCheckTimeout: 5000,
  containerName: 'openclaw',
};

// Cached runtime detection
let cachedRuntime: 'docker' | 'podman' | null | undefined;

async function getContainerRuntime(): Promise<'docker' | 'podman' | null> {
  if (cachedRuntime === undefined) {
    cachedRuntime = await detectRuntime();
  }
  return cachedRuntime;
}

// ============================================================================
// Types
// ============================================================================

export interface OpenClawOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface OpenClawStatus {
  available: boolean;
  isLocal: boolean;
  isDocker: boolean;
}

export interface ModelProviderInfo {
  provider: string | null;
  model: string | null;
  configured: boolean;
}

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

interface SpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// ============================================================================
// Process Execution Utilities
// ============================================================================

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
      timeout: options?.timeout ?? 30000,
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
 * Get spawn configuration for OpenClaw CLI execution
 * Automatically uses container exec when OpenClaw is running in Docker/Podman
 */
async function getSpawnConfig(args: string[]): Promise<SpawnConfig> {
  const isDocker = await isDockerOpenClawAvailable();
  const runtime = isDocker ? await getContainerRuntime() : null;

  // Environment variables to pass to OpenClaw
  // Include all AI-related env vars for seamless integration
  const env: Record<string, string> = {
    OPENCLAW_GATEWAY_URL: CONFIG.gatewayUrl,
    OPENCLAW_GATEWAY_TOKEN: CONFIG.gatewayToken,
    // Anthropic/Claude configuration
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? '',
    // OpenAI configuration
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? '',
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? '',
  };

  if (runtime) {
    // Execute inside container - pass env vars via -e flags
    return {
      command: runtime,
      args: [
        'exec',
        '-e', 'OPENCLAW_GATEWAY_URL',
        '-e', 'OPENCLAW_GATEWAY_TOKEN',
        '-e', 'ANTHROPIC_API_KEY',
        '-e', 'ANTHROPIC_BASE_URL',
        '-e', 'ANTHROPIC_MODEL',
        '-e', 'OPENAI_API_KEY',
        '-e', 'OPENAI_BASE_URL',
        '-e', 'OPENAI_MODEL',
        CONFIG.containerName,
        'openclaw',
        ...args,
      ],
      env,
    };
  }

  // Execute local CLI
  return {
    command: 'openclaw',
    args,
    env,
  };
}

/**
 * Spawn OpenClaw process with proper configuration
 * Filters out internal log messages from stdout
 */
function spawnOpenClaw(
  args: string[],
  options?: OpenClawOptions & { onChunk?: (chunk: string) => void }
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const spawnConfig = await getSpawnConfig(args);
    const timeout = options?.timeout ?? CONFIG.defaultTimeout;

    const proc = spawn(spawnConfig.command, spawnConfig.args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnConfig.env,
    });

    let stdout = '';
    let stderr = '';

    /**
     * Filter out OpenClaw internal log lines from output
     * Log lines start with [bracket] pattern like [agents/...] or [xai-auth]
     */
    const filterLogLines = (text: string): string => {
      return text.split('\n')
        .filter(line => !line.trim().startsWith('['))
        .join('\n');
    };

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Filter log lines when streaming to user
      const filtered = filterLogLines(chunk);
      if (filtered) {
        options?.onChunk?.(filtered);
      }
    });

    proc.stderr?.on('data', (data) => { stderr += data; });

    // Abort signal handling
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
        // Filter log lines from final output
        resolve(filterLogLines(stdout).trim());
      } else if (code === null) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      } else {
        reject(new Error(`OpenClaw failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      options?.signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`Failed to spawn openclaw: ${err.message}`));
    });
  });
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if OpenClaw container is running
 */
export async function isDockerOpenClawAvailable(): Promise<boolean> {
  const runtime = await getContainerRuntime();
  if (!runtime) return false;

  const result = await execCommand(runtime, [
    'ps',
    '--filter', `name=${CONFIG.containerName}`,
    '--filter', 'status=running',
    '--format', '{{.Names}}',
  ]);

  return result.success && result.stdout.trim() === CONFIG.containerName;
}

/**
 * Check if OpenClaw gateway health endpoint responds
 */
export async function isGatewayHealthy(): Promise<boolean> {
  try {
    const httpUrl = CONFIG.gatewayUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const response = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(CONFIG.healthCheckTimeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if local OpenClaw CLI is running (not in container)
 */
export async function isLocalOpenClawAvailable(): Promise<boolean> {
  if (await isDockerOpenClawAvailable()) return false;
  if (!(await isGatewayHealthy())) return false;

  const result = await execCommand('openclaw', ['status', '--json'], { timeout: CONFIG.healthCheckTimeout });
  if (!result.success) return false;

  try {
    const status = JSON.parse(result.stdout);
    return status.gateway?.mode === 'local' && !!status.gateway?.url;
  } catch {
    return false;
  }
}

/**
 * Check if any OpenClaw is available
 * Optimized: checks gateway health first (fast HTTP), then container status
 */
export async function isOpenClawAvailable(): Promise<boolean> {
  // Fast check: gateway health endpoint (no subprocess)
  if (await isGatewayHealthy()) {
    return true;
  }
  // Fallback: check if container is running (slower, spawns subprocess)
  return isDockerOpenClawAvailable();
}

/**
 * Get OpenClaw status summary
 */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const [isDocker, isLocal] = await Promise.all([
    isDockerOpenClawAvailable(),
    isLocalOpenClawAvailable(),
  ]);

  return { available: isDocker || isLocal, isDocker, isLocal };
}

// ============================================================================
// Agent Functions
// ============================================================================

/**
 * Build agent CLI arguments
 */
function buildAgentArgs(message: string): string[] {
  return [
    'agent',
    '--local',
    '--session-id', CONFIG.sessionId,
    '--message', message,
    '--thinking', 'minimal',
  ];
}

/**
 * Send message to OpenClaw agent
 */
export async function sendToOpenClaw(
  message: string,
  options?: OpenClawOptions
): Promise<string> {
  return spawnOpenClaw(buildAgentArgs(message), options);
}

/**
 * Send message to OpenClaw with streaming output
 */
export async function sendToOpenClawStream(
  message: string,
  onChunk: (chunk: string) => void,
  options?: OpenClawOptions
): Promise<string> {
  return spawnOpenClaw(buildAgentArgs(message), { ...options, onChunk });
}

// ============================================================================
// Cron & Notifications
// ============================================================================

/**
 * Schedule a cron job
 */
export async function scheduleCron(
  name: string,
  schedule: string,
  prompt: string
): Promise<string> {
  const spawnConfig = await getSpawnConfig([
    'cron', 'add',
    '--name', name,
    '--schedule', schedule,
    '--prompt', prompt,
  ]);

  const result = await execCommand(spawnConfig.command, spawnConfig.args, { timeout: 10000, env: spawnConfig.env });

  if (!result.success) {
    throw new Error(`Failed to schedule cron: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

/**
 * Send notification via OpenClaw
 */
export async function sendNotification(to: string, message: string): Promise<string> {
  const spawnConfig = await getSpawnConfig([
    'message', 'send',
    '--to', to,
    '--message', message,
  ]);

  const result = await execCommand(spawnConfig.command, spawnConfig.args, { timeout: 30000, env: spawnConfig.env });

  if (!result.success) {
    throw new Error(`Failed to send notification: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

/**
 * Write to OpenClaw memory (local filesystem)
 */
export async function writeToMemory(
  content: string,
  filename = 'clawsql-cluster-state.md'
): Promise<void> {
  const memoryDir = path.join(os.homedir(), '.openclaw', 'memory');

  try {
    await fs.promises.mkdir(memoryDir, { recursive: true });
    await fs.promises.appendFile(
      path.join(memoryDir, filename),
      `\n\n---\n\n${content}`
    );
  } catch {
    // Silently ignore - memory is optional
  }
}

// ============================================================================
// OpenClawAgent Class
// ============================================================================

/**
 * OpenClaw-backed AI agent for ClawSQL
 */
export class OpenClawAgent {
  private available: boolean | null = null;

  constructor(private context: CLIContext) {}

  async isAvailable(): Promise<boolean> {
    if (this.available === null) {
      this.available = await isOpenClawAvailable();
    }
    return this.available;
  }

  async process(input: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenClaw not running. Start with: clawsql /start');
    }

    return sendToOpenClaw(`${this.buildContext()}\n\nUser: ${input}`);
  }

  async healthCheckCron(schedule = '0 * * * *'): Promise<string> {
    return scheduleCron(
      'clawsql:health-check',
      schedule,
      'Check MySQL cluster health. Report issues with instances, replication, or failover.'
    );
  }

  async alert(channel: string, message: string): Promise<string> {
    return sendNotification(channel, `🦞 ClawSQL: ${message}`);
  }

  private buildContext(): string {
    const { orchestrator, proxysql, failover } = this.context.settings;
    return `ClawSQL assistant for MySQL cluster management.
Orchestrator: ${orchestrator.url}
ProxySQL: ${proxysql.host}:${proxysql.adminPort}
Auto-failover: ${failover.autoFailoverEnabled ? 'enabled' : 'disabled'}`;
  }
}

export function createOpenClawAgent(ctx: CLIContext): OpenClawAgent {
  return new OpenClawAgent(ctx);
}

// ============================================================================
// Model Provider Configuration
// ============================================================================

export const SUPPORTED_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI (GPT)', envKey: 'OPENAI_API_KEY' },
  { id: 'xai', name: 'xAI (Grok)', envKey: 'XAI_API_KEY' },
  { id: 'mistral', name: 'Mistral', envKey: 'MISTRAL_API_KEY' },
  { id: 'ollama', name: 'Ollama (Local)', envKey: null },
  { id: 'custom', name: 'Custom Provider', envKey: 'CUSTOM_API_KEY' },
] as const;

/**
 * Get current model provider info
 */
export async function getModelProviderInfo(): Promise<ModelProviderInfo> {
  const spawnConfig = await getSpawnConfig(['config', 'get', 'agents.defaults.model']);

  const result = await execCommand(spawnConfig.command, spawnConfig.args, { timeout: CONFIG.healthCheckTimeout, env: spawnConfig.env });

  if (!result.success || !result.stdout.trim()) {
    return { provider: null, model: null, configured: false };
  }

  const model = result.stdout.trim();
  const providerMatch = model.match(/^(\w+)\//);

  return {
    provider: providerMatch?.[1] ?? null,
    model,
    configured: !!model,
  };
}

/**
 * Configure model provider
 */
export async function configureModelProvider(
  provider: string,
  apiKey?: string,
  options?: { baseUrl?: string; modelId?: string }
): Promise<{ success: boolean; message: string }> {
  const providerInfo = SUPPORTED_PROVIDERS.find(p => p.id === provider);

  if (!providerInfo) {
    return {
      success: false,
      message: `Unknown provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.map(p => p.id).join(', ')}`,
    };
  }

  const args: string[] = ['onboard', '--non-interactive', '--accept-risk'];

  if (provider === 'ollama') {
    args.push('--auth-choice', 'ollama');
  } else if (provider === 'custom') {
    args.push('--auth-choice', 'custom-api-key');
    if (apiKey) args.push('--custom-api-key', apiKey);
  } else {
    args.push('--auth-choice', `${provider}-api-key`);
    if (apiKey) args.push(`--${provider}-api-key`, apiKey);
  }

  if (options?.baseUrl) args.push('--custom-base-url', options.baseUrl);
  if (options?.modelId) args.push('--custom-model-id', options.modelId);

  const spawnConfig = await getSpawnConfig(args);
  const result = await execCommand(spawnConfig.command, spawnConfig.args, { timeout: 30000, env: spawnConfig.env });

  return {
    success: result.success,
    message: result.success
      ? `Configured ${providerInfo.name}`
      : `Failed: ${result.stderr || result.stdout}`,
  };
}

/**
 * Test OpenClaw connectivity
 */
export async function testOpenClawConnection(query = 'Hello'): Promise<{
  success: boolean;
  response?: string;
  error?: string;
  latencyMs: number;
}> {
  const start = Date.now();

  try {
    const response = await sendToOpenClaw(query, { timeout: 30000 });
    return { success: true, response, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Get detailed status for display
 */
export async function getDetailedOpenClawStatus(): Promise<{
  available: boolean;
  mode: 'docker' | 'local' | 'unavailable';
  gatewayHealthy: boolean;
  modelInfo: ModelProviderInfo;
  controlUI: string;
  gatewayUrl: string;
}> {
  const status = await getOpenClawStatus();
  const gatewayHealthy = status.available && await isGatewayHealthy();
  const modelInfo = status.available ? await getModelProviderInfo() : { provider: null, model: null, configured: false };

  return {
    available: status.available,
    mode: status.isDocker ? 'docker' : status.isLocal ? 'local' : 'unavailable',
    gatewayHealthy,
    modelInfo,
    controlUI: 'http://localhost:18790',
    gatewayUrl: CONFIG.gatewayUrl,
  };
}

// ============================================================================
// Backwards Compatibility
// ============================================================================

/** @deprecated Use isDockerOpenClawAvailable */
export const isDockerOpenClawContainerRunning = isDockerOpenClawAvailable;

/** @deprecated Use isGatewayHealthy */
export const isOpenClawGatewayReachable = isGatewayHealthy;

/** @deprecated Use isGatewayHealthy() in a loop */
export async function ensureOpenClawRunning(timeoutSeconds = 30): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await isGatewayHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}
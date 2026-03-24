/**
 * ClawSQL CLI - OpenClaw Integration
 *
 * Integrates with OpenClaw gateway for AI-powered operations.
 */

import { spawn } from 'child_process';
import { CLIContext } from '../registry.js';

/**
 * OpenClaw integration options
 */
export interface OpenClawOptions {
  gatewayUrl?: string;
  timeout?: number;
}

/**
 * Check if OpenClaw gateway is running
 * Note: The status command may show "unreachable" due to internal scope issues,
 * but the agent can still work. We check if OpenClaw is installed and try to use it.
 */
export async function isOpenClawAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('openclaw', ['status', '--json'], {
      timeout: 5000,
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          // Gateway is configured if we have a mode and URL, even if status shows unreachable
          // The agent can still work despite "missing scope: operator.read" errors
          const hasGateway = result.gateway?.mode === 'local' && !!result.gateway?.url;
          resolve(hasGateway);
        } catch {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Send a message to OpenClaw agent
 */
export async function sendToOpenClaw(
  message: string,
  options?: OpenClawOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use a fixed session ID for ClawSQL interactions
    const args = [
      'agent',
      '--session-id', 'clawsql-session',
      '--message', message,
      '--thinking', 'minimal'
    ];

    if (options?.gatewayUrl) {
      args.push('--gateway', options.gatewayUrl);
    }

    const proc = spawn('openclaw', args, {
      timeout: options?.timeout || 120000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`OpenClaw agent failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

/**
 * Send a message to OpenClaw agent with streaming output
 * Calls onChunk callback for each chunk of output as it arrives
 *
 * NOTE: OpenClaw's agent command outputs all at once after processing completes,
 * not incrementally. The streaming callback will typically receive one large chunk.
 * This is a limitation of OpenClaw's internal output handling, not Node.js buffering.
 */
export async function sendToOpenClawStream(
  message: string,
  onChunk: (chunk: string) => void,
  options?: OpenClawOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use a fixed session ID for ClawSQL interactions
    const args = [
      'agent',
      '--session-id', 'clawsql-session',
      '--message', message,
      '--thinking', 'minimal'  // Reduce verbose thinking output
    ];

    if (options?.gatewayUrl) {
      args.push('--gateway', options.gatewayUrl);
    }

    const proc = spawn('openclaw', args, {
      timeout: options?.timeout || 120000,
    });

    let fullOutput = '';
    let stderr = '';

    // Stream stdout chunks immediately
    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      fullOutput += chunk;
      onChunk(chunk);
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(fullOutput.trim());
      } else {
        reject(new Error(`OpenClaw agent failed: ${stderr || fullOutput}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

/**
 * Schedule a cron job via OpenClaw
 */
export async function scheduleCron(
  name: string,
  schedule: string,
  prompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', [
      'cron', 'add',
      '--name', name,
      '--schedule', schedule,
      '--prompt', prompt,
    ], {
      timeout: 10000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Failed to schedule cron: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

/**
 * Send a notification via OpenClaw channels
 */
export async function sendNotification(
  to: string,
  message: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', [
      'message', 'send',
      '--to', to,
      '--message', message,
    ], {
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Failed to send message: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run openclaw: ${err.message}`));
    });
  });
}

/**
 * Write to OpenClaw memory
 */
export async function writeToMemory(
  content: string,
  filename: string = 'clawsql-cluster-state.md'
): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const memoryDir = path.join(os.homedir(), '.openclaw', 'memory');

  try {
    await fs.promises.mkdir(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, filename);
    await fs.promises.appendFile(filePath, `\n\n---\n\n${content}`);
  } catch (error) {
    // Memory write is optional - don't fail the operation
    console.error('Failed to write to OpenClaw memory:', error);
  }
}

/**
 * OpenClaw-backed AI agent
 */
export class OpenClawAgent {
  private context: CLIContext;
  private available: boolean | null = null;

  constructor(ctx: CLIContext) {
    this.context = ctx;
  }

  /**
   * Check if OpenClaw is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.available === null) {
      this.available = await isOpenClawAvailable();
    }
    return this.available;
  }

  /**
   * Process a natural language query
   */
  async process(input: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('OpenClaw gateway is not running. Start it with: openclaw gateway');
    }

    // Build context for the agent
    const contextPrompt = this.buildContextPrompt();
    const fullMessage = `${contextPrompt}\n\nUser query: ${input}`;

    return sendToOpenClaw(fullMessage);
  }

  /**
   * Build context prompt with current cluster state
   */
  private buildContextPrompt(): string {
    const settings = this.context.settings;
    return `You are the ClawSQL assistant. You have access to MySQL cluster management tools.

Current configuration:
- Orchestrator: ${settings.orchestrator.url}
- ProxySQL: ${settings.proxysql.host}:${settings.proxysql.adminPort}
- Auto-failover: ${settings.failover.autoFailoverEnabled ? 'enabled' : 'disabled'}

Use the clawsql skill commands to answer questions about the MySQL cluster.`;
  }

  /**
   * Schedule periodic health checks
   */
  async scheduleHealthCheck(schedule: string = '0 * * * *'): Promise<string> {
    return scheduleCron(
      'clawsql:health-check',
      schedule,
      'Check MySQL cluster health using clawsql skill. Report any issues with instances, replication lag, or failover status.'
    );
  }

  /**
   * Send an alert through configured channels
   */
  async alert(channel: string, message: string): Promise<string> {
    return sendNotification(channel, `🦞 ClawSQL Alert: ${message}`);
  }
}

/**
 * Create an OpenClaw agent instance
 */
export function createOpenClawAgent(ctx: CLIContext): OpenClawAgent {
  return new OpenClawAgent(ctx);
}
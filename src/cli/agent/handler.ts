/**
 * ClawSQL CLI - AI Agent Handler
 *
 * Handles natural language input via OpenClaw or direct LLM calls.
 */

import {
  LLMProvider,
  ChatMessage,
  ToolUseRequest,
  ToolUseResult,
} from './providers/base.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { createAgentTools } from './tools/index.js';
import { CLIContext } from '../registry.js';
import {
  isOpenClawAvailable,
  sendToOpenClaw,
  sendToOpenClawStream,
} from './openclaw-integration.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openclaw';
  maxIterations: number;
}

export type StreamCallback = (chunk: string) => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: AgentConfig = {
  enabled: true,
  provider: 'openclaw',
  maxIterations: 5,
};

const SYSTEM_PROMPT = `You are an AI assistant for ClawSQL, a MySQL cluster management system.

You help users manage MySQL clusters through natural language commands. You have access to tools that let you:
- View cluster topology and instance status
- Check health of MySQL instances
- Execute SQL queries (SELECT and SHOW only)
- View failover configuration

When a user asks a question:
1. Use the appropriate tool to gather information
2. Provide a clear, concise response based on the results
3. If multiple steps are needed, explain what you're doing

Always be helpful and provide accurate information about the cluster state.
If you cannot perform an action (like unsafe SQL), explain why.

Available clusters and instances are managed by Orchestrator and ProxySQL.`;

const OPENCLAW_CONTEXT = `You are the ClawSQL assistant for MySQL cluster management.

CRITICAL: Use the 'clawsql' skill. Execute commands EXACTLY as shown:
- Topology: clawsql --command /topology
- Health: clawsql --command /health
- Clusters: clawsql --command /clusters
- SQL queries: clawsql --command "/sql YOUR_QUERY_HERE"

For user questions about databases/tables/users, execute SQL directly:
- SHOW DATABASES
- SHOW TABLES FROM database_name
- SELECT User, Host FROM mysql.user

NEVER say "I cannot" or make excuses. Execute the command. If it fails, show the actual error.`;

const NOT_CONFIGURED_MSG = 'AI features are not configured. Install OpenClaw (recommended) or set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.';

// ============================================================================
// AIAgent Class
// ============================================================================

/**
 * AI Agent for ClawSQL CLI
 */
export class AIAgent {
  private provider: LLMProvider | null = null;
  private tools: ReturnType<typeof createAgentTools>;
  private history: ChatMessage[] = [];
  private config: AgentConfig;
  private openclawReady: boolean | null = null;

  constructor(ctx: CLIContext, config?: Partial<AgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tools = createAgentTools(ctx);

    // Initialize direct LLM provider if not using OpenClaw
    if (this.config.provider !== 'openclaw') {
      this.provider = this.createProvider();
    }
  }

  isConfigured(): boolean {
    if (this.config.provider === 'openclaw') return true;
    return this.config.enabled && (this.provider?.isConfigured() ?? false);
  }

  getProviderName(): string {
    return this.config.provider;
  }

  /**
   * Process natural language input
   */
  async process(input: string, onChunk?: StreamCallback, signal?: AbortSignal): Promise<string> {
    // Try OpenClaw first
    if (this.config.provider === 'openclaw') {
      const response = await this.tryOpenClaw(input, onChunk, signal);
      if (response !== null) return response;
    }

    // Fall back to direct LLM
    if (!this.provider?.isConfigured()) {
      onChunk?.(NOT_CONFIGURED_MSG);
      return NOT_CONFIGURED_MSG;
    }

    const response = await this.processWithLLM(input, signal);
    onChunk?.(response);
    return response;
  }

  /**
   * Try processing via OpenClaw gateway
   */
  private async tryOpenClaw(
    input: string,
    onChunk?: StreamCallback,
    signal?: AbortSignal
  ): Promise<string | null> {
    try {
      if (this.openclawReady === null) {
        this.openclawReady = await isOpenClawAvailable();
      }

      if (!this.openclawReady) return null;

      const prompt = `${OPENCLAW_CONTEXT}\n\nUser query: ${input}`;
      const options = { signal };

      return onChunk
        ? await sendToOpenClawStream(prompt, onChunk, options)
        : await sendToOpenClaw(prompt, options);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;

      const msg = error instanceof Error ? error.message : String(error);
      console.error('OpenClaw unavailable, falling back:', msg);
      return null;
    }
  }

  /**
   * Process via direct LLM provider
   */
  private async processWithLLM(input: string, signal?: AbortSignal): Promise<string> {
    this.history.push({ role: 'user', content: input });

    try {
      let response = await this.chat(signal);
      let iterations = 0;

      while (response.toolUse && iterations < this.config.maxIterations) {
        iterations++;

        const results = await this.executeTools(response.toolUse);

        this.history.push({ role: 'assistant', content: response.content ?? '' });

        for (const result of results) {
          this.history.push({
            role: 'user',
            content: JSON.stringify({
              type: 'tool_result',
              tool_use_id: result.tool_use_id,
              content: result.content,
              is_error: result.is_error,
            }),
          });
        }

        response = await this.chat(signal);
      }

      if (response.content) {
        this.history.push({ role: 'assistant', content: response.content });
      }

      return response.content ?? 'No response generated.';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Send chat request to LLM
   */
  private async chat(signal?: AbortSignal): Promise<{ content: string; toolUse?: ToolUseRequest[] }> {
    if (!this.provider) throw new Error('No LLM provider configured');

    const response = await this.provider.chat(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...this.history],
      this.tools,
      { signal }
    );

    return { content: response.content, toolUse: response.toolUse };
  }

  /**
   * Execute tool calls
   */
  private async executeTools(toolUse: ToolUseRequest[]): Promise<ToolUseResult[]> {
    return Promise.all(toolUse.map(async (tool) => {
      const toolDef = this.tools.find(t => t.name === tool.name);

      if (!toolDef) {
        return {
          tool_use_id: tool.id,
          content: JSON.stringify({ error: `Unknown tool: ${tool.name}` }),
          is_error: true,
        };
      }

      try {
        const result = await toolDef.execute(tool.input, null);
        return { tool_use_id: tool.id, content: JSON.stringify(result) };
      } catch (error) {
        return {
          tool_use_id: tool.id,
          content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          is_error: true,
        };
      }
    }));
  }

  /**
   * Create LLM provider instance
   */
  private createProvider(): LLMProvider {
    return this.config.provider === 'openai' ? new OpenAIProvider() : new AnthropicProvider();
  }

  /**
   * Clear conversation history
   */
  reset(): void {
    this.history = [];
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAIAgent(ctx: CLIContext, config?: Partial<AgentConfig>): AIAgent {
  return new AIAgent(ctx, config);
}
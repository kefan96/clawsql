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

/**
 * Agent configuration
 */
export interface AgentConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openclaw';
  maxIterations: number;
}

/**
 * Streaming callback type
 */
export type StreamCallback = (chunk: string) => void;

/**
 * System prompt for the AI agent
 */
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

/**
 * AI Agent for ClawSQL CLI
 */
export class AIAgent {
  private provider: LLMProvider | null = null;
  private tools: ReturnType<typeof createAgentTools>;
  private conversationHistory: ChatMessage[] = [];
  private config: AgentConfig;
  private openclawAvailable: boolean | null = null;

  constructor(ctx: CLIContext, config?: Partial<AgentConfig>) {
    this.config = {
      enabled: true,
      provider: 'openclaw',
      maxIterations: 5,
      ...config,
    };

    // Initialize provider (may be null for openclaw mode)
    if (this.config.provider !== 'openclaw') {
      this.provider = this.createProvider();
    }
    this.tools = createAgentTools(ctx);
  }

  /**
   * Create the LLM provider based on configuration
   */
  private createProvider(): LLMProvider {
    switch (this.config.provider) {
      case 'openai':
        return new OpenAIProvider();
      case 'anthropic':
      default:
        return new AnthropicProvider();
    }
  }

  /**
   * Check if the agent is properly configured
   */
  isConfigured(): boolean {
    if (this.config.provider === 'openclaw') {
      return true; // OpenClaw is always "configured" if installed
    }
    return this.config.enabled && (this.provider?.isConfigured() ?? false);
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.config.provider;
  }

  /**
   * Process a natural language input
   * @param input The user's natural language input
   * @param onChunk Optional callback for streaming output chunks
   */
  async process(input: string, onChunk?: StreamCallback): Promise<string> {
    // Try OpenClaw first if configured
    if (this.config.provider === 'openclaw') {
      try {
        const { isOpenClawAvailable, sendToOpenClaw, sendToOpenClawStream } = await import('./openclaw-integration.js');

        if (this.openclawAvailable === null) {
          this.openclawAvailable = await isOpenClawAvailable();
        }

        if (this.openclawAvailable) {
          const contextPrompt = this.buildOpenClawContext();

          // Use streaming if callback provided
          if (onChunk) {
            return await sendToOpenClawStream(`${contextPrompt}\n\nUser query: ${input}`, onChunk);
          } else {
            return await sendToOpenClaw(`${contextPrompt}\n\nUser query: ${input}`);
          }
        }
      } catch (error) {
        // Fall through to direct LLM
        const msg = error instanceof Error ? error.message : String(error);
        console.error('OpenClaw not available, falling back to direct LLM:', msg);
      }
    }

    // Fall back to direct LLM calls
    if (!this.provider || !this.provider.isConfigured()) {
      return 'AI features are not configured. Install OpenClaw (recommended) or set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.';
    }

    return this.processWithLLM(input);
  }

  /**
   * Process using direct LLM call
   */
  private async processWithLLM(input: string): Promise<string> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: input,
    });

    try {
      let iteration = 0;
      let response = await this.sendChat();

      // Handle tool use loop
      while (response.toolUse && iteration < this.config.maxIterations) {
        iteration++;

        // Execute tool calls
        const toolResults = await this.executeTools(response.toolUse);

        // Add assistant message with tool use
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content || '',
        });

        // Add tool results
        for (const result of toolResults) {
          this.conversationHistory.push({
            role: 'user',
            content: JSON.stringify({
              type: 'tool_result',
              tool_use_id: result.tool_use_id,
              content: result.content,
              is_error: result.is_error,
            }),
          });
        }

        // Get next response
        response = await this.sendChat();
      }

      // Add final assistant response to history
      if (response.content) {
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content,
        });
      }

      return response.content || 'No response generated.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }

  /**
   * Build context for OpenClaw
   */
  private buildOpenClawContext(): string {
    return `You are the ClawSQL assistant for MySQL cluster management.

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
  }

  /**
   * Send a chat request to the LLM
   */
  private async sendChat(): Promise<{ content: string; toolUse?: ToolUseRequest[] }> {
    if (!this.provider) {
      throw new Error('No LLM provider configured');
    }

    const response = await this.provider.chat(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...this.conversationHistory],
      this.tools
    );

    return {
      content: response.content,
      toolUse: response.toolUse,
    };
  }

  /**
   * Execute tool calls
   */
  private async executeTools(toolUse: ToolUseRequest[]): Promise<ToolUseResult[]> {
    const results: ToolUseResult[] = [];

    for (const tool of toolUse) {
      const toolDef = this.tools.find(t => t.name === tool.name);

      if (!toolDef) {
        results.push({
          tool_use_id: tool.id,
          content: JSON.stringify({ error: `Unknown tool: ${tool.name}` }),
          is_error: true,
        });
        continue;
      }

      try {
        const result = await toolDef.execute(tool.input, null);
        results.push({
          tool_use_id: tool.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        results.push({
          tool_use_id: tool.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          is_error: true,
        });
      }
    }

    return results;
  }

  /**
   * Clear conversation history
   */
  reset(): void {
    this.conversationHistory = [];
  }
}

/**
 * Create an AI agent instance
 */
export function createAIAgent(ctx: CLIContext, config?: Partial<AgentConfig>): AIAgent {
  return new AIAgent(ctx, config);
}
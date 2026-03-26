/**
 * ClawSQL CLI - Anthropic Provider
 *
 * LLM provider implementation for Anthropic Claude API.
 */

import {
  LLMProvider,
  ChatMessage,
  ChatResponse,
  AgentTool,
  ToolParameterSchema,
  loadAIConfig,
} from './base.js';

/**
 * Anthropic API message format
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
}

/**
 * Anthropic Claude provider
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private apiKey: string | undefined;
  private model: string;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor() {
    const config = loadAIConfig();
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || 'claude-sonnet-4-6-20250514';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(
    messages: ChatMessage[],
    tools: AgentTool[],
    options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured. Set the environment variable to enable AI features.');
    }

    // Convert messages to Anthropic format
    const anthropicMessages: AnthropicMessage[] = [];
    let systemPrompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        anthropicMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Convert tools to Anthropic format
    const anthropicTools: AnthropicTool[] = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties || {},
        required: tool.parameters.required,
      },
    }));

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: AnthropicContentBlock[];
      stop_reason: string;
    };

    // Extract text and tool use from response
    let textContent = '';
    const toolUse: ChatResponse['toolUse'] = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        textContent += block.text;
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolUse.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
        });
      }
    }

    return {
      content: textContent,
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      stopReason: data.stop_reason as ChatResponse['stopReason'],
    };
  }
}

/**
 * Get the Anthropic provider instance
 */
export function getAnthropicProvider(): LLMProvider {
  return new AnthropicProvider();
}
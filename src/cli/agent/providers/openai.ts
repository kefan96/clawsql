/**
 * ClawSQL CLI - OpenAI Provider
 *
 * LLM provider implementation for OpenAI API.
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
 * OpenAI API message format
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameterSchema>;
      required?: string[];
    };
  };
}

/**
 * OpenAI provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey: string | undefined;
  private model: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor() {
    const config = loadAIConfig();
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || 'gpt-4o';
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
      throw new Error('OPENAI_API_KEY not configured. Set the environment variable to enable AI features.');
    }

    // Convert messages to OpenAI format
    const openaiMessages: OpenAIMessage[] = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // Convert tools to OpenAI format
    const openaiTools: OpenAITool[] = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.parameters.properties || {},
          required: tool.parameters.required,
        },
      },
    }));

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: OpenAIToolCall[];
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    // Extract tool calls
    const toolUse: ChatResponse['toolUse'] = [];
    if (choice.message.tool_calls) {
      for (const call of choice.message.tool_calls) {
        toolUse.push({
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments),
        });
      }
    }

    return {
      content: choice.message.content || '',
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      stopReason: choice.finish_reason as ChatResponse['stopReason'],
    };
  }
}

/**
 * Get the OpenAI provider instance
 */
export function getOpenAIProvider(): LLMProvider {
  return new OpenAIProvider();
}
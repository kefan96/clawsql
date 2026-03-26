/**
 * ClawSQL CLI - AI Agent Base Provider
 *
 * Defines the interface for LLM providers.
 */

import { getSettings } from '../../../config/settings.js';

/**
 * Chat message
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool parameter schema (JSON Schema subset)
 */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
}

/**
 * Agent tool definition
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (params: Record<string, unknown>, context: unknown) => Promise<unknown>;
}

/**
 * Tool use request from the LLM
 */
export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool use result
 */
export interface ToolUseResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Chat response from the LLM
 */
export interface ChatResponse {
  content: string;
  toolUse?: ToolUseRequest[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  /** Provider name */
  readonly name: string;

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean;

  /**
   * Send a chat request to the LLM
   */
  chat(
    messages: ChatMessage[],
    tools: AgentTool[],
    options?: {
      maxTokens?: number;
      temperature?: number;
      signal?: AbortSignal;
    }
  ): Promise<ChatResponse>;
}

/**
 * AI Agent configuration
 */
export interface AIAgentConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openclaw';
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Load AI configuration from settings and environment
 */
export function loadAIConfig(): AIAgentConfig {
  const settings = getSettings();
  return {
    enabled: settings.ai.enabled,
    provider: settings.ai.provider,
    model: settings.ai.model,
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    maxTokens: settings.ai.maxTokens,
    temperature: settings.ai.temperature,
  };
}
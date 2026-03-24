/**
 * ClawSQL CLI - AI Agent Module
 *
 * Exports for the AI agent system.
 */

export { AIAgent, createAIAgent } from './handler.js';
export type { AgentConfig } from './handler.js';
export type { LLMProvider, ChatMessage, ChatResponse, AgentTool, ToolParameterSchema } from './providers/base.js';
export { loadAIConfig } from './providers/base.js';
export { AnthropicProvider, getAnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider, getOpenAIProvider } from './providers/openai.js';
export { createAgentTools } from './tools/index.js';
export {
  OpenClawAgent,
  createOpenClawAgent,
  isOpenClawAvailable,
  sendToOpenClaw,
  scheduleCron,
  sendNotification,
  writeToMemory,
} from './openclaw-integration.js';
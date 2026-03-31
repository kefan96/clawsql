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
  isDockerOpenClawAvailable,
  isLocalOpenClawAvailable,
  isGatewayHealthy,
  getOpenClawStatus,
  ensureOpenClawRunning,
  sendToOpenClaw,
  sendToOpenClawStream,
  scheduleCron,
  sendNotification,
  writeToMemory,
  getModelProviderInfo,
  configureModelProvider,
  testOpenClawConnection,
  getDetailedOpenClawStatus,
  printUnknownGatewayGuidance,
  INTERNAL_CLUSTER_PREFIXES,
  INTERNAL_CLUSTER_NAMES,
  SUPPORTED_PROVIDERS,
} from './openclaw-integration.js';
export type { ModelProviderInfo, OpenClawOptions, OpenClawStatus } from './openclaw-integration.js';
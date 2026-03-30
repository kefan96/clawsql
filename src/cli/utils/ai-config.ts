/**
 * ClawSQL CLI - AI Config Detection
 *
 * Detects AI configuration from environment variables.
 * Enables seamless integration with existing AI tool setups (Claude Code, etc.)
 */

// ============================================================================
// Types
// ============================================================================

export interface AIDetectedConfig {
  provider: 'anthropic' | 'openai' | 'none';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  source: 'environment' | 'none';
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect AI configuration from environment variables
 *
 * Priority: Anthropic > OpenAI (Anthropic is most common for Claude Code users)
 */
export function detectAIConfigFromEnv(): AIDetectedConfig {
  // Check Anthropic first (most common for Claude Code users)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      model: process.env.ANTHROPIC_MODEL,
      source: 'environment',
    };
  }

  // Check OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
      source: 'environment',
    };
  }

  return { provider: 'none', source: 'none' };
}

/**
 * Check if any AI configuration is detected
 */
export function hasAIConfigInEnv(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Get display string for detected config
 */
export function getAIConfigDisplay(config: AIDetectedConfig): string {
  if (config.provider === 'none') {
    return 'bundled qwen (default)';
  }

  const parts: string[] = [config.provider];
  if (config.model) {
    parts.push(config.model);
  }
  return parts.join('/');
}

/**
 * Get environment variables to pass to OpenClaw container
 */
export function getAIEnvVars(): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? '',
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? '',
  };
}
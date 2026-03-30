/**
 * ClawSQL CLI - OpenClaw Command
 *
 * Manage OpenClaw AI gateway integration.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { theme, indicators } from '../ui/components.js';
import {
  getDetailedOpenClawStatus,
  configureModelProvider,
  SUPPORTED_PROVIDERS,
  sendToOpenClaw,
} from '../agent/index.js';
import { detectAIConfigFromEnv } from '../utils/ai-config.js';

// ============================================================================
// Command Definition
// ============================================================================

export const openclawCommand: Command = {
  name: 'openclaw',
  description: 'Manage OpenClaw AI gateway',
  usage: '/openclaw <status|setup|test> [options]',
  handler: async (args: string[], ctx: CLIContext) => {
    const subcommand = args[0] || 'status';

    const handlers: Record<string, () => Promise<void>> = {
      status: () => handleStatus(ctx),
      setup: () => handleSetup(args.slice(1), ctx),
      test: () => handleTest(args.slice(1), ctx),
    };

    const handler = handlers[subcommand];
    if (handler) {
      await handler();
    } else {
      console.log(ctx.formatter.error(`Unknown subcommand: ${subcommand}`));
      console.log(ctx.formatter.info('Usage: /openclaw <status|setup|test>'));
    }
  },
};

// ============================================================================
// Status Handler
// ============================================================================

async function handleStatus(ctx: CLIContext): Promise<void> {
  console.log(ctx.formatter.header('OpenClaw AI Gateway Status'));

  const status = await getDetailedOpenClawStatus();

  if (!status.available) {
    printNotAvailable();
    return;
  }

  printStatusDetails(status);
  printEndpoints(status);
  printModelInfo(status);
  printFeatures();
  printTestHint();
}

function printNotAvailable(): void {
  console.log(`  ${theme.error(indicators.error)} Status:       ${theme.error('Not available')}`);
  console.log();
  console.log(theme.muted('  OpenClaw is not running. Start it with:'));
  console.log(theme.primary('    /start'));
}

function printStatusDetails(status: Awaited<ReturnType<typeof getDetailedOpenClawStatus>>): void {
  const modeDisplay = status.mode === 'docker' ? 'Running in Docker' : 'Using local installation';
  console.log(`  ${theme.success(indicators.success)} Status:       ${theme.success(modeDisplay)}`);

  const healthIcon = status.gatewayHealthy ? theme.success(indicators.success) : theme.error(indicators.error);
  const healthText = status.gatewayHealthy ? theme.success('healthy') : theme.error('unhealthy');
  console.log(`  ${healthIcon} Gateway:      ${healthText}`);
}

function printEndpoints(status: Awaited<ReturnType<typeof getDetailedOpenClawStatus>>): void {
  console.log();
  console.log(chalk.bold('  Endpoints:'));
  console.log(`    Control UI:    ${chalk.cyan(status.controlUI)}`);
  console.log(`    Gateway WS:    ${chalk.gray(status.gatewayUrl)}`);
}

function printModelInfo(status: Awaited<ReturnType<typeof getDetailedOpenClawStatus>>): void {
  console.log();
  console.log(chalk.bold('  Model Provider:'));

  // Check if we have AI config from environment
  const aiConfig = detectAIConfigFromEnv();

  if (status.modelInfo.configured && status.modelInfo.model) {
    console.log(`    Provider:      ${theme.success(status.modelInfo.provider || 'custom')}`);
    console.log(`    Model:         ${theme.success(status.modelInfo.model)}`);
  } else if (aiConfig.provider !== 'none') {
    // Show auto-detected config from environment
    console.log(`    ${theme.success(indicators.success)} Auto-detected from environment`);
    console.log(`    Provider:      ${theme.success(aiConfig.provider)}`);
    if (aiConfig.model) {
      console.log(`    Model:         ${theme.success(aiConfig.model)}`);
    }
    if (aiConfig.baseUrl) {
      console.log(`    Base URL:      ${chalk.gray(aiConfig.baseUrl)}`);
    }
    console.log();
    console.log(theme.muted('    Model will be automatically configured on first use.'));
  } else {
    console.log(`    ${theme.warning(indicators.warning)} Not configured (using bundled qwen)`);
    console.log();
    console.log(theme.muted('    Set ANTHROPIC_API_KEY or OPENAI_API_KEY for auto-configuration'));
    console.log(theme.muted('    Or configure manually:'));
    console.log(theme.primary('      /openclaw setup --provider <provider>'));
  }
}

function printFeatures(): void {
  console.log();
  console.log(chalk.bold('  Features:'));
  const features = [
    'Chat with AI about MySQL operations',
    'Manage sessions and conversation history',
    'View gateway logs and diagnostics',
    'Schedule automated health checks',
  ];
  features.forEach(f => console.log(`    ${chalk.gray('•')} ${f}`));
}

function printTestHint(): void {
  console.log();
  console.log(theme.muted('  Test AI connectivity:'));
  console.log(theme.primary('    /openclaw test "What is the cluster status?"'));
}

// ============================================================================
// Setup Handler
// ============================================================================

async function handleSetup(args: string[], ctx: CLIContext): Promise<void> {
  console.log(ctx.formatter.header('OpenClaw Model Provider Setup'));

  const opts = parseSetupArgs(args);

  if (!opts.provider) {
    printSetupHelp();
    return;
  }

  const providerInfo = SUPPORTED_PROVIDERS.find(p => p.id === opts.provider);
  if (!providerInfo) {
    console.log(ctx.formatter.error(`Unknown provider: ${opts.provider}`));
    console.log(ctx.formatter.info(`Supported: ${SUPPORTED_PROVIDERS.map(p => p.id).join(', ')}`));
    return;
  }

  if (providerInfo.envKey && !opts.apiKey && !process.env[providerInfo.envKey]) {
    console.log(ctx.formatter.error(`API key required for ${providerInfo.name}`));
    console.log(ctx.formatter.info(`Set ${providerInfo.envKey} or use --api-key`));
    return;
  }

  console.log(ctx.formatter.info(`Configuring ${providerInfo.name}...`));

  const result = await configureModelProvider(opts.provider, opts.apiKey, {
    baseUrl: opts.baseUrl,
    modelId: opts.modelId,
  });

  if (result.success) {
    console.log(ctx.formatter.success(result.message));
    console.log();
    console.log(ctx.formatter.info('Test with:'));
    console.log(theme.primary('  /openclaw test "Hello"'));
  } else {
    console.log(ctx.formatter.error(result.message));
  }
}

interface SetupOptions {
  provider: string | null;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}

function parseSetupArgs(args: string[]): SetupOptions {
  const findValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  return {
    provider: findValue('--provider') ?? null,
    apiKey: findValue('--api-key'),
    baseUrl: findValue('--base-url'),
    modelId: findValue('--model'),
  };
}

function printSetupHelp(): void {
  console.log('Configure a model provider for better AI responses.\n');
  console.log(chalk.bold('Supported providers:\n'));

  for (const p of SUPPORTED_PROVIDERS) {
    const envHint = p.envKey ? chalk.gray(` (requires ${p.envKey})`) : '';
    console.log(`  ${chalk.cyan(p.id.padEnd(12))} ${p.name}${envHint}`);
  }

  console.log();
  console.log(chalk.bold('Examples:'));
  const examples = [
    { comment: 'Configure Anthropic Claude', cmd: '/openclaw setup --provider anthropic --api-key YOUR_KEY' },
    { comment: 'Configure OpenAI GPT', cmd: '/openclaw setup --provider openai --api-key YOUR_KEY' },
    { comment: 'Configure Ollama (local)', cmd: '/openclaw setup --provider ollama --base-url http://localhost:11434' },
    { comment: 'Configure custom provider', cmd: '/openclaw setup --provider custom --base-url https://api.example.com/v1 --api-key YOUR_KEY' },
  ];

  examples.forEach(ex => {
    console.log(theme.muted(`  # ${ex.comment}`));
    console.log(theme.primary(`  ${ex.cmd}`));
  });

  console.log();
  console.log(chalk.yellow('Note: This will run OpenClaw onboarding which may restart the gateway.'));
}

// ============================================================================
// Test Handler
// ============================================================================

async function handleTest(args: string[], ctx: CLIContext): Promise<void> {
  console.log(ctx.formatter.header('OpenClaw AI Test'));

  const query = args.length > 0 ? args.join(' ') : 'Hello, please respond briefly to confirm you are working.';

  console.log(ctx.formatter.info(`Sending: "${query}"`));
  console.log();

  const status = await getDetailedOpenClawStatus();

  if (!status.available) {
    console.log(ctx.formatter.error('OpenClaw gateway is not available'));
    console.log(ctx.formatter.info('Start with: /start'));
    return;
  }

  if (!status.gatewayHealthy) {
    console.log(ctx.formatter.error('OpenClaw gateway is not healthy'));
    console.log(ctx.formatter.info('Check logs: docker logs openclaw'));
    return;
  }

  if (status.modelInfo.configured && status.modelInfo.model) {
    console.log(chalk.gray(`Using model: ${status.modelInfo.model}`));
  } else {
    console.log(chalk.yellow('Using bundled qwen model (consider configuring a provider)'));
  }

  console.log();
  console.log(chalk.cyan('Response:'));

  try {
    const response = await sendToOpenClaw(query, { timeout: 60000 });
    console.log();
    console.log(response);
    console.log();
    console.log(ctx.formatter.success('AI test successful!'));
  } catch (error) {
    console.log();
    console.log(ctx.formatter.error(`Failed: ${error instanceof Error ? error.message : String(error)}`));

    if (!status.modelInfo.configured) {
      console.log();
      console.log(ctx.formatter.info('Configure a provider for better results:'));
      console.log(theme.primary('  /openclaw setup --provider anthropic --api-key YOUR_KEY'));
    }
  }
}

export default openclawCommand;
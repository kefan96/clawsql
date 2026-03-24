/**
 * ClawSQL CLI - UI Components
 *
 * Professional UI components for the interactive CLI.
 * Inspired by Claude Code's clean, minimal style.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * UI Theme colors
 */
export const theme = {
  primary: chalk.cyan,
  secondary: chalk.gray,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.dim,
  highlight: chalk.bold.white,
  accent: chalk.magenta,
};

/**
 * Status indicators
 */
export const indicators = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  arrow: '→',
  bullet: '●',
  circle: '○',
  prompt: '❯',
  promptAlt: '›',
};

/**
 * Create a professional banner
 */
export function createBanner(options: {
  version: string;
  aiStatus?: { enabled: boolean; provider?: string };
  orchestratorStatus?: 'connected' | 'disconnected' | 'unknown';
}): string {
  const lines: string[] = [];
  const width = 60;

  // Top border
  lines.push(theme.primary('╭' + '─'.repeat(width - 2) + '╮'));

  // Title line
  const title = `ClawSQL v${options.version}`;
  const titlePadding = Math.floor((width - title.length - 2) / 2);
  lines.push(
    theme.primary('│') +
    ' '.repeat(titlePadding) +
    theme.highlight(title) +
    ' '.repeat(width - title.length - titlePadding - 2) +
    theme.primary('│')
  );

  // Subtitle
  const subtitle = 'MySQL Cluster Management';
  const subtitlePadding = Math.floor((width - subtitle.length - 2) / 2);
  lines.push(
    theme.primary('│') +
    ' '.repeat(subtitlePadding) +
    theme.secondary(subtitle) +
    ' '.repeat(width - subtitle.length - subtitlePadding - 2) +
    theme.primary('│')
  );

  // Status line
  const statusParts: string[] = [];

  if (options.aiStatus) {
    const aiText = options.aiStatus.enabled
      ? `${indicators.success} AI: ${options.aiStatus.provider || 'enabled'}`
      : `${indicators.circle} AI: disabled`;
    statusParts.push(options.aiStatus.enabled ? theme.success(aiText) : theme.muted(aiText));
  }

  if (options.orchestratorStatus) {
    const orchText = options.orchestratorStatus === 'connected'
      ? `${indicators.success} Orchestrator`
      : options.orchestratorStatus === 'disconnected'
        ? `${indicators.error} Orchestrator`
        : `${indicators.circle} Orchestrator`;
    statusParts.push(
      options.orchestratorStatus === 'connected'
        ? theme.success(orchText)
        : options.orchestratorStatus === 'disconnected'
          ? theme.error(orchText)
          : theme.muted(orchText)
    );
  }

  if (statusParts.length > 0) {
    const statusText = statusParts.join('  ');
    const statusPadding = Math.floor((width - statusText.length - 4) / 2);
    lines.push(
      theme.primary('│') +
      ' '.repeat(Math.max(1, statusPadding)) +
      statusText +
      ' '.repeat(Math.max(1, width - statusText.length - statusPadding - 3)) +
      theme.primary('│')
    );
  }

  // Bottom border
  lines.push(theme.primary('╰' + '─'.repeat(width - 2) + '╯'));

  return lines.join('\n');
}

/**
 * Create a contextual prompt string
 */
export function createPrompt(options: {
  context?: string;
  status?: 'normal' | 'warning' | 'error';
}): string {
  const { context, status = 'normal' } = options;

  // Status color
  const statusColor = status === 'error'
    ? theme.error
    : status === 'warning'
      ? theme.warning
      : theme.primary;

  // Build prompt
  let prompt = statusColor('clawsql');

  // Add context if provided (e.g., current cluster)
  if (context) {
    prompt += theme.muted(` (${context})`);
  }

  // Add prompt indicator
  prompt += ' ' + statusColor(indicators.prompt) + ' ';

  return prompt;
}

/**
 * Create a suggestion box for command completions
 */
export function createSuggestionBox(suggestions: string[], hint?: string): string {
  if (suggestions.length === 0) return '';

  const lines: string[] = [];

  // Suggestions header
  lines.push(theme.muted('  Suggestions:'));

  // List suggestions
  for (const suggestion of suggestions.slice(0, 5)) {
    lines.push(theme.info(`    ${indicators.arrow} ${suggestion}`));
  }

  if (suggestions.length > 5) {
    lines.push(theme.muted(`    ... and ${suggestions.length - 5} more`));
  }

  // Add hint if provided
  if (hint) {
    lines.push('');
    lines.push(theme.secondary('  ' + hint));
  }

  return lines.join('\n');
}

/**
 * Create a "did you mean?" suggestion
 */
export function createDidYouMean(typed: string, suggestions: string[]): string {
  if (suggestions.length === 0) return '';

  const lines: string[] = [];
  lines.push(theme.error(`Unknown command: ${typed}`));

  if (suggestions.length === 1) {
    lines.push(theme.info(`Did you mean: /${suggestions[0]}?`));
  } else {
    lines.push(theme.info('Did you mean one of these?'));
    for (const suggestion of suggestions) {
      lines.push(theme.muted(`  /${suggestion}`));
    }
  }

  return lines.join('\n');
}

/**
 * Create a status bar
 */
export function createStatusBar(options: {
  clusters?: number;
  instances?: number;
  alerts?: number;
}): string {
  const parts: string[] = [];

  if (options.clusters !== undefined) {
    parts.push(`${theme.info(indicators.bullet)} Clusters: ${options.clusters}`);
  }

  if (options.instances !== undefined) {
    parts.push(`${theme.success(indicators.bullet)} Instances: ${options.instances}`);
  }

  if (options.alerts !== undefined) {
    const alertColor = options.alerts > 0 ? theme.warning : theme.success;
    parts.push(`${alertColor(indicators.bullet)} Alerts: ${options.alerts}`);
  }

  return parts.join('  ');
}

/**
 * Create a keybindings help box
 */
export function createKeybindingsHelp(): string {
  const lines: string[] = [
    theme.muted('─'.repeat(40)),
    theme.secondary('  Keyboard Shortcuts:'),
    '',
    theme.muted('  Tab       ') + 'Auto-complete',
    theme.muted('  Ctrl+L    ') + 'Clear screen',
    theme.muted('  Ctrl+C    ') + 'Cancel input',
    theme.muted('  Ctrl+D    ') + 'Exit',
    theme.muted('  ↑/↓       ') + 'History navigation',
    theme.muted('  ?         ') + 'Show command hints',
    theme.muted('─'.repeat(40)),
  ];

  return lines.join('\n');
}

/**
 * Clear the terminal screen
 */
export function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[0f');
}

/**
 * Create a spinner for async operations
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  });
}

/**
 * Format a command hint
 */
export function formatCommandHint(command: string, description: string, usage: string): string {
  return [
    theme.primary(`/${command}`) + theme.muted(' - ') + description,
    theme.muted('  Usage: ') + usage,
  ].join('\n');
}

/**
 * Create a divider line
 */
export function divider(char: string = '─', width: number = 60): string {
  return theme.muted(char.repeat(width));
}

/**
 * Format a welcome message
 */
export function formatWelcomeMessage(): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(theme.muted('Type /help to see available commands.'));
  lines.push(theme.muted('Type /exit or press Ctrl+D to exit.'));
  lines.push('');
  return lines.join('\n');
}
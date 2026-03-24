/**
 * ClawSQL CLI - UI Components
 *
 * Professional UI components for the interactive CLI.
 * Inspired by Claude Code's clean, minimal style.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * UI Theme colors - VSCode-inspired palette
 */
export const theme = {
  primary: chalk.hex('#007ACC'),      // VSCode blue
  secondary: chalk.hex('#3794FF'),    // Light blue
  success: chalk.hex('#89D185'),      // VSCode green
  warning: chalk.hex('#DCDCAA'),      // VSCode yellow
  error: chalk.hex('#F14C4C'),        // VSCode red
  info: chalk.hex('#569CD6'),         // VSCode keyword blue
  muted: chalk.hex('#808080'),        // VSCode comment gray
  highlight: chalk.hex('#4FC1FF'),    // Bright blue
  accent: chalk.hex('#4EC9B0'),       // VSCode teal
};

/**
 * Status indicators - Minimal unicode symbols
 */
export const indicators = {
  success: '\u2022',    // bullet
  error: '\u25E6',      // white bullet
  warning: '\u25C6',    // diamond
  info: '\u25CB',       // circle
  arrow: '\u2192',      // arrow
  bullet: '\u2022',     // bullet
  circle: '\u25CB',     // circle
  prompt: '\u276F',     // heavy right angle bracket
};

/**
 * Strip ANSI escape codes and get visible string length
 */
function visibleLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '').length;
}

/**
 * Create a professional banner with VSCode-inspired styling
 */
export function createBanner(options: {
  version: string;
  aiStatus?: { enabled: boolean; provider?: string };
  orchestratorStatus?: 'connected' | 'disconnected' | 'unknown';
}): string {
  const lines: string[] = [];
  const width = 52;

  // Top border
  lines.push(theme.primary('┌' + '─'.repeat(width - 2) + '┐'));

  // Title line
  const title = `ClawSQL v${options.version}`;
  const titlePadding = Math.floor((width - title.length - 2) / 2);
  lines.push(
    theme.primary('│') +
    ' '.repeat(titlePadding) +
    theme.highlight.bold(title) +
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
    const icon = options.aiStatus.enabled ? indicators.success : indicators.circle;
    const label = `${icon} AI: ${options.aiStatus.provider || (options.aiStatus.enabled ? 'on' : 'off')}`;
    statusParts.push(options.aiStatus.enabled ? theme.accent(label) : theme.muted(label));
  }

  if (options.orchestratorStatus) {
    const icon = options.orchestratorStatus === 'connected'
      ? indicators.success
      : options.orchestratorStatus === 'disconnected'
        ? indicators.error
        : indicators.circle;
    const label = `${icon} Orchestrator`;
    statusParts.push(
      options.orchestratorStatus === 'connected'
        ? theme.success(label)
        : options.orchestratorStatus === 'disconnected'
          ? theme.error(label)
          : theme.muted(label)
    );
  }

  if (statusParts.length > 0) {
    const statusText = statusParts.join('  ');
    const visibleLen = visibleLength(statusText);
    const statusPadding = Math.floor((width - visibleLen - 2) / 2);
    lines.push(
      theme.primary('│') +
      ' '.repeat(Math.max(1, statusPadding)) +
      statusText +
      ' '.repeat(Math.max(1, width - visibleLen - statusPadding - 2)) +
      theme.primary('│')
    );
  }

  // Bottom border
  lines.push(theme.primary('└' + '─'.repeat(width - 2) + '┘'));

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

  const statusColor = status === 'error'
    ? theme.error
    : status === 'warning'
      ? theme.warning
      : theme.primary;

  let prompt = statusColor('clawsql');

  if (context) {
    prompt += theme.muted(` (${context})`);
  }

  prompt += ' ' + statusColor(indicators.prompt) + ' ';

  return prompt;
}

/**
 * Create a suggestion box for command completions
 */
export function createSuggestionBox(suggestions: string[], hint?: string): string {
  if (suggestions.length === 0) return '';

  const lines: string[] = [];
  lines.push(theme.muted('  Suggestions:'));

  for (const suggestion of suggestions.slice(0, 5)) {
    lines.push(theme.info(`    ${indicators.arrow} ${suggestion}`));
  }

  if (suggestions.length > 5) {
    lines.push(theme.muted(`    ... and ${suggestions.length - 5} more`));
  }

  if (hint) {
    lines.push(theme.secondary('  ' + hint));
  }

  return lines.join('\n');
}

/**
 * Create a "did you mean?" suggestion
 */
export function createDidYouMean(typed: string, suggestions: string[]): string {
  if (suggestions.length === 0) return '';

  if (suggestions.length === 1) {
    return theme.error(`Unknown: ${typed}`) + ' ' + theme.info(`Did you mean: /${suggestions[0]}?`);
  }

  const lines: string[] = [theme.error(`Unknown: ${typed}`), theme.info('Did you mean one of these?')];
  for (const suggestion of suggestions) {
    lines.push(theme.muted(`  /${suggestion}`));
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
    theme.muted('  Tab       ') + 'Auto-complete',
    theme.muted('  Ctrl+L    ') + 'Clear screen',
    theme.muted('  Ctrl+C    ') + 'Cancel input',
    theme.muted('  Ctrl+D    ') + 'Exit',
    theme.muted('  Up/Down   ') + 'History navigation',
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
  return theme.muted('Type /help for commands, /exit to quit.');
}

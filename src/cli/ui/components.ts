/**
 * ClawSQL CLI - UI Components
 *
 * Professional UI components for the interactive CLI.
 * Inspired by Claude Code's clean, minimal style.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * Nord Theme Colors (https://www.nordtheme.com)
 * Single source of truth for all CLI colors
 */
export const nord = {
  polarNight: {
    nord0: '#2E3440',
    nord1: '#3B4252',
    nord2: '#434C5E',
    nord3: '#4C566A',
  },
  snowStorm: {
    nord4: '#D8DEE9',
    nord5: '#E5E9F0',
    nord6: '#ECEFF4',
  },
  frost: {
    nord7: '#8FBCBB',
    nord8: '#88C0D0',
    nord9: '#81A1C1',
    nord10: '#5E81AC',
  },
  aurora: {
    nord11: '#BF616A',
    nord12: '#D08770',
    nord13: '#EBCB8B',
    nord14: '#A3BE8C',
    nord15: '#B48EAD',
  },
} as const;

/**
 * Chalk-based theme for CLI output
 * Use these functions for consistent colors across the CLI
 */
export const theme = {
  primary: chalk.hex(nord.frost.nord8),      // Cyan
  secondary: chalk.hex(nord.frost.nord9),    // Blue
  success: chalk.hex(nord.aurora.nord14),    // Green
  warning: chalk.hex(nord.aurora.nord13),    // Yellow
  error: chalk.hex(nord.aurora.nord11),      // Red
  info: chalk.hex(nord.frost.nord7),         // Teal
  muted: chalk.hex(nord.polarNight.nord3),   // Muted gray
  highlight: chalk.hex(nord.snowStorm.nord4), // Bright
  accent: chalk.hex(nord.aurora.nord15),     // Purple
};

/**
 * Clean status indicators (no emojis)
 * Use these for consistent icons across the CLI
 */
export const indicators = {
  success: '●',
  error: '○',
  warning: '◆',
  info: '○',
  arrow: '→',
  bullet: '●',
  circle: '○',
  check: '✓',
  cross: '✗',
  prompt: '›',
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
    theme.muted('─'.repeat(50)),
    theme.secondary('  Keyboard Shortcuts:'),
    theme.muted('─'.repeat(50)),
    theme.muted('  Navigation:'),
    theme.muted('  ← →       ') + 'Move cursor',
    theme.muted('  Home/End  ') + 'Jump to start/end of line',
    theme.muted('  ↑ ↓       ') + 'History / suggestions navigation',
    theme.muted('─'.repeat(50)),
    theme.muted('  Editing:'),
    theme.muted('  Ctrl+A    ') + 'Jump to beginning',
    theme.muted('  Ctrl+E    ') + 'Jump to end',
    theme.muted('  Ctrl+K    ') + 'Delete to end of line',
    theme.muted('  Ctrl+U    ') + 'Delete to beginning',
    theme.muted('  Ctrl+W    ') + 'Delete previous word',
    theme.muted('  Ctrl+T    ') + 'Transpose characters',
    theme.muted('─'.repeat(50)),
    theme.muted('  Actions:'),
    theme.muted('  Tab       ') + 'Accept suggestion',
    theme.muted('  Enter     ') + 'Execute command',
    theme.muted('  Ctrl+L    ') + 'Clear screen',
    theme.muted('  Ctrl+C    ') + 'Cancel input',
    theme.muted('  Ctrl+D    ') + 'Exit CLI',
    theme.muted('  Esc       ') + 'Clear suggestions',
    theme.muted('─'.repeat(50)),
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

/**
 * Suggestion item for dropdown
 */
export interface SuggestionItem {
  name: string;
  description: string;
}

/**
 * Format a suggestions dropdown in Claude Code style
 * Shows command suggestions with descriptions in a formatted panel
 */
export function formatSuggestionsDropdown(
  suggestions: SuggestionItem[],
  selectedIndex: number,
  maxWidth: number = process.stdout.columns || 80
): string {
  if (suggestions.length === 0) return '';

  const lines: string[] = [];

  // Calculate column widths
  const nameWidth = Math.max(...suggestions.map(s => s.name.length)) + 2;
  const descWidth = maxWidth - nameWidth - 4;

  // Top border
  lines.push(theme.muted('─'.repeat(Math.min(maxWidth, 100))));

  // Suggestions
  suggestions.forEach((suggestion, index) => {
    const isSelected = index === selectedIndex;
    const name = suggestion.name.padEnd(nameWidth);
    const desc = truncateText(suggestion.description, descWidth);

    if (isSelected) {
      // Highlight selected item
      lines.push(
        theme.primary('› ') +
        theme.primary.bold(name) +
        theme.muted(desc)
      );
    } else {
      lines.push(
        '  ' +
        theme.info(name) +
        theme.muted(desc)
      );
    }
  });

  // Bottom border
  lines.push(theme.muted('─'.repeat(Math.min(maxWidth, 100))));

  return lines.join('\n');
}

/**
 * Truncate text to fit within maxWidth, adding ellipsis if needed
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return '...';
  return text.slice(0, maxWidth - 3) + '...';
}

/**
 * Clear the suggestions dropdown from the terminal
 * @param numLines Number of lines to clear
 */
export function clearSuggestionsDropdown(numLines: number): void {
  // Move cursor up and clear each line
  for (let i = 0; i < numLines; i++) {
    process.stdout.write('\x1B[1A'); // Move up one line
    process.stdout.write('\x1B[2K'); // Clear entire line
  }
  process.stdout.write('\x1B[0G'); // Move cursor to beginning of line
}

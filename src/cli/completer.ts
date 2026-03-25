/**
 * ClawSQL CLI - Autocomplete Module
 *
 * Provides tab completion for commands, subcommands, and arguments.
 */

import { getRegistry, listCommands } from './registry.js';

/**
 * Completion result from the completer
 */
export interface CompletionResult {
  /** List of possible completions */
  completions: string[];
  /** Hint text to display below the input */
  hint?: string;
}

/**
 * Built-in commands that are handled directly by the REPL
 * These are not registered in the command registry
 */
const BUILTIN_COMMANDS = [
  { name: 'exit', description: 'Exit the CLI' },
  { name: 'quit', description: 'Exit the CLI (alias for exit)' },
  { name: 'q', description: 'Exit the CLI (short alias)' },
  { name: 'clear', description: 'Clear the screen' },
  { name: 'cls', description: 'Clear the screen (alias)' },
];

/**
 * Get all commands (registered + built-in) for completion
 */
function getAllCommands(): Array<{ name: string; description: string }> {
  return [...listCommands(), ...BUILTIN_COMMANDS];
}

/**
 * Subcommand definition for autocomplete
 */
interface SubcommandInfo {
  name: string;
  description: string;
}

/**
 * Known subcommands for each command
 * These are extracted from command handlers
 */
const SUBCOMMANDS: Record<string, SubcommandInfo[]> = {
  failover: [
    { name: 'status', description: 'Show failover status' },
    { name: 'history', description: 'Show failover history' },
    { name: 'switchover', description: 'Planned primary change' },
    { name: 'failover', description: 'Emergency failover' },
    { name: 'recover', description: 'Recover old primary' },
  ],
  instances: [
    { name: 'list', description: 'List all instances' },
    { name: 'add', description: 'Register new instance' },
    { name: 'remove', description: 'Deregister instance' },
    { name: 'discover', description: 'Scan network for MySQL instances' },
  ],
  clusters: [
    { name: 'list', description: 'List all clusters' },
    { name: 'topology', description: 'Show cluster topology' },
    { name: 'sync', description: 'Sync cluster to ProxySQL' },
    { name: 'promote', description: 'Promote a replica to primary' },
  ],
  cron: [
    { name: 'list', description: 'List scheduled tasks' },
    { name: 'add', description: 'Add scheduled task' },
    { name: 'remove', description: 'Remove scheduled task' },
  ],
  notify: [
    { name: 'send', description: 'Send notification' },
    { name: 'channels', description: 'List channels' },
  ],
  config: [
    { name: 'show', description: 'Display current configuration' },
    { name: 'init', description: 'Interactive configuration wizard' },
    { name: 'set', description: 'Set configuration value' },
    { name: 'get', description: 'Get configuration value' },
  ],
};

/**
 * Flag definition for autocomplete
 */
export interface FlagInfo {
  name: string;
  description: string;
  hasValue?: boolean;
  valuePlaceholder?: string;
}

/**
 * Known flags for each command
 */
const FLAGS: Record<string, FlagInfo[]> = {
  start: [
    { name: '--demo', description: 'Start with demo MySQL cluster' },
    { name: '--json', description: 'Output in JSON format' },
  ],
  instances: [
    { name: '--host', description: 'MySQL host', hasValue: true, valuePlaceholder: '<host>' },
    { name: '--port', description: 'MySQL port', hasValue: true, valuePlaceholder: '<port>' },
    { name: '--network', description: 'Network to scan', hasValue: true, valuePlaceholder: '<cidr>' },
    { name: '--user', description: 'Admin user', hasValue: true, valuePlaceholder: '<user>' },
    { name: '--password', description: 'Admin password', hasValue: true, valuePlaceholder: '<password>' },
  ],
  clusters: [
    { name: '--name', description: 'Cluster name', hasValue: true, valuePlaceholder: '<name>' },
    { name: '--primary', description: 'Primary host:port', hasValue: true, valuePlaceholder: '<host:port>' },
    { name: '--replicas', description: 'Replica host:port list', hasValue: true, valuePlaceholder: '<h:p,...>' },
    { name: '--host', description: 'Host to promote', hasValue: true, valuePlaceholder: '<host:port>' },
    { name: '--json', description: 'Output in JSON format' },
  ],
  failover: [
    { name: '--host', description: 'Target host:port', hasValue: true, valuePlaceholder: '<host:port>' },
    { name: '--force', description: 'Skip confirmation prompts' },
    { name: '--dry-run', description: 'Simulate without executing' },
  ],
  cleanup: [
    { name: '--force', description: 'Skip confirmation prompt' },
  ],
  status: [
    { name: '--json', description: 'Output in JSON format' },
    { name: '--watch', description: 'Continuously update status' },
  ],
  topology: [
    { name: '--cluster', description: 'Cluster name', hasValue: true, valuePlaceholder: '<name>' },
    { name: '--json', description: 'Output in JSON format' },
  ],
};

/**
 * Create an autocomplete completer function for readline
 */
export function createCompleter() {
  const registry = getRegistry();

  /**
   * Complete command input
   * Returns [completions, originalInput] for readline completer interface
   */
  function complete(
    line: string
  ): [string[], string] {
    const trimmed = line.trim();

    // Empty line - show all commands
    if (!trimmed) {
      const allCommands = getAllCommands();
      return [allCommands.map(c => `/${c.name}`), ''];
    }

    // Not a command (doesn't start with /)
    if (!trimmed.startsWith('/')) {
      return [[], line];
    }

    // Remove the leading / for processing
    const input = trimmed.slice(1);
    const parts = input.split(/\s+/);
    const commandName = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1);

    // Completing command name
    if (parts.length === 1) {
      const matches = completeCommand(commandName);
      // Return with the / prefix
      return [matches.map(m => `/${m}`), line];
    }

    // Completing subcommand or arguments
    if (parts.length >= 2) {
      const command = registry.get(commandName);
      if (command) {
        const subcommandMatches = completeSubcommand(commandName, args);
        // Reconstruct the line prefix for the completion
        const prefix = `/${commandName} `;
        return [subcommandMatches.map(m => prefix + m), line];
      }
    }

    return [[], line];
  }

  /**
   * Complete a command name
   */
  function completeCommand(partial: string): string[] {
    const lower = partial.toLowerCase();
    const allCommands = getAllCommands();

    // Exact match
    if (allCommands.some(c => c.name === lower)) {
      return [lower];
    }

    // Prefix matches
    return allCommands
      .filter(c => c.name.startsWith(lower))
      .map(c => c.name);
  }

  /**
   * Complete a subcommand for a given command
   */
  function completeSubcommand(commandName: string, args: string[]): string[] {
    const subcommands = SUBCOMMANDS[commandName];
    if (!subcommands || subcommands.length === 0) {
      return [];
    }

    const partial = args[0]?.toLowerCase() ?? '';

    // If we already have a complete subcommand, no more completions
    if (args.length > 1) {
      return [];
    }

    // Exact match
    if (subcommands.some(s => s.name === partial)) {
      return [partial];
    }

    // Prefix matches
    return subcommands
      .filter(s => s.name.startsWith(partial))
      .map(s => s.name);
  }

  /**
   * Get completion suggestions with descriptions
   * Used for displaying help during autocomplete
   */
  function getSuggestions(input: string): CompletionResult {
    const trimmed = input.trim();

    if (!trimmed.startsWith('/')) {
      return { completions: [] };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0]?.toLowerCase() ?? '';

    // Command name completion
    if (parts.length === 1) {
      const allCommands = getAllCommands();
      const matches = allCommands.filter(c => c.name.startsWith(commandName));

      if (matches.length === 0) {
        return { completions: [] };
      }

      if (matches.length === 1) {
        return {
          completions: [`/${matches[0].name}`],
          hint: matches[0].description,
        };
      }

      return {
        completions: matches.map(c => `/${c.name}`),
        hint: `${matches.length} commands available`,
      };
    }

    // Subcommand completion
    if (parts.length >= 2) {
      const subcommands = SUBCOMMANDS[commandName];
      if (!subcommands) {
        return { completions: [] };
      }

      const partial = parts[1]?.toLowerCase() ?? '';
      const matches = subcommands.filter(s => s.name.startsWith(partial));

      if (matches.length === 0) {
        return { completions: [] };
      }

      if (matches.length === 1) {
        return {
          completions: [matches[0].name],
          hint: matches[0].description,
        };
      }

      // Multiple matches - show all with descriptions
      const hint = matches.map(s => `  ${s.name.padEnd(12)} - ${s.description}`).join('\n');
      return {
        completions: matches.map(s => s.name),
        hint,
      };
    }

    return { completions: [] };
  }

  /**
   * Get hint text for current input
   */
  function getHint(input: string): string | undefined {
    const result = getSuggestions(input);
    return result.hint;
  }

  /**
   * Find similar commands for "did you mean?" suggestions
   */
  function findSimilar(input: string): string[] {
    const allCommands = getAllCommands();
    const inputLower = input.toLowerCase();

    // Calculate Levenshtein distance for fuzzy matching
    const withDistance = allCommands.map(c => ({
      name: c.name,
      distance: levenshteinDistance(inputLower, c.name.toLowerCase()),
    }));

    // Return commands with distance <= 3, sorted by distance
    return withDistance
      .filter(c => c.distance <= 3 && c.distance < input.length)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(c => c.name);
  }

  return {
    complete,
    getSuggestions,
    getHint,
    findSimilar,
    completeCommand,
    completeSubcommand,
  };
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Format completions for display
 */
export function formatCompletions(completions: string[], maxWidth: number = 80): string {
  if (completions.length === 0) return '';

  const maxLen = Math.max(...completions.map(c => c.length));
  const cols = Math.floor(maxWidth / (maxLen + 2)) || 1;

  const lines: string[] = [];
  for (let i = 0; i < completions.length; i += cols) {
    const row = completions.slice(i, i + cols);
    lines.push(row.map(c => c.padEnd(maxLen + 2)).join(''));
  }

  return lines.join('\n');
}

/**
 * Get flags for a command
 */
export function getFlags(commandName: string): FlagInfo[] {
  return FLAGS[commandName] || [];
}

/**
 * Complete flags for a command
 */
export function completeFlags(commandName: string, partial: string): FlagInfo[] {
  const flags = FLAGS[commandName];
  if (!flags) return [];

  const lower = partial.toLowerCase();
  return flags.filter(f => f.name.toLowerCase().startsWith(lower));
}
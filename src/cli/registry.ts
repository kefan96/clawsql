/**
 * ClawSQL CLI - Command Registry
 *
 * Manages registration and lookup of CLI commands.
 */

import { getSettings } from '../config/settings.js';
import { getOrchestratorClient } from '../core/discovery/topology.js';
import { getFailoverExecutor } from '../core/failover/executor.js';
import { getProxySQLManager } from '../core/routing/proxysql-manager.js';
import { Formatter, getFormatter } from './formatter.js';

/**
 * CLI context passed to command handlers
 */
export interface CLIContext {
  settings: ReturnType<typeof getSettings>;
  orchestrator: ReturnType<typeof getOrchestratorClient>;
  failoverExecutor: ReturnType<typeof getFailoverExecutor>;
  proxysql: ReturnType<typeof getProxySQLManager>;
  formatter: Formatter;
  outputFormat: 'table' | 'json';
}

/**
 * Command handler function type
 */
export type CommandHandler = (args: string[], context: CLIContext) => Promise<void>;

/**
 * Command definition
 */
export interface Command {
  /** Command name (e.g., 'topology' for /topology) */
  name: string;
  /** Short description for help */
  description: string;
  /** Usage example */
  usage: string;
  /** Command handler */
  handler: CommandHandler;
  /** Subcommands (optional) */
  subcommands?: Map<string, Command>;
}

/**
 * Command registry
 */
class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a new command
   */
  register(command: Command): void {
    if (this.commands.has(command.name)) {
      console.warn(`Command '${command.name}' is already registered. Overwriting.`);
    }
    this.commands.set(command.name, command);
  }

  /**
   * Get a command by name
   */
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Check if a command exists
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * List all registered commands
   */
  list(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get command names
   */
  names(): string[] {
    return Array.from(this.commands.keys());
  }
}

// Singleton registry instance
let registry: CommandRegistry | null = null;
let context: CLIContext | null = null;

/**
 * Get the command registry instance
 */
export function getRegistry(): CommandRegistry {
  if (!registry) {
    registry = new CommandRegistry();
  }
  return registry;
}

/**
 * Register a command in the registry
 */
export function registerCommand(command: Command): void {
  getRegistry().register(command);
}

/**
 * Get a command from the registry
 */
export function getCommand(name: string): Command | undefined {
  return getRegistry().get(name);
}

/**
 * List all commands
 */
export function listCommands(): Command[] {
  return getRegistry().list();
}

/**
 * Create CLI context with all services
 */
export function createCLIContext(outputFormat: 'table' | 'json' = 'table'): CLIContext {
  if (!context) {
    const formatter = getFormatter();
    formatter.setFormat(outputFormat);

    context = {
      settings: getSettings(),
      orchestrator: getOrchestratorClient(),
      failoverExecutor: getFailoverExecutor(),
      proxysql: getProxySQLManager(),
      formatter,
      outputFormat,
    };
  } else {
    context.formatter.setFormat(outputFormat);
    context.outputFormat = outputFormat;
  }
  return context;
}

/**
 * Parse command input into command name and arguments
 */
export function parseInput(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Handle slash commands
  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1);
    return { command, args };
  }

  // Non-slash input is treated as natural language (for AI agent)
  return { command: '', args: [trimmed] };
}

/**
 * Execute a command by name with arguments
 */
export async function executeCommand(
  commandName: string,
  args: string[],
  ctx: CLIContext
): Promise<boolean> {
  const command = getCommand(commandName);

  if (!command) {
    console.log(ctx.formatter.error(`Unknown command: /${commandName}`));
    console.log(ctx.formatter.info('Type /help to see available commands.'));
    return false;
  }

  try {
    await command.handler(args, ctx);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(ctx.formatter.error(`Command failed: ${message}`));
    return false;
  }
}
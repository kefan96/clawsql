/**
 * ClawSQL CLI - Main Entry Point
 *
 * Initializes and starts the CLI.
 */

import { startREPL } from './repl.js';
import { registerCommand } from './registry.js';

// Import all commands
import helpCommand from './commands/help.js';
import topologyCommand from './commands/topology.js';
import instancesCommand from './commands/instances.js';
import clustersCommand from './commands/clusters.js';
import failoverCommand from './commands/failover.js';
import configCommand from './commands/config.js';
import sqlCommand from './commands/sql.js';
import cronCommand from './commands/cron.js';
import notifyCommand from './commands/notify.js';
import startCommand from './commands/start.js';
import stopCommand from './commands/stop.js';
import statusCommand from './commands/status.js';
import cleanupCommand from './commands/cleanup.js';
import doctorCommand from './commands/doctor.js';

/**
 * Register all built-in commands
 */
function registerBuiltinCommands(): void {
  registerCommand(helpCommand);
  registerCommand(topologyCommand);
  registerCommand(instancesCommand);
  registerCommand(clustersCommand);
  registerCommand(failoverCommand);
  registerCommand(configCommand);
  registerCommand(sqlCommand);
  registerCommand(cronCommand);
  registerCommand(notifyCommand);
  registerCommand(startCommand);
  registerCommand(stopCommand);
  registerCommand(statusCommand);
  registerCommand(cleanupCommand);
  registerCommand(doctorCommand);
}

/**
 * Start the interactive CLI
 */
export function startCLI(): void {
  // Register all built-in commands
  registerBuiltinCommands();

  // Start the REPL
  startREPL();
}

/**
 * Execute a single command and exit
 */
export async function executeSingleCommand(
  commandStr: string,
  options: { json?: boolean } = {}
): Promise<void> {
  const { executeCommand, createCLIContext, parseInput } = await import('./registry.js');

  // Register commands
  registerBuiltinCommands();

  // Create context with JSON output if requested
  const ctx = createCLIContext(options.json ? 'json' : 'table');

  // Parse and execute
  const parsed = parseInput(commandStr);
  if (parsed && parsed.command) {
    const success = await executeCommand(parsed.command, parsed.args, ctx);
    process.exit(success ? 0 : 1);
  } else {
    console.error('Invalid command format. Use /<command>');
    process.exit(1);
  }
}

export default { startCLI, executeSingleCommand };
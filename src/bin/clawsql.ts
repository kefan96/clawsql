#!/usr/bin/env node
/**
 * ClawSQL CLI Entry Point
 *
 * Usage:
 *   clawsql              Start interactive CLI
 *   clawsql install      Pull all required Docker images
 *   clawsql --server     Start HTTP API server
 *   clawsql -c "/topology"  Execute single command
 *   clawsql --help       Show help
 */

// Set CLI mode early to suppress logs
process.env.CLAWSQL_CLI_MODE = 'true';

import { program, Command } from 'commander';
import { startCLI, executeSingleCommand } from '../cli/index.js';
import { startServer } from '../app.js';
import { getSettings } from '../config/settings.js';

const settings = getSettings();

// Create install command as a standalone subcommand
const installCmd = new Command('install')
  .description('Pull all required Docker images')
  .option('--demo', 'Include demo MySQL cluster images')
  .option('--detail', 'Show detailed output')
  .action(async (options: { demo?: boolean; detail?: boolean }) => {
    const args: string[] = [];
    if (options.demo) args.push('--demo');
    if (options.detail) args.push('--detail');
    await executeSingleCommand(`/install ${args.join(' ')}`);
  });

program
  .name('clawsql')
  .description('MySQL Cluster Automation and Operations Management CLI')
  .version(settings.appVersion)
  .option('-s, --server', 'Start HTTP API server instead of CLI')
  .option('-c, --command <cmd>', 'Execute a single command and exit')
  .option('--json', 'Output in JSON format (with -c)')
  .action(async (options: { server?: boolean; command?: string; json?: boolean }) => {
    if (options.server) {
      // Start HTTP API server
      console.log('Starting ClawSQL HTTP API server...');
      await startServer();
    } else if (options.command) {
      // Execute single command
      await executeSingleCommand(options.command, { json: options.json });
    } else {
      // Start interactive CLI
      startCLI();
    }
  });

// Add install as a subcommand
program.addCommand(installCmd);

program.parse();
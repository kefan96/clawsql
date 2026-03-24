#!/usr/bin/env node
/**
 * ClawSQL CLI Entry Point
 *
 * Usage:
 *   clawsql              Start interactive CLI
 *   clawsql --server     Start HTTP API server
 *   clawsql -c "/topology"  Execute single command
 *   clawsql --help       Show help
 */

// Set CLI mode early to suppress logs
process.env.CLAWSQL_CLI_MODE = 'true';

import { program } from 'commander';
import { startCLI, executeSingleCommand } from '../cli/index.js';
import { startServer } from '../app.js';
import { getSettings } from '../config/settings.js';

const settings = getSettings();

program
  .name('clawsql')
  .description('MySQL Cluster Automation and Operations Management CLI')
  .version(settings.appVersion)
  .option('-s, --server', 'Start HTTP API server instead of CLI')
  .option('-c, --command <cmd>', 'Execute a single command and exit')
  .option('--json', 'Output in JSON format (with -c)')
  .action(async (options) => {
    if (options.server) {
      // Start HTTP API server
      console.log('Starting ClawSQL HTTP API server...');
      await startServer();
    } else if (options.command) {
      // Execute single command
      await executeSingleCommand(options.command, { json: options.json });
    } else {
      // Start interactive CLI
      await startCLI();
    }
  })
  .parse();
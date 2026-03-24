/**
 * ClawSQL - Logger Utility
 *
 * Structured logging using Pino.
 */

import pino from 'pino';
import { getSettings } from '../config/settings.js';

let logger: pino.Logger | null = null;

/**
 * Check if we're running in CLI mode
 */
function isCLIMode(): boolean {
  // CLI mode is when running the clawsql command directly
  return process.argv[1]?.endsWith('clawsql') ||
    process.argv[1]?.includes('clawsql.ts') ||
    process.env.CLAWSQL_CLI_MODE === 'true';
}

/**
 * Setup and get the logger instance
 */
export function setupLogger(): pino.Logger {
  if (logger) return logger;

  const settings = getSettings();
  const isDev = process.env.NODE_ENV !== 'production';

  // Map our levels to pino levels
  const levelMap: Record<string, string> = {
    'DEBUG': 'debug',
    'INFO': 'info',
    'WARNING': 'warn',
    'ERROR': 'error',
    'CRITICAL': 'fatal',
    'SILENT': 'silent',
  };

  // In CLI mode, suppress most logs unless DEBUG is set
  let logLevel = levelMap[settings.logging.level.toUpperCase()] || 'error';
  if (isCLIMode() && !process.env.DEBUG) {
    logLevel = 'silent'; // Suppress all logs in CLI mode
  }

  logger = pino({
    level: logLevel,
    transport: isDev || settings.logging.format === 'text'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: settings.appName,
      version: settings.appVersion,
    },
  });

  return logger;
}

/**
 * Get the logger instance
 */
export function getLogger(name?: string): pino.Logger {
  if (!logger) {
    setupLogger();
  }
  return name ? logger!.child({ module: name }) : logger!;
}

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  if (!logger) {
    setupLogger();
  }
  return logger!.child(context);
}

export default getLogger;
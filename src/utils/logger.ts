/**
 * ClawSQL - Logger Utility
 *
 * Structured logging using Pino.
 */

import pino from 'pino';
import { getSettings } from '../config/settings.js';

let logger: pino.Logger | null = null;

/**
 * Setup and get the logger instance
 */
export function setupLogger(): pino.Logger {
  if (logger) return logger;

  const settings = getSettings();
  const isDev = process.env.NODE_ENV !== 'production';

  logger = pino({
    level: settings.logging.level.toLowerCase(),
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
/**
 * ClawSQL - CLI Argument Utilities
 *
 * Shared utilities for parsing CLI arguments.
 */

/**
 * Parse a string argument from an args array
 */
export function parseStringArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

/**
 * Parse a number argument from an args array
 */
export function parseNumberArg(args: string[], name: string, defaultValue: number): number {
  const value = parseStringArg(args, name);
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a host:port string into components
 */
export function parseHostPort(input: string, defaultPort = 3306): { host: string; port: number } {
  const parts = input.split(':');
  const host = parts[0];
  const port = parts.length > 1 ? parseInt(parts[1], 10) : defaultPort;
  return { host, port: isNaN(port) ? defaultPort : port };
}

/**
 * Get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
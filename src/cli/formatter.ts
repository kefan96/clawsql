/**
 * ClawSQL CLI - Output Formatter
 *
 * Provides formatted output for CLI commands (tables, colors, JSON).
 */

import Table from 'cli-table3';
import chalk from 'chalk';

/**
 * Output format options
 */
export type OutputFormat = 'table' | 'json' | 'plain';

/**
 * Formatter configuration
 */
export interface FormatterOptions {
  format: OutputFormat;
  colors: boolean;
}

/**
 * Table column definition
 */
export interface Column {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Default formatter instance
 */
let defaultFormatter: Formatter;

/**
 * CLI Output Formatter
 */
export class Formatter {
  private format: OutputFormat;
  private colors: boolean;

  constructor(options?: Partial<FormatterOptions>) {
    this.format = options?.format ?? 'table';
    this.colors = options?.colors ?? true;
  }

  /**
   * Format data as a table
   */
  table(data: Record<string, unknown>[], columns: Column[]): string {
    if (this.format === 'json') {
      return this.json(data);
    }

    if (data.length === 0) {
      return this.warning('No data to display');
    }

    const table = new Table({
      head: columns.map(col => this.colors ? chalk.bold(col.header) : col.header),
      colWidths: columns.map(col => col.width ?? 'auto' as unknown as number),
      colAligns: columns.map(col => col.align ?? 'left'),
      style: {
        head: [],
        border: this.colors ? ['gray'] : [],
      },
    });

    for (const row of data) {
      table.push(
        columns.map(col => {
          const value = row[col.key];
          if (value === null || value === undefined) {
            return this.colors ? chalk.gray('-') : '-';
          }
          return String(value);
        })
      );
    }

    return table.toString();
  }

  /**
   * Format data as JSON
   */
  json(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Format a success message
   */
  success(message: string): string {
    return this.colors ? chalk.green('✓ ') + message : `✓ ${message}`;
  }

  /**
   * Format an error message
   */
  error(message: string): string {
    return this.colors ? chalk.red('✗ ') + message : `✗ ${message}`;
  }

  /**
   * Format a warning message
   */
  warning(message: string): string {
    return this.colors ? chalk.yellow('⚠ ') + message : `⚠ ${message}`;
  }

  /**
   * Format an info message
   */
  info(message: string): string {
    return this.colors ? chalk.blue('ℹ ') + message : `ℹ ${message}`;
  }

  /**
   * Format a header/title
   */
  header(title: string): string {
    if (this.format === 'json') {
      return title;
    }
    const line = '─'.repeat(title.length + 4);
    return this.colors
      ? `\n${chalk.bold.blue(line)}\n  ${chalk.bold(title)}\n${chalk.bold.blue(line)}\n`
      : `\n${line}\n  ${title}\n${line}\n`;
  }

  /**
   * Format a key-value pair
   */
  keyValue(key: string, value: unknown): string {
    const displayValue = value === null || value === undefined
      ? (this.colors ? chalk.gray('(not set)') : '(not set)')
      : String(value);
    return this.colors
      ? `  ${chalk.cyan(key)}: ${displayValue}`
      : `  ${key}: ${displayValue}`;
  }

  /**
   * Format a tree structure (for topology)
   */
  tree(nodes: TreeNode[], indent: number = 0): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    for (const node of nodes) {
      const icon = node.type === 'primary'
        ? (this.colors ? chalk.green('●') : '●')
        : node.type === 'replica'
          ? (this.colors ? chalk.blue('○') : '○')
          : '·';

      const label = this.colors && node.type === 'primary'
        ? chalk.bold(node.name)
        : node.name;

      let line = `${prefix}${icon} ${label}`;

      if (node.status) {
        const statusColor = node.status === 'online'
          ? chalk.green
          : node.status === 'offline'
            ? chalk.red
            : chalk.yellow;
        line += this.colors
          ? ` ${statusColor(`[${node.status}]`)}`
          : ` [${node.status}]`;
      }

      if (node.extra) {
        line += this.colors
          ? chalk.gray(` (${node.extra})`)
          : ` (${node.extra})`;
      }

      lines.push(line);

      if (node.children && node.children.length > 0) {
        lines.push(this.tree(node.children, indent + 1));
      }
    }

    return lines.join('\n');
  }

  /**
   * Set output format
   */
  setFormat(format: OutputFormat): void {
    this.format = format;
  }

  /**
   * Get current format
   */
  getFormat(): OutputFormat {
    return this.format;
  }
}

/**
 * Tree node for topology display
 */
export interface TreeNode {
  name: string;
  type: 'primary' | 'replica' | 'unknown';
  status?: string;
  extra?: string;
  children?: TreeNode[];
}

/**
 * Get the default formatter instance
 */
export function getFormatter(): Formatter {
  if (!defaultFormatter) {
    defaultFormatter = new Formatter();
  }
  return defaultFormatter;
}

/**
 * Create a new formatter with specific options
 */
export function createFormatter(options?: Partial<FormatterOptions>): Formatter {
  return new Formatter(options);
}
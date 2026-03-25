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
    const line = '─'.repeat(Math.max(title.length + 4, 24));
    return this.colors
      ? `${chalk.bold.blue(line)}\n  ${chalk.bold(title)}\n${chalk.bold.blue(line)}`
      : `${line}\n  ${title}\n${line}`;
  }

  /**
   * Format a section header (compact)
   */
  section(title: string): string {
    return this.colors
      ? chalk.bold.cyan(`[${title}]`)
      : `[${title}]`;
  }

  /**
   * Format a key-value pair (compact)
   */
  keyValue(key: string, value: unknown): string {
    const displayValue = value === null || value === undefined
      ? (this.colors ? chalk.gray('(not set)') : '(not set)')
      : String(value);
    return this.colors
      ? `  ${chalk.gray(key)}: ${displayValue}`
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
   * Format a merged cluster topology view
   */
  clusterTopology(cluster: ClusterTopologyData): string {
    const lines: string[] = [];

    // Header
    const headerLine = '─'.repeat(50);
    lines.push(this.colors ? chalk.bold.blue(headerLine) : headerLine);
    lines.push(this.colors ? chalk.bold(`  Cluster: ${cluster.displayName}`) : `  Cluster: ${cluster.displayName}`);
    lines.push(this.colors ? chalk.bold.blue(headerLine) : headerLine);

    // Endpoint and hostgroups
    if (cluster.endpoint) {
      lines.push(this.colors
        ? `  ${chalk.gray('Endpoint:')} ${chalk.cyan(`${cluster.endpoint.host}:${cluster.endpoint.port}`)}`
        : `  Endpoint: ${cluster.endpoint.host}:${cluster.endpoint.port}`);
    }

    if (cluster.hostgroups) {
      lines.push(this.colors
        ? `  ${chalk.gray('Hostgroups:')} ${chalk.bold.green('RW')}=${chalk.yellow(cluster.hostgroups.writer.toString())}, ${chalk.cyan('RO')}=${chalk.yellow(cluster.hostgroups.reader.toString())}`
        : `  Hostgroups: RW=${cluster.hostgroups.writer}, RO=${cluster.hostgroups.reader}`);
    }

    lines.push('');

    // Health status
    const healthIcon = cluster.health === 'healthy'
      ? (this.colors ? chalk.green('✓') : '✓')
      : cluster.health === 'degraded'
        ? (this.colors ? chalk.yellow('⚠') : '⚠')
        : (this.colors ? chalk.red('✗') : '✗');
    lines.push(this.colors
      ? `  ${healthIcon} ${chalk.gray('Health:')} ${cluster.health}`
      : `  ${healthIcon} Health: ${cluster.health}`);

    lines.push('');

    // Primary
    if (cluster.primary) {
      lines.push(this.colors ? chalk.bold('  Primary:') : '  Primary:');
      lines.push(this.formatInstanceLine(cluster.primary, 'primary', cluster.hostgroups));
    } else {
      lines.push(this.colors
        ? chalk.yellow('  No primary found')
        : '  No primary found');
    }

    // Replicas
    if (cluster.replicas.length > 0) {
      lines.push('');
      lines.push(this.colors ? chalk.bold('  Replicas:') : '  Replicas:');
      for (const replica of cluster.replicas) {
        lines.push(this.formatInstanceLine(replica, 'replica', cluster.hostgroups));
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single instance line for cluster topology
   */
  private formatInstanceLine(instance: ClusterInstanceInfo, type: 'primary' | 'replica', hostgroups?: { writer: number; reader: number }): string {
    const icon = type === 'primary'
      ? (this.colors ? chalk.green('●') : '●')
      : (this.colors ? chalk.blue('○') : '○');

    const statusColor = instance.state === 'online'
      ? chalk.green
      : instance.state === 'offline'
        ? chalk.red
        : chalk.yellow;

    const hostPort = `${instance.host}:${instance.port}`;
    const status = instance.state;

    // Build info parts
    const infoParts: string[] = [];

    // Determine RW/RO label based on hostgroup
    if (instance.hostgroup !== undefined && hostgroups) {
      const rwLabel = instance.hostgroup === hostgroups.writer
        ? (this.colors ? chalk.bold.green('RW') : 'RW')
        : instance.hostgroup === hostgroups.reader
          ? (this.colors ? chalk.cyan('RO') : 'RO')
          : `hg:${instance.hostgroup}`;
      infoParts.push(rwLabel);
    } else if (instance.hostgroup !== undefined) {
      infoParts.push(`hg:${instance.hostgroup}`);
    }

    if (instance.proxysqlStatus) {
      const psColor = instance.proxysqlStatus === 'ONLINE'
        ? chalk.green
        : chalk.yellow;
      infoParts.push(this.colors
        ? psColor(instance.proxysqlStatus)
        : instance.proxysqlStatus);
    }

    if (instance.connections !== undefined && instance.connections > 0) {
      infoParts.push(`conns:${instance.connections}`);
    }

    if (type === 'replica' && instance.replicationLag !== undefined) {
      infoParts.push(`lag:${instance.replicationLag}s`);
    }

    const infoStr = infoParts.length > 0
      ? (this.colors ? chalk.gray(`(${infoParts.join(', ')})`) : `(${infoParts.join(', ')})`)
      : '';

    const line = `    ${icon} ${hostPort} ${statusColor(`[${status}]`)} ${infoStr}`;

    // Additional details on next line
    const details: string[] = [];
    if (instance.version) details.push(`v${instance.version}`);
    if (instance.serverId) details.push(`id:${instance.serverId}`);

    if (details.length > 0 && type === 'primary') {
      return line + '\n' + (this.colors ? chalk.gray(`        ${details.join(', ')}`) : `        ${details.join(', ')}`);
    }

    return line;
  }

  /**
   * Convert markdown to terminal-formatted text
   */
  markdown(text: string): string {
    if (!this.colors) {
      // Strip markdown syntax for non-color output
      return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/^(\s*)- /gm, '$1• ')
        .replace(/^(\s*)\d+\. /gm, '$1◦ ');
    }

    return text
      // Bold: **text**
      .replace(/\*\*(.+?)\*\*/g, (_, p1) => chalk.bold(p1))
      // Italic: *text*
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, p1) => chalk.italic(p1))
      // Inline code: `code`
      .replace(/`([^`]+)`/g, (_, p1) => chalk.cyan(p1))
      // Headers (must be at start of line)
      .replace(/^### (.+)$/gm, (_, p1) => '\n' + chalk.bold.blue(p1))
      .replace(/^## (.+)$/gm, (_, p1) => '\n' + chalk.bold.underline(p1))
      .replace(/^# (.+)$/gm, (_, p1) => '\n' + chalk.bold.underline.blue(p1) + '\n')
      // Bullet points (including indented)
      .replace(/^(\s*)- (.+)$/gm, (_, indent, p1) => `${indent}${chalk.gray('•')} ${p1}`)
      // Numbered lists (including indented)
      .replace(/^(\s*)\d+\. (.+)$/gm, (_, indent, p1) => `${indent}${chalk.gray('◦')} ${p1}`);
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
 * Process streaming text with markdown formatting.
 * Buffers text, processes markdown when complete patterns found.
 */
export class StreamingMarkdownProcessor {
  private buffer: string = '';

  process(chunk: string): { text: string; backspace: number } {
    this.buffer += chunk;

    // Try to find and process complete markdown patterns
    let processed = this.buffer;
    let hasMatch = false;

    // Process **bold** patterns
    processed = processed.replace(/\*\*(.+?)\*\*/g, (_, content) => {
      hasMatch = true;
      return chalk.bold(content);
    });

    // Process `code` patterns
    processed = processed.replace(/`([^`]+)`/g, (_, content) => {
      hasMatch = true;
      return chalk.cyan(content);
    });

    if (hasMatch) {
      // Found complete patterns - rewrite the buffer
      const backspace = this.buffer.length;
      this.buffer = '';
      return { text: processed, backspace };
    }

    // No complete patterns yet
    // Find where incomplete markdown might start
    const lastBoldStart = this.buffer.lastIndexOf('**');
    const lastCodeStart = this.buffer.lastIndexOf('`');

    // Find the earliest incomplete markdown start
    let markdownStart = -1;
    if (lastBoldStart !== -1 && lastCodeStart !== -1) {
      markdownStart = Math.min(lastBoldStart, lastCodeStart);
    } else if (lastBoldStart !== -1) {
      markdownStart = lastBoldStart;
    } else if (lastCodeStart !== -1) {
      markdownStart = lastCodeStart;
    }

    if (markdownStart > 0) {
      // Output text before incomplete markdown, keep the rest
      const text = this.buffer.slice(0, markdownStart);
      this.buffer = this.buffer.slice(markdownStart);
      return { text, backspace: 0 };
    }

    // No incomplete markdown - output all
    const text = this.buffer;
    this.buffer = '';
    return { text, backspace: 0 };
  }

  flush(): string {
    const r = this.buffer;
    this.buffer = '';
    return r;
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
 * Merged instance info for cluster topology display
 */
export interface ClusterInstanceInfo {
  host: string;
  port: number;
  state: string;
  role: string;
  version?: string;
  serverId?: number;
  replicationLag?: number;
  hostgroup?: number;
  proxysqlStatus?: string;
  connections?: number;
}

/**
 * Cluster topology data for display
 */
export interface ClusterTopologyData {
  displayName: string;
  endpoint?: { host: string; port: number };
  hostgroups?: { writer: number; reader: number };
  primary: ClusterInstanceInfo | null;
  replicas: ClusterInstanceInfo[];
  health: string;
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
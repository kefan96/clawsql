/**
 * ClawSQL - Network Scanner
 *
 * Scans networks for MySQL instances.
 */

import { createConnection, Connection } from 'mysql2/promise';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('scanner');

/**
 * MySQL instance discovered on the network
 */
export interface DiscoveredInstance {
  host: string;
  port: number;
  version?: string;
  serverId?: number;
  isMySQL: boolean;
  error?: string;
}

/**
 * Scanner options
 */
export interface ScannerOptions {
  /** Network CIDR (e.g., '192.168.1.0/24') */
  network: string;
  /** Port range start */
  portStart: number;
  /** Port range end */
  portEnd: number;
  /** Connection timeout in ms */
  timeout: number;
  /** Maximum concurrent connections */
  maxConcurrent: number;
  /** MySQL credentials for probing */
  user?: string;
  password?: string;
}

/**
 * Default scanner options
 */
const DEFAULT_OPTIONS: Partial<ScannerOptions> = {
  portStart: 3306,
  portEnd: 3306,
  timeout: 2000,
  maxConcurrent: 50,
};

/**
 * Network Scanner
 */
export class NetworkScanner {
  private options: ScannerOptions;

  constructor(options: Partial<ScannerOptions> & { network: string }) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as ScannerOptions;
  }

  /**
   * Scan the network for MySQL instances
   */
  async scan(onProgress?: (found: number, scanned: number) => void): Promise<DiscoveredInstance[]> {
    const hosts = this.expandNetwork(this.options.network);
    const ports = this.expandPorts();
    const targets: Array<{ host: string; port: number }> = [];

    for (const host of hosts) {
      for (const port of ports) {
        targets.push({ host, port });
      }
    }

    logger.info({ network: this.options.network, targets: targets.length }, 'Starting network scan');

    const results: DiscoveredInstance[] = [];
    let scanned = 0;
    let found = 0;

    // Process in batches
    for (let i = 0; i < targets.length; i += this.options.maxConcurrent) {
      const batch = targets.slice(i, i + this.options.maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(target => this.probeMySQL(target.host, target.port))
      );

      for (const result of batchResults) {
        if (result.isMySQL) {
          results.push(result);
          found++;
        }
        scanned++;
      }

      if (onProgress) {
        onProgress(found, scanned);
      }
    }

    logger.info({ found, scanned }, 'Network scan complete');
    return results;
  }

  /**
   * Expand CIDR network to list of IP addresses
   */
  private expandNetwork(cidr: string): string[] {
    const [baseIp, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr || '32', 10);

    if (prefix === 32) {
      return [baseIp];
    }

    // Parse IP address
    const parts = baseIp.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4) {
      throw new Error(`Invalid IP address: ${baseIp}`);
    }

    // Calculate network range
    const ipNum = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const network = (ipNum & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;

    // Limit scan size for safety
    const maxHosts = 256; // Max /24
    const hostCount = Math.min(broadcast - network - 1, maxHosts);

    const hosts: string[] = [];
    for (let i = 1; i <= hostCount; i++) {
      const hostIp = network + i;
      hosts.push([
        (hostIp >>> 24) & 255,
        (hostIp >>> 16) & 255,
        (hostIp >>> 8) & 255,
        hostIp & 255,
      ].join('.'));
    }

    return hosts;
  }

  /**
   * Expand port range to list of ports
   */
  private expandPorts(): number[] {
    const ports: number[] = [];
    for (let p = this.options.portStart; p <= this.options.portEnd; p++) {
      ports.push(p);
    }
    return ports;
  }

  /**
   * Probe a host:port for MySQL
   */
  private async probeMySQL(host: string, port: number): Promise<DiscoveredInstance> {
    const result: DiscoveredInstance = {
      host,
      port,
      isMySQL: false,
    };

    let conn: Connection | null = null;

    try {
      // Try to connect with timeout
      conn = await Promise.race([
        createConnection({
          host,
          port,
          user: this.options.user || 'root',
          password: this.options.password || '',
          connectTimeout: this.options.timeout,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), this.options.timeout)
        ),
      ]);

      // Connected - verify it's MySQL
      const [rows] = await conn.execute('SELECT VERSION() as version, @@server_id as server_id');

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as { version?: string; server_id?: number };
        result.isMySQL = true;
        result.version = row.version;
        result.serverId = row.server_id;
      }
    } catch (error) {
      // Check if error indicates MySQL but auth failed
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Access denied') || message.includes('authentication')) {
        // It's MySQL but credentials are wrong
        result.isMySQL = true;
        result.error = 'Authentication failed';
      } else if (message.includes('Unknown database')) {
        result.isMySQL = true;
      } else if (message.includes('MySQL') || message.includes('mysql')) {
        result.isMySQL = true;
        result.error = message;
      }
      // Otherwise, not MySQL or not reachable
    } finally {
      if (conn) {
        try {
          await conn.end();
        } catch {
          // Ignore close errors
        }
      }
    }

    return result;
  }
}

/**
 * Quick scan for a single host
 */
export async function probeMySQLInstance(
  host: string,
  port: number,
  user?: string,
  password?: string,
  timeout: number = 2000
): Promise<DiscoveredInstance> {
  const scanner = new NetworkScanner({
    network: `${host}/32`,
    portStart: port,
    portEnd: port,
    timeout,
    user,
    password,
  });

  const results = await scanner.scan();
  return results[0] || { host, port, isMySQL: false };
}

// Singleton scanner instance
let scanner: NetworkScanner | null = null;

/**
 * Get or create a network scanner
 */
export function getScanner(options?: Partial<ScannerOptions> & { network: string }): NetworkScanner {
  if (!scanner || options) {
    scanner = new NetworkScanner(options || { network: '127.0.0.1/32' });
  }
  return scanner;
}
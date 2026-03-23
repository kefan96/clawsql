/**
 * ClawSQL - ProxySQL Manager
 *
 * Manages ProxySQL configuration and routing.
 */

import mysql from 'mysql2/promise';
import { getLogger } from '../../utils/logger.js';
import { MySQLInstance, MySQLCluster } from '../../types/index.js';
import { ProxySQLSettings } from '../../config/settings.js';

const logger = getLogger('proxysql');

/**
 * ProxySQL hostgroup
 */
export interface ProxySQLHostGroup {
  hostgroupId: number;
  name: string;
  instances: MySQLInstance[];
  isWriter: boolean;
}

/**
 * ProxySQL server
 */
export interface ProxySQLServer {
  hostgroupId: number;
  hostname: string;
  port: number;
  weight: number;
  status: 'ONLINE' | 'OFFLINE_SOFT' | 'OFFLINE_HARD';
  maxConnections: number;
  comment?: string;
}

/**
 * ProxySQL query rule
 */
export interface ProxySQLRule {
  ruleId: number;
  matchPattern: string;
  destinationHostgroup: number;
  apply: boolean;
  active: boolean;
  comment?: string;
}

/**
 * ProxySQL Manager
 */
export class ProxySQLManager {
  private connection: mysql.Connection | null = null;
  private settings: ProxySQLSettings;
  private hostgroups: Map<number, ProxySQLHostGroup> = new Map();
  private servers: Map<string, ProxySQLServer> = new Map();
  private rules: ProxySQLRule[] = [];

  static readonly DEFAULT_WRITER_HOSTGROUP = 10;
  static readonly DEFAULT_READER_HOSTGROUP = 20;

  constructor(settings?: ProxySQLSettings) {
    this.settings = settings || {
      host: 'proxysql',
      adminPort: 6032,
      mysqlPort: 6033,
      adminUser: 'clawsql',
      adminPassword: 'clawsql',
    };
  }

  /**
   * Connect to ProxySQL admin interface
   */
  async connect(): Promise<void> {
    logger.info(
      { host: this.settings.host, port: this.settings.adminPort },
      'Connecting to ProxySQL'
    );
    this.connection = await mysql.createConnection({
      host: this.settings.host,
      port: this.settings.adminPort,
      user: this.settings.adminUser,
      password: this.settings.adminPassword,
    });
    logger.info('ProxySQL connection established');
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      logger.info('ProxySQL connection closed');
    }
  }

  /**
   * Execute a query on ProxySQL admin interface
   */
  private async execute(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (!this.connection) {
      await this.connect();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows] = await this.connection!.execute(sql, params as any[]);
    return rows as unknown[];
  }

  /**
   * Set monitor credentials
   */
  async setMonitorCredentials(user: string, password: string): Promise<boolean> {
    try {
      await this.execute(
        "UPDATE global_variables SET variable_value = ? WHERE variable_name = 'mysql-monitor_username'",
        [user]
      );
      await this.execute(
        "UPDATE global_variables SET variable_value = ? WHERE variable_name = 'mysql-monitor_password'",
        [password]
      );
      await this.execute('LOAD MYSQL VARIABLES TO RUNTIME');
      logger.info('Monitor credentials set');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to set monitor credentials');
      return false;
    }
  }

  /**
   * Add a MySQL server to ProxySQL
   */
  async addServer(
    instance: MySQLInstance,
    hostgroupId: number,
    weight: number = 1,
    maxConnections: number = 1000
  ): Promise<boolean> {
    const key = `${hostgroupId}:${instance.host}:${instance.port}`;
    this.servers.set(key, {
      hostgroupId,
      hostname: instance.host,
      port: instance.port,
      weight,
      status: 'ONLINE',
      maxConnections,
      comment: `ClawSQL: ${instance.host}:${instance.port}`,
    });

    try {
      await this.execute(
        `INSERT INTO mysql_servers
         (hostgroup_id, hostname, port, weight, max_connections, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [hostgroupId, instance.host, instance.port, weight, maxConnections, `ClawSQL: ${instance.host}:${instance.port}`]
      );
      await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
      logger.info({ host: instance.host, port: instance.port, hostgroupId }, 'Server added to ProxySQL');
      return true;
    } catch (error) {
      // Server might already exist
      logger.debug({ error, key }, 'Server may already exist');
      return true;
    }
  }

  /**
   * Register a MySQL instance with ProxySQL
   */
  async registerInstance(
    instance: MySQLInstance,
    isPrimary: boolean = false,
    writerHostgroup: number = ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
    readerHostgroup: number = ProxySQLManager.DEFAULT_READER_HOSTGROUP
  ): Promise<boolean> {
    const hostgroupId = isPrimary ? writerHostgroup : readerHostgroup;
    return this.addServer(instance, hostgroupId);
  }

  /**
   * Remove a MySQL server from ProxySQL
   */
  async removeServer(instance: MySQLInstance, hostgroupId: number): Promise<boolean> {
    try {
      await this.execute(
        'DELETE FROM mysql_servers WHERE hostname = ? AND port = ? AND hostgroup_id = ?',
        [instance.host, instance.port, hostgroupId]
      );
      await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
      await this.execute('SAVE MYSQL SERVERS TO DISK');
      const key = `${hostgroupId}:${instance.host}:${instance.port}`;
      this.servers.delete(key);
      logger.info({ host: instance.host, port: instance.port }, 'Server removed from ProxySQL');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to remove server');
      return false;
    }
  }

  /**
   * Setup read/write split routing rules
   */
  async setupReadWriteSplit(
    _cluster: MySQLCluster,
    writerHostgroup: number = ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
    readerHostgroup: number = ProxySQLManager.DEFAULT_READER_HOSTGROUP
  ): Promise<boolean> {
    const rules: ProxySQLRule[] = [
      // Route SELECT ... FOR UPDATE to writer
      {
        ruleId: 1,
        matchPattern: '^SELECT.*FOR UPDATE',
        destinationHostgroup: writerHostgroup,
        apply: true,
        active: true,
        comment: 'Route SELECT FOR UPDATE to writer',
      },
      // Route SELECT queries to reader hostgroup
      {
        ruleId: 2,
        matchPattern: '^SELECT',
        destinationHostgroup: readerHostgroup,
        apply: true,
        active: true,
        comment: 'Route SELECT to readers',
      },
      // Default route to writer
      {
        ruleId: 100,
        matchPattern: '.*',
        destinationHostgroup: writerHostgroup,
        apply: true,
        active: true,
        comment: 'Default route to writer',
      },
    ];

    for (const rule of rules) {
      this.rules.push(rule);
      try {
        await this.execute(
          `INSERT INTO mysql_query_rules
           (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rule.ruleId, rule.active ? 1 : 0, rule.matchPattern, rule.destinationHostgroup, rule.apply ? 1 : 0, rule.comment || '']
        );
      } catch {
        // Rule might already exist
      }
    }

    await this.execute('LOAD MYSQL QUERY RULES TO RUNTIME');
    await this.execute('SAVE MYSQL QUERY RULES TO DISK');
    logger.info('Read/write split rules configured');
    return true;
  }

  /**
   * Sync an entire cluster to ProxySQL
   */
  async syncCluster(
    cluster: MySQLCluster,
    writerHostgroup: number = ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
    readerHostgroup: number = ProxySQLManager.DEFAULT_READER_HOSTGROUP,
    monitorUser?: string,
    monitorPassword?: string
  ): Promise<{
    clusterId: string;
    serversAdded: number;
    serversRemoved: number;
    hostgroups: { writer: number; reader: number };
    success: boolean;
    errors: string[];
  }> {
    const result = {
      clusterId: cluster.clusterId,
      serversAdded: 0,
      serversRemoved: 0,
      hostgroups: { writer: writerHostgroup, reader: readerHostgroup },
      success: true,
      errors: [] as string[],
    };

    try {
      // Set monitor credentials if provided
      if (monitorUser && monitorPassword) {
        await this.setMonitorCredentials(monitorUser, monitorPassword);
      }

      // Add primary to writer hostgroup
      if (cluster.primary) {
        if (await this.addServer(cluster.primary, writerHostgroup)) {
          result.serversAdded++;
        }
      }

      // Add replicas to reader hostgroup
      for (const replica of cluster.replicas) {
        if (await this.addServer(replica, readerHostgroup)) {
          result.serversAdded++;
        }
      }

      // Setup replication hostgroups for automatic failover detection
      await this.execute(
        `INSERT INTO mysql_replication_hostgroups
         (writer_hostgroup, reader_hostgroup, comment)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE comment = VALUES(comment)`,
        [writerHostgroup, readerHostgroup, `Cluster: ${cluster.name}`]
      );

      // Setup read/write split rules
      await this.setupReadWriteSplit(cluster, writerHostgroup, readerHostgroup);

      // Load and save
      await this.loadConfigToRuntime();
      await this.saveConfigToDisk();

      logger.info({ clusterId: cluster.clusterId, serversAdded: result.serversAdded }, 'Cluster synced to ProxySQL');
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      logger.error({ error, clusterId: cluster.clusterId }, 'Failed to sync cluster');
    }

    return result;
  }

  /**
   * Remove all servers for a cluster from ProxySQL
   */
  async removeCluster(
    cluster: MySQLCluster,
    _writerHostgroup: number = ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
    _readerHostgroup: number = ProxySQLManager.DEFAULT_READER_HOSTGROUP
  ): Promise<boolean> {
    try {
      // Remove primary
      if (cluster.primary) {
        await this.execute(
          'DELETE FROM mysql_servers WHERE hostname = ? AND port = ?',
          [cluster.primary.host, cluster.primary.port]
        );
      }

      // Remove replicas
      for (const replica of cluster.replicas) {
        await this.execute(
          'DELETE FROM mysql_servers WHERE hostname = ? AND port = ?',
          [replica.host, replica.port]
        );
      }

      await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
      await this.execute('SAVE MYSQL SERVERS TO DISK');
      logger.info({ clusterId: cluster.clusterId }, 'Cluster removed from ProxySQL');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to remove cluster');
      return false;
    }
  }

  /**
   * Load configuration changes to runtime
   */
  async loadConfigToRuntime(): Promise<boolean> {
    try {
      await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
      await this.execute('LOAD MYSQL USERS TO RUNTIME');
      await this.execute('LOAD MYSQL QUERY RULES TO RUNTIME');
      await this.execute('LOAD MYSQL VARIABLES TO RUNTIME');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save current configuration to disk
   */
  async saveConfigToDisk(): Promise<boolean> {
    try {
      await this.execute('SAVE MYSQL SERVERS TO DISK');
      await this.execute('SAVE MYSQL USERS TO DISK');
      await this.execute('SAVE MYSQL QUERY RULES TO DISK');
      await this.execute('SAVE MYSQL VARIABLES TO DISK');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get servers for a hostgroup
   */
  async getServers(hostgroupId?: number): Promise<ProxySQLServer[]> {
    const servers = Array.from(this.servers.values());
    if (hostgroupId !== undefined) {
      return servers.filter(s => s.hostgroupId === hostgroupId);
    }
    return servers;
  }

  /**
   * Get configuration summary
   */
  getConfigSummary(): { hostgroups: number; servers: number; rules: number } {
    return {
      hostgroups: this.hostgroups.size,
      servers: this.servers.size,
      rules: this.rules.length,
    };
  }
}

// Singleton instance
let proxysqlManager: ProxySQLManager | null = null;

/**
 * Get the ProxySQL manager instance
 */
export function getProxySQLManager(): ProxySQLManager {
  if (!proxysqlManager) {
    proxysqlManager = new ProxySQLManager();
  }
  return proxysqlManager;
}
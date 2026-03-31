/**
 * ClawSQL - ProxySQL Manager
 *
 * Manages ProxySQL configuration and routing.
 */

import mysql from 'mysql2/promise';
import { getLogger } from '../../utils/logger.js';
import { MySQLInstance, MySQLCluster } from '../../types/index.js';
import { ProxySQLSettings } from '../../config/settings.js';
import { getDatabase } from '../../utils/database.js';

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
 * ProxySQL server runtime statistics
 */
export interface ProxySQLServerStats {
  hostgroupId: number;
  host: string;
  port: number;
  status: string;
  connUsed: number;
  connFree: number;
  connOk: number;
  connErr: number;
  queries: number;
}

/**
 * ProxySQL replication hostgroup mapping
 */
export interface ProxySQLReplicationHostgroup {
  writerHostgroup: number;
  readerHostgroup: number;
  clusterId?: string;
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
      portRangeStart: 6033,
      portRangeEnd: 6050,
      hostgroupRangeStart: 10,
      hostgroupRangeEnd: 200,
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
   * Note: ProxySQL admin doesn't support prepared statements, so we use query() instead
   */
  private async execute(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (!this.connection) {
      await this.connect();
    }

    // ProxySQL admin doesn't support prepared statements
    // Use query() with interpolated values
    let querySql = sql;
    if (params.length > 0) {
      // Simple parameter interpolation for ProxySQL
      let paramIndex = 0;
      querySql = sql.replace(/\?/g, () => {
        const value = params[paramIndex++];
        if (value === null || value === undefined) {
          return 'NULL';
        }
        if (typeof value === 'number') {
          return String(value);
        }
        if (typeof value === 'boolean') {
          return value ? '1' : '0';
        }
        // Escape single quotes for string values
        return `'${String(value).replace(/'/g, "''")}'`;
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows] = await this.connection!.query(querySql);
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
    const server: ProxySQLServer = {
      hostgroupId,
      hostname: instance.host,
      port: instance.port,
      weight,
      status: 'ONLINE',
      maxConnections,
      comment: `ClawSQL: ${instance.host}:${instance.port}`,
    };

    const key = `${hostgroupId}:${instance.host}:${instance.port}`;
    this.servers.set(key, server);

    try {
      await this.execute(
        `INSERT INTO mysql_servers
         (hostgroup_id, hostname, port, weight, max_connections, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [hostgroupId, instance.host, instance.port, weight, maxConnections, `ClawSQL: ${instance.host}:${instance.port}`]
      );
      await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
      logger.info({ host: instance.host, port: instance.port, hostgroupId }, 'Server added to ProxySQL');

      // Mirror to database
      await this.mirrorServer(server, 'INSERT');

      return true;
    } catch (error) {
      // Server might already exist
      logger.debug({ error, key }, 'Server may already exist');
      // Still mirror to database in case it's a race condition
      await this.mirrorServer(server, 'INSERT');
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
    const server: ProxySQLServer = {
      hostgroupId,
      hostname: instance.host,
      port: instance.port,
      weight: 0,
      status: 'OFFLINE_HARD',
      maxConnections: 0,
    };

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

      // Mirror to database (delete)
      await this.mirrorServer(server, 'DELETE');

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
        // Mirror rule to database
        await this.mirrorQueryRule(rule);
      } catch {
        // Rule might already exist, still mirror
        await this.mirrorQueryRule(rule);
      }
    }

    await this.execute('LOAD MYSQL QUERY RULES TO RUNTIME');
    await this.execute('SAVE MYSQL QUERY RULES TO DISK');
    logger.info('Read/write split rules configured');
    return true;
  }

  /**
   * Sync an entire cluster to ProxySQL
   * Uses upsert logic: adds missing servers, removes servers not in topology
   */
  async syncCluster(
    cluster: MySQLCluster,
    writerHostgroup: number = ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
    readerHostgroup: number = ProxySQLManager.DEFAULT_READER_HOSTGROUP,
    adminUser?: string,
    adminPassword?: string
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
      if (adminUser && adminPassword) {
        await this.setMonitorCredentials(adminUser, adminPassword);
      }

      // Get current servers in both hostgroups
      const currentServers = await this.getServers();
      const currentInWriter = currentServers.filter(s => s.hostgroupId === writerHostgroup);
      const currentInReader = currentServers.filter(s => s.hostgroupId === readerHostgroup);

      // Build expected servers from cluster topology
      const expectedServers = new Set<string>();
      if (cluster.primary) {
        expectedServers.add(`${writerHostgroup}:${cluster.primary.host}:${cluster.primary.port}`);
      }
      for (const replica of cluster.replicas) {
        expectedServers.add(`${readerHostgroup}:${replica.host}:${replica.port}`);
      }

      // Remove servers that are no longer in topology
      for (const server of [...currentInWriter, ...currentInReader]) {
        const key = `${server.hostgroupId}:${server.hostname}:${server.port}`;
        if (!expectedServers.has(key)) {
          try {
            await this.execute(
              'DELETE FROM mysql_servers WHERE hostgroup_id = ? AND hostname = ? AND port = ?',
              [server.hostgroupId, server.hostname, server.port]
            );
            result.serversRemoved++;
            logger.debug({ host: server.hostname, port: server.port, hostgroup: server.hostgroupId }, 'Removed stale server');
          } catch (error) {
            logger.warn({ error, server }, 'Failed to remove stale server');
          }
        }
      }

      // Add primary to writer hostgroup (upsert)
      if (cluster.primary) {
        // Remove from reader hostgroup if present (primary shouldn't be in reader)
        try {
          await this.execute(
            'DELETE FROM mysql_servers WHERE hostname = ? AND port = ? AND hostgroup_id = ?',
            [cluster.primary.host, cluster.primary.port, readerHostgroup]
          );
        } catch {
          // Ignore if doesn't exist
        }
        // Add to writer hostgroup
        try {
          await this.execute(
            `INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
             VALUES (?, ?, ?, 1, 1000, ?)`,
            [writerHostgroup, cluster.primary.host, cluster.primary.port, `ClawSQL: ${cluster.primary.host}:${cluster.primary.port}`]
          );
          result.serversAdded++;
        } catch {
          // Server might already exist, that's OK
        }
      }

      // Add replicas to reader hostgroup
      for (const replica of cluster.replicas) {
        try {
          // Remove from writer hostgroup if present (replica shouldn't be in writer)
          await this.execute(
            'DELETE FROM mysql_servers WHERE hostname = ? AND port = ? AND hostgroup_id = ?',
            [replica.host, replica.port, writerHostgroup]
          );
          // Add to reader hostgroup
          await this.execute(
            `INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
             VALUES (?, ?, ?, 1, 1000, ?)`,
            [readerHostgroup, replica.host, replica.port, `ClawSQL: ${replica.host}:${replica.port}`]
          );
          result.serversAdded++;
        } catch {
          // Server might already exist, that's OK
        }
      }

      // Setup replication hostgroups for automatic failover detection
      try {
        await this.execute(
          `DELETE FROM mysql_replication_hostgroups WHERE writer_hostgroup = ?`,
          [writerHostgroup]
        );
      } catch {
        // Ignore if doesn't exist
      }
      await this.execute(
        `INSERT INTO mysql_replication_hostgroups
         (writer_hostgroup, reader_hostgroup, comment)
         VALUES (?, ?, ?)`,
        [writerHostgroup, readerHostgroup, `Cluster: ${cluster.name}`]
      );

      // Mirror hostgroup to database
      await this.mirrorHostgroup(writerHostgroup, readerHostgroup, cluster.clusterId, `Cluster: ${cluster.name}`);

      // Setup read/write split rules
      await this.setupReadWriteSplit(cluster, writerHostgroup, readerHostgroup);

      // Load and save
      await this.loadConfigToRuntime();
      await this.saveConfigToDisk();

      logger.info({ clusterId: cluster.clusterId, serversAdded: result.serversAdded, serversRemoved: result.serversRemoved }, 'Cluster synced to ProxySQL');
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
   * Get servers configured in ProxySQL (queries live from mysql_servers table)
   */
  async getServers(hostgroupId?: number): Promise<ProxySQLServer[]> {
    try {
      const rows = await this.execute(
        `SELECT hostgroup_id, hostname, port, weight, status, max_connections, comment
         FROM mysql_servers`
      );

      const servers: ProxySQLServer[] = (rows as Record<string, unknown>[]).map((row) => ({
        hostgroupId: Number(row.hostgroup_id),
        hostname: row.hostname as string,
        port: Number(row.port),
        weight: Number(row.weight),
        status: row.status as 'ONLINE' | 'OFFLINE_SOFT' | 'OFFLINE_HARD',
        maxConnections: Number(row.max_connections),
        comment: row.comment as string | undefined,
      }));

      // Update in-memory cache
      this.servers.clear();
      for (const server of servers) {
        const key = `${server.hostgroupId}:${server.hostname}:${server.port}`;
        this.servers.set(key, server);
      }

      if (hostgroupId !== undefined) {
        return servers.filter(s => s.hostgroupId === hostgroupId);
      }
      return servers;
    } catch (error) {
      logger.error({ error }, 'Failed to get servers from ProxySQL');
      // Fallback to in-memory cache
      const cachedServers = Array.from(this.servers.values());
      if (hostgroupId !== undefined) {
        return cachedServers.filter(s => s.hostgroupId === hostgroupId);
      }
      return cachedServers;
    }
  }

  /**
   * Get live server statistics from ProxySQL stats_mysql_connection_pool
   */
  async getServerStats(): Promise<ProxySQLServerStats[]> {
    try {
      const rows = await this.execute(
        `SELECT hostgroup, srv_host, srv_port, status,
                ConnUsed, ConnFree, ConnOK, ConnERR, Queries
         FROM stats_mysql_connection_pool`
      );

      return (rows as Record<string, unknown>[]).map((row) => ({
        hostgroupId: Number(row.hostgroup),
        host: row.srv_host as string,
        port: Number(row.srv_port),
        status: row.status as string,
        connUsed: Number(row.ConnUsed),
        connFree: Number(row.ConnFree),
        connOk: Number(row.ConnOK),
        connErr: Number(row.ConnERR),
        queries: Number(row.Queries),
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get server stats from ProxySQL');
      return [];
    }
  }

  /**
   * Get replication hostgroup mappings
   */
  async getReplicationHostgroups(): Promise<ProxySQLReplicationHostgroup[]> {
    try {
      const rows = await this.execute(
        `SELECT writer_hostgroup, reader_hostgroup, comment
         FROM mysql_replication_hostgroups`
      );

      return (rows as Record<string, unknown>[]).map((row) => ({
        writerHostgroup: Number(row.writer_hostgroup),
        readerHostgroup: Number(row.reader_hostgroup),
        comment: row.comment as string | undefined,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get replication hostgroups from ProxySQL');
      return [];
    }
  }

  /**
   * Get the MySQL port that clients connect to
   */
  getMySQLPort(): number {
    return this.settings.mysqlPort;
  }

  /**
   * Execute a raw SQL query on ProxySQL admin interface
   * Public method for external use
   */
  async executeRaw(sql: string, params: unknown[] = []): Promise<unknown[]> {
    return this.execute(sql, params);
  }

  /**
   * Get listening ports from ProxySQL
   */
  async getListeningPorts(): Promise<number[]> {
    try {
      const rows = await this.execute(
        "SELECT variable_value FROM global_variables WHERE variable_name = 'mysql-interfaces'"
      );
      const value = (rows as Record<string, unknown>[])[0]?.variable_value as string;
      if (!value) return [this.settings.mysqlPort];

      // Parse ports from interfaces like "0.0.0.0:6033;0.0.0.0:6034"
      const ports = value.split(';').map((iface) => {
        const parts = iface.trim().split(':');
        return parseInt(parts[parts.length - 1], 10);
      }).filter((p) => !isNaN(p));

      return ports.length > 0 ? ports : [this.settings.mysqlPort];
    } catch (error) {
      logger.error({ error }, 'Failed to get listening ports');
      return [this.settings.mysqlPort];
    }
  }

  /**
   * Add a listening port to ProxySQL
   */
  async addListeningPort(port: number): Promise<boolean> {
    try {
      const currentPorts = await this.getListeningPorts();
      if (currentPorts.includes(port)) {
        logger.debug({ port }, 'Port already listening');
        return true;
      }

      const newPorts = [...currentPorts, port];
      const interfaces = newPorts.map((p) => `0.0.0.0:${p}`).join(';');

      await this.execute(
        "UPDATE global_variables SET variable_value = ? WHERE variable_name = 'mysql-interfaces'",
        [interfaces]
      );
      await this.execute('LOAD MYSQL VARIABLES TO RUNTIME');

      logger.info({ port, interfaces }, 'Added listening port');
      return true;
    } catch (error) {
      logger.error({ error, port }, 'Failed to add listening port');
      return false;
    }
  }

  /**
   * Remove a listening port from ProxySQL
   */
  async removeListeningPort(port: number): Promise<boolean> {
    try {
      const currentPorts = await this.getListeningPorts();
      if (!currentPorts.includes(port)) {
        return true;
      }

      const newPorts = currentPorts.filter((p) => p !== port);
      const interfaces = newPorts.length > 0
        ? newPorts.map((p) => `0.0.0.0:${p}`).join(';')
        : `0.0.0.0:${this.settings.mysqlPort}`;

      await this.execute(
        "UPDATE global_variables SET variable_value = ? WHERE variable_name = 'mysql-interfaces'",
        [interfaces]
      );
      await this.execute('LOAD MYSQL VARIABLES TO RUNTIME');

      logger.info({ port }, 'Removed listening port');
      return true;
    } catch (error) {
      logger.error({ error, port }, 'Failed to remove listening port');
      return false;
    }
  }

  /**
   * Get the ProxySQL host
   */
  getHost(): string {
    return this.settings.host;
  }

  /**
   * Relocate a replica to follow a new primary
   * This is used after failover to reconfigure replicas
   */
  async relocateReplica(replica: MySQLInstance, newPrimary: MySQLInstance): Promise<boolean> {
    logger.info(
      { replica: `${replica.host}:${replica.port}`, newPrimary: `${newPrimary.host}:${newPrimary.port}` },
      'Relocating replica to follow new primary'
    );
    // This is handled by Orchestrator's relocateReplica method
    // The ProxySQL manager just updates its internal tracking
    // The actual replication change is done via Orchestrator
    return true;
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

  // =========================================================================
  // Database Mirror Methods
  // =========================================================================

  /**
   * Mirror server configuration to metadata database
   */
  private async mirrorServer(
    server: ProxySQLServer,
    action: 'INSERT' | 'DELETE'
  ): Promise<void> {
    const db = getDatabase();
    try {
      if (action === 'INSERT') {
        await db.execute(
          `INSERT INTO proxysql_servers (hostgroup_id, hostname, port, status, weight, max_connections, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), weight = VALUES(weight), synced_at = NOW()`,
          [
            server.hostgroupId,
            server.hostname,
            server.port,
            server.status,
            server.weight,
            server.maxConnections,
            server.comment || '',
          ]
        );
      } else {
        await db.execute(
          'DELETE FROM proxysql_servers WHERE hostgroup_id = ? AND hostname = ? AND port = ?',
          [server.hostgroupId, server.hostname, server.port]
        );
      }

      // Log to audit
      await this.auditLog(
        action === 'INSERT' ? 'ADD_SERVER' : 'REMOVE_SERVER',
        'server',
        `${server.hostgroupId}:${server.hostname}:${server.port}`,
        null,
        server
      );
    } catch (error) {
      logger.error({ error, server, action }, 'Failed to mirror server to database');
    }
  }

  /**
   * Mirror hostgroup configuration to metadata database
   */
  private async mirrorHostgroup(
    writerHostgroup: number,
    readerHostgroup: number,
    clusterId?: string,
    comment?: string
  ): Promise<void> {
    const db = getDatabase();
    try {
      await db.execute(
        `INSERT INTO proxysql_hostgroups (writer_hostgroup, reader_hostgroup, cluster_id, comment)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE reader_hostgroup = VALUES(reader_hostgroup), cluster_id = VALUES(cluster_id)`,
        [writerHostgroup, readerHostgroup, clusterId || null, comment || '']
      );

      await this.auditLog(
        'SYNC_HOSTGROUP',
        'hostgroup',
        `${writerHostgroup}/${readerHostgroup}`,
        null,
        { writerHostgroup, readerHostgroup, clusterId }
      );
    } catch (error) {
      logger.error({ error, writerHostgroup, readerHostgroup }, 'Failed to mirror hostgroup to database');
    }
  }

  /**
   * Mirror query rule to metadata database
   */
  private async mirrorQueryRule(rule: ProxySQLRule): Promise<void> {
    const db = getDatabase();
    try {
      await db.execute(
        `INSERT INTO proxysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE active = VALUES(active), match_pattern = VALUES(match_pattern)`,
        [
          rule.ruleId,
          rule.active ? 1 : 0,
          rule.matchPattern,
          rule.destinationHostgroup,
          rule.apply ? 1 : 0,
          rule.comment || '',
        ]
      );
    } catch (error) {
      logger.error({ error, rule }, 'Failed to mirror query rule to database');
    }
  }

  /**
   * Log action to audit table
   */
  private async auditLog(
    action: string,
    entityType: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown
  ): Promise<void> {
    const db = getDatabase();
    try {
      await db.execute(
        `INSERT INTO proxysql_audit_log (action, entity_type, entity_id, old_value, new_value)
         VALUES (?, ?, ?, ?, ?)`,
        [
          action,
          entityType,
          entityId,
          oldValue ? JSON.stringify(oldValue) : null,
          newValue ? JSON.stringify(newValue) : null,
        ]
      );
    } catch (error) {
      logger.error({ error, action, entityType, entityId }, 'Failed to write audit log');
    }
  }

  /**
   * Restore ProxySQL configuration from metadata database
   * Called on startup to sync ProxySQL with stored config
   */
  async restoreFromDatabase(): Promise<{ servers: number; hostgroups: number; rules: number }> {
    logger.info('Restoring ProxySQL configuration from metadata database');

    const result = { servers: 0, hostgroups: 0, rules: 0 };

    try {
      const db = getDatabase();

      // Restore servers
      const servers = await db.query<{
        hostgroup_id: number;
        hostname: string;
        port: number;
        status: string;
        weight: number;
        max_connections: number;
        comment: string;
      }>('SELECT * FROM proxysql_servers WHERE status = "ONLINE"');

      for (const server of servers) {
        try {
          await this.addServer(
            { host: server.hostname, port: server.port } as MySQLInstance,
            server.hostgroup_id,
            server.weight,
            server.max_connections
          );
          result.servers++;
        } catch (error) {
          logger.warn({ error, server }, 'Failed to restore server');
        }
      }

      // Restore hostgroups
      const hostgroups = await db.query<{
        writer_hostgroup: number;
        reader_hostgroup: number;
        cluster_id: string;
        comment: string;
      }>('SELECT * FROM proxysql_hostgroups');

      for (const hg of hostgroups) {
        try {
          await this.execute(
            `INSERT INTO mysql_replication_hostgroups (writer_hostgroup, reader_hostgroup, comment)
             VALUES (?, ?, ?)`,
            [hg.writer_hostgroup, hg.reader_hostgroup, hg.comment || '']
          );
          result.hostgroups++;
        } catch (error) {
          logger.debug({ error, hostgroup: hg }, 'Hostgroup may already exist');
        }
      }

      // Restore query rules
      const rules = await db.query<{
        rule_id: number;
        active: number;
        match_pattern: string;
        destination_hostgroup: number;
        apply: number;
        comment: string;
      }>('SELECT * FROM proxysql_query_rules WHERE active = 1');

      for (const rule of rules) {
        try {
          await this.execute(
            `INSERT INTO mysql_query_rules (rule_id, active, match_pattern, destination_hostgroup, apply, comment)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [rule.rule_id, rule.active, rule.match_pattern, rule.destination_hostgroup, rule.apply, rule.comment || '']
          );
          result.rules++;
        } catch (error) {
          logger.debug({ error, rule }, 'Query rule may already exist');
        }
      }

      // Load to runtime
      await this.loadConfigToRuntime();

      logger.info(result, 'ProxySQL configuration restored from database');
    } catch (error) {
      logger.error({ error }, 'Failed to restore ProxySQL configuration from database');
    }

    return result;
  }

  /**
   * Get all mirrored servers from database
   */
  async getMirroredServers(): Promise<ProxySQLServer[]> {
    const db = getDatabase();
    const rows = await db.query<{
      hostgroup_id: number;
      hostname: string;
      port: number;
      status: string;
      weight: number;
      max_connections: number;
      comment: string;
    }>('SELECT * FROM proxysql_servers ORDER BY hostgroup_id, hostname');

    return rows.map((row) => ({
      hostgroupId: row.hostgroup_id,
      hostname: row.hostname,
      port: row.port,
      status: row.status as 'ONLINE' | 'OFFLINE_SOFT' | 'OFFLINE_HARD',
      weight: row.weight,
      maxConnections: row.max_connections,
      comment: row.comment,
    }));
  }

  /**
   * Get audit log entries
   */
  async getAuditLog(limit: number = 100): Promise<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: string;
    old_value: unknown;
    new_value: unknown;
    changed_at: Date;
  }[]> {
    const db = getDatabase();
    return db.query(
      'SELECT * FROM proxysql_audit_log ORDER BY changed_at DESC LIMIT ?',
      [limit]
    );
  }
}

// Singleton instance
let proxysqlManager: ProxySQLManager | null = null;

/**
 * Get the ProxySQL manager instance
 */
export function getProxySQLManager(): ProxySQLManager {
  if (!proxysqlManager) {
    const { getSettings } = require('../../config/settings.js');
    proxysqlManager = new ProxySQLManager(getSettings().proxysql);
  }
  return proxysqlManager;
}
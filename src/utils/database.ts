/**
 * ClawSQL - Database Utility
 *
 * MySQL database connection for metadata storage.
 * Shared with Orchestrator - extends Orchestrator's schema with ClawSQL-specific tables.
 */

import mysql from 'mysql2/promise';
import { getSettings } from '../config/settings.js';
import { getLogger } from './logger.js';

const logger = getLogger('database');

/**
 * MySQL connection pool
 */
export type MySQLConnection = mysql.Pool;

/**
 * Database manager for MySQL metadata storage
 */
export class DatabaseManager {
  private pool: MySQLConnection | null = null;

  /**
   * Initialize the database connection
   */
  async connect(): Promise<void> {
    const settings = getSettings();
    const metadataDb = settings.metadataDb;

    const host = metadataDb.host || 'metadata-mysql';

    logger.info(
      { host, port: metadataDb.port, database: metadataDb.name },
      'Connecting to MySQL metadata database'
    );

    this.pool = mysql.createPool({
      host,
      port: metadataDb.port,
      database: metadataDb.name,
      user: metadataDb.user,
      password: metadataDb.password,
      connectionLimit: metadataDb.poolSize,
      waitForConnections: true,
    });

    // Test connection
    const conn = await this.pool.getConnection();
    await conn.ping();
    conn.release();

    logger.info('MySQL connection established');

    // Initialize ClawSQL-specific tables
    await this.initializeSchema();
  }

  /**
   * Initialize ClawSQL-specific tables
   * Note: Orchestrator creates its own tables automatically
   */
  private async initializeSchema(): Promise<void> {
    const schema = `
      -- Alerts table for ClawSQL alerting
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id VARCHAR(36) PRIMARY KEY,
        severity ENUM('info', 'warning', 'critical') NOT NULL,
        instance_id VARCHAR(128),
        cluster_id VARCHAR(128),
        message TEXT NOT NULL,
        details JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_at TIMESTAMP NULL,
        acknowledged_by VARCHAR(128),
        INDEX idx_alerts_severity (severity),
        INDEX idx_alerts_instance (instance_id),
        INDEX idx_alerts_cluster (cluster_id),
        INDEX idx_alerts_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Schema metadata for NL2SQL processing
      CREATE TABLE IF NOT EXISTS schema_metadata (
        schema_id VARCHAR(36) PRIMARY KEY,
        instance_id VARCHAR(128) NOT NULL,
        database_name VARCHAR(64) NOT NULL,
        table_name VARCHAR(64) NOT NULL,
        column_name VARCHAR(64),
        column_type VARCHAR(64),
        is_nullable BOOLEAN,
        column_comment TEXT,
        table_comment TEXT,
        sample_values JSON,
        business_context TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_schema (instance_id, database_name, table_name, column_name),
        INDEX idx_schema_instance (instance_id),
        INDEX idx_schema_database (database_name),
        INDEX idx_schema_table (table_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Instance metadata (labels, extra fields extending Orchestrator's database_instance)
      CREATE TABLE IF NOT EXISTS instance_metadata (
        instance_id VARCHAR(128) PRIMARY KEY,
        labels JSON DEFAULT ('{}'),
        extra JSON DEFAULT ('{}'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Configuration snapshots for version control
      CREATE TABLE IF NOT EXISTS config_snapshots (
        snapshot_id VARCHAR(36) PRIMARY KEY,
        config_type VARCHAR(64) NOT NULL,
        config_data JSON NOT NULL,
        version VARCHAR(64) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(128),
        INDEX idx_config_type (config_type),
        INDEX idx_config_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- ProxySQL server configuration mirror
      CREATE TABLE IF NOT EXISTS proxysql_servers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hostgroup_id INT NOT NULL,
        hostname VARCHAR(255) NOT NULL,
        port INT NOT NULL,
        status ENUM('ONLINE', 'OFFLINE_SOFT', 'OFFLINE_HARD') DEFAULT 'ONLINE',
        weight INT DEFAULT 1,
        max_connections INT DEFAULT 1000,
        max_replication_lag INT DEFAULT 0,
        use_ssl TINYINT DEFAULT 0,
        comment VARCHAR(255),
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_server (hostgroup_id, hostname, port),
        INDEX idx_hostgroup (hostgroup_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- ProxySQL replication hostgroups mirror
      CREATE TABLE IF NOT EXISTS proxysql_hostgroups (
        writer_hostgroup INT PRIMARY KEY,
        reader_hostgroup INT NOT NULL,
        cluster_id VARCHAR(128),
        comment VARCHAR(255),
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- ProxySQL query rules mirror
      CREATE TABLE IF NOT EXISTS proxysql_query_rules (
        rule_id INT PRIMARY KEY,
        active TINYINT DEFAULT 1,
        match_pattern VARCHAR(2048),
        replace_pattern VARCHAR(2048),
        destination_hostgroup INT,
        apply TINYINT DEFAULT 1,
        comment VARCHAR(255),
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- ProxySQL configuration change audit log
      CREATE TABLE IF NOT EXISTS proxysql_audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(32) NOT NULL,
        entity_type VARCHAR(32) NOT NULL,
        entity_id VARCHAR(128),
        old_value JSON,
        new_value JSON,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        changed_by VARCHAR(128),
        INDEX idx_audit_action (action),
        INDEX idx_audit_entity (entity_type, entity_id),
        INDEX idx_audit_time (changed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Topology templates for cluster provisioning
      CREATE TABLE IF NOT EXISTS topology_templates (
        template_id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(64) NOT NULL,
        description TEXT,
        primary_count INT DEFAULT 1,
        replica_count INT DEFAULT 2,
        replication_mode ENUM('async', 'semi-sync', 'group-replication') DEFAULT 'async',
        settings JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Cluster metadata for provisioned clusters
      CREATE TABLE IF NOT EXISTS cluster_metadata (
        cluster_id VARCHAR(128) PRIMARY KEY,
        template_id VARCHAR(36),
        assigned_port INT,
        writer_hostgroup INT,
        reader_hostgroup INT,
        provision_status ENUM('pending', 'provisioning', 'ready', 'failed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES topology_templates(template_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      -- Provisioned instances for template-based clusters
      CREATE TABLE IF NOT EXISTS provisioned_instances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cluster_id VARCHAR(128) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port INT NOT NULL,
        role ENUM('primary', 'replica') NOT NULL,
        sequence INT NOT NULL,
        provisioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cluster_instance (cluster_id, host, port),
        INDEX idx_cluster (cluster_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
      await this.pool!.execute(statement);
    }

    logger.info('ClawSQL schema initialized');
  }

  /**
   * Execute a query and return results
   */
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows] = await this.pool.execute(sql, params as any[]);
    return rows as T[];
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: unknown[] = []): Promise<{ changes: number; lastId: unknown }> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await this.pool.execute(sql, params as any[]);
    const r = result as mysql.ResultSetHeader;
    return { changes: r.affectedRows, lastId: r.insertId };
  }

  /**
   * Get a single row
   */
  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows] = await this.pool.execute(sql, params as any[]);
    const r = rows as T[];
    return r[0];
  }

  /**
   * Get a connection from the pool for transactions
   */
  async getConnection(): Promise<mysql.PoolConnection> {
    if (!this.pool) {
      throw new Error('Database not connected');
    }
    return this.pool.getConnection();
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('MySQL connection closed');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.pool !== null;
  }
}

// Singleton instance
let dbManager: DatabaseManager | null = null;

/**
 * Get the database manager instance
 */
export function getDatabase(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<DatabaseManager> {
  const db = getDatabase();
  if (!db.isConnected()) {
    await db.connect();
  }
  return db;
}
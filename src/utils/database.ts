/**
 * ClawSQL - Database Utility
 *
 * SQLite and MySQL database connection for metadata storage.
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { getSettings, DatabaseSettings } from '../config/settings.js';
import { getLogger } from './logger.js';

const logger = getLogger('database');

// Database connection types
export type SQLiteConnection = Database.Database;
export type MySQLConnection = mysql.Pool;

/**
 * Database connection wrapper supporting SQLite and MySQL
 */
export class DatabaseManager {
  private sqliteDb: SQLiteConnection | null = null;
  private mysqlPool: MySQLConnection | null = null;
  private settings: DatabaseSettings;

  constructor(settings?: DatabaseSettings) {
    this.settings = settings || getSettings().database;
  }

  /**
   * Initialize the database connection
   */
  async connect(): Promise<void> {
    if (this.settings.type === 'sqlite') {
      await this.connectSQLite();
    } else {
      await this.connectMySQL();
    }
    await this.initializeSchema();
  }

  /**
   * Connect to SQLite database
   */
  private async connectSQLite(): Promise<void> {
    logger.info({ path: this.settings.sqlitePath }, 'Connecting to SQLite database');
    this.sqliteDb = new Database(this.settings.sqlitePath);
    this.sqliteDb.pragma('journal_mode = WAL');
    this.sqliteDb.pragma('foreign_keys = ON');
    logger.info('SQLite connection established');
  }

  /**
   * Connect to MySQL database
   */
  private async connectMySQL(): Promise<void> {
    logger.info(
      { host: this.settings.host, port: this.settings.port, database: this.settings.name },
      'Connecting to MySQL database'
    );
    this.mysqlPool = mysql.createPool({
      host: this.settings.host,
      port: this.settings.port,
      database: this.settings.name,
      user: this.settings.user,
      password: this.settings.password,
      connectionLimit: this.settings.poolSize,
      waitForConnections: true,
    });
    // Test connection
    const conn = await this.mysqlPool.getConnection();
    await conn.ping();
    conn.release();
    logger.info('MySQL connection established');
  }

  /**
   * Initialize database schema
   */
  private async initializeSchema(): Promise<void> {
    const schema = `
      -- Instances table
      CREATE TABLE IF NOT EXISTS instances (
        instance_id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        server_id INTEGER,
        role TEXT DEFAULT 'unknown',
        state TEXT DEFAULT 'offline',
        version TEXT,
        replication_lag REAL,
        last_seen TEXT,
        cluster_id TEXT,
        labels TEXT DEFAULT '{}',
        extra TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Clusters table
      CREATE TABLE IF NOT EXISTS clusters (
        cluster_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        primary_instance_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Failover operations table
      CREATE TABLE IF NOT EXISTS failover_operations (
        operation_id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        old_primary_id TEXT,
        new_primary_id TEXT,
        state TEXT DEFAULT 'idle',
        started_at TEXT,
        completed_at TEXT,
        steps TEXT DEFAULT '[]',
        error TEXT,
        manual INTEGER DEFAULT 0,
        reason TEXT,
        triggered_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Alerts table
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        instance_id TEXT,
        cluster_id TEXT,
        message TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        acknowledged INTEGER DEFAULT 0,
        acknowledged_at TEXT,
        acknowledged_by TEXT
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_instances_cluster ON instances(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_instances_state ON instances(state);
      CREATE INDEX IF NOT EXISTS idx_failover_cluster ON failover_operations(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    `;

    if (this.sqliteDb) {
      this.sqliteDb.exec(schema);
    } else if (this.mysqlPool) {
      const statements = schema.split(';').filter(s => s.trim());
      for (const statement of statements) {
        await this.mysqlPool.execute(statement);
      }
    }
    logger.info('Database schema initialized');
  }

  /**
   * Execute a query
   */
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      const result = stmt.all(...params) as T[];
      return result;
    } else if (this.mysqlPool) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [rows] = await this.mysqlPool.execute(sql, params as any[]);
      return rows as T[];
    }
    throw new Error('Database not connected');
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: unknown[] = []): Promise<{ changes: number; lastId: unknown }> {
    if (this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      const result = stmt.run(...params);
      return { changes: result.changes, lastId: result.lastInsertRowid };
    } else if (this.mysqlPool) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [result] = await this.mysqlPool.execute(sql, params as any[]);
      const r = result as mysql.ResultSetHeader;
      return { changes: r.affectedRows, lastId: r.insertId };
    }
    throw new Error('Database not connected');
  }

  /**
   * Get a single row
   */
  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } else if (this.mysqlPool) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [rows] = await this.mysqlPool.execute(sql, params as any[]);
      const r = rows as T[];
      return r[0];
    }
    throw new Error('Database not connected');
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.close();
      this.sqliteDb = null;
      logger.info('SQLite connection closed');
    }
    if (this.mysqlPool) {
      await this.mysqlPool.end();
      this.mysqlPool = null;
      logger.info('MySQL connection closed');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.sqliteDb !== null || this.mysqlPool !== null;
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
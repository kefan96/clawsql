/**
 * ClawSQL - MySQL Instance Client
 *
 * Execute commands on MySQL instances.
 */

import mysql from 'mysql2/promise';
import { getLogger } from './logger.js';
import { getSettings } from '../config/settings.js';

const logger = getLogger('mysql-client');

/**
 * MySQL Instance Client
 * Executes commands on MySQL instances for failover operations.
 */
export class MySQLInstanceClient {
  private adminUser: string;
  private adminPassword: string;

  constructor() {
    const settings = getSettings();
    this.adminUser = settings.mysql.adminUser;
    this.adminPassword = settings.mysql.adminPassword;
  }

  /**
   * Execute a SQL command on a MySQL instance
   */
  async executeCommand(host: string, port: number, sql: string): Promise<boolean> {
    let connection: mysql.Connection | null = null;

    try {
      connection = await mysql.createConnection({
        host,
        port,
        user: this.adminUser,
        password: this.adminPassword,
        connectTimeout: 5000,
      });

      await connection.execute(sql);
      logger.debug({ host, port, sql }, 'Command executed successfully');
      return true;
    } catch (error) {
      logger.error({ error, host, port, sql }, 'Failed to execute command');
      return false;
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Start replication on an instance
   */
  async startReplication(host: string, port: number): Promise<boolean> {
    logger.info({ host, port }, 'Starting replication');
    return this.executeCommand(host, port, 'START SLAVE');
  }

  /**
   * Stop replication on an instance
   */
  async stopReplication(host: string, port: number): Promise<boolean> {
    logger.info({ host, port }, 'Stopping replication');
    return this.executeCommand(host, port, 'STOP SLAVE');
  }

  /**
   * Get replication status
   */
  async getReplicationStatus(host: string, port: number): Promise<{
    ioRunning: boolean;
    sqlRunning: boolean;
    secondsBehind: number | null;
  } | null> {
    let connection: mysql.Connection | null = null;

    try {
      connection = await mysql.createConnection({
        host,
        port,
        user: this.adminUser,
        password: this.adminPassword,
        connectTimeout: 5000,
      });

      const [rows] = await connection.execute('SHOW SLAVE STATUS');
      const status = (rows as Record<string, unknown>[])[0];

      if (!status) {
        return null;
      }

      return {
        ioRunning: status.Slave_IO_Running === 'Yes',
        sqlRunning: status.Slave_SQL_Running === 'Yes',
        secondsBehind: status.Seconds_Behind_Master as number | null,
      };
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to get replication status');
      return null;
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Set instance read-only
   */
  async setReadOnly(host: string, port: number, readOnly: boolean): Promise<boolean> {
    const sql = `SET GLOBAL read_only = ${readOnly ? 'ON' : 'OFF'}`;
    logger.info({ host, port, readOnly }, 'Setting read-only mode');
    return this.executeCommand(host, port, sql);
  }
}

// Singleton instance
let mysqlClient: MySQLInstanceClient | null = null;

/**
 * Get the MySQL instance client
 */
export function getMySQLClient(): MySQLInstanceClient {
  if (!mysqlClient) {
    mysqlClient = new MySQLInstanceClient();
  }
  return mysqlClient;
}
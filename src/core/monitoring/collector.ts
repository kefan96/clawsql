/**
 * ClawSQL - Metrics Collector
 *
 * Collects metrics from MySQL instances.
 */

import mysql from 'mysql2/promise';
import { getLogger } from '../../utils/logger.js';
import {
  MySQLInstance,
  InstanceMetrics,
  createInstanceId,
} from '../../types/index.js';
import { getSettings } from '../../config/settings.js';

const logger = getLogger('collector');

/**
 * Metrics Collector
 */
export class MetricsCollector {
  private settings = getSettings();

  /**
   * Collect metrics from a MySQL instance
   */
  async collectMetrics(instance: MySQLInstance): Promise<InstanceMetrics> {
    const instanceId = createInstanceId(instance.host, instance.port);

    try {
      const connection = await mysql.createConnection({
        host: instance.host,
        port: instance.port,
        user: this.settings.mysql.monitorUser,
        password: this.settings.mysql.monitorPassword,
        connectTimeout: 5000,
      });

      // Get replication status
      const [slaveStatus] = await connection.execute(
        'SHOW SLAVE STATUS'
      );
      const slaveStatusRow = (slaveStatus as Record<string, unknown>[])[0];

      // Get status variables
      const [statusVars] = await connection.execute(
        'SHOW GLOBAL STATUS WHERE Variable_name IN (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'Threads_connected',
          'max_connections',
          'Queries',
          'Uptime',
          'Innodb_buffer_pool_read_requests',
          'Innodb_buffer_pool_reads',
          'Bytes_received',
          'Bytes_sent',
        ]
      );
      const status = this.parseStatusRows(statusVars as Record<string, unknown>[]);

      await connection.end();

      // Calculate derived metrics
      const bufferPoolReads = Number(status.Innodb_buffer_pool_reads) || 0;
      const bufferPoolRequests = Number(status.Innodb_buffer_pool_read_requests) || 1;
      const bufferPoolHitRate = bufferPoolRequests > 0
        ? ((bufferPoolRequests - bufferPoolReads) / bufferPoolRequests) * 100
        : 100;

      return {
        instanceId,
        timestamp: new Date(),
        replicationLagSeconds: slaveStatusRow
          ? Number(slaveStatusRow.Seconds_Behind_Master)
          : undefined,
        replicationIoRunning: slaveStatusRow
          ? slaveStatusRow.Slave_IO_Running === 'Yes'
          : false,
        replicationSqlRunning: slaveStatusRow
          ? slaveStatusRow.Slave_SQL_Running === 'Yes'
          : false,
        connectionsCurrent: Number(status.Threads_connected) || 0,
        connectionsMax: Number(status.max_connections) || 1000,
        queriesPerSecond: Number(status.Queries) / (Number(status.Uptime) || 1),
        innodbBufferPoolHitRate: bufferPoolHitRate,
        uptimeSeconds: Number(status.Uptime) || 0,
      };
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to collect metrics');
      return {
        instanceId,
        timestamp: new Date(),
        replicationIoRunning: false,
        replicationSqlRunning: false,
        connectionsCurrent: 0,
        connectionsMax: 0,
        queriesPerSecond: 0,
        innodbBufferPoolHitRate: 0,
        uptimeSeconds: 0,
      };
    }
  }

  /**
   * Parse SHOW STATUS rows into a key-value object
   */
  private parseStatusRows(rows: Record<string, unknown>[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.Variable_name as string] = row.Value;
    }
    return result;
  }
}

// Singleton instance
let metricsCollector: MetricsCollector | null = null;

/**
 * Get the metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector();
  }
  return metricsCollector;
}
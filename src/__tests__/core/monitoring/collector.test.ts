/**
 * Tests for Metrics Collector
 */

import { MetricsCollector, getMetricsCollector } from '../../../core/monitoring/collector.js';
import { createMySQLInstance } from '../../../types/index.js';
import mysql from 'mysql2/promise';

// Mock mysql2
jest.mock('mysql2/promise');
const mockedMysql = mysql as jest.Mocked<typeof mysql>;

// Mock settings
jest.mock('../../../config/settings.js', () => ({
  getSettings: () => ({
    mysql: {
      monitorUser: 'monitor',
      monitorPassword: 'password',
    },
    logging: {
      level: 'INFO',
      format: 'json',
    },
  }),
}));

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let mockConnection: {
    execute: jest.Mock;
    end: jest.Mock;
  };

  beforeEach(() => {
    mockConnection = {
      execute: jest.fn(),
      end: jest.fn(),
    };
    mockedMysql.createConnection.mockResolvedValue(mockConnection as unknown as mysql.Connection);
    collector = new MetricsCollector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('collectMetrics', () => {
    it('should collect metrics from MySQL instance', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[]]) // SHOW SLAVE STATUS
        .mockResolvedValueOnce([
          [
            { Variable_name: 'Threads_connected', Value: '10' },
            { Variable_name: 'max_connections', Value: '100' },
            { Variable_name: 'Queries', Value: '1000' },
            { Variable_name: 'Uptime', Value: '3600' },
            { Variable_name: 'Innodb_buffer_pool_read_requests', Value: '5000' },
            { Variable_name: 'Innodb_buffer_pool_reads', Value: '50' },
            { Variable_name: 'Bytes_received', Value: '1024' },
            { Variable_name: 'Bytes_sent', Value: '2048' },
          ],
        ]);

      const instance = createMySQLInstance('mysql-primary', 3306);
      const metrics = await collector.collectMetrics(instance);

      expect(metrics.instanceId).toBe('mysql-primary:3306');
      expect(metrics.connectionsCurrent).toBe(10);
      expect(metrics.connectionsMax).toBe(100);
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should collect replication metrics for replica', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              Seconds_Behind_Master: 5,
              Slave_IO_Running: 'Yes',
              Slave_SQL_Running: 'Yes',
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            { Variable_name: 'Threads_connected', Value: '5' },
            { Variable_name: 'max_connections', Value: '100' },
            { Variable_name: 'Queries', Value: '500' },
            { Variable_name: 'Uptime', Value: '1800' },
            { Variable_name: 'Innodb_buffer_pool_read_requests', Value: '1000' },
            { Variable_name: 'Innodb_buffer_pool_reads', Value: '10' },
            { Variable_name: 'Bytes_received', Value: '512' },
            { Variable_name: 'Bytes_sent', Value: '1024' },
          ],
        ]);

      const instance = createMySQLInstance('mysql-replica', 3306);
      const metrics = await collector.collectMetrics(instance);

      expect(metrics.replicationLagSeconds).toBe(5);
      expect(metrics.replicationIoRunning).toBe(true);
      expect(metrics.replicationSqlRunning).toBe(true);
    });

    it('should handle connection errors gracefully', async () => {
      mockedMysql.createConnection.mockRejectedValue(new Error('Connection refused'));

      const instance = createMySQLInstance('offline-mysql', 3306);
      const metrics = await collector.collectMetrics(instance);

      expect(metrics.instanceId).toBe('offline-mysql:3306');
      expect(metrics.replicationIoRunning).toBe(false);
      expect(metrics.connectionsCurrent).toBe(0);
    });

    it('should calculate buffer pool hit rate', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([
          [
            { Variable_name: 'Threads_connected', Value: '10' },
            { Variable_name: 'max_connections', Value: '100' },
            { Variable_name: 'Queries', Value: '1000' },
            { Variable_name: 'Uptime', Value: '3600' },
            { Variable_name: 'Innodb_buffer_pool_read_requests', Value: '1000' },
            { Variable_name: 'Innodb_buffer_pool_reads', Value: '100' },
            { Variable_name: 'Bytes_received', Value: '1024' },
            { Variable_name: 'Bytes_sent', Value: '2048' },
          ],
        ]);

      const instance = createMySQLInstance('mysql-primary', 3306);
      const metrics = await collector.collectMetrics(instance);

      // Hit rate = (requests - reads) / requests = (1000 - 100) / 1000 = 90%
      expect(metrics.innodbBufferPoolHitRate).toBeCloseTo(90);
    });
  });
});

describe('getMetricsCollector', () => {
  it('should return singleton instance', () => {
    const c1 = getMetricsCollector();
    const c2 = getMetricsCollector();

    expect(c1).toBe(c2);
  });
});
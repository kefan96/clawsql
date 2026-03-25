/**
 * Tests for ProxySQL Manager
 */

import { ProxySQLManager, getProxySQLManager } from '../../../core/routing/proxysql-manager.js';
import { InstanceRole, createMySQLInstance, createMySQLCluster } from '../../../types/index.js';
import mysql from 'mysql2/promise';

// Mock mysql2
jest.mock('mysql2/promise');
const mockedMysql = mysql as jest.Mocked<typeof mysql>;

// Mock database module
jest.mock('../../../utils/database.js', () => ({
  getDatabase: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue({ changes: 1, lastId: 1 }),
    query: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('ProxySQLManager', () => {
  let manager: ProxySQLManager;
  let mockConnection: {
    execute: jest.Mock;
    query: jest.Mock;
    end: jest.Mock;
  };

  beforeEach(() => {
    mockConnection = {
      execute: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
    };

    mockedMysql.createConnection.mockResolvedValue(mockConnection as unknown as mysql.Connection);
    manager = new ProxySQLManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default settings', () => {
      const m = new ProxySQLManager();
      expect(m).toBeDefined();
    });

    it('should accept custom settings', () => {
      const m = new ProxySQLManager({
        host: 'custom-proxysql',
        adminPort: 6033,
        mysqlPort: 6034,
        adminUser: 'custom-user',
        adminPassword: 'custom-pass',
      });
      expect(m).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should establish connection to ProxySQL', async () => {
      await manager.connect();

      expect(mockedMysql.createConnection).toHaveBeenCalledWith({
        host: 'proxysql',
        port: 6032,
        user: 'clawsql',
        password: 'clawsql',
      });
    });

    it('should use custom settings for connection', async () => {
      const customManager = new ProxySQLManager({
        host: 'custom-host',
        adminPort: 7000,
        adminUser: 'admin',
        adminPassword: 'password',
      });

      await customManager.connect();

      expect(mockedMysql.createConnection).toHaveBeenCalledWith({
        host: 'custom-host',
        port: 7000,
        user: 'admin',
        password: 'password',
      });
    });
  });

  describe('close', () => {
    it('should close connection if exists', async () => {
      await manager.connect();
      await manager.close();

      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should not throw if no connection', async () => {
      await expect(manager.close()).resolves.not.toThrow();
    });
  });

  describe('setMonitorCredentials', () => {
    it('should set monitor credentials', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      const result = await manager.setMonitorCredentials('monitor', 'password');

      expect(result).toBe(true);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE global_variables SET variable_value = 'monitor' WHERE variable_name = 'mysql-monitor_username'")
      );
    });

    it('should return false on error', async () => {
      mockConnection.query.mockRejectedValue(new Error('Failed'));

      const result = await manager.setMonitorCredentials('monitor', 'password');

      expect(result).toBe(false);
    });
  });

  describe('addServer', () => {
    it('should add server to ProxySQL', async () => {
      mockConnection.query.mockResolvedValue([[], []]);
      const instance = createMySQLInstance('mysql-primary', 3306);

      const result = await manager.addServer(instance, 10, 1, 1000);

      expect(result).toBe(true);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO mysql_servers')
      );
    });
  });

  describe('registerInstance', () => {
    it('should register primary to writer hostgroup', async () => {
      mockConnection.query.mockResolvedValue([[], []]);
      const instance = createMySQLInstance('mysql-primary', 3306);

      const result = await manager.registerInstance(instance, true);

      expect(result).toBe(true);
    });

    it('should register replica to reader hostgroup', async () => {
      mockConnection.query.mockResolvedValue([[], []]);
      const instance = createMySQLInstance('mysql-replica', 3306);

      const result = await manager.registerInstance(instance, false);

      expect(result).toBe(true);
    });
  });

  describe('syncCluster', () => {
    it('should sync cluster to ProxySQL', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      const primary = createMySQLInstance('mysql-primary', 3306, { role: InstanceRole.PRIMARY });
      const replica = createMySQLInstance('mysql-replica', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const result = await manager.syncCluster(cluster, 10, 20, 'monitor', 'password');

      expect(result.success).toBe(true);
      expect(result.clusterId).toBe('cluster-1');
    });

    it('should handle errors during sync', async () => {
      mockConnection.query.mockRejectedValue(new Error('Failed'));

      const cluster = createMySQLCluster('cluster-1', 'test');

      const result = await manager.syncCluster(cluster);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getConfigSummary', () => {
    it('should return config summary', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      const instance = createMySQLInstance('mysql-primary', 3306);
      await manager.addServer(instance, 10);

      const summary = manager.getConfigSummary();

      expect(summary.servers).toBe(1);
    });
  });
});

describe('getProxySQLManager', () => {
  it('should return singleton instance', () => {
    const m1 = getProxySQLManager();
    const m2 = getProxySQLManager();

    expect(m1).toBe(m2);
  });
});
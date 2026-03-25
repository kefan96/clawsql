/**
 * Tests for Database Utility
 */

// Mock mysql2/promise
jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(),
}));

// Mock settings
jest.mock('../../config/settings', () => ({
  getSettings: jest.fn(),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { DatabaseManager, getDatabase, initDatabase } from '../../utils/database';
import { createPool } from 'mysql2/promise';
import { getSettings } from '../../config/settings';

const mockCreatePool = createPool as jest.MockedFunction<typeof createPool>;
const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;

let mockPool: any;
let mockConnection: any;

describe('DatabaseManager', () => {

  beforeEach(() => {
    mockConnection = {
      ping: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };

    mockPool = {
      getConnection: jest.fn().mockResolvedValue(mockConnection),
      execute: jest.fn().mockResolvedValue([[], []]),
      end: jest.fn().mockResolvedValue(undefined),
    };

    mockCreatePool.mockReturnValue(mockPool as any);

    mockGetSettings.mockReturnValue({
      metadataDb: {
        host: 'localhost',
        port: 3306,
        name: 'clawsql',
        user: 'root',
        password: 'password',
        poolSize: 10,
      },
    } as any);

    // Reset singleton
    jest.resetModules();
  });

  describe('connect', () => {
    it('should connect to MySQL database', async () => {
      const db = new DatabaseManager();
      await db.connect();

      expect(mockCreatePool).toHaveBeenCalled();
      expect(mockConnection.ping).toHaveBeenCalled();
    });

    it('should initialize schema after connection', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 0 }, []]);

      const db = new DatabaseManager();
      await db.connect();

      // Schema initialization should have been called
      expect(mockPool.execute).toHaveBeenCalled();
    });

    it('should use default host if not configured', async () => {
      mockGetSettings.mockReturnValue({
        metadataDb: {
          host: '',
          port: 3306,
          name: 'clawsql',
          user: 'root',
          password: 'password',
          poolSize: 10,
        },
      } as any);

      const db = new DatabaseManager();
      await db.connect();

      expect(mockCreatePool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'metadata-mysql',
      }));
    });
  });

  describe('query', () => {
    it('should execute query and return results', async () => {
      const mockRows = [{ id: 1, name: 'test' }];
      mockPool.execute.mockResolvedValue([mockRows, []]);

      const db = new DatabaseManager();
      await db.connect();
      const results = await db.query('SELECT * FROM test');

      expect(results).toEqual(mockRows);
    });

    it('should throw error when not connected', async () => {
      const db = new DatabaseManager();

      await expect(db.query('SELECT 1')).rejects.toThrow('Database not connected');
    });

    it('should execute query with parameters', async () => {
      mockPool.execute.mockResolvedValue([[{ id: 1 }], []]);

      const db = new DatabaseManager();
      await db.connect();
      await db.query('SELECT * FROM test WHERE id = ?', [1]);

      expect(mockPool.execute).toHaveBeenCalledWith('SELECT * FROM test WHERE id = ?', [1]);
    });
  });

  describe('execute', () => {
    it('should execute statement and return result', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 5, insertId: 10 }, []]);

      const db = new DatabaseManager();
      await db.connect();
      const result = await db.execute('UPDATE test SET name = ?', ['new']);

      expect(result.changes).toBe(5);
      expect(result.lastId).toBe(10);
    });

    it('should throw error when not connected', async () => {
      const db = new DatabaseManager();

      await expect(db.execute('INSERT INTO test VALUES (1)')).rejects.toThrow('Database not connected');
    });
  });

  describe('get', () => {
    it('should return single row', async () => {
      mockPool.execute.mockResolvedValue([[{ id: 1, name: 'test' }], []]);

      const db = new DatabaseManager();
      await db.connect();
      const result = await db.get('SELECT * FROM test WHERE id = ?', [1]);

      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should return undefined when no rows', async () => {
      mockPool.execute.mockResolvedValue([[], []]);

      const db = new DatabaseManager();
      await db.connect();
      const result = await db.get('SELECT * FROM test WHERE id = ?', [999]);

      expect(result).toBeUndefined();
    });

    it('should throw error when not connected', async () => {
      const db = new DatabaseManager();

      await expect(db.get('SELECT 1')).rejects.toThrow('Database not connected');
    });
  });

  describe('getConnection', () => {
    it('should return connection from pool', async () => {
      const db = new DatabaseManager();
      await db.connect();
      const conn = await db.getConnection();

      expect(conn).toBe(mockConnection);
    });

    it('should throw error when not connected', async () => {
      const db = new DatabaseManager();

      await expect(db.getConnection()).rejects.toThrow('Database not connected');
    });
  });

  describe('close', () => {
    it('should close pool connection', async () => {
      const db = new DatabaseManager();
      await db.connect();
      await db.close();

      expect(mockPool.end).toHaveBeenCalled();
      expect(db.isConnected()).toBe(false);
    });

    it('should do nothing if not connected', async () => {
      const db = new DatabaseManager();
      await db.close();

      expect(mockPool.end).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      const db = new DatabaseManager();
      expect(db.isConnected()).toBe(false);
    });

    it('should return true after connection', async () => {
      const db = new DatabaseManager();
      await db.connect();
      expect(db.isConnected()).toBe(true);
    });

    it('should return false after close', async () => {
      const db = new DatabaseManager();
      await db.connect();
      await db.close();
      expect(db.isConnected()).toBe(false);
    });
  });
});

describe('getDatabase', () => {
  it('should return singleton instance', () => {
    const db1 = getDatabase();
    const db2 = getDatabase();

    expect(db1).toBe(db2);
  });
});
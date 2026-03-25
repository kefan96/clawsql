/**
 * Tests for Network Scanner
 */

// Mock mysql2/promise
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { NetworkScanner, probeMySQLInstance, getScanner } from '../../../core/discovery/scanner';
import { createConnection } from 'mysql2/promise';

const mockCreateConnection = createConnection as jest.MockedFunction<typeof createConnection>;

describe('NetworkScanner', () => {
  let mockConnection: any;

  beforeEach(() => {
    mockConnection = {
      execute: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };

    mockCreateConnection.mockResolvedValue(mockConnection as any);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const scanner = new NetworkScanner({ network: '192.168.1.0/24' });
      expect(scanner).toBeDefined();
    });

    it('should accept custom options', () => {
      const scanner = new NetworkScanner({
        network: '192.168.1.0/24',
        portStart: 3306,
        portEnd: 3307,
        timeout: 5000,
        maxConcurrent: 10,
        user: 'test',
        password: 'testpass',
      });
      expect(scanner).toBeDefined();
    });
  });

  describe('scan', () => {
    it('should scan single host with /32 CIDR', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35', server_id: 1 }], []]);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].host).toBe('192.168.1.10');
      expect(results[0].port).toBe(3306);
      expect(results[0].isMySQL).toBe(true);
      expect(results[0].version).toBe('8.0.35');
    });

    it('should call progress callback', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35', server_id: 1 }], []]);

      const progressCallback = jest.fn();
      const scanner = new Scanner({ network: '192.168.1.10/32' });
      await scanner.scan(progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should handle connection timeout', async () => {
      mockCreateConnection.mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 100)
        )
      );

      const scanner = new NetworkScanner({ network: '192.168.1.10/32', timeout: 50 });
      const results = await scanner.scan();

      expect(results).toHaveLength(0);
    });

    it('should handle authentication error as MySQL', async () => {
      const error = new Error('Access denied for user');
      mockCreateConnection.mockRejectedValue(error);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].isMySQL).toBe(true);
      expect(results[0].error).toBe('Authentication failed');
    });

    it('should handle MySQL protocol error', async () => {
      const error = new Error('MySQL protocol error');
      mockCreateConnection.mockRejectedValue(error);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].isMySQL).toBe(true);
    });

    it('should handle Unknown database error as MySQL', async () => {
      const error = new Error('Unknown database');
      mockCreateConnection.mockRejectedValue(error);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(1);
      expect(results[0].isMySQL).toBe(true);
    });

    it('should handle connection close errors', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35' }], []]);
      mockConnection.end.mockRejectedValue(new Error('Close error'));

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      // Should not throw
      expect(results).toHaveLength(1);
    });

    it('should scan multiple ports', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35' }], []]);

      const scanner = new NetworkScanner({
        network: '192.168.1.10/32',
        portStart: 3306,
        portEnd: 3307,
      });
      const results = await scanner.scan();

      expect(results).toHaveLength(2);
    });

    it('should handle empty query result', async () => {
      mockConnection.execute.mockResolvedValue([[], []]);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(0);
    });

    it('should handle non-array query result', async () => {
      mockConnection.execute.mockResolvedValue([{}, []]);

      const scanner = new NetworkScanner({ network: '192.168.1.10/32' });
      const results = await scanner.scan();

      expect(results).toHaveLength(0);
    });
  });

  describe('expandNetwork', () => {
    it('should handle /24 network', async () => {
      // Mock connection to fail (so we don't actually scan)
      mockCreateConnection.mockRejectedValue(new Error('No connection'));

      const scanner = new NetworkScanner({ network: '192.168.1.0/24', timeout: 10 });
      await scanner.scan();

      // Should have attempted 256 hosts * 1 port = 256 connections
      // But limited to 256 hosts
      expect(mockCreateConnection).toHaveBeenCalled();
    });

    it('should handle invalid IP address', async () => {
      const scanner = new NetworkScanner({ network: 'invalid/24' });

      await expect(scanner.scan()).rejects.toThrow('Invalid IP address');
    });
  });

  describe('probeMySQLInstance', () => {
    it('should probe single instance', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35', server_id: 1 }], []]);

      const result = await probeMySQLInstance('192.168.1.10', 3306);

      expect(result.isMySQL).toBe(true);
      expect(result.version).toBe('8.0.35');
      expect(result.serverId).toBe(1);
    });

    it('should return false for non-MySQL', async () => {
      mockCreateConnection.mockRejectedValue(new Error('Connection refused'));

      const result = await probeMySQLInstance('192.168.1.10', 3306);

      expect(result.isMySQL).toBe(false);
    });

    it('should use custom credentials', async () => {
      mockConnection.execute.mockResolvedValue([[{ version: '8.0.35' }], []]);

      await probeMySQLInstance('192.168.1.10', 3306, 'admin', 'password', 5000);

      expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
        user: 'admin',
        password: 'password',
      }));
    });
  });

  describe('getScanner', () => {
    // Reset singleton between tests by re-importing
    beforeEach(() => {
      jest.resetModules();
    });

    it('should return singleton scanner', () => {
      // Need to re-import after reset
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getScanner } = require('../../../core/discovery/scanner');

      const scanner1 = getScanner({ network: '192.168.1.0/24' });
      const scanner2 = getScanner();

      expect(scanner1).toBe(scanner2);
    });

    it('should create new scanner with options', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getScanner } = require('../../../core/discovery/scanner');

      const scanner = getScanner({ network: '10.0.0.0/24' });

      expect(scanner).toBeDefined();
    });

    it('should return default scanner without options', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getScanner } = require('../../../core/discovery/scanner');

      const scanner = getScanner();

      expect(scanner).toBeDefined();
    });
  });
});

// Need to reference the class directly for testing
class Scanner extends NetworkScanner {
  constructor(options: any) {
    super(options);
  }
}
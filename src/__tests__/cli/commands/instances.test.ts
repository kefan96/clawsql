/**
 * Tests for Instances Command
 */

// Mock chalk ESM module
jest.mock('chalk', () => ({
  default: {
    bold: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    blue: (str: string) => str,
    cyan: (str: string) => str,
    gray: (str: string) => str,
  },
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  bold: (str: string) => str,
  cyan: (str: string) => str,
  blue: (str: string) => str,
  gray: (str: string) => str,
}));

// Mock ora
jest.mock('ora', () => {
  return jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    text: '',
    succeed: jest.fn(),
    fail: jest.fn(),
  }));
});

// Mock scanner module
jest.mock('../../../core/discovery/scanner', () => ({
  NetworkScanner: jest.fn().mockImplementation(() => ({
    scan: jest.fn().mockResolvedValue([
      { host: '192.168.1.10', port: 3306, isMySQL: true, version: '8.0.35' },
      { host: '192.168.1.11', port: 3306, isMySQL: true, version: '8.0.35' },
    ]),
  })),
  probeMySQLInstance: jest.fn(),
}));

import { instancesCommand } from '../../../cli/commands/instances';
import { probeMySQLInstance, NetworkScanner } from '../../../core/discovery/scanner';

const mockProbeMySQLInstance = probeMySQLInstance as jest.MockedFunction<typeof probeMySQLInstance>;

describe('instancesCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      settings: {
        mysql: {
          adminUser: 'clawsql',
          adminPassword: 'password',
        },
      },
      orchestrator: {
        getClusters: jest.fn().mockResolvedValue([]),
        getTopology: jest.fn(),
        discoverInstance: jest.fn().mockResolvedValue(true),
        forgetInstance: jest.fn().mockResolvedValue(true),
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        section: jest.fn().mockImplementation((s: string) => `[${s}]`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        table: jest.fn().mockReturnValue('table-output'),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        warning: jest.fn().mockImplementation((s: string) => `⚠ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
        success: jest.fn().mockImplementation((s: string) => `✓ ${s}`),
      },
      outputFormat: 'table',
    };

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should have correct name and description', () => {
    expect(instancesCommand.name).toBe('instances');
    expect(instancesCommand.description).toBe('Manage MySQL instances');
  });

  it('should show help when no subcommand provided', async () => {
    await instancesCommand.handler([], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing subcommand'));
  });

  it('should handle unknown subcommand', async () => {
    await instancesCommand.handler(['unknown'], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith('Unknown subcommand: unknown');
  });

  describe('listInstances', () => {
    it('should show warning when no instances found', async () => {
      mockContext.orchestrator.getClusters.mockResolvedValue([]);

      await instancesCommand.handler(['list'], mockContext);

      expect(mockContext.formatter.warning).toHaveBeenCalledWith('No instances discovered.');
    });

    it('should list instances from clusters', async () => {
      mockContext.orchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'test-cluster',
        primary: { host: 'primary', port: 3306, state: 'online', version: '8.0.35' },
        replicas: [
          { host: 'replica1', port: 3306, state: 'online', replicationLag: 0, version: '8.0.35' },
        ],
      });

      await instancesCommand.handler(['list'], mockContext);

      expect(mockContext.orchestrator.getClusters).toHaveBeenCalled();
      expect(mockContext.formatter.header).toHaveBeenCalled();
      expect(mockContext.formatter.table).toHaveBeenCalled();
    });

    it('should output JSON when format is json', async () => {
      mockContext.outputFormat = 'json';
      mockContext.orchestrator.getClusters.mockResolvedValue([]);

      await instancesCommand.handler(['list'], mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ instances: [] }, null, 2));
      mockContext.outputFormat = 'table';
    });

    it('should handle errors gracefully', async () => {
      mockContext.orchestrator.getClusters.mockRejectedValue(new Error('Connection error'));

      await instancesCommand.handler(['list'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to list instances'));
    });
  });

  describe('registerInstance', () => {
    it('should show error when host is missing', async () => {
      await instancesCommand.handler(['register'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing host'));
    });

    it('should register instance successfully', async () => {
      mockProbeMySQLInstance.mockResolvedValue({
        isMySQL: true,
        version: '8.0.35',
      });

      await instancesCommand.handler(['register', '192.168.1.10'], mockContext);

      expect(mockProbeMySQLInstance).toHaveBeenCalled();
      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('192.168.1.10', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle non-MySQL instance', async () => {
      mockProbeMySQLInstance.mockResolvedValue({
        isMySQL: false,
      });

      await instancesCommand.handler(['register', '192.168.1.10'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No MySQL instance found'));
    });

    it('should handle registration failure', async () => {
      mockProbeMySQLInstance.mockResolvedValue({
        isMySQL: true,
        version: '8.0.35',
      });
      mockContext.orchestrator.discoverInstance.mockResolvedValue(false);

      await instancesCommand.handler(['register', '192.168.1.10'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to register'));
    });

    it('should handle registration error', async () => {
      mockProbeMySQLInstance.mockResolvedValue({
        isMySQL: true,
        version: '8.0.35',
      });
      mockContext.orchestrator.discoverInstance.mockRejectedValue(new Error('Already exists'));

      await instancesCommand.handler(['register', '192.168.1.10'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Registration failed'));
    });

    it('should use custom port when specified with flag', async () => {
      mockProbeMySQLInstance.mockResolvedValue({
        isMySQL: true,
        version: '8.0.35',
      });

      await instancesCommand.handler(['register', '192.168.1.10', '--port', '3307'], mockContext);

      expect(mockProbeMySQLInstance).toHaveBeenCalledWith(
        '192.168.1.10',
        3307,
        expect.any(String),
        expect.any(String),
        expect.any(Number)
      );
    });
  });

  describe('discoverInstances', () => {
    it('should show error when network is missing', async () => {
      await instancesCommand.handler(['discover'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing network'));
    });

    it('should discover instances on network', async () => {
      await instancesCommand.handler(['discover', '192.168.1.0/24'], mockContext);

      expect(NetworkScanner).toHaveBeenCalledWith(expect.objectContaining({
        network: '192.168.1.0/24',
      }));
      expect(mockContext.formatter.header).toHaveBeenCalled();
    });

    it('should auto-register when flag provided', async () => {
      await instancesCommand.handler(['discover', '192.168.1.0/24', '--auto-register'], mockContext);

      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalled();
    });

    it('should handle custom port range', async () => {
      await instancesCommand.handler(['discover', '192.168.1.0/24', '--port-start', '3306', '--port-end', '3307'], mockContext);

      expect(NetworkScanner).toHaveBeenCalledWith(expect.objectContaining({
        portStart: 3306,
        portEnd: 3307,
      }));
    });
  });

  describe('removeInstance', () => {
    it('should show error when host is missing', async () => {
      await instancesCommand.handler(['remove'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing host'));
    });

    it('should remove instance successfully', async () => {
      await instancesCommand.handler(['remove', '192.168.1.10'], mockContext);

      expect(mockContext.orchestrator.forgetInstance).toHaveBeenCalledWith('192.168.1.10', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle removal failure', async () => {
      mockContext.orchestrator.forgetInstance.mockResolvedValue(false);

      await instancesCommand.handler(['remove', '192.168.1.10'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to remove'));
    });

    it('should handle removal error', async () => {
      mockContext.orchestrator.forgetInstance.mockRejectedValue(new Error('Not found'));

      await instancesCommand.handler(['remove', '192.168.1.10'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Removal failed'));
    });

    it('should accept forget as alias', async () => {
      await instancesCommand.handler(['forget', '192.168.1.10'], mockContext);

      expect(mockContext.orchestrator.forgetInstance).toHaveBeenCalledWith('192.168.1.10', 3306);
    });
  });
});
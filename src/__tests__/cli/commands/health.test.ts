/**
 * Tests for Health Command
 */

// Mock chalk ESM module
jest.mock('chalk', () => ({
  default: {
    bold: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
  },
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  bold: (str: string) => str,
}));

// Mock fetch
global.fetch = jest.fn();

import { healthCommand } from '../../../cli/commands/health';
import { CLIContext } from '../../../cli/registry';

describe('healthCommand', () => {
  let mockContext: CLIContext;

  beforeEach(() => {
    mockContext = {
      settings: {
        prometheus: { url: 'http://prometheus:9090' },
      },
      orchestrator: {
        healthCheck: jest.fn().mockResolvedValue(true),
        getClusters: jest.fn().mockResolvedValue([]),
        getTopology: jest.fn(),
      },
      proxysql: {
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      },
      formatter: {
        header: jest.fn().mockReturnValue('System Health'),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        section: jest.fn().mockReturnValue('[Cluster Health]'),
      },
      outputFormat: 'table',
    } as unknown as CLIContext;

    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('should have correct name and description', () => {
    expect(healthCommand.name).toBe('health');
    expect(healthCommand.description).toBe('Show system health status');
  });

  it('should check orchestrator health', async () => {
    await healthCommand.handler([], mockContext);

    expect(mockContext.orchestrator.healthCheck).toHaveBeenCalled();
  });

  it('should check proxysql health', async () => {
    await healthCommand.handler([], mockContext);

    expect(mockContext.proxysql.connect).toHaveBeenCalled();
    expect(mockContext.proxysql.close).toHaveBeenCalled();
  });

  it('should handle orchestrator unreachable', async () => {
    (mockContext.orchestrator.healthCheck as jest.Mock).mockRejectedValue(new Error('Connection refused'));

    await healthCommand.handler([], mockContext);

    // Should not throw
    expect(true).toBe(true);
  });

  it('should handle proxysql unreachable', async () => {
    (mockContext.proxysql.connect as jest.Mock).mockRejectedValue(new Error('Connection refused'));

    await healthCommand.handler([], mockContext);

    // Should not throw
    expect(true).toBe(true);
  });

  it('should check prometheus health', async () => {
    await healthCommand.handler([], mockContext);

    expect(global.fetch).toHaveBeenCalledWith('http://prometheus:9090/-/healthy');
  });

  it('should handle prometheus unreachable', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));

    await healthCommand.handler([], mockContext);

    // Should not throw
    expect(true).toBe(true);
  });

  it('should output JSON when requested', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockContext.outputFormat = 'json';

    await healthCommand.handler([], mockContext);

    expect(consoleSpy).toHaveBeenCalled();
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = lastCall[0];
    expect(() => JSON.parse(output)).not.toThrow();

    consoleSpy.mockRestore();
    mockContext.outputFormat = 'table';
  });

  it('should show cluster health when clusters exist', async () => {
    (mockContext.orchestrator.getClusters as jest.Mock).mockResolvedValue(['cluster-1']);
    (mockContext.orchestrator.getTopology as jest.Mock).mockResolvedValue({
      clusterId: 'cluster-1',
      name: 'test-cluster',
      primary: { host: 'primary', port: 3306, state: 'online' },
      replicas: [
        { host: 'replica1', port: 3306, state: 'online' },
      ],
    });

    await healthCommand.handler([], mockContext);

    expect(mockContext.orchestrator.getClusters).toHaveBeenCalled();
  });

  it('should handle errors getting cluster health', async () => {
    (mockContext.orchestrator.getClusters as jest.Mock).mockRejectedValue(new Error('Failed'));

    await healthCommand.handler([], mockContext);

    // Should not throw
    expect(true).toBe(true);
  });
});
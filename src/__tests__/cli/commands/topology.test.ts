/**
 * Tests for Topology Command
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

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    head: string[] = [];
    push() {}
    toString() { return 'mock-table'; }
  };
});

import { topologyCommand } from '../../../cli/commands/topology';
import { HealthStatus, InstanceRole, InstanceState } from '../../../types/index';

describe('topologyCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      clusterView: {
        getMergedView: jest.fn(),
        getAllMergedViews: jest.fn().mockResolvedValue([]),
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        warning: jest.fn().mockImplementation((s: string) => `⚠ ${s}`),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
        clusterTopology: jest.fn().mockReturnValue('topology-output'),
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
    expect(topologyCommand.name).toBe('topology');
    expect(topologyCommand.description).toBe('Show MySQL cluster topology with ProxySQL routing');
  });

  it('should show warning when no clusters found', async () => {
    mockContext.clusterView.getAllMergedViews.mockResolvedValueOnce([]);

    await topologyCommand.handler([], mockContext);

    expect(mockContext.formatter.warning).toHaveBeenCalled();
  });

  it('should show all clusters when no args', async () => {
    const mockView = {
      clusterId: 'cluster-1',
      displayName: 'Test Cluster',
      primary: {
        host: 'primary',
        port: 3306,
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      },
      replicas: [],
      health: HealthStatus.HEALTHY,
    };

    mockContext.clusterView.getAllMergedViews.mockResolvedValueOnce([mockView]);

    await topologyCommand.handler([], mockContext);

    expect(mockContext.clusterView.getAllMergedViews).toHaveBeenCalled();
    expect(mockContext.formatter.clusterTopology).toHaveBeenCalled();
  });

  it('should show specific cluster when name provided', async () => {
    const mockView = {
      clusterId: 'cluster-1',
      displayName: 'Test Cluster',
      primary: {
        host: 'primary',
        port: 3306,
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      },
      replicas: [],
      health: HealthStatus.HEALTHY,
    };

    mockContext.clusterView.getMergedView.mockResolvedValueOnce(mockView);

    await topologyCommand.handler(['cluster-1'], mockContext);

    expect(mockContext.clusterView.getMergedView).toHaveBeenCalledWith('cluster-1');
    expect(mockContext.formatter.clusterTopology).toHaveBeenCalled();
  });

  it('should show warning when cluster not found', async () => {
    mockContext.clusterView.getMergedView.mockResolvedValueOnce(null);

    await topologyCommand.handler(['nonexistent'], mockContext);

    expect(mockContext.formatter.warning).toHaveBeenCalled();
  });

  it('should output JSON when format is json', async () => {
    mockContext.outputFormat = 'json';
    mockContext.clusterView.getAllMergedViews.mockResolvedValueOnce([]);

    await topologyCommand.handler([], mockContext);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ clusters: [] }, null, 2));

    mockContext.outputFormat = 'table';
  });

  it('should output JSON error when cluster not found', async () => {
    mockContext.outputFormat = 'json';
    mockContext.clusterView.getMergedView.mockResolvedValueOnce(null);

    await topologyCommand.handler(['nonexistent'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    expect(lastCall[0]).toContain('not found');

    mockContext.outputFormat = 'table';
  });

  it('should handle errors gracefully', async () => {
    mockContext.clusterView.getAllMergedViews.mockRejectedValueOnce(new Error('Connection error'));

    await topologyCommand.handler([], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalled();
  });

  it('should output JSON error on exception', async () => {
    mockContext.outputFormat = 'json';
    mockContext.clusterView.getAllMergedViews.mockRejectedValueOnce(new Error('Connection error'));

    await topologyCommand.handler([], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.error).toBe('Connection error');

    mockContext.outputFormat = 'table';
  });
});
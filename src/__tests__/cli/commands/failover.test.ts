/**
 * Tests for Failover Command
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

import { failoverCommand } from '../../../cli/commands/failover';

describe('failoverCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      settings: {
        failover: {
          autoFailoverEnabled: true,
          timeoutSeconds: 30,
          minReplicasForFailover: 1,
          confirmationChecks: 3,
        },
      },
      orchestrator: {
        getTopology: jest.fn(),
        getClusterForInstance: jest.fn(),
      },
      failoverExecutor: {
        getCurrentOperation: jest.fn().mockReturnValue(null),
        getOperationHistory: jest.fn().mockReturnValue([]),
        executeSwitchover: jest.fn(),
        executeManualFailover: jest.fn(),
        getPendingRecoveries: jest.fn().mockReturnValue([]),
        checkAndRecoverAll: jest.fn(),
        recoverInstance: jest.fn(),
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        table: jest.fn().mockReturnValue('table-output'),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        warning: jest.fn().mockImplementation((s: string) => `⚠ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
        success: jest.fn().mockImplementation((s: string) => `✓ ${s}`),
      },
    };

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should have correct name and description', () => {
    expect(failoverCommand.name).toBe('failover');
    expect(failoverCommand.description).toBe('Manage failover and switchover operations');
  });

  it('should show help when no subcommand provided', async () => {
    await failoverCommand.handler([], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing subcommand'));
  });

  it('should handle unknown subcommand', async () => {
    await failoverCommand.handler(['unknown'], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith('Unknown subcommand: unknown');
  });

  describe('showStatus', () => {
    it('should show failover configuration', async () => {
      await failoverCommand.handler(['status'], mockContext);

      expect(mockContext.formatter.header).toHaveBeenCalledWith('Failover Configuration');
      expect(mockContext.formatter.keyValue).toHaveBeenCalled();
    });

    it('should show current operation if exists', async () => {
      mockContext.failoverExecutor.getCurrentOperation.mockReturnValue({
        operationId: 'op-123',
        state: 'running',
        clusterId: 'cluster-1',
      });

      await failoverCommand.handler(['status'], mockContext);

      expect(mockContext.failoverExecutor.getCurrentOperation).toHaveBeenCalled();
    });
  });

  describe('showHistory', () => {
    it('should show message when no history', async () => {
      await failoverCommand.handler(['history'], mockContext);

      expect(mockContext.formatter.info).toHaveBeenCalledWith('No failover operations recorded.');
    });

    it('should show operation history', async () => {
      mockContext.failoverExecutor.getOperationHistory.mockReturnValue([
        {
          operationId: 'op-123-456-789',
          clusterId: 'cluster-1',
          oldPrimaryId: 'primary:3306',
          newPrimaryId: 'replica:3306',
          state: 'completed',
          reason: 'Manual switchover via CLI',
        },
        {
          operationId: 'op-456-789-012',
          clusterId: 'cluster-2',
          oldPrimaryId: 'primary2:3306',
          newPrimaryId: null,
          state: 'failed',
          reason: 'Automatic failover',
        },
      ]);

      await failoverCommand.handler(['history'], mockContext);

      expect(mockContext.formatter.header).toHaveBeenCalledWith('Failover/Switchover History');
      expect(mockContext.formatter.table).toHaveBeenCalled();
    });
  });

  describe('executeSwitchover', () => {
    it('should show error when cluster is missing', async () => {
      await failoverCommand.handler(['switchover'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing cluster'));
    });

    it('should show error when cluster not found', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue(null);

      await failoverCommand.handler(['switchover', 'unknown-cluster'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should show error when no primary in cluster', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: null,
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No primary found'));
    });

    it('should show error when primary not healthy', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'offline' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('not healthy'));
    });

    it('should show error when no replicas', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [],
      });

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No replicas found'));
    });

    it('should execute switchover successfully', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeSwitchover.mockResolvedValue({
        operationId: 'op-123',
        state: 'completed',
        newPrimaryId: 'replica:3306',
        steps: [],
      });

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.failoverExecutor.executeSwitchover).toHaveBeenCalled();
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle switchover failure', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeSwitchover.mockResolvedValue({
        operationId: 'op-123',
        state: 'failed',
        error: 'Connection refused',
        newPrimaryId: null,
        steps: ['Step 1', 'Step 2'],
      });

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });

    it('should handle execution error', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeSwitchover.mockRejectedValue(new Error('Executor error'));

      await failoverCommand.handler(['switchover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });
  });

  describe('executeFailover', () => {
    it('should show error when cluster is missing', async () => {
      await failoverCommand.handler(['failover'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing cluster'));
    });

    it('should suggest switchover when primary is healthy', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });

      await failoverCommand.handler(['failover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.info).toHaveBeenCalledWith(expect.stringContaining('switchover'));
    });

    it('should show error when no replicas', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'offline' },
        replicas: [],
      });

      await failoverCommand.handler(['failover', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No replicas found'));
    });

    it('should execute failover when primary is down', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'offline' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeManualFailover.mockResolvedValue({
        operationId: 'op-123',
        state: 'completed',
        newPrimaryId: 'replica:3306',
        steps: [],
      });

      await failoverCommand.handler(['failover', 'cluster-1'], mockContext);

      expect(mockContext.failoverExecutor.executeManualFailover).toHaveBeenCalled();
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should execute failover when no primary', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: null,
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeManualFailover.mockResolvedValue({
        operationId: 'op-123',
        state: 'completed',
        newPrimaryId: 'replica:3306',
        steps: [],
      });

      await failoverCommand.handler(['failover', 'cluster-1'], mockContext);

      expect(mockContext.failoverExecutor.executeManualFailover).toHaveBeenCalled();
    });

    it('should accept execute as alias', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'offline' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });
      mockContext.failoverExecutor.executeManualFailover.mockResolvedValue({
        operationId: 'op-123',
        state: 'completed',
        newPrimaryId: 'replica:3306',
        steps: [],
      });

      await failoverCommand.handler(['execute', 'cluster-1'], mockContext);

      expect(mockContext.failoverExecutor.executeManualFailover).toHaveBeenCalled();
    });
  });

  describe('recoverInstance', () => {
    it('should show no pending recoveries', async () => {
      await failoverCommand.handler(['recover'], mockContext);

      expect(mockContext.formatter.info).toHaveBeenCalledWith('No instances pending recovery.');
    });

    it('should list pending recoveries', async () => {
      mockContext.failoverExecutor.getPendingRecoveries.mockReturnValue([
        {
          instanceId: 'old-primary:3306',
          clusterId: 'cluster-1',
          newPrimaryId: 'new-primary:3306',
          failedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]);

      await failoverCommand.handler(['recover'], mockContext);

      expect(mockContext.formatter.header).toHaveBeenCalledWith('Instances Pending Recovery');
    });

    it('should recover all instances', async () => {
      mockContext.failoverExecutor.checkAndRecoverAll.mockResolvedValue({
        recovered: ['old-primary:3306'],
        stillPending: [],
        errors: [],
      });

      await failoverCommand.handler(['recover', '--all'], mockContext);

      expect(mockContext.failoverExecutor.checkAndRecoverAll).toHaveBeenCalled();
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should recover specific instance', async () => {
      mockContext.failoverExecutor.recoverInstance.mockResolvedValue({
        success: true,
        message: 'Instance recovered successfully',
      });

      await failoverCommand.handler(['recover', 'old-primary:3306'], mockContext);

      expect(mockContext.failoverExecutor.recoverInstance).toHaveBeenCalledWith('old-primary:3306');
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle recovery failure', async () => {
      mockContext.failoverExecutor.recoverInstance.mockResolvedValue({
        success: false,
        message: 'Recovery failed',
      });

      await failoverCommand.handler(['recover', 'old-primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalled();
    });
  });

  describe('resolveCluster', () => {
    it('should resolve cluster from instance ID', async () => {
      mockContext.orchestrator.getClusterForInstance.mockResolvedValue('cluster-1');
      mockContext.orchestrator.getTopology.mockResolvedValue({
        clusterId: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [],
      });

      await failoverCommand.handler(['switchover', 'primary:3306'], mockContext);

      expect(mockContext.orchestrator.getClusterForInstance).toHaveBeenCalledWith('primary', 3306);
    });
  });
});
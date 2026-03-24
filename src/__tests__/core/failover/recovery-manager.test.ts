/**
 * Tests for Recovery Manager
 */

import { RecoveryManager } from '../../../core/failover/recovery-manager.js';
import { OrchestratorClient } from '../../../core/discovery/topology.js';
import { InstanceState } from '../../../types/index.js';

// Mock dependencies
jest.mock('../../../core/discovery/topology.js');
jest.mock('../../../utils/mysql-client.js', () => ({
  getMySQLClient: () => ({
    startReplication: jest.fn().mockResolvedValue(true),
    getReplicationStatus: jest.fn().mockResolvedValue({
      ioRunning: true,
      sqlRunning: true,
      secondsBehind: 0,
    }),
    executeCommand: jest.fn().mockResolvedValue(true),
  }),
}));

describe('RecoveryManager', () => {
  let manager: RecoveryManager;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;

  beforeEach(() => {
    mockOrchestrator = {
      getInstance: jest.fn(),
    } as unknown as jest.Mocked<OrchestratorClient>;

    manager = new RecoveryManager(mockOrchestrator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('queueForRecovery', () => {
    it('should queue instance for recovery', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'old-primary',
        3306,
        'new-primary:3306'
      );

      manager.queueForRecovery(pending);

      expect(manager.isPending('old-primary:3306')).toBe(true);
    });
  });

  describe('getPending', () => {
    it('should return empty array when no pending recoveries', () => {
      expect(manager.getPending()).toEqual([]);
    });

    it('should return all pending recoveries', () => {
      const pending1 = RecoveryManager.createPendingRecovery('cluster-1', 'host1', 3306, 'new:3306');
      const pending2 = RecoveryManager.createPendingRecovery('cluster-1', 'host2', 3306, 'new:3306');

      manager.queueForRecovery(pending1);
      manager.queueForRecovery(pending2);

      const pendings = manager.getPending();
      expect(pendings).toHaveLength(2);
      expect(pendings.map(p => p.instanceId)).toContain('host1:3306');
      expect(pendings.map(p => p.instanceId)).toContain('host2:3306');
    });
  });

  describe('isPending', () => {
    it('should return false when not pending', () => {
      expect(manager.isPending('host:3306')).toBe(false);
    });

    it('should return true when pending', () => {
      const pending = RecoveryManager.createPendingRecovery('cluster-1', 'host', 3306, 'new:3306');
      manager.queueForRecovery(pending);

      expect(manager.isPending('host:3306')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should return false when clearing non-existent', () => {
      expect(manager.clear('nonexistent:3306')).toBe(false);
    });

    it('should clear pending recovery', () => {
      const pending = RecoveryManager.createPendingRecovery('cluster-1', 'host', 3306, 'new:3306');
      manager.queueForRecovery(pending);

      expect(manager.clear('host:3306')).toBe(true);
      expect(manager.isPending('host:3306')).toBe(false);
    });
  });

  describe('recover', () => {
    it('should return failure when instance not pending', async () => {
      const result = await manager.recover('nonexistent:3306');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not pending recovery');
    });

    it('should return failure when instance not found in Orchestrator', async () => {
      mockOrchestrator.getInstance.mockResolvedValue(null);

      const pending = RecoveryManager.createPendingRecovery('cluster-1', 'host', 3306, 'new:3306');
      manager.queueForRecovery(pending);

      const result = await manager.recover('host:3306');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found in Orchestrator');
    });

    it('should return failure when instance is not online', async () => {
      mockOrchestrator.getInstance.mockResolvedValue({
        host: 'host',
        port: 3306,
        state: InstanceState.OFFLINE,
      });

      const pending = RecoveryManager.createPendingRecovery('cluster-1', 'host', 3306, 'new:3306');
      manager.queueForRecovery(pending);

      const result = await manager.recover('host:3306');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not online');
    });

    it('should recover instance successfully', async () => {
      mockOrchestrator.getInstance.mockResolvedValue({
        host: 'host',
        port: 3306,
        state: InstanceState.ONLINE,
      });

      const pending = RecoveryManager.createPendingRecovery('cluster-1', 'host', 3306, 'new:3306');
      manager.queueForRecovery(pending);

      const result = await manager.recover('host:3306');

      expect(result.success).toBe(true);
      expect(result.message).toContain('recovered');
      expect(manager.isPending('host:3306')).toBe(false);
    });
  });

  describe('recoverAll', () => {
    it('should return empty results when no pending', async () => {
      const result = await manager.recoverAll();

      expect(result.recovered).toEqual([]);
      expect(result.stillPending).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should recover multiple instances', async () => {
      mockOrchestrator.getInstance.mockResolvedValue({
        host: 'host',
        port: 3306,
        state: InstanceState.ONLINE,
      });

      const pending1 = RecoveryManager.createPendingRecovery('cluster-1', 'host1', 3306, 'new:3306');
      const pending2 = RecoveryManager.createPendingRecovery('cluster-1', 'host2', 3306, 'new:3306');

      manager.queueForRecovery(pending1);
      manager.queueForRecovery(pending2);

      const result = await manager.recoverAll();

      expect(result.recovered).toHaveLength(2);
      expect(result.stillPending).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should handle mixed results', async () => {
      mockOrchestrator.getInstance
        .mockResolvedValueOnce({
          host: 'host1',
          port: 3306,
          state: InstanceState.ONLINE,
        })
        .mockResolvedValueOnce({
          host: 'host2',
          port: 3306,
          state: InstanceState.OFFLINE,
        });

      const pending1 = RecoveryManager.createPendingRecovery('cluster-1', 'host1', 3306, 'new:3306');
      const pending2 = RecoveryManager.createPendingRecovery('cluster-1', 'host2', 3306, 'new:3306');

      manager.queueForRecovery(pending1);
      manager.queueForRecovery(pending2);

      const result = await manager.recoverAll();

      expect(result.recovered).toContain('host1:3306');
      expect(result.stillPending).toContain('host2:3306');
    });
  });

  describe('createPendingRecovery', () => {
    it('should create pending recovery with all fields', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'host',
        3306,
        'new-primary:3306'
      );

      expect(pending.clusterId).toBe('cluster-1');
      expect(pending.instanceId).toBe('host:3306');
      expect(pending.host).toBe('host');
      expect(pending.port).toBe(3306);
      expect(pending.newPrimaryId).toBe('new-primary:3306');
      expect(pending.failedAt).toBeInstanceOf(Date);
      expect(pending.recoveredAt).toBeUndefined();
    });
  });
});
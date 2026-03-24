/**
 * Tests for Operation Runner
 */

import { OperationRunner } from '../../../core/failover/operation-runner.js';
import { InstancePromoter } from '../../../core/failover/promoter.js';
import { ProxySQLManager } from '../../../core/routing/proxysql-manager.js';
import {
  FailoverState,
  InstanceRole,
  InstanceState,
  createMySQLInstance,
  createMySQLCluster,
} from '../../../types/index.js';
import { FailoverHook } from '../../../core/failover/types.js';

// Mock dependencies
jest.mock('../../../core/failover/promoter.js');
jest.mock('../../../core/routing/proxysql-manager.js');

describe('OperationRunner', () => {
  let runner: OperationRunner;
  let mockPromoter: jest.Mocked<InstancePromoter>;
  let mockProxySQL: jest.Mocked<ProxySQLManager>;

  beforeEach(() => {
    mockPromoter = {
      promote: jest.fn(),
    } as unknown as jest.Mocked<InstancePromoter>;

    mockProxySQL = {
      syncCluster: jest.fn(),
      relocateReplica: jest.fn(),
    } as unknown as jest.Mocked<ProxySQLManager>;

    runner = new OperationRunner(mockPromoter, mockProxySQL);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerPreHook', () => {
    it('should register pre-execution hook', async () => {
      const hook: FailoverHook = jest.fn();
      runner.registerPreHook(hook);

      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.ONLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: true,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      await runner.execute(operation, cluster, true);

      expect(hook).toHaveBeenCalled();
    });
  });

  describe('registerPostHook', () => {
    it('should register post-execution hook', async () => {
      const hook: FailoverHook = jest.fn();
      runner.registerPostHook(hook);

      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.ONLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: true,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      await runner.execute(operation, cluster, true);

      expect(hook).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should execute switchover successfully', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.ONLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: true,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      const result = await runner.execute(operation, cluster, true);

      expect(result.state).toBe(FailoverState.COMPLETED);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(mockPromoter.promote).toHaveBeenCalledWith(replica, cluster, true);
    });

    it('should execute failover successfully', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      const result = await runner.execute(operation, cluster, false);

      expect(result.state).toBe(FailoverState.COMPLETED);
      expect(mockPromoter.promote).toHaveBeenCalledWith(replica, cluster, false);
    });

    it('should auto-select candidate when not specified', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const replica1 = createMySQLInstance('replica1', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE, replicationLag: 10 });
      const replica2 = createMySQLInstance('replica2', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE, replicationLag: 2 });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica1, replica2] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
      };

      const result = await runner.execute(operation, cluster, false);

      expect(result.state).toBe(FailoverState.COMPLETED);
      expect(result.newPrimaryId).toBe('replica2:3306'); // Lowest lag
    });

    it('should fail when no suitable candidate', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.OFFLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
      };

      const result = await runner.execute(operation, cluster, false);

      expect(result.state).toBe(FailoverState.FAILED);
      expect(result.error).toContain('No suitable candidate');
    });

    it('should fail when promotion fails', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.ONLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: false, error: 'Promotion failed' });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: true,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      const result = await runner.execute(operation, cluster, true);

      expect(result.state).toBe(FailoverState.FAILED);
      expect(result.error).toContain('Promotion failed');
    });

    it('should fail when target replica not found', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.ONLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: true,
        reason: 'test',
        steps: [],
        newPrimaryId: 'nonexistent:3306',
      };

      const result = await runner.execute(operation, cluster, true);

      expect(result.state).toBe(FailoverState.FAILED);
      expect(result.error).toContain('not found');
    });

    it('should reconfigure other replicas', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const replica1 = createMySQLInstance('replica1', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const replica2 = createMySQLInstance('replica2', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica1, replica2] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.relocateReplica.mockResolvedValue(true);
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica1:3306',
      };

      const result = await runner.execute(operation, cluster, false);

      expect(result.state).toBe(FailoverState.COMPLETED);
      // replica2 should be relocated to follow replica1
      expect(mockProxySQL.relocateReplica).toHaveBeenCalledWith(replica2, replica1);
    });

    it('should run post-hooks even on failure', async () => {
      const hook: FailoverHook = jest.fn();
      runner.registerPostHook(hook);

      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [] });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
      };

      await runner.execute(operation, cluster, false);

      expect(hook).toHaveBeenCalled();
    });

    it('should handle post-hook errors gracefully', async () => {
      const hook: FailoverHook = jest.fn().mockRejectedValue(new Error('Hook error'));
      runner.registerPostHook(hook);

      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY, state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA, state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      mockPromoter.promote.mockResolvedValue({ success: true });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const operation = {
        operationId: 'op-1',
        clusterId: 'cluster-1',
        state: FailoverState.IDLE,
        manual: false,
        reason: 'test',
        steps: [],
        newPrimaryId: 'replica:3306',
      };

      // Should not throw
      const result = await runner.execute(operation, cluster, false);
      expect(result.state).toBe(FailoverState.COMPLETED);
    });
  });
});
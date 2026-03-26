/**
 * Tests for Sync Coordinator
 */

import { SyncCoordinator, getSyncCoordinator, resetSyncCoordinator } from '../../../core/sync/sync-coordinator.js';
import { createMySQLInstance, createMySQLCluster, InstanceState, InstanceRole } from '../../../types/index.js';
import { getProxySQLManager } from '../../../core/routing/proxysql-manager.js';

// Mock ProxySQL manager
jest.mock('../../../core/routing/proxysql-manager.js');

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;
  let mockProxySQL: jest.Mocked<ReturnType<typeof getProxySQLManager>>;

  beforeEach(() => {
    mockProxySQL = {
      syncCluster: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getProxySQLManager>>;

    (getProxySQLManager as jest.Mock).mockReturnValue(mockProxySQL);

    coordinator = new SyncCoordinator({
      cooldownMs: 1000,
      debounceMs: 0,
      maxRetries: 2,
      enabled: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    coordinator.clearCache();
  });

  // ===========================================================================
  // Input Validation
  // ===========================================================================

  describe('input validation', () => {
    it('should reject null cluster', async () => {
      const result = await coordinator.sync(null as any, 'manual');
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('invalid_input');
      expect(result.error).toContain('null or undefined');
    });

    it('should reject cluster without clusterId', async () => {
      const cluster = { replicas: [] } as any;
      const result = await coordinator.sync(cluster, 'manual');
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('invalid_input');
      expect(result.error).toContain('Missing cluster ID');
    });

    it('should reject cluster with no instances', async () => {
      const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [] });
      const result = await coordinator.sync(cluster, 'manual');
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('invalid_input');
      expect(result.error).toContain('no instances');
    });

    it('should accept cluster with only primary', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [] });

      const result = await coordinator.sync(cluster, 'manual', true);
      expect(result.skipped).toBe(false);
    });

    it('should accept cluster with only replicas', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [replica] });

      const result = await coordinator.sync(cluster, 'manual', true);
      expect(result.skipped).toBe(false);
    });
  });

  // ===========================================================================
  // Lock Mechanism
  // ===========================================================================

  describe('lock mechanism', () => {
    it('should allow syncs to proceed', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [] });

      const result = await coordinator.sync(cluster, 'webhook', true);
      expect(result.skipped).toBe(false);
      expect(mockProxySQL.syncCluster).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Retry Logic
  // ===========================================================================

  describe('retry logic', () => {
    it('should retry on ProxySQL failure', async () => {
      mockProxySQL.syncCluster
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({
          success: true,
          clusterId: 'cluster-1',
          serversAdded: 1,
          serversRemoved: 0,
          hostgroups: { writer: 10, reader: 20 },
          errors: [],
        });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const result = await coordinator.sync(cluster, 'manual', true);

      expect(result.skipped).toBe(false);
      expect(mockProxySQL.syncCluster).toHaveBeenCalledTimes(2);
    });

    it('should return error after max retries', async () => {
      mockProxySQL.syncCluster.mockRejectedValue(new Error('Connection failed'));

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const result = await coordinator.sync(cluster, 'manual', true);

      expect(result.skipped).toBe(false);
      expect(result.reason).toBe('failed');
      expect(result.error).toContain('Connection failed');
      expect(mockProxySQL.syncCluster).toHaveBeenCalledTimes(2); // maxRetries = 2
    });

    it('should handle syncCluster returning success=false', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: false,
        clusterId: 'cluster-1',
        serversAdded: 0,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: ['Server rejected'],
      });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const result = await coordinator.sync(cluster, 'manual', true);

      expect(result.skipped).toBe(false);
      expect(result.reason).toBe('failed');
      expect(result.error).toContain('Server rejected');
    });
  });

  // ===========================================================================
  // State Management
  // ===========================================================================

  describe('state management', () => {
    it('should not update lastSyncTime on failure', async () => {
      mockProxySQL.syncCluster.mockRejectedValue(new Error('Failed'));

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      expect(coordinator.getLastSyncTime('cluster-1')).toBeNull();
    });

    it('should update lastSyncTime on success', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      expect(coordinator.getLastSyncTime('cluster-1')).not.toBeNull();
    });
  });

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe('statistics', () => {
    it('should track successful syncs', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      const stats = coordinator.getStats();
      expect(stats.totalSyncs).toBe(1);
      expect(stats.successfulSyncs).toBe(1);
      expect(stats.failedSyncs).toBe(0);
      expect(stats.lastSyncCluster).toBe('cluster-1');
    });

    it('should track failed syncs', async () => {
      mockProxySQL.syncCluster.mockRejectedValue(new Error('Failed'));

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      const stats = coordinator.getStats();
      expect(stats.totalSyncs).toBe(1);
      expect(stats.successfulSyncs).toBe(0);
      expect(stats.failedSyncs).toBe(1);
    });
  });

  // ===========================================================================
  // Disabled State
  // ===========================================================================

  describe('disabled state', () => {
    it('should skip sync when disabled', async () => {
      const disabledCoordinator = new SyncCoordinator({ enabled: false });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const result = await disabledCoordinator.sync(cluster, 'manual', true);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('disabled');
      expect(mockProxySQL.syncCluster).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  describe('helper methods', () => {
    it('should clear cache', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      expect(coordinator.isInCooldown('cluster-1')).toBe(true);

      coordinator.clearCache();

      expect(coordinator.isInCooldown('cluster-1')).toBe(false);
    });

    it('should reset cooldown for specific cluster', async () => {
      mockProxySQL.syncCluster.mockResolvedValue({
        success: true,
        clusterId: 'cluster-1',
        serversAdded: 1,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        errors: [],
      });

      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      await coordinator.sync(cluster, 'manual', true);

      expect(coordinator.isInCooldown('cluster-1')).toBe(true);

      coordinator.resetCooldown('cluster-1');

      expect(coordinator.isInCooldown('cluster-1')).toBe(false);
    });
  });
});

describe('getSyncCoordinator', () => {
  beforeEach(() => {
    resetSyncCoordinator();
  });

  it('should return singleton instance', () => {
    const c1 = getSyncCoordinator();
    const c2 = getSyncCoordinator();
    expect(c1).toBe(c2);
  });

  it('should reset singleton on resetSyncCoordinator', () => {
    const c1 = getSyncCoordinator();
    resetSyncCoordinator();
    const c2 = getSyncCoordinator();
    expect(c1).not.toBe(c2);
  });
});
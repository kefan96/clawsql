/**
 * Tests for Topology Watcher
 */

import { TopologyWatcher, getTopologyWatcher, resetTopologyWatcher } from '../../../core/sync/topology-watcher.js';
import { getOrchestratorClient } from '../../../core/discovery/topology.js';
import { getSyncCoordinator } from '../../../core/sync/sync-coordinator.js';
import { createMySQLInstance, createMySQLCluster, InstanceState } from '../../../types/index.js';

// Mock dependencies
jest.mock('../../../core/discovery/topology.js');
jest.mock('../../../core/sync/sync-coordinator.js');

describe('TopologyWatcher', () => {
  let watcher: TopologyWatcher;
  let mockOrchestrator: jest.Mocked<ReturnType<typeof getOrchestratorClient>>;
  let mockSyncCoordinator: jest.Mocked<ReturnType<typeof getSyncCoordinator>>;

  beforeEach(() => {
    mockOrchestrator = {
      getClusters: jest.fn(),
      getTopology: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getOrchestratorClient>>;

    mockSyncCoordinator = {
      sync: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getSyncCoordinator>>;

    (getOrchestratorClient as jest.Mock).mockReturnValue(mockOrchestrator);
    (getSyncCoordinator as jest.Mock).mockReturnValue(mockSyncCoordinator);

    watcher = new TopologyWatcher({
      pollIntervalMs: 60000, // Long interval to prevent auto-poll during tests
      enabled: true,
    });
  });

  afterEach(() => {
    watcher.stop();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('should start polling when start() called', async () => {
      mockOrchestrator.getClusters.mockResolvedValue([]);

      await watcher.start();

      expect(watcher.isRunning()).toBe(true);
      expect(mockOrchestrator.getClusters).toHaveBeenCalledTimes(1); // Initial poll
    });

    it('should stop polling when stop() called', async () => {
      mockOrchestrator.getClusters.mockResolvedValue([]);

      await watcher.start();
      watcher.stop();

      expect(watcher.isRunning()).toBe(false);
    });

    it('should not start if already running', async () => {
      mockOrchestrator.getClusters.mockResolvedValue([]);

      await watcher.start();
      await watcher.start(); // Second call

      expect(mockOrchestrator.getClusters).toHaveBeenCalledTimes(1);
    });

    it('should not start if disabled', async () => {
      const disabledWatcher = new TopologyWatcher({ enabled: false });

      await disabledWatcher.start();

      expect(disabledWatcher.isRunning()).toBe(false);
    });

    it('should perform initial poll on start', async () => {
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology.mockResolvedValue(cluster);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.start();

      expect(mockOrchestrator.getClusters).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getTopology).toHaveBeenCalledWith('cluster-1');
    });
  });

  // ===========================================================================
  // Polling via forcePoll
  // ===========================================================================

  describe('forcePoll', () => {
    it('should detect topology changes via forcePoll', async () => {
      const cluster1 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const cluster2 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology
        .mockResolvedValueOnce(cluster1)
        .mockResolvedValueOnce(cluster2);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      // First poll
      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalledTimes(1);

      // Second poll with changed topology
      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalledTimes(2);
    });

    it('should not trigger sync when topology unchanged', async () => {
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology.mockResolvedValue(cluster);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalledTimes(1);

      // Clear mock to count fresh
      mockSyncCoordinator.sync.mockClear();

      // Same topology - no sync
      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).not.toHaveBeenCalled();
    });

    it('should trigger sync on primary change', async () => {
      const cluster1 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary1', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const cluster2 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary2', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology
        .mockResolvedValueOnce(cluster1)
        .mockResolvedValueOnce(cluster2);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.forcePoll();
      mockSyncCoordinator.sync.mockClear();

      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalledWith(cluster2, 'poll');
    });

    it('should trigger sync on replica added', async () => {
      const cluster1 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      const cluster2 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE })],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology
        .mockResolvedValueOnce(cluster1)
        .mockResolvedValueOnce(cluster2);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.forcePoll();
      mockSyncCoordinator.sync.mockClear();

      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalled();
    });

    it('should trigger sync on replica removed', async () => {
      const cluster1 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE })],
      });

      const cluster2 = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology
        .mockResolvedValueOnce(cluster1)
        .mockResolvedValueOnce(cluster2);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.forcePoll();
      mockSyncCoordinator.sync.mockClear();

      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should handle orchestrator errors gracefully', async () => {
      mockOrchestrator.getClusters.mockRejectedValue(new Error('Connection failed'));

      // Should not throw
      await expect(watcher.forcePoll()).resolves.not.toThrow();
    });

    it('should handle missing topology gracefully', async () => {
      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology.mockResolvedValue(null);

      await watcher.forcePoll();

      expect(mockSyncCoordinator.sync).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('configuration', () => {
    it('should use custom poll interval', () => {
      const customWatcher = new TopologyWatcher({ pollIntervalMs: 5000 });
      expect(customWatcher.getPollInterval()).toBe(5000);
    });

    it('should update poll interval dynamically', () => {
      watcher.setPollInterval(5000);
      expect(watcher.getPollInterval()).toBe(5000);
    });

    it('should default to 30000ms poll interval', () => {
      const defaultWatcher = new TopologyWatcher();
      expect(defaultWatcher.getPollInterval()).toBe(30000);
    });
  });

  // ===========================================================================
  // Cache
  // ===========================================================================

  describe('cache', () => {
    it('should clear cache on clearCache()', async () => {
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockOrchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockOrchestrator.getTopology.mockResolvedValue(cluster);
      mockSyncCoordinator.sync.mockResolvedValue({ skipped: false, serversSynced: 1 });

      await watcher.forcePoll();
      watcher.clearCache();
      mockSyncCoordinator.sync.mockClear();

      // After clearing cache, same topology should trigger sync
      await watcher.forcePoll();
      expect(mockSyncCoordinator.sync).toHaveBeenCalled();
    });
  });
});

describe('getTopologyWatcher', () => {
  beforeEach(() => {
    resetTopologyWatcher();
  });

  afterEach(() => {
    resetTopologyWatcher();
  });

  it('should return singleton instance', () => {
    const w1 = getTopologyWatcher();
    const w2 = getTopologyWatcher();
    expect(w1).toBe(w2);
  });

  it('should reset singleton on resetTopologyWatcher', () => {
    const w1 = getTopologyWatcher();
    resetTopologyWatcher();
    const w2 = getTopologyWatcher();
    expect(w1).not.toBe(w2);
  });
});
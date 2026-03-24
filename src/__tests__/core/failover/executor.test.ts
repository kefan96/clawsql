/**
 * Tests for Failover Module
 */

import { FailoverExecutor, getFailoverExecutor } from '../../../core/failover/executor.js';
import { CandidateSelector, LowestLagStrategy } from '../../../core/failover/candidate-selector.js';
import { InstancePromoter } from '../../../core/failover/promoter.js';
import { RecoveryManager } from '../../../core/failover/recovery-manager.js';
import {
  FailoverState,
  FailureType,
  InstanceRole,
  InstanceState,
  createMySQLInstance,
  createMySQLCluster,
} from '../../../types/index.js';
import { OrchestratorClient } from '../../../core/discovery/topology.js';
import { ProxySQLManager } from '../../../core/routing/proxysql-manager.js';

// Mock dependencies
jest.mock('../../../core/discovery/topology.js');
jest.mock('../../../core/routing/proxysql-manager.js');
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

describe('CandidateSelector', () => {
  describe('LowestLagStrategy', () => {
    let strategy: LowestLagStrategy;

    beforeEach(() => {
      strategy = new LowestLagStrategy();
    });

    it('should return null when no replicas', () => {
      const candidate = strategy.select([]);
      expect(candidate).toBeNull();
    });

    it('should return null when all replicas are offline', () => {
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.OFFLINE,
      });
      const candidate = strategy.select([replica]);
      expect(candidate).toBeNull();
    });

    it('should select replica with lowest replication lag', () => {
      const replica1 = createMySQLInstance('replica1', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 10,
      });
      const replica2 = createMySQLInstance('replica2', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 2,
      });

      const candidate = strategy.select([replica1, replica2]);
      expect(candidate?.host).toBe('replica2');
    });

    it('should skip replicas that are not online', () => {
      const replica1 = createMySQLInstance('replica1', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.MAINTENANCE,
        replicationLag: 0,
      });
      const replica2 = createMySQLInstance('replica2', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 5,
      });

      const candidate = strategy.select([replica1, replica2]);
      expect(candidate?.host).toBe('replica2');
    });
  });

  describe('CandidateSelector class', () => {
    it('should select from cluster replicas', () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
      });
      const replica1 = createMySQLInstance('replica1', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 10,
      });
      const replica2 = createMySQLInstance('replica2', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 2,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica1, replica2],
      });

      const selector = new CandidateSelector();
      const candidate = selector.select(cluster);
      expect(candidate?.host).toBe('replica2');
    });

    it('should find replica by ID', () => {
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [replica] });

      const found = CandidateSelector.findReplica(cluster, 'replica:3306');
      expect(found).toBe(replica);
    });

    it('should get instance ID', () => {
      const instance = createMySQLInstance('host', 3306);
      expect(CandidateSelector.getInstanceId(instance)).toBe('host:3306');
    });
  });
});

describe('InstancePromoter', () => {
  let promoter: InstancePromoter;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;

  beforeEach(() => {
    mockOrchestrator = {
      gracefulMasterTakeover: jest.fn(),
      forceMasterFailover: jest.fn(),
    } as unknown as jest.Mocked<OrchestratorClient>;

    promoter = new InstancePromoter(mockOrchestrator);
  });

  describe('promote', () => {
    it('should promote instance for switchover', async () => {
      mockOrchestrator.gracefulMasterTakeover.mockResolvedValue({ Code: 'OK' });

      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
      const newPrimary = createMySQLInstance('new-primary', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary });

      const result = await promoter.promote(newPrimary, cluster, true);
      expect(result.success).toBe(true);
    });

    it('should promote instance for failover', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });

      const newPrimary = createMySQLInstance('new-primary', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test');

      const result = await promoter.promote(newPrimary, cluster, false);
      expect(result.success).toBe(true);
    });

    it('should return failure on error', async () => {
      mockOrchestrator.forceMasterFailover.mockRejectedValue(new Error('Failed'));

      const newPrimary = createMySQLInstance('new-primary', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test');

      const result = await promoter.promote(newPrimary, cluster, false);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed');
    });
  });
});

describe('RecoveryManager', () => {
  let recoveryManager: RecoveryManager;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;

  beforeEach(() => {
    mockOrchestrator = {
      getInstance: jest.fn(),
    } as unknown as jest.Mocked<OrchestratorClient>;

    recoveryManager = new RecoveryManager(mockOrchestrator);
  });

  describe('queueForRecovery', () => {
    it('should queue instance for recovery', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'host',
        3306,
        'new-primary:3306'
      );

      recoveryManager.queueForRecovery(pending);
      expect(recoveryManager.isPending('host:3306')).toBe(true);
    });
  });

  describe('getPending', () => {
    it('should return all pending recoveries', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'host',
        3306,
        'new-primary:3306'
      );

      recoveryManager.queueForRecovery(pending);
      const pendings = recoveryManager.getPending();
      expect(pendings).toHaveLength(1);
      expect(pendings[0].instanceId).toBe('host:3306');
    });
  });

  describe('clear', () => {
    it('should clear a pending recovery', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'host',
        3306,
        'new-primary:3306'
      );

      recoveryManager.queueForRecovery(pending);
      expect(recoveryManager.clear('host:3306')).toBe(true);
      expect(recoveryManager.isPending('host:3306')).toBe(false);
    });
  });

  describe('createPendingRecovery', () => {
    it('should create pending recovery record', () => {
      const pending = RecoveryManager.createPendingRecovery(
        'cluster-1',
        'host',
        3306,
        'new-primary:3306'
      );

      expect(pending.clusterId).toBe('cluster-1');
      expect(pending.instanceId).toBe('host:3306');
      expect(pending.newPrimaryId).toBe('new-primary:3306');
    });
  });
});

describe('FailoverExecutor', () => {
  let executor: FailoverExecutor;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;
  let mockProxySQL: jest.Mocked<ProxySQLManager>;

  beforeEach(() => {
    mockOrchestrator = {
      healthCheck: jest.fn(),
      getClusters: jest.fn(),
      getTopology: jest.fn(),
      getInstance: jest.fn(),
      discoverInstance: jest.fn(),
      forgetInstance: jest.fn(),
      beginMaintenance: jest.fn(),
      endMaintenance: jest.fn(),
      getReplicationAnalysis: jest.fn(),
      gracefulMasterTakeover: jest.fn(),
      forceMasterFailover: jest.fn(),
      relocateReplicas: jest.fn(),
    } as unknown as jest.Mocked<OrchestratorClient>;

    mockProxySQL = {
      connect: jest.fn(),
      close: jest.fn(),
      setMonitorCredentials: jest.fn(),
      addServer: jest.fn(),
      registerInstance: jest.fn(),
      removeServer: jest.fn(),
      setupReadWriteSplit: jest.fn(),
      syncCluster: jest.fn(),
      removeCluster: jest.fn(),
      loadConfigToRuntime: jest.fn(),
      saveConfigToDisk: jest.fn(),
      getServers: jest.fn(),
      getConfigSummary: jest.fn(),
      relocateReplica: jest.fn(),
    } as unknown as jest.Mocked<ProxySQLManager>;

    executor = new FailoverExecutor(mockOrchestrator, mockProxySQL);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create executor with dependencies', () => {
      expect(executor).toBeDefined();
    });
  });

  describe('executeSwitchover', () => {
    it('should fail when primary is not healthy', async () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.OFFLINE,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const operation = await executor.executeSwitchover(cluster);

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('healthy primary');
    });

    it('should fail when target replica not found', async () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const operation = await executor.executeSwitchover(cluster, 'nonexistent:3306');

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('not found');
      expect(operation.error).toContain('replica:3306'); // Available replicas shown
    });

    it('should fail when no primary in cluster', async () => {
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [replica] });

      const operation = await executor.executeSwitchover(cluster);

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('healthy primary');
    });
  });

  describe('executeManualFailover', () => {
    it('should fail when primary is healthy', async () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const operation = await executor.executeManualFailover(cluster);

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('Primary is healthy');
    });

    it('should fail when target replica not found', async () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.OFFLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary });

      const operation = await executor.executeManualFailover(cluster, 'nonexistent:3306');

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('not found');
    });

    it('should execute manual failover successfully', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.OFFLINE,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const operation = await executor.executeManualFailover(
        cluster,
        'replica:3306',
        'Manual failover'
      );

      expect(operation.state).toBe(FailoverState.COMPLETED);
      expect(operation.manual).toBe(true);
    });
  });

  describe('executeAutomaticFailover', () => {
    it('should execute automatic failover successfully', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.FAILED,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const failureEvent = {
        eventId: 'event-1',
        failureType: FailureType.PRIMARY_UNREACHABLE,
        instanceId: 'primary:3306',
        clusterId: 'cluster-1',
        detectedAt: new Date(),
        confirmed: true,
        confirmationCount: 3,
        details: {},
      };

      const operation = await executor.executeAutomaticFailover(failureEvent, cluster);

      expect(operation.state).toBe(FailoverState.COMPLETED);
      expect(operation.manual).toBe(false);
    });

    it('should fail when no suitable candidate', async () => {
      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.FAILED,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.OFFLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const failureEvent = {
        eventId: 'event-1',
        failureType: FailureType.PRIMARY_UNREACHABLE,
        instanceId: 'primary:3306',
        clusterId: 'cluster-1',
        detectedAt: new Date(),
        confirmed: true,
        confirmationCount: 3,
        details: {},
      };

      const operation = await executor.executeAutomaticFailover(failureEvent, cluster);

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toContain('No suitable candidate');
    });
  });

  describe('recovery management', () => {
    it('should return empty pending recoveries initially', () => {
      expect(executor.getPendingRecoveries()).toEqual([]);
    });

    it('should check if instance is pending recovery', () => {
      expect(executor.isPendingRecovery('host:3306')).toBe(false);
    });
  });

  describe('operation history', () => {
    it('should return null when no operation in progress', () => {
      expect(executor.getCurrentOperation()).toBeNull();
    });

    it('should return empty array initially', () => {
      const history = executor.getOperationHistory();
      expect(history).toEqual([]);
    });

    it('should record operation history', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.OFFLINE,
      });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      await executor.executeManualFailover(cluster, 'replica:3306', 'Test');

      const history = executor.getOperationHistory();
      expect(history).toHaveLength(1);
      expect(history[0].clusterId).toBe('cluster-1');
    });

    it('should filter history by cluster ID', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, { state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      await executor.executeManualFailover(cluster, 'replica:3306', 'Test');

      const history = executor.getOperationHistory('cluster-1');
      expect(history).toHaveLength(1);

      const otherHistory = executor.getOperationHistory('other-cluster');
      expect(otherHistory).toHaveLength(0);
    });

    it('should get operation by ID', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, { state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      const result = await executor.executeManualFailover(cluster, 'replica:3306', 'Test');

      const found = executor.getOperation(result.operationId);
      expect(found).toBeDefined();
      expect(found?.operationId).toBe(result.operationId);
    });

    it('should return undefined for unknown operation ID', () => {
      const found = executor.getOperation('unknown-id');
      expect(found).toBeUndefined();
    });
  });

  describe('hook registration', () => {
    it('should register pre-failover hook', () => {
      const hook = jest.fn();
      executor.registerPreFailoverHook(hook);
      // Hook is registered internally, we test it works via executeSwitchover
      expect(() => executor.registerPreFailoverHook(hook)).not.toThrow();
    });

    it('should register post-failover hook', () => {
      const hook = jest.fn();
      executor.registerPostFailoverHook(hook);
      expect(() => executor.registerPostFailoverHook(hook)).not.toThrow();
    });
  });

  describe('cancelOperation', () => {
    it('should return false when no matching operation', async () => {
      const result = await executor.cancelOperation('unknown-id');
      expect(result).toBe(false);
    });

    it('should cancel current operation', async () => {
      // Create an operation that's in progress
      mockOrchestrator.forceMasterFailover.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ Code: 'OK' }), 100)));
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, { state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      // Start failover in background
      const failoverPromise = executor.executeManualFailover(cluster, 'replica:3306', 'Test');

      // Get current operation
      await new Promise(resolve => setTimeout(resolve, 10));
      const current = executor.getCurrentOperation();

      if (current) {
        const cancelled = await executor.cancelOperation(current.operationId);
        expect(cancelled).toBe(true);
      }

      await failoverPromise;
    });
  });

  describe('recovery operations', () => {
    it('should queue old primary for recovery after failover', async () => {
      mockOrchestrator.forceMasterFailover.mockResolvedValue({ Code: 'OK' });
      mockProxySQL.syncCluster.mockResolvedValue({
        clusterId: 'cluster-1',
        serversAdded: 2,
        serversRemoved: 0,
        hostgroups: { writer: 10, reader: 20 },
        success: true,
        errors: [],
      });

      const primary = createMySQLInstance('primary', 3306, { state: InstanceState.OFFLINE });
      const replica = createMySQLInstance('replica', 3306, { state: InstanceState.ONLINE });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

      await executor.executeManualFailover(cluster, 'replica:3306', 'Test');

      // Old primary should be pending recovery
      expect(executor.isPendingRecovery('primary:3306')).toBe(true);
    });
  });
});

describe('getFailoverExecutor', () => {
  it('should return singleton instance', () => {
    const e1 = getFailoverExecutor();
    const e2 = getFailoverExecutor();
    expect(e1).toBe(e2);
  });
});
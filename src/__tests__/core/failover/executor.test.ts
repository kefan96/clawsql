/**
 * Tests for Failover Executor
 */

import { FailoverExecutor, getFailoverExecutor } from '../../../core/failover/executor.js';
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
      requestFailover: jest.fn(),
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

  describe('selectCandidate', () => {
    it('should return null when no replicas', async () => {
      const cluster = createMySQLCluster('cluster-1', 'test');
      const candidate = await executor.selectCandidate(cluster);

      expect(candidate).toBeNull();
    });

    it('should return null when all replicas are offline', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
      const replica = createMySQLInstance('replica', 3306, {
        role: InstanceRole.REPLICA,
        state: InstanceState.OFFLINE,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });

      const candidate = await executor.selectCandidate(cluster);

      expect(candidate).toBeNull();
    });

    it('should select replica with lowest replication lag', async () => {
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

      const candidate = await executor.selectCandidate(cluster);

      expect(candidate?.host).toBe('replica2');
    });

    it('should skip replicas in maintenance', async () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
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
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica1, replica2],
      });

      const candidate = await executor.selectCandidate(cluster);

      expect(candidate?.host).toBe('replica2');
    });
  });

  describe('promoteInstance', () => {
    it('should promote instance successfully', async () => {
      mockOrchestrator.requestFailover.mockResolvedValue({ success: true });
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
      const newPrimary = createMySQLInstance('new-primary', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary });

      const result = await executor.promoteInstance(newPrimary, cluster);

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockOrchestrator.requestFailover.mockRejectedValue(new Error('Failed'));
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
      const newPrimary = createMySQLInstance('new-primary', 3306, { role: InstanceRole.REPLICA });
      const cluster = createMySQLCluster('cluster-1', 'test', { primary });

      const result = await executor.promoteInstance(newPrimary, cluster);

      expect(result).toBe(false);
    });
  });

  describe('reconfigureReplicas', () => {
    it('should reconfigure replicas to follow new primary', async () => {
      mockOrchestrator.relocateReplicas.mockResolvedValue(true);
      const newPrimary = createMySQLInstance('new-primary', 3306);
      const replica = createMySQLInstance('replica', 3306);

      const result = await executor.reconfigureReplicas(newPrimary, [replica]);

      expect(result).toBe(true);
    });
  });

  describe('executeManualFailover', () => {
    it('should execute manual failover', async () => {
      mockOrchestrator.requestFailover.mockResolvedValue({ success: true });
      mockOrchestrator.relocateReplicas.mockResolvedValue(true);
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

      const operation = await executor.executeManualFailover(
        cluster,
        'replica:3306',
        'Planned maintenance'
      );

      expect(operation.state).toBe(FailoverState.COMPLETED);
      expect(operation.manual).toBe(true);
    });
  });

  describe('executeAutomaticFailover', () => {
    it('should execute automatic failover', async () => {
      mockOrchestrator.requestFailover.mockResolvedValue({ success: true });
      mockOrchestrator.relocateReplicas.mockResolvedValue(true);
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

  describe('getCurrentOperation', () => {
    it('should return null when no operation in progress', () => {
      expect(executor.getCurrentOperation()).toBeNull();
    });
  });

  describe('getOperationHistory', () => {
    it('should return empty array initially', () => {
      const history = executor.getOperationHistory();
      expect(history).toEqual([]);
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
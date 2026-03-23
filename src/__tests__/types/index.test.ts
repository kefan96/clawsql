/**
 * Tests for ClawSQL core types and models
 */

import {
  InstanceRole,
  InstanceState,
  HealthStatus,
  AlertSeverity,
  FailoverState,
  FailureType,
  createInstanceId,
  createMySQLInstance,
  createMySQLCluster,
  isPrimary,
  isReplica,
  isOnline,
  isHealthy,
  getInstanceCount,
  getHealthyCount,
  getClusterHealthStatus,
} from '../../types/index';

describe('Enums', () => {
  describe('InstanceRole', () => {
    it('should have correct values', () => {
      expect(InstanceRole.PRIMARY).toBe('primary');
      expect(InstanceRole.REPLICA).toBe('replica');
      expect(InstanceRole.UNKNOWN).toBe('unknown');
    });
  });

  describe('InstanceState', () => {
    it('should have correct values', () => {
      expect(InstanceState.ONLINE).toBe('online');
      expect(InstanceState.OFFLINE).toBe('offline');
      expect(InstanceState.RECOVERING).toBe('recovering');
      expect(InstanceState.FAILED).toBe('failed');
      expect(InstanceState.MAINTENANCE).toBe('maintenance');
    });
  });

  describe('HealthStatus', () => {
    it('should have correct values', () => {
      expect(HealthStatus.HEALTHY).toBe('healthy');
      expect(HealthStatus.DEGRADED).toBe('degraded');
      expect(HealthStatus.UNHEALTHY).toBe('unhealthy');
      expect(HealthStatus.UNKNOWN).toBe('unknown');
    });
  });

  describe('AlertSeverity', () => {
    it('should have correct values', () => {
      expect(AlertSeverity.INFO).toBe('info');
      expect(AlertSeverity.WARNING).toBe('warning');
      expect(AlertSeverity.CRITICAL).toBe('critical');
    });
  });

  describe('FailoverState', () => {
    it('should have correct values', () => {
      expect(FailoverState.IDLE).toBe('idle');
      expect(FailoverState.DETECTING).toBe('detecting');
      expect(FailoverState.CANDIDATE_SELECTION).toBe('candidate_selection');
      expect(FailoverState.PROMOTING).toBe('promoting');
      expect(FailoverState.RECONFIGURING).toBe('reconfiguring');
      expect(FailoverState.COMPLETED).toBe('completed');
      expect(FailoverState.FAILED).toBe('failed');
    });
  });

  describe('FailureType', () => {
    it('should have correct values', () => {
      expect(FailureType.PRIMARY_UNREACHABLE).toBe('primary_unreachable');
      expect(FailureType.PRIMARY_NOT_WRITING).toBe('primary_not_writing');
      expect(FailureType.REPLICATION_STOPPED).toBe('replication_stopped');
      expect(FailureType.REPLICATION_LAG_HIGH).toBe('replication_lag_high');
      expect(FailureType.DISK_FULL).toBe('disk_full');
      expect(FailureType.MEMORY_EXHAUSTED).toBe('memory_exhausted');
    });
  });
});

describe('Helper Functions', () => {
  describe('createInstanceId', () => {
    it('should create instance ID from host and port', () => {
      expect(createInstanceId('localhost', 3306)).toBe('localhost:3306');
      expect(createInstanceId('192.168.1.1', 3307)).toBe('192.168.1.1:3307');
      expect(createInstanceId('mysql-primary', 3306)).toBe('mysql-primary:3306');
    });
  });

  describe('createMySQLInstance', () => {
    it('should create instance with default values', () => {
      const instance = createMySQLInstance('localhost', 3306);

      expect(instance.host).toBe('localhost');
      expect(instance.port).toBe(3306);
      expect(instance.role).toBe(InstanceRole.UNKNOWN);
      expect(instance.state).toBe(InstanceState.OFFLINE);
      expect(instance.labels).toEqual({});
      expect(instance.extra).toEqual({});
      expect(instance.lastSeen).toBeInstanceOf(Date);
    });

    it('should create instance with overrides', () => {
      const instance = createMySQLInstance('localhost', 3306, {
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        serverId: 1,
        version: '8.0.32',
        clusterId: 'cluster-123',
        labels: { env: 'production' },
      });

      expect(instance.role).toBe(InstanceRole.PRIMARY);
      expect(instance.state).toBe(InstanceState.ONLINE);
      expect(instance.serverId).toBe(1);
      expect(instance.version).toBe('8.0.32');
      expect(instance.clusterId).toBe('cluster-123');
      expect(instance.labels).toEqual({ env: 'production' });
    });
  });

  describe('createMySQLCluster', () => {
    it('should create cluster with default values', () => {
      const cluster = createMySQLCluster('cluster-123', 'test-cluster');

      expect(cluster.clusterId).toBe('cluster-123');
      expect(cluster.name).toBe('test-cluster');
      expect(cluster.primary).toBeUndefined();
      expect(cluster.replicas).toEqual([]);
      expect(cluster.createdAt).toBeInstanceOf(Date);
      expect(cluster.updatedAt).toBeInstanceOf(Date);
    });

    it('should create cluster with overrides', () => {
      const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
      const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA });

      const cluster = createMySQLCluster('cluster-123', 'test-cluster', {
        primary,
        replicas: [replica],
        description: 'Test cluster',
      });

      expect(cluster.primary).toBe(primary);
      expect(cluster.replicas).toHaveLength(1);
      expect(cluster.description).toBe('Test cluster');
    });
  });

  describe('isPrimary', () => {
    it('should return true for primary instances', () => {
      const instance = createMySQLInstance('host', 3306, { role: InstanceRole.PRIMARY });
      expect(isPrimary(instance)).toBe(true);
    });

    it('should return false for non-primary instances', () => {
      const instance = createMySQLInstance('host', 3306, { role: InstanceRole.REPLICA });
      expect(isPrimary(instance)).toBe(false);
    });

    it('should return false for unknown role', () => {
      const instance = createMySQLInstance('host', 3306);
      expect(isPrimary(instance)).toBe(false);
    });
  });

  describe('isReplica', () => {
    it('should return true for replica instances', () => {
      const instance = createMySQLInstance('host', 3306, { role: InstanceRole.REPLICA });
      expect(isReplica(instance)).toBe(true);
    });

    it('should return false for non-replica instances', () => {
      const instance = createMySQLInstance('host', 3306, { role: InstanceRole.PRIMARY });
      expect(isReplica(instance)).toBe(false);
    });
  });

  describe('isOnline', () => {
    it('should return true for online instances', () => {
      const instance = createMySQLInstance('host', 3306, { state: InstanceState.ONLINE });
      expect(isOnline(instance)).toBe(true);
    });

    it('should return false for offline instances', () => {
      const instance = createMySQLInstance('host', 3306, { state: InstanceState.OFFLINE });
      expect(isOnline(instance)).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return true for online primary instances', () => {
      const instance = createMySQLInstance('host', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      });
      expect(isHealthy(instance)).toBe(true);
    });

    it('should return true for online replica instances', () => {
      const instance = createMySQLInstance('host', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.REPLICA,
      });
      expect(isHealthy(instance)).toBe(true);
    });

    it('should return false for offline instances', () => {
      const instance = createMySQLInstance('host', 3306, {
        state: InstanceState.OFFLINE,
        role: InstanceRole.PRIMARY,
      });
      expect(isHealthy(instance)).toBe(false);
    });

    it('should return false for unknown role', () => {
      const instance = createMySQLInstance('host', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.UNKNOWN,
      });
      expect(isHealthy(instance)).toBe(false);
    });
  });

  describe('getInstanceCount', () => {
    it('should return 0 for empty cluster', () => {
      const cluster = createMySQLCluster('cluster-1', 'test');
      expect(getInstanceCount(cluster)).toBe(0);
    });

    it('should return 1 for cluster with only primary', () => {
      const primary = createMySQLInstance('primary', 3306);
      const cluster = createMySQLCluster('cluster-1', 'test', { primary });
      expect(getInstanceCount(cluster)).toBe(1);
    });

    it('should count replicas correctly', () => {
      const replica1 = createMySQLInstance('replica1', 3306);
      const replica2 = createMySQLInstance('replica2', 3306);
      const cluster = createMySQLCluster('cluster-1', 'test', {
        replicas: [replica1, replica2],
      });
      expect(getInstanceCount(cluster)).toBe(2);
    });

    it('should count all instances', () => {
      const primary = createMySQLInstance('primary', 3306);
      const replica1 = createMySQLInstance('replica1', 3306);
      const replica2 = createMySQLInstance('replica2', 3306);
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica1, replica2],
      });
      expect(getInstanceCount(cluster)).toBe(3);
    });
  });

  describe('getHealthyCount', () => {
    it('should return 0 for empty cluster', () => {
      const cluster = createMySQLCluster('cluster-1', 'test');
      expect(getHealthyCount(cluster)).toBe(0);
    });

    it('should count healthy instances only', () => {
      const primary = createMySQLInstance('primary', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      });
      const replica1 = createMySQLInstance('replica1', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.REPLICA,
      });
      const replica2 = createMySQLInstance('replica2', 3306, {
        state: InstanceState.OFFLINE,
        role: InstanceRole.REPLICA,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica1, replica2],
      });
      expect(getHealthyCount(cluster)).toBe(2);
    });
  });

  describe('getClusterHealthStatus', () => {
    it('should return UNKNOWN for empty cluster', () => {
      const cluster = createMySQLCluster('cluster-1', 'test');
      expect(getClusterHealthStatus(cluster)).toBe(HealthStatus.UNKNOWN);
    });

    it('should return HEALTHY when all instances are healthy', () => {
      const primary = createMySQLInstance('primary', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      });
      const replica = createMySQLInstance('replica', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.REPLICA,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });
      expect(getClusterHealthStatus(cluster)).toBe(HealthStatus.HEALTHY);
    });

    it('should return DEGRADED when half or more instances are healthy', () => {
      const primary = createMySQLInstance('primary', 3306, {
        state: InstanceState.ONLINE,
        role: InstanceRole.PRIMARY,
      });
      const replica1 = createMySQLInstance('replica1', 3306, {
        state: InstanceState.OFFLINE,
        role: InstanceRole.REPLICA,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica1],
      });
      expect(getClusterHealthStatus(cluster)).toBe(HealthStatus.DEGRADED);
    });

    it('should return UNHEALTHY when less than half instances are healthy', () => {
      const primary = createMySQLInstance('primary', 3306, {
        state: InstanceState.OFFLINE,
        role: InstanceRole.PRIMARY,
      });
      const replica = createMySQLInstance('replica', 3306, {
        state: InstanceState.OFFLINE,
        role: InstanceRole.REPLICA,
      });
      const cluster = createMySQLCluster('cluster-1', 'test', {
        primary,
        replicas: [replica],
      });
      expect(getClusterHealthStatus(cluster)).toBe(HealthStatus.UNHEALTHY);
    });
  });
});
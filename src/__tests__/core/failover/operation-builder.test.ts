/**
 * Tests for Operation Builder
 */

import { OperationBuilder, createFailedOperation, createSwitchoverOperation, createFailoverOperation } from '../../../core/failover/operation-builder.js';
import { FailoverState, createMySQLCluster, createMySQLInstance, InstanceRole, InstanceState } from '../../../types/index.js';

describe('OperationBuilder', () => {
  describe('create', () => {
    it('should create a new builder instance', () => {
      const builder = OperationBuilder.create();
      expect(builder).toBeInstanceOf(OperationBuilder);
    });
  });

  describe('withId', () => {
    it('should set custom operation ID', () => {
      const operation = OperationBuilder.create()
        .withId('custom-id')
        .asIdle()
        .build();

      expect(operation.operationId).toBe('custom-id');
    });

    it('should generate UUID if no ID provided', () => {
      const operation = OperationBuilder.create()
        .asIdle()
        .build();

      expect(operation.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('forCluster', () => {
    it('should set cluster information', () => {
      const cluster = createMySQLCluster('cluster-1', 'test-cluster');
      const operation = OperationBuilder.create()
        .forCluster(cluster)
        .asIdle()
        .build();

      expect(operation.clusterId).toBe('cluster-1');
    });
  });

  describe('asManual', () => {
    it('should create manual operation', () => {
      const operation = OperationBuilder.create()
        .asManual('Test reason')
        .build();

      expect(operation.manual).toBe(true);
      expect(operation.reason).toBe('Test reason');
      expect(operation.state).toBe(FailoverState.IDLE);
    });
  });

  describe('asAutomatic', () => {
    it('should create automatic operation', () => {
      const operation = OperationBuilder.create()
        .asAutomatic('trigger-123', 'Auto failover')
        .build();

      expect(operation.manual).toBe(false);
      expect(operation.reason).toBe('Auto failover');
      expect(operation.triggeredBy).toBe('trigger-123');
    });
  });

  describe('withTarget', () => {
    it('should set target instance', () => {
      const instance = createMySQLInstance('replica', 3306);
      const operation = OperationBuilder.create()
        .withTarget(instance)
        .asIdle()
        .build();

      expect(operation.newPrimaryId).toBe('replica:3306');
    });
  });

  describe('asFailed', () => {
    it('should create failed operation', () => {
      const operation = OperationBuilder.create()
        .asFailed('Something went wrong')
        .build();

      expect(operation.state).toBe(FailoverState.FAILED);
      expect(operation.error).toBe('Something went wrong');
      expect(operation.completedAt).toBeDefined();
    });
  });

  describe('asIdle', () => {
    it('should create idle operation', () => {
      const operation = OperationBuilder.create()
        .asIdle()
        .build();

      expect(operation.state).toBe(FailoverState.IDLE);
    });
  });

  describe('build', () => {
    it('should build complete operation', () => {
      const cluster = createMySQLCluster('cluster-1', 'test');
      const target = createMySQLInstance('replica', 3306);

      const operation = OperationBuilder.create()
        .withId('op-1')
        .forCluster(cluster)
        .asManual('Manual failover')
        .withTarget(target)
        .build();

      expect(operation.operationId).toBe('op-1');
      expect(operation.clusterId).toBe('cluster-1');
      expect(operation.manual).toBe(true);
      expect(operation.reason).toBe('Manual failover');
      expect(operation.newPrimaryId).toBe('replica:3306');
      expect(operation.state).toBe(FailoverState.IDLE);
      expect(operation.steps).toEqual([]);
    });
  });
});

describe('createFailedOperation', () => {
  it('should create failed operation with all details', () => {
    const cluster = createMySQLCluster('cluster-1', 'test');
    const operation = createFailedOperation(cluster, 'Test error', 'Test reason');

    expect(operation.clusterId).toBe('cluster-1');
    expect(operation.error).toBe('Test error');
    expect(operation.reason).toBe('Test reason');
    expect(operation.state).toBe(FailoverState.FAILED);
    expect(operation.completedAt).toBeDefined();
  });
});

describe('createSwitchoverOperation', () => {
  it('should create switchover operation with target', () => {
    const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
    const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA });
    const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

    const operation = createSwitchoverOperation(cluster, 'replica:3306', 'Planned switchover');

    expect(operation.clusterId).toBe('cluster-1');
    expect(operation.newPrimaryId).toBe('replica:3306');
    expect(operation.reason).toBe('Planned switchover');
    expect(operation.state).toBe(FailoverState.IDLE);
  });

  it('should create switchover operation without target', () => {
    const primary = createMySQLInstance('primary', 3306, { role: InstanceRole.PRIMARY });
    const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA });
    const cluster = createMySQLCluster('cluster-1', 'test', { primary, replicas: [replica] });

    const operation = createSwitchoverOperation(cluster, undefined, 'Planned switchover');

    expect(operation.clusterId).toBe('cluster-1');
    expect(operation.newPrimaryId).toBeUndefined();
    expect(operation.reason).toBe('Planned switchover');
  });
});

describe('createFailoverOperation', () => {
  it('should create failover operation with target', () => {
    const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA });
    const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [replica] });

    const operation = createFailoverOperation(cluster, 'replica:3306', 'Emergency failover');

    expect(operation.clusterId).toBe('cluster-1');
    expect(operation.newPrimaryId).toBe('replica:3306');
    expect(operation.reason).toBe('Emergency failover');
    expect(operation.state).toBe(FailoverState.IDLE);
  });

  it('should create failover operation without target', () => {
    const replica = createMySQLInstance('replica', 3306, { role: InstanceRole.REPLICA });
    const cluster = createMySQLCluster('cluster-1', 'test', { replicas: [replica] });

    const operation = createFailoverOperation(cluster, undefined, 'Emergency failover');

    expect(operation.clusterId).toBe('cluster-1');
    expect(operation.newPrimaryId).toBeUndefined();
  });
});
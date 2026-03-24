/**
 * ClawSQL - Operation Builder
 *
 * Factory for creating failover operations.
 * Uses the Factory Pattern to encapsulate operation creation logic.
 */

import { v4 as uuidv4 } from 'uuid';
import { FailoverOperation, FailoverState, MySQLCluster, MySQLInstance } from '../../types/index.js';

/**
 * Operation Builder
 * Provides a fluent interface for constructing failover operations.
 */
export class OperationBuilder {
  private operation: Partial<FailoverOperation> = {};

  /**
   * Start building a new operation
   */
  static create(): OperationBuilder {
    return new OperationBuilder();
  }

  /**
   * Set the operation ID
   */
  withId(id?: string): this {
    this.operation.operationId = id || uuidv4();
    return this;
  }

  /**
   * Set the cluster
   */
  forCluster(cluster: MySQLCluster): this {
    this.operation.clusterId = cluster.clusterId;
    this.operation.oldPrimaryId = cluster.primary
      ? `${cluster.primary.host}:${cluster.primary.port}`
      : '';
    return this;
  }

  /**
   * Set as manual operation
   */
  asManual(reason: string): this {
    this.operation.manual = true;
    this.operation.reason = reason;
    return this;
  }

  /**
   * Set as automatic operation
   */
  asAutomatic(triggeredBy: string, reason: string): this {
    this.operation.manual = false;
    this.operation.reason = reason;
    this.operation.triggeredBy = triggeredBy;
    return this;
  }

  /**
   * Set target primary
   */
  withTarget(instance: MySQLInstance): this {
    this.operation.newPrimaryId = `${instance.host}:${instance.port}`;
    return this;
  }

  /**
   * Set target by ID
   */
  withTargetId(targetId: string): this {
    this.operation.newPrimaryId = targetId;
    return this;
  }

  /**
   * Mark as failed with error
   */
  asFailed(error: string): this {
    this.operation.state = FailoverState.FAILED;
    this.operation.error = error;
    this.operation.completedAt = new Date();
    this.operation.steps = this.operation.steps || [];
    return this;
  }

  /**
   * Initialize as idle (ready to execute)
   */
  asIdle(): this {
    this.operation.state = FailoverState.IDLE;
    this.operation.steps = [];
    return this;
  }

  /**
   * Build the operation
   */
  build(): FailoverOperation {
    if (!this.operation.operationId) {
      this.operation.operationId = uuidv4();
    }
    if (!this.operation.state) {
      this.operation.state = FailoverState.IDLE;
    }
    if (!this.operation.steps) {
      this.operation.steps = [];
    }
    return this.operation as FailoverOperation;
  }
}

/**
 * Create a failed operation immediately
 */
export function createFailedOperation(
  cluster: MySQLCluster,
  error: string,
  reason: string
): FailoverOperation {
  return OperationBuilder.create()
    .forCluster(cluster)
    .asManual(reason)
    .asFailed(error)
    .build();
}

/**
 * Create a switchover operation
 */
export function createSwitchoverOperation(
  cluster: MySQLCluster,
  targetId: string | undefined,
  reason: string
): FailoverOperation {
  const builder = OperationBuilder.create()
    .forCluster(cluster)
    .asManual(reason)
    .asIdle();

  if (targetId) {
    builder.withTargetId(targetId);
  }

  return builder.build();
}

/**
 * Create a failover operation
 */
export function createFailoverOperation(
  cluster: MySQLCluster,
  targetId: string | undefined,
  reason: string
): FailoverOperation {
  const builder = OperationBuilder.create()
    .forCluster(cluster)
    .asManual(reason)
    .asIdle();

  if (targetId) {
    builder.withTargetId(targetId);
  }

  return builder.build();
}

/**
 * Create an automatic failover operation
 */
export function createAutomaticFailoverOperation(
  cluster: MySQLCluster,
  failureType: string,
  eventId: string
): FailoverOperation {
  return OperationBuilder.create()
    .forCluster(cluster)
    .asAutomatic(eventId, `Automatic failover due to ${failureType}`)
    .asIdle()
    .build();
}
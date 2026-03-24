/**
 * ClawSQL - Operation Runner
 *
 * Base runner for failover operations.
 * Implements the Template Method Pattern for operation execution.
 */

import { getLogger } from '../../utils/logger.js';
import { MySQLCluster, MySQLInstance, FailoverOperation, FailoverState } from '../../types/index.js';
import { FailoverError } from '../../utils/exceptions.js';
import { FailoverHook } from './types.js';
import { InstancePromoter } from './promoter.js';
import { CandidateSelector } from './candidate-selector.js';
import { ProxySQLManager } from '../routing/proxysql-manager.js';

const logger = getLogger('failover');

/**
 * Step function type
 */
type StepFunction = (step: string) => void;

/**
 * Operation Runner
 * Executes the common flow for failover operations.
 */
export class OperationRunner {
  private preHooks: FailoverHook[] = [];
  private postHooks: FailoverHook[] = [];

  constructor(
    private promoter: InstancePromoter,
    private proxysql: ProxySQLManager
  ) {}

  /**
   * Register a pre-execution hook
   */
  registerPreHook(hook: FailoverHook): void {
    this.preHooks.push(hook);
  }

  /**
   * Register a post-execution hook
   */
  registerPostHook(hook: FailoverHook): void {
    this.postHooks.push(hook);
  }

  /**
   * Execute the operation
   * Template method that defines the skeleton of the operation.
   */
  async execute(
    operation: FailoverOperation,
    cluster: MySQLCluster,
    isSwitchover: boolean
  ): Promise<FailoverOperation> {
    const addStep = this.createStepLogger(operation);

    operation.startedAt = new Date();
    operation.state = FailoverState.DETECTING;

    try {
      // 1. Pre-execution hooks
      await this.runPreHooks(operation, cluster, addStep);

      // 2. Select candidate
      const newPrimary = await this.selectCandidate(operation, cluster, addStep);

      // 3. Promote instance
      await this.promoteInstance(operation, cluster, newPrimary, isSwitchover, addStep);

      // 4. Reconfigure replicas
      await this.reconfigureReplicas(operation, cluster, newPrimary, addStep);

      // 5. Update routing
      await this.updateRouting(operation, cluster, newPrimary, addStep);

      // Success
      operation.state = FailoverState.COMPLETED;
      operation.completedAt = new Date();
      addStep(this.getSuccessMessage(isSwitchover));

      logger.info(
        { operationId: operation.operationId, clusterId: cluster.clusterId },
        this.getSuccessMessage(isSwitchover)
      );
    } catch (error) {
      this.handleFailure(operation, error, addStep, isSwitchover);
    } finally {
      await this.runPostHooks(operation, cluster);
    }

    return operation;
  }

  /**
   * Create a step logging function
   */
  private createStepLogger(operation: FailoverOperation): StepFunction {
    return (step: string) => {
      const timestamp = new Date().toISOString();
      operation.steps.push(`[${timestamp}] ${step}`);
    };
  }

  /**
   * Run pre-execution hooks
   */
  private async runPreHooks(
    operation: FailoverOperation,
    cluster: MySQLCluster,
    addStep: StepFunction
  ): Promise<void> {
    addStep('Running pre-execution hooks');
    for (const hook of this.preHooks) {
      await hook(operation, cluster);
    }
  }

  /**
   * Select candidate for promotion
   */
  private async selectCandidate(
    operation: FailoverOperation,
    cluster: MySQLCluster,
    addStep: StepFunction
  ): Promise<MySQLInstance> {
    operation.state = FailoverState.CANDIDATE_SELECTION;
    addStep('Selecting candidate for promotion');

    // Auto-select if not specified
    if (!operation.newPrimaryId) {
      const selector = new CandidateSelector();
      const candidate = selector.select(cluster);
      if (!candidate) {
        throw new FailoverError('No suitable candidate found for promotion');
      }
      operation.newPrimaryId = CandidateSelector.getInstanceId(candidate);
    }

    // Find the instance
    const newPrimary = CandidateSelector.findReplica(cluster, operation.newPrimaryId);
    if (!newPrimary) {
      throw new FailoverError(`Candidate ${operation.newPrimaryId} not found`);
    }

    return newPrimary;
  }

  /**
   * Promote the instance
   */
  private async promoteInstance(
    operation: FailoverOperation,
    cluster: MySQLCluster,
    newPrimary: MySQLInstance,
    isSwitchover: boolean,
    addStep: StepFunction
  ): Promise<void> {
    operation.state = FailoverState.PROMOTING;
    addStep(this.getPromotionMessage(operation.newPrimaryId!, isSwitchover));

    const result = await this.promoter.promote(newPrimary, cluster, isSwitchover);

    if (!result.success) {
      throw new FailoverError(result.error || 'Promotion failed');
    }

    if (isSwitchover) {
      addStep('Started replication on demoted primary');
    }
  }

  /**
   * Reconfigure replicas to follow new primary
   */
  private async reconfigureReplicas(
    operation: FailoverOperation,
    cluster: MySQLCluster,
    newPrimary: MySQLInstance,
    addStep: StepFunction
  ): Promise<void> {
    operation.state = FailoverState.RECONFIGURING;
    addStep('Reconfiguring replicas');

    const otherReplicas = cluster.replicas.filter(
      r => `${r.host}:${r.port}` !== operation.newPrimaryId
    );

    for (const replica of otherReplicas) {
      try {
        await this.proxysql.relocateReplica(replica, newPrimary);
      } catch (error) {
        logger.warn({ error, replica: `${replica.host}:${replica.port}` }, 'Failed to reconfigure replica');
      }
    }
  }

  /**
   * Update routing rules
   */
  private async updateRouting(
    _operation: FailoverOperation,
    cluster: MySQLCluster,
    newPrimary: MySQLInstance,
    addStep: StepFunction
  ): Promise<void> {
    addStep('Updating routing rules');

    await this.proxysql.syncCluster(
      { ...cluster, primary: newPrimary },
      ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
      ProxySQLManager.DEFAULT_READER_HOSTGROUP
    );
  }

  /**
   * Run post-execution hooks
   */
  private async runPostHooks(
    operation: FailoverOperation,
    cluster: MySQLCluster
  ): Promise<void> {
    for (const hook of this.postHooks) {
      try {
        await hook(operation, cluster);
      } catch (error) {
        logger.error({ error }, 'Post-execution hook error');
      }
    }
  }

  /**
   * Handle operation failure
   */
  private handleFailure(
    operation: FailoverOperation,
    error: unknown,
    addStep: StepFunction,
    isSwitchover: boolean
  ): void {
    operation.state = FailoverState.FAILED;
    operation.error = error instanceof Error ? error.message : String(error);
    operation.completedAt = new Date();

    const operationType = isSwitchover ? 'Switchover' : 'Failover';
    addStep(`${operationType} failed: ${operation.error}`);

    logger.error({ error, operationId: operation.operationId }, `${operationType} failed`);
  }

  /**
   * Get promotion message
   */
  private getPromotionMessage(targetId: string, isSwitchover: boolean): string {
    return isSwitchover
      ? `Switching over to ${targetId}`
      : `Promoting ${targetId} to primary (failover)`;
  }

  /**
   * Get success message
   */
  private getSuccessMessage(isSwitchover: boolean): string {
    return isSwitchover ? 'Switchover completed successfully' : 'Failover completed successfully';
  }
}
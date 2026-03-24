/**
 * ClawSQL - Failover Executor
 *
 * Main orchestrator for failover operations.
 * Coordinates switchover, failover, and recovery operations.
 *
 * Terminology:
 * - Switchover: Planned operation when primary is healthy. Promotes a replica and fixes replication.
 * - Failover: Emergency operation when primary is down. Promotes a replica automatically.
 * - Manual Failover: User-initiated when primary is down. User selects which replica to promote.
 */

import { MySQLCluster, FailoverOperation, FailoverState, FailureEvent, isOnline } from '../../types/index.js';
import { OrchestratorClient, getOrchestratorClient } from '../discovery/topology.js';
import { ProxySQLManager, getProxySQLManager } from '../routing/proxysql-manager.js';
import { FailoverHook, PendingRecovery, RecoveryResult, BatchRecoveryResult } from './types.js';
import { OperationBuilder, createFailedOperation, createSwitchoverOperation, createFailoverOperation } from './operation-builder.js';
import { CandidateSelector } from './candidate-selector.js';
import { InstancePromoter } from './promoter.js';
import { RecoveryManager } from './recovery-manager.js';
import { OperationRunner } from './operation-runner.js';

/**
 * Failover Executor
 * Main entry point for all failover operations.
 */
export class FailoverExecutor {
  private orchestrator: OrchestratorClient;
  private proxysql: ProxySQLManager;
  private promoter: InstancePromoter;
  private recoveryManager: RecoveryManager;
  private operationRunner: OperationRunner;

  private currentOperation: FailoverOperation | null = null;
  private operationHistory: FailoverOperation[] = [];

  static readonly MAX_FAILOVER_TIME = 30; // seconds

  constructor(
    orchestrator?: OrchestratorClient,
    proxysql?: ProxySQLManager
  ) {
    this.orchestrator = orchestrator || getOrchestratorClient();
    this.proxysql = proxysql || getProxySQLManager();
    this.promoter = new InstancePromoter(this.orchestrator);
    this.recoveryManager = new RecoveryManager(this.orchestrator);
    this.operationRunner = new OperationRunner(this.promoter, this.proxysql);
  }

  // =========================================================================
  // Hook Registration
  // =========================================================================

  /**
   * Register a pre-failover hook
   */
  registerPreFailoverHook(hook: FailoverHook): void {
    this.operationRunner.registerPreHook(hook);
  }

  /**
   * Register a post-failover hook
   */
  registerPostFailoverHook(hook: FailoverHook): void {
    this.operationRunner.registerPostHook(hook);
  }

  // =========================================================================
  // Public Operations
  // =========================================================================

  /**
   * Execute automatic failover
   */
  async executeAutomaticFailover(
    failureEvent: FailureEvent,
    cluster: MySQLCluster
  ): Promise<FailoverOperation> {
    const operation = OperationBuilder.create()
      .forCluster(cluster)
      .asAutomatic(failureEvent.eventId, `Automatic failover due to ${failureEvent.failureType}`)
      .build();

    return this.executeFailoverOperation(operation, cluster);
  }

  /**
   * Execute switchover (planned, primary is healthy)
   * Promotes a replica to primary and starts replication on the old primary.
   */
  async executeSwitchover(
    cluster: MySQLCluster,
    targetPrimaryId?: string,
    reason: string = ''
  ): Promise<FailoverOperation> {
    // Validate primary is healthy
    if (!cluster.primary || !isOnline(cluster.primary)) {
      return this.recordOperation(
        createFailedOperation(
          cluster,
          'Switchover requires a healthy primary. Use failover for unhealthy primary.',
          reason || 'Switchover requested'
        )
      );
    }

    // Validate target if specified
    if (targetPrimaryId) {
      const targetReplica = CandidateSelector.findReplica(cluster, targetPrimaryId);
      if (!targetReplica) {
        return this.recordOperation(
          createFailedOperation(
            cluster,
            `Target '${targetPrimaryId}' not found in cluster replicas. ` +
              `Available: ${cluster.replicas.map(r => `${r.host}:${r.port}`).join(', ')}`,
            reason || 'Switchover requested'
          )
        );
      }
    }

    const operation = createSwitchoverOperation(cluster, targetPrimaryId, reason);
    return this.executeSwitchoverOperation(operation, cluster);
  }

  /**
   * Execute manual failover (primary is down, user selects replica)
   */
  async executeManualFailover(
    cluster: MySQLCluster,
    targetPrimaryId?: string,
    reason: string = ''
  ): Promise<FailoverOperation> {
    // Validate primary is NOT healthy
    if (cluster.primary && isOnline(cluster.primary)) {
      return this.recordOperation(
        createFailedOperation(
          cluster,
          'Primary is healthy. Use switchover for planned primary change.',
          reason || 'Manual failover requested'
        )
      );
    }

    // Validate target if specified
    if (targetPrimaryId) {
      const targetReplica = CandidateSelector.findReplica(cluster, targetPrimaryId);
      if (!targetReplica) {
        return this.recordOperation(
          createFailedOperation(
            cluster,
            `Target '${targetPrimaryId}' not found in cluster replicas. ` +
              `Available: ${cluster.replicas.map(r => `${r.host}:${r.port}`).join(', ')}`,
            reason || 'Manual failover requested'
          )
        );
      }
    }

    const operation = createFailoverOperation(cluster, targetPrimaryId, reason);
    return this.executeFailoverOperation(operation, cluster);
  }

  // =========================================================================
  // Recovery Management
  // =========================================================================

  /**
   * Get all pending recoveries
   */
  getPendingRecoveries(): PendingRecovery[] {
    return this.recoveryManager.getPending();
  }

  /**
   * Check if an instance is pending recovery
   */
  isPendingRecovery(instanceId: string): boolean {
    return this.recoveryManager.isPending(instanceId);
  }

  /**
   * Recover an old primary instance
   */
  async recoverInstance(instanceId: string): Promise<RecoveryResult> {
    return this.recoveryManager.recover(instanceId);
  }

  /**
   * Check all pending recoveries and recover instances that are back online
   */
  async checkAndRecoverAll(): Promise<BatchRecoveryResult> {
    return this.recoveryManager.recoverAll();
  }

  /**
   * Clear a pending recovery (manual override)
   */
  clearPendingRecovery(instanceId: string): boolean {
    return this.recoveryManager.clear(instanceId);
  }

  // =========================================================================
  // Operation History
  // =========================================================================

  /**
   * Get current operation
   */
  getCurrentOperation(): FailoverOperation | null {
    return this.currentOperation;
  }

  /**
   * Get operation history
   */
  getOperationHistory(clusterId?: string, limit: number = 100): FailoverOperation[] {
    let operations = [...this.operationHistory];
    if (clusterId) {
      operations = operations.filter(o => o.clusterId === clusterId);
    }
    return operations
      .sort((a, b) => (a.startedAt?.getTime() || 0) - (b.startedAt?.getTime() || 0))
      .slice(-limit);
  }

  /**
   * Get operation by ID
   */
  getOperation(operationId: string): FailoverOperation | undefined {
    return this.operationHistory.find(o => o.operationId === operationId);
  }

  /**
   * Cancel an in-progress operation
   */
  async cancelOperation(operationId: string): Promise<boolean> {
    if (this.currentOperation?.operationId === operationId) {
      this.currentOperation.state = FailoverState.FAILED;
      this.currentOperation.error = 'Cancelled by user';
      this.currentOperation.completedAt = new Date();
      this.operationHistory.push(this.currentOperation);
      this.currentOperation = null;
      return true;
    }
    return false;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Record an operation to history
   */
  private recordOperation(operation: FailoverOperation): FailoverOperation {
    this.operationHistory.push(operation);
    return operation;
  }

  /**
   * Execute switchover operation
   */
  private async executeSwitchoverOperation(
    operation: FailoverOperation,
    cluster: MySQLCluster
  ): Promise<FailoverOperation> {
    this.currentOperation = operation;

    try {
      const result = await this.operationRunner.execute(operation, cluster, true);
      this.operationHistory.push(result);
      return result;
    } finally {
      this.currentOperation = null;
    }
  }

  /**
   * Execute failover operation
   */
  private async executeFailoverOperation(
    operation: FailoverOperation,
    cluster: MySQLCluster
  ): Promise<FailoverOperation> {
    this.currentOperation = operation;

    try {
      const result = await this.operationRunner.execute(operation, cluster, false);

      // Queue old primary for recovery on successful failover
      if (result.state === FailoverState.COMPLETED && cluster.primary && result.newPrimaryId) {
        const pendingRecovery = RecoveryManager.createPendingRecovery(
          cluster.clusterId,
          cluster.primary.host,
          cluster.primary.port,
          result.newPrimaryId
        );
        this.recoveryManager.queueForRecovery(pendingRecovery);

        const addStep = (step: string) => {
          const timestamp = new Date().toISOString();
          result.steps.push(`[${timestamp}] ${step}`);
        };
        addStep(`Old primary ${pendingRecovery.instanceId} queued for recovery`);
      }

      this.operationHistory.push(result);
      return result;
    } finally {
      this.currentOperation = null;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let failoverExecutor: FailoverExecutor | null = null;

/**
 * Get the Failover executor instance
 */
export function getFailoverExecutor(): FailoverExecutor {
  if (!failoverExecutor) {
    failoverExecutor = new FailoverExecutor();
  }
  return failoverExecutor;
}
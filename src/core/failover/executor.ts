/**
 * ClawSQL - Failover Executor
 *
 * Executes failover operations with candidate selection and cluster reconfiguration.
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../../utils/logger.js';
import {
  MySQLCluster,
  MySQLInstance,
  FailoverOperation,
  FailoverState,
  FailureEvent,
  InstanceState,
  isOnline,
} from '../../types/index.js';
import { FailoverError } from '../../utils/exceptions.js';
import { OrchestratorClient, getOrchestratorClient } from '../discovery/topology.js';
import { ProxySQLManager, getProxySQLManager } from '../routing/proxysql-manager.js';

const logger = getLogger('failover');

/**
 * Pre/Post failover hook type
 */
type FailoverHook = (operation: FailoverOperation, cluster: MySQLCluster) => Promise<void>;

/**
 * Failover Executor
 */
export class FailoverExecutor {
  private orchestrator: OrchestratorClient;
  private proxysql: ProxySQLManager;
  private currentOperation: FailoverOperation | null = null;
  private operationHistory: FailoverOperation[] = [];
  private preFailoverHooks: FailoverHook[] = [];
  private postFailoverHooks: FailoverHook[] = [];

  static readonly MAX_FAILOVER_TIME = 30; // seconds

  constructor(orchestrator?: OrchestratorClient, proxysql?: ProxySQLManager) {
    this.orchestrator = orchestrator || getOrchestratorClient();
    this.proxysql = proxysql || getProxySQLManager();
  }

  /**
   * Register a pre-failover hook
   */
  registerPreFailoverHook(hook: FailoverHook): void {
    this.preFailoverHooks.push(hook);
  }

  /**
   * Register a post-failover hook
   */
  registerPostFailoverHook(hook: FailoverHook): void {
    this.postFailoverHooks.push(hook);
  }

  /**
   * Execute automatic failover
   */
  async executeAutomaticFailover(
    failureEvent: FailureEvent,
    cluster: MySQLCluster
  ): Promise<FailoverOperation> {
    const operation: FailoverOperation = {
      operationId: uuidv4(),
      clusterId: cluster.clusterId,
      oldPrimaryId: cluster.primary ? `${cluster.primary.host}:${cluster.primary.port}` : '',
      manual: false,
      reason: `Automatic failover due to ${failureEvent.failureType}`,
      triggeredBy: failureEvent.eventId,
      state: FailoverState.IDLE,
      steps: [],
    };

    return this.executeFailover(operation, cluster);
  }

  /**
   * Execute manual failover
   */
  async executeManualFailover(
    cluster: MySQLCluster,
    targetPrimaryId?: string,
    reason: string = ''
  ): Promise<FailoverOperation> {
    const operation: FailoverOperation = {
      operationId: uuidv4(),
      clusterId: cluster.clusterId,
      oldPrimaryId: cluster.primary ? `${cluster.primary.host}:${cluster.primary.port}` : '',
      newPrimaryId: targetPrimaryId,
      manual: true,
      reason: reason || 'Manual failover requested',
      state: FailoverState.IDLE,
      steps: [],
    };

    // If target specified, find it
    if (targetPrimaryId) {
      for (const replica of cluster.replicas) {
        if (`${replica.host}:${replica.port}` === targetPrimaryId) {
          operation.newPrimaryId = targetPrimaryId;
          break;
        }
      }
    }

    return this.executeFailover(operation, cluster);
  }

  /**
   * Select the best candidate for promotion
   */
  async selectCandidate(cluster: MySQLCluster): Promise<MySQLInstance | null> {
    if (!cluster.replicas.length) {
      return null;
    }

    // Filter healthy replicas
    const healthyReplicas = cluster.replicas.filter(
      r => isOnline(r) && r.state !== InstanceState.MAINTENANCE
    );

    if (!healthyReplicas.length) {
      return null;
    }

    // Sort by replication lag (prefer lowest)
    const sortedReplicas = [...healthyReplicas].sort((a, b) => {
      const lagA = a.replicationLag ?? Infinity;
      const lagB = b.replicationLag ?? Infinity;
      return lagA - lagB;
    });

    return sortedReplicas[0];
  }

  /**
   * Promote an instance to primary
   */
  async promoteInstance(instance: MySQLInstance, cluster: MySQLCluster): Promise<boolean> {
    try {
      const result = await this.orchestrator.requestFailover(
        cluster.primary?.host || instance.host,
        cluster.primary?.port || instance.port,
        instance.host
      );
      return result !== null;
    } catch (error) {
      logger.error({ error, instance: `${instance.host}:${instance.port}` }, 'Promotion failed');
      return false;
    }
  }

  /**
   * Reconfigure replicas to follow new primary
   */
  async reconfigureReplicas(
    newPrimary: MySQLInstance,
    replicas: MySQLInstance[]
  ): Promise<boolean> {
    try {
      for (const replica of replicas) {
        if (`${replica.host}:${replica.port}` !== `${newPrimary.host}:${newPrimary.port}`) {
          await this.orchestrator.relocateReplicas(
            replica.host,
            replica.port,
            newPrimary.host,
            newPrimary.port
          );
        }
      }
      return true;
    } catch (error) {
      logger.error({ error }, 'Reconfiguration failed');
      return false;
    }
  }

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

  /**
   * Execute the failover operation
   */
  private async executeFailover(
    operation: FailoverOperation,
    cluster: MySQLCluster
  ): Promise<FailoverOperation> {
    this.currentOperation = operation;
    operation.startedAt = new Date();
    operation.state = FailoverState.DETECTING;

    const addStep = (step: string): void => {
      const timestamp = new Date().toISOString();
      operation.steps.push(`[${timestamp}] ${step}`);
    };

    try {
      // Run pre-failover hooks
      addStep('Running pre-failover hooks');
      for (const hook of this.preFailoverHooks) {
        await hook(operation, cluster);
      }

      // Select candidate
      operation.state = FailoverState.CANDIDATE_SELECTION;
      addStep('Selecting candidate for promotion');

      if (!operation.newPrimaryId) {
        const candidate = await this.selectCandidate(cluster);
        if (candidate) {
          operation.newPrimaryId = `${candidate.host}:${candidate.port}`;
        } else {
          throw new FailoverError('No suitable candidate found for promotion');
        }
      }

      // Find the new primary instance
      const newPrimary = cluster.replicas.find(
        r => `${r.host}:${r.port}` === operation.newPrimaryId
      );
      if (!newPrimary) {
        throw new FailoverError(`Candidate ${operation.newPrimaryId} not found`);
      }

      // Promote
      operation.state = FailoverState.PROMOTING;
      addStep(`Promoting ${operation.newPrimaryId} to primary`);

      const success = await this.promoteInstance(newPrimary, cluster);
      if (!success) {
        throw new FailoverError('Promotion failed');
      }

      // Reconfigure replicas
      operation.state = FailoverState.RECONFIGURING;
      addStep('Reconfiguring replicas');

      const otherReplicas = cluster.replicas.filter(
        r => `${r.host}:${r.port}` !== operation.newPrimaryId
      );
      await this.reconfigureReplicas(newPrimary, otherReplicas);

      // Update routing
      addStep('Updating routing rules');
      await this.proxysql.syncCluster(
        { ...cluster, primary: newPrimary },
        ProxySQLManager.DEFAULT_WRITER_HOSTGROUP,
        ProxySQLManager.DEFAULT_READER_HOSTGROUP
      );

      // Success
      operation.state = FailoverState.COMPLETED;
      operation.completedAt = new Date();
      addStep('Failover completed successfully');

      logger.info({ operationId: operation.operationId, clusterId: cluster.clusterId }, 'Failover completed');
    } catch (error) {
      operation.state = FailoverState.FAILED;
      operation.error = error instanceof Error ? error.message : String(error);
      operation.completedAt = new Date();
      addStep(`Failover failed: ${operation.error}`);

      logger.error({ error, operationId: operation.operationId }, 'Failover failed');
    } finally {
      // Run post-failover hooks
      for (const hook of this.postFailoverHooks) {
        try {
          await hook(operation, cluster);
        } catch (error) {
          logger.error({ error }, 'Post-failover hook error');
        }
      }

      this.operationHistory.push(operation);
      this.currentOperation = null;
    }

    return operation;
  }
}

// Singleton instance
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
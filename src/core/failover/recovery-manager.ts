/**
 * ClawSQL - Recovery Manager
 *
 * Manages the recovery of instances after failover.
 * Tracks instances that need recovery and handles the recovery process.
 */

import { getLogger } from '../../utils/logger.js';
import { InstanceState } from '../../types/index.js';
import { OrchestratorClient } from '../discovery/topology.js';
import { getMySQLClient } from '../../utils/mysql-client.js';
import { PendingRecovery, RecoveryResult, BatchRecoveryResult } from './types.js';

const logger = getLogger('failover');

/**
 * Recovery Manager
 * Handles tracking and recovery of instances after failover.
 */
export class RecoveryManager {
  private pendingRecoveries: Map<string, PendingRecovery> = new Map();

  constructor(private orchestrator: OrchestratorClient) {}

  /**
   * Queue an instance for recovery
   */
  queueForRecovery(recovery: PendingRecovery): void {
    this.pendingRecoveries.set(recovery.instanceId, recovery);
    logger.info(
      { instanceId: recovery.instanceId, newPrimaryId: recovery.newPrimaryId },
      'Instance queued for recovery'
    );
  }

  /**
   * Get all pending recoveries
   */
  getPending(): PendingRecovery[] {
    return Array.from(this.pendingRecoveries.values());
  }

  /**
   * Check if an instance is pending recovery
   */
  isPending(instanceId: string): boolean {
    return this.pendingRecoveries.has(instanceId);
  }

  /**
   * Clear a pending recovery
   */
  clear(instanceId: string): boolean {
    return this.pendingRecoveries.delete(instanceId);
  }

  /**
   * Recover a specific instance
   */
  async recover(instanceId: string): Promise<RecoveryResult> {
    const pending = this.pendingRecoveries.get(instanceId);
    if (!pending) {
      return { success: false, message: `Instance ${instanceId} is not pending recovery` };
    }

    try {
      logger.info(
        { instanceId, newPrimaryId: pending.newPrimaryId },
        'Attempting to recover instance'
      );

      // Verify instance is online
      const instance = await this.orchestrator.getInstance(pending.host, pending.port);
      if (!instance) {
        return { success: false, message: `Instance ${instanceId} not found in Orchestrator` };
      }

      if (instance.state !== InstanceState.ONLINE) {
        return {
          success: false,
          message: `Instance ${instanceId} is not online (state: ${instance.state})`
        };
      }

      // Start replication
      const mysqlClient = getMySQLClient();
      const started = await mysqlClient.startReplication(pending.host, pending.port);
      if (!started) {
        return { success: false, message: `Failed to start replication on ${instanceId}` };
      }

      // Verify replication is running
      await this.delay(2000);
      const status = await mysqlClient.getReplicationStatus(pending.host, pending.port);

      if (!status || !status.ioRunning || !status.sqlRunning) {
        const ioStatus = status?.ioRunning ? 'running' : 'stopped';
        const sqlStatus = status?.sqlRunning ? 'running' : 'stopped';
        return {
          success: false,
          message: `Replication not fully running on ${instanceId}: IO=${ioStatus}, SQL=${sqlStatus}`
        };
      }

      // Mark as recovered
      pending.recoveredAt = new Date();
      this.pendingRecoveries.delete(instanceId);

      logger.info({ instanceId, newPrimaryId: pending.newPrimaryId }, 'Instance recovered successfully');
      return {
        success: true,
        message: `Instance ${instanceId} recovered and replicating from ${pending.newPrimaryId}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, instanceId }, 'Recovery failed');
      return { success: false, message: `Recovery failed: ${message}` };
    }
  }

  /**
   * Recover all pending instances
   */
  async recoverAll(): Promise<BatchRecoveryResult> {
    const result: BatchRecoveryResult = {
      recovered: [],
      stillPending: [],
      errors: []
    };

    for (const [instanceId] of this.pendingRecoveries) {
      const recoveryResult = await this.recover(instanceId);

      if (recoveryResult.success) {
        result.recovered.push(instanceId);
      } else if (
        recoveryResult.message.includes('not online') ||
        recoveryResult.message.includes('not found')
      ) {
        result.stillPending.push(instanceId);
      } else {
        result.errors.push(`${instanceId}: ${recoveryResult.message}`);
        result.stillPending.push(instanceId);
      }
    }

    return result;
  }

  /**
   * Create a pending recovery record
   */
  static createPendingRecovery(
    clusterId: string,
    host: string,
    port: number,
    newPrimaryId: string
  ): PendingRecovery {
    return {
      clusterId,
      instanceId: `${host}:${port}`,
      host,
      port,
      newPrimaryId,
      failedAt: new Date()
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
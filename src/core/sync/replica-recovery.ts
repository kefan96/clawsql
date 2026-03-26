/**
 * ClawSQL - Replica Recovery
 *
 * Handles automatic recovery of replica instances after failover.
 * - Starts replication on demoted primary
 * - Ends maintenance mode when appropriate
 */

import { getLogger } from '../../utils/logger.js';
import { MySQLInstance, InstanceState } from '../../types/index.js';
import { OrchestratorClient } from '../discovery/topology.js';
import { getMySQLClient } from '../../utils/mysql-client.js';

const logger = getLogger('sync');

/**
 * Result of a replica recovery attempt
 */
export interface RecoveryResult {
  recovered: boolean;
  reason: string;
}

/**
 * Attempt to recover a replica instance
 *
 * This is called after failover/switchover when a replica is in maintenance
 * or unhealthy state. It tries to:
 * 1. Start replication on the replica
 * 2. End maintenance mode if the replica is healthy
 *
 * @param replica The replica instance to recover
 * @param newPrimary The new primary to follow
 * @param orchestrator Orchestrator client for API calls
 * @returns Recovery result indicating success or failure with reason
 */
export async function recoverReplica(
  replica: MySQLInstance,
  newPrimary: MySQLInstance,
  orchestrator: OrchestratorClient
): Promise<RecoveryResult> {
  const instanceId = `${replica.host}:${replica.port}`;

  // Skip if replica is offline - can't recover
  if (replica.state === InstanceState.OFFLINE) {
    return {
      recovered: false,
      reason: `Instance ${instanceId} is offline, cannot recover`,
    };
  }

  // Check if replica is in maintenance state
  const inMaintenance = replica.state === InstanceState.MAINTENANCE;

  logger.info(
    { instanceId, state: replica.state, inMaintenance },
    'Attempting replica recovery'
  );

  try {
    // Step 1: Check if MySQL is actually reachable
    const mysqlClient = getMySQLClient();
    const replicationStatus = await mysqlClient.getReplicationStatus(replica.host, replica.port);

    // If we can get replication status, MySQL is reachable
    const isReachable = replicationStatus !== null;

    if (!isReachable) {
      // MySQL might be reachable but not configured as replica
      // Try to check connectivity differently
      logger.debug({ instanceId }, 'Could not get replication status, checking connectivity');
    }

    // Step 2: Start replication via Orchestrator
    logger.info({ instanceId }, 'Starting replication via Orchestrator');
    const started = await orchestrator.startSlave(replica.host, replica.port);

    if (!started) {
      return {
        recovered: false,
        reason: `Failed to start replication on ${instanceId} via Orchestrator`,
      };
    }

    // Wait briefly for replication to start
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      timer.unref();
    });

    // Step 3: Verify replication is running
    const status = await mysqlClient.getReplicationStatus(replica.host, replica.port);

    if (!status) {
      return {
        recovered: false,
        reason: `Could not verify replication status on ${instanceId}`,
      };
    }

    if (!status.ioRunning || !status.sqlRunning) {
      const ioStatus = status.ioRunning ? 'running' : 'stopped';
      const sqlStatus = status.sqlRunning ? 'running' : 'stopped';
      return {
        recovered: false,
        reason: `Replication not fully running on ${instanceId}: IO=${ioStatus}, SQL=${sqlStatus}`,
      };
    }

    // Step 4: End maintenance mode if needed
    if (inMaintenance) {
      logger.info({ instanceId }, 'Ending maintenance mode via Orchestrator');
      const endedMaintenance = await orchestrator.endMaintenance(replica.host, replica.port);

      if (!endedMaintenance) {
        logger.warn(
          { instanceId },
          'Replication started but failed to end maintenance mode'
        );
        // Still consider recovery successful if replication is running
      }
    }

    logger.info(
      { instanceId, newPrimary: `${newPrimary.host}:${newPrimary.port}` },
      'Replica recovered successfully'
    );

    return {
      recovered: true,
      reason: `Instance ${instanceId} recovered: replication running, following ${newPrimary.host}:${newPrimary.port}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error, instanceId }, 'Replica recovery failed');
    return {
      recovered: false,
      reason: `Recovery failed for ${instanceId}: ${message}`,
    };
  }
}

/**
 * Recover multiple replicas in parallel
 *
 * @param replicas List of replicas to attempt recovery
 * @param newPrimary The new primary to follow
 * @param orchestrator Orchestrator client
 * @returns Map of instance ID to recovery result
 */
export async function recoverReplicas(
  replicas: MySQLInstance[],
  newPrimary: MySQLInstance,
  orchestrator: OrchestratorClient
): Promise<Map<string, RecoveryResult>> {
  const results = new Map<string, RecoveryResult>();

  // Filter replicas that need recovery (maintenance or offline state)
  const needsRecovery = replicas.filter(
    r => r.state === InstanceState.MAINTENANCE || r.state === InstanceState.OFFLINE
  );

  if (needsRecovery.length === 0) {
    logger.debug('No replicas need recovery');
    return results;
  }

  logger.info(
    { count: needsRecovery.length, instances: needsRecovery.map(r => `${r.host}:${r.port}`) },
    'Attempting to recover replicas'
  );

  // Attempt recovery in parallel
  const recoveryPromises = needsRecovery.map(async (replica) => {
    const result = await recoverReplica(replica, newPrimary, orchestrator);
    return { instanceId: `${replica.host}:${replica.port}`, result };
  });

  const recoveryResults = await Promise.all(recoveryPromises);

  for (const { instanceId, result } of recoveryResults) {
    results.set(instanceId, result);
  }

  return results;
}
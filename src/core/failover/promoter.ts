/**
 * ClawSQL - Instance Promoter
 *
 * Handles the promotion of instances to primary role.
 * Coordinates with Orchestrator for the actual promotion.
 */

import { getLogger } from '../../utils/logger.js';
import { MySQLCluster, MySQLInstance } from '../../types/index.js';
import { OrchestratorClient } from '../discovery/topology.js';
import { getMySQLClient } from '../../utils/mysql-client.js';
import { PromotionResult } from './types.js';

const logger = getLogger('failover');

/**
 * Orchestrator response success indicators
 */
const SUCCESS_INDICATORS = ['Code', 'IsSuccessful', 'Success'] as const;

/**
 * Check if Orchestrator response indicates success
 */
function isSuccessfulResponse(result: Record<string, unknown> | null): boolean {
  if (!result) return false;
  return SUCCESS_INDICATORS.some(key =>
    result[key] === 'OK' || result[key] === true
  );
}

/**
 * Extract error message from Orchestrator response
 */
function extractError(result: Record<string, unknown> | null): string {
  if (!result) return 'Unknown error';
  return (result.Message as string) || (result.Error as string) || JSON.stringify(result);
}

/**
 * Instance Promoter
 * Handles promotion logic and post-promotion tasks.
 */
export class InstancePromoter {
  constructor(private orchestrator: OrchestratorClient) {}

  /**
   * Promote an instance to primary
   * @param instance - The instance to promote
   * @param cluster - The cluster context
   * @param isSwitchover - True for switchover (primary healthy), false for failover
   */
  async promote(
    instance: MySQLInstance,
    cluster: MySQLCluster,
    isSwitchover: boolean
  ): Promise<PromotionResult> {
    const clusterAlias = cluster.clusterId;
    const oldPrimary = cluster.primary;

    try {
      const result = await this.executePromotion(instance, clusterAlias, isSwitchover);

      if (!isSuccessfulResponse(result)) {
        const errorMsg = extractError(result);
        logger.error({ cluster: clusterAlias, result }, 'Promotion returned failure');
        return { success: false, error: errorMsg };
      }

      // For switchover, start replication on the old primary
      if (isSwitchover && oldPrimary) {
        await this.startReplicationOnDemotedPrimary(oldPrimary);
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error, instance: `${instance.host}:${instance.port}` }, 'Promotion failed');
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Execute the promotion via Orchestrator
   */
  private async executePromotion(
    instance: MySQLInstance,
    clusterAlias: string,
    isSwitchover: boolean
  ): Promise<Record<string, unknown> | null> {
    if (isSwitchover) {
      logger.info(
        { cluster: clusterAlias, target: `${instance.host}:${instance.port}` },
        'Performing graceful master takeover'
      );
      return this.orchestrator.gracefulMasterTakeover(
        clusterAlias,
        instance.host,
        instance.port
      );
    } else {
      logger.info({ cluster: clusterAlias }, 'Performing force master failover');
      return this.orchestrator.forceMasterFailover(clusterAlias);
    }
  }

  /**
   * Start replication on the demoted primary
   */
  private async startReplicationOnDemotedPrimary(
    oldPrimary: MySQLInstance
  ): Promise<void> {
    const instanceId = `${oldPrimary.host}:${oldPrimary.port}`;
    logger.info({ oldPrimary: instanceId }, 'Starting replication on demoted primary');

    const mysqlClient = getMySQLClient();
    const started = await mysqlClient.startReplication(oldPrimary.host, oldPrimary.port);

    if (!started) {
      logger.warn(
        { oldPrimary: instanceId },
        'Failed to start replication on demoted primary - manual intervention may be needed'
      );
    }
  }
}
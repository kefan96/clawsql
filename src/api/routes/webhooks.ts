/**
 * ClawSQL - Webhook Routes
 *
 * Handles webhook callbacks from Orchestrator.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getLogger } from '../../utils/logger.js';
import { getOrchestratorClient } from '../../core/discovery/topology.js';
import { getSyncCoordinator } from '../../core/sync/sync-coordinator.js';
import { recoverReplicas } from '../../core/sync/replica-recovery.js';
import {
  OrchestratorFailoverPayload,
  WebhookResult,
} from '../../core/sync/types.js';

const logger = getLogger('webhook');

/**
 * Orchestrator failover payload schema
 */
const OrchestratorFailoverPayloadSchema = z.object({
  cluster: z.string(),
  master: z.string(),
  successor: z.string(),
  successorHost: z.string().optional(),
  successorPort: z.number().optional(),
  isSuccessful: z.boolean(),
  failoverType: z.enum(['master', 'intermediate-master']),
  reason: z.string().optional(),
  timestamp: z.string().optional(),
});

/**
 * Webhook routes
 */
const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Orchestrator failover webhook
   * Called by Orchestrator after a failover event
   */
  fastify.post('/orchestrator/failover', async (request, _reply) => {
    // Parse and validate payload manually
    const parseResult = OrchestratorFailoverPayloadSchema.safeParse(request.body);

    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.errors }, 'Invalid webhook payload');
      return {
        received: false,
        processed: false,
        message: `Invalid payload: ${parseResult.error.message}`,
      };
    }

    const payload = parseResult.data as OrchestratorFailoverPayload;

    logger.info(
      {
        cluster: payload.cluster,
        master: payload.master,
        successor: payload.successor,
        isSuccessful: payload.isSuccessful,
        failoverType: payload.failoverType,
      },
      'Received Orchestrator failover webhook'
    );

    const result = await handleFailoverWebhook(payload);
    return result;
  });

  /**
   * Health check for webhook endpoint
   */
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  });
};

/**
 * Handle Orchestrator failover webhook
 */
async function handleFailoverWebhook(
  payload: OrchestratorFailoverPayload
): Promise<WebhookResult> {
  // Check if failover was successful
  if (!payload.isSuccessful) {
    logger.warn(
      { cluster: payload.cluster },
      'Failover was not successful, skipping sync'
    );
    return {
      received: true,
      processed: false,
      message: 'Failover was not successful, sync skipped',
    };
  }

  try {
    // Get the current topology from Orchestrator
    const orchestrator = getOrchestratorClient();

    // Wait for topology to stabilize after failover
    // Orchestrator may not have discovered all replicas immediately after switchover
    const maxRetries = 10;
    const retryDelayMs = 2000;
    let topology = null;
    let lastReplicaCount = -1;
    let stableCount = 0;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      // Try to get topology - first by successor (new primary), then enumerate all clusters
      if (payload.successor) {
        try {
          topology = await orchestrator.getTopology(payload.successor);
        } catch (err) {
          logger.debug({ successor: payload.successor, error: err }, 'Successor lookup failed');
        }
      }

      // If topology incomplete, try enumerating all clusters
      if (!topology || topology.replicas.length === 0) {
        try {
          const clusters = await orchestrator.getClusters();
          for (const clusterName of clusters) {
            try {
              const clusterTopology = await orchestrator.getTopology(clusterName);
              if (clusterTopology?.primary) {
                const primaryId = `${clusterTopology.primary.host}:${clusterTopology.primary.port}`;
                if (primaryId === payload.successor) {
                  // Only use this if it has more replicas than what we have
                  if (!topology || clusterTopology.replicas.length > topology.replicas.length) {
                    topology = clusterTopology;
                    logger.debug(
                      { foundCluster: clusterName, primary: primaryId, replicas: clusterTopology.replicas.length },
                      'Found cluster topology via enumeration'
                    );
                  }
                }
              }
            } catch (err) {
              logger.debug({ clusterName, error: err }, 'Failed to get topology for cluster');
            }
          }
        } catch (err) {
          logger.error({ error: err }, 'Failed to get clusters from Orchestrator');
        }
      }

      // If we have a topology with replicas, check if it's stable
      if (topology && topology.replicas.length > 0) {
        // Check for replicas in maintenance/downtime mode - wait for them to recover
        const maintenanceReplicas = topology.replicas.filter(
          r => r.state === 'maintenance' || r.state === 'offline'
        );
        if (maintenanceReplicas.length > 0) {
          logger.debug(
            { cluster: topology.clusterId, maintenanceReplicas: maintenanceReplicas.map(r => r.host) },
            'Some replicas are in maintenance/downtime mode, waiting for recovery'
          );
          // Don't reset stability counter, but continue waiting
        } else if (topology.replicas.length === lastReplicaCount) {
          stableCount++;
          if (stableCount >= 2) {
            // Topology is stable - proceed with sync
            break;
          }
          logger.debug(
            { cluster: topology.clusterId, replicas: topology.replicas.length, stableCount },
            'Topology stabilizing, waiting for confirmation'
          );
        } else {
          // Replica count changed, reset stability counter
          stableCount = 0;
          lastReplicaCount = topology.replicas.length;
        }
      }

      // Wait before next retry
      if (retryCount < maxRetries - 1) {
        logger.info(
          { cluster: payload.cluster, successor: payload.successor, attempt: retryCount + 1, replicas: topology?.replicas.length || 0 },
          'Waiting for topology to stabilize (replicas not yet discovered)'
        );
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!topology) {
      logger.error(
        { cluster: payload.cluster, successor: payload.successor },
        'Could not find cluster topology after retries'
      );
      return {
        received: true,
        processed: false,
        message: `Cluster '${payload.cluster}' not found in Orchestrator`,
      };
    }

    logger.info(
      { cluster: topology.clusterId, primary: topology.primary?.host, replicas: topology.replicas.length },
      'Topology retrieved for webhook sync'
    );

    // Verify the successor matches the new primary
    if (topology.primary) {
      const newPrimaryId = `${topology.primary.host}:${topology.primary.port}`;
      if (payload.successor !== newPrimaryId) {
        logger.warn(
          {
            expected: newPrimaryId,
            received: payload.successor,
            cluster: payload.cluster,
          },
          'Successor mismatch in webhook payload'
        );
        // Continue anyway - trust Orchestrator topology
      }
    }

    // Attempt to recover replicas in maintenance/offline state
    // This is critical after failover/switchover when the old primary is demoted
    if (topology.primary && topology.replicas.length > 0) {
      const recoveryResults = await recoverReplicas(
        topology.replicas,
        topology.primary,
        orchestrator
      );

      // Log recovery results
      for (const [instanceId, result] of recoveryResults) {
        if (result.recovered) {
          logger.info({ instanceId, reason: result.reason }, 'Replica recovered during webhook');
        } else {
          logger.warn({ instanceId, reason: result.reason }, 'Replica recovery deferred');
        }
      }

      // Re-fetch topology after recovery attempts to get updated states
      if (recoveryResults.size > 0) {
        logger.info({ cluster: topology.clusterId }, 'Re-fetching topology after recovery attempts');
        try {
          const updatedTopology = await orchestrator.getTopology(topology.clusterId);
          if (updatedTopology) {
            topology = updatedTopology;
          }
        } catch (err) {
          logger.warn({ error: err }, 'Failed to re-fetch topology, using cached version');
        }
      }
    }

    // Sync ProxySQL
    const syncCoordinator = getSyncCoordinator();
    const syncResult = await syncCoordinator.sync(topology, 'webhook');

    logger.info(
      {
        cluster: payload.cluster,
        skipped: syncResult.skipped,
        reason: syncResult.reason,
      },
      'ProxySQL sync completed from webhook'
    );

    return {
      received: true,
      processed: !syncResult.skipped,
      message: syncResult.skipped
        ? `Sync skipped: ${syncResult.reason}`
        : `ProxySQL synced with ${syncResult.serversSynced} servers`,
      syncResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error, cluster: payload.cluster }, 'Webhook handler error');

    return {
      received: true,
      processed: false,
      message: `Error processing webhook: ${message}`,
    };
  }
}

export default webhookRoutes;
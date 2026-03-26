/**
 * ClawSQL - Topology Watcher
 *
 * Polls Orchestrator for topology changes and triggers ProxySQL sync.
 * Acts as a fallback mechanism when webhooks are not received.
 * Also attempts to recover replicas stuck in maintenance state.
 */

import { getLogger } from '../../utils/logger.js';
import { MySQLCluster, InstanceState } from '../../types/index.js';
import { getOrchestratorClient } from '../discovery/topology.js';
import { getSyncCoordinator } from './sync-coordinator.js';
import { recoverReplica } from './replica-recovery.js';
import { getSettings } from '../../config/settings.js';

const logger = getLogger('sync');

/**
 * Topology Watcher
 * Periodically checks for topology changes and syncs ProxySQL.
 */
export class TopologyWatcher {
  private interval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private lastTopologyHashes: Map<string, string> = new Map();
  private pollIntervalMs: number;
  private enabled: boolean;

  constructor(options?: { pollIntervalMs?: number; enabled?: boolean }) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 30000;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * Start watching for topology changes
   */
  async start(): Promise<void> {
    if (this.running || !this.enabled) {
      logger.debug(
        { running: this.running, enabled: this.enabled },
        'Topology watcher not started'
      );
      return;
    }

    this.running = true;
    logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      'Topology watcher started'
    );

    // Do initial poll
    await this.poll();

    // Schedule periodic polls
    this.interval = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
    // Don't keep the process alive just for this timer
    this.interval.unref();
  }

  /**
   * Stop watching for topology changes
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    logger.info('Topology watcher stopped');
  }

  /**
   * Check if the watcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Perform a single poll of all clusters
   */
  private async poll(): Promise<void> {
    logger.debug('Polling for topology changes');

    try {
      const orchestrator = getOrchestratorClient();
      const syncCoordinator = getSyncCoordinator();

      // Get all clusters
      const clusters = await orchestrator.getClusters();

      for (const clusterName of clusters) {
        try {
          const topology = await orchestrator.getTopology(clusterName);
          if (!topology) {
            logger.debug({ clusterName }, 'Could not get topology for cluster');
            continue;
          }

          const hash = this.computeTopologyHash(topology);
          const lastHash = this.lastTopologyHashes.get(topology.clusterId);

          // Check if topology changed
          if (lastHash !== hash) {
            logger.info(
              { clusterId: topology.clusterId, oldHash: lastHash, newHash: hash },
              'Topology change detected'
            );

            // Attempt to recover replicas in maintenance state (non-blocking)
            // This handles cases where webhook recovery failed or was skipped
            if (topology.primary) {
              this.attemptReplicaRecovery(topology, orchestrator);
            }

            // Sync ProxySQL
            await syncCoordinator.sync(topology, 'poll');

            // Update hash
            this.lastTopologyHashes.set(topology.clusterId, hash);
          } else {
            // Even if topology hasn't changed, check for replicas needing recovery
            // This handles cases where recovery was deferred earlier
            if (topology.primary && this.hasReplicasNeedingRecovery(topology)) {
              logger.info(
                { clusterId: topology.clusterId },
                'Checking for replicas needing recovery'
              );
              this.attemptReplicaRecovery(topology, orchestrator);
            }

            logger.debug(
              { clusterId: topology.clusterId },
              'No topology change detected'
            );
          }
        } catch (error) {
          logger.error(
            { error, clusterName },
            'Error polling cluster topology'
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error during topology poll');
    }
  }

  /**
   * Compute a hash of the cluster topology
   */
  private computeTopologyHash(cluster: MySQLCluster): string {
    const parts: string[] = [
      cluster.clusterId,
      cluster.primary
        ? `${cluster.primary.host}:${cluster.primary.port}:${cluster.primary.state}`
        : 'null',
      ...cluster.replicas
        .map(r => `${r.host}:${r.port}:${r.state}:${r.replicationLag ?? 0}`)
        .sort(),
    ];
    return parts.join('|');
  }

  /**
   * Force a poll cycle
   */
  async forcePoll(): Promise<void> {
    await this.poll();
  }

  /**
   * Clear cached topology hashes
   */
  clearCache(): void {
    this.lastTopologyHashes.clear();
    logger.debug('Topology cache cleared');
  }

  /**
   * Get the current poll interval
   */
  getPollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Update the poll interval
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;
    if (this.running && this.interval) {
      clearInterval(this.interval);
      this.interval = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
      this.interval.unref();
      logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Poll interval updated');
    }
  }

  /**
   * Check if any replicas need recovery (maintenance or offline state)
   */
  private hasReplicasNeedingRecovery(cluster: MySQLCluster): boolean {
    return cluster.replicas.some(
      r => r.state === InstanceState.MAINTENANCE || r.state === InstanceState.OFFLINE
    );
  }

  /**
   * Attempt to recover replicas in maintenance state (non-blocking)
   * If recovery succeeds, invalidates cache to trigger re-sync on next poll
   */
  private attemptReplicaRecovery(
    cluster: MySQLCluster,
    orchestrator: ReturnType<typeof getOrchestratorClient>
  ): void {
    if (!cluster.primary) return;

    const replicasNeedingRecovery = cluster.replicas.filter(
      r => r.state === InstanceState.MAINTENANCE || r.state === InstanceState.OFFLINE
    );

    if (replicasNeedingRecovery.length === 0) return;

    // Attempt recovery in background (non-blocking)
    for (const replica of replicasNeedingRecovery) {
      recoverReplica(replica, cluster.primary, orchestrator)
        .then(result => {
          if (result.recovered) {
            logger.info(
              { instanceId: `${replica.host}:${replica.port}` },
              'Replica auto-recovered during poll'
            );
            // Invalidate cache to force re-sync on next poll
            this.lastTopologyHashes.delete(cluster.clusterId);
          }
        })
        .catch(error => {
          logger.debug(
            { error, instanceId: `${replica.host}:${replica.port}` },
            'Recovery attempt failed (will retry)'
          );
        });
    }
  }
}

// Singleton instance
let topologyWatcher: TopologyWatcher | null = null;

/**
 * Get the topology watcher instance
 */
export function getTopologyWatcher(): TopologyWatcher {
  if (!topologyWatcher) {
    const settings = getSettings();
    topologyWatcher = new TopologyWatcher({
      pollIntervalMs: settings.sync?.pollIntervalMs ?? 30000,
      enabled: settings.sync?.enabled ?? true,
    });
  }
  return topologyWatcher;
}

/**
 * Reset the topology watcher (for testing)
 */
export function resetTopologyWatcher(): void {
  if (topologyWatcher) {
    topologyWatcher.stop();
  }
  topologyWatcher = null;
}
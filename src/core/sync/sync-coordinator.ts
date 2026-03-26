/**
 * ClawSQL - Sync Coordinator
 *
 * Central coordinator for ProxySQL synchronization.
 * Handles deduplication, rate limiting, and idempotent operations.
 */

import { getLogger } from '../../utils/logger.js';
import { MySQLCluster } from '../../types/index.js';
import { getProxySQLManager } from '../routing/proxysql-manager.js';
import { SyncResult, SyncStats } from './types.js';
import { getSettings } from '../../config/settings.js';

const logger = getLogger('sync');

/**
 * Sync Coordinator
 * Manages synchronization between Orchestrator topology and ProxySQL routing.
 */
export class SyncCoordinator {
  private lastSyncTime: Map<string, number> = new Map();
  private lastTopologyHash: Map<string, string> = new Map();
  private locks: Map<string, Promise<SyncResult>> = new Map();
  private pendingDebounces: Map<string, NodeJS.Timeout> = new Map();
  private stats: SyncStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    skippedSyncs: 0,
  };

  private readonly cooldownMs: number;
  private readonly debounceMs: number;
  private readonly maxRetries: number;
  private readonly enabled: boolean;
  private readonly writerHostgroup: number;
  private readonly readerHostgroup: number;

  constructor(options?: {
    cooldownMs?: number;
    debounceMs?: number;
    maxRetries?: number;
    enabled?: boolean;
    writerHostgroup?: number;
    readerHostgroup?: number;
  }) {
    this.cooldownMs = options?.cooldownMs ?? 5000;
    this.debounceMs = options?.debounceMs ?? 1000;
    this.maxRetries = options?.maxRetries ?? 2;
    this.enabled = options?.enabled ?? true;
    this.writerHostgroup = options?.writerHostgroup ?? 10;
    this.readerHostgroup = options?.readerHostgroup ?? 20;
  }

  /**
   * Sync ProxySQL with the given cluster topology
   * Uses lock and debounce mechanisms to prevent concurrent syncs
   */
  async sync(
    cluster: MySQLCluster,
    source: 'webhook' | 'poll' | 'manual' = 'manual',
    force: boolean = false
  ): Promise<SyncResult> {
    // Input validation
    const validation = this.validateCluster(cluster);
    if (!validation.valid) {
      logger.warn({ error: validation.error }, 'Sync rejected - invalid input');
      return { skipped: true, reason: 'invalid_input', error: validation.error };
    }

    const clusterId = cluster.clusterId;

    // Clear any pending debounce timer
    const pendingTimer = this.pendingDebounces.get(clusterId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingDebounces.delete(clusterId);
    }

    // If sync is already in progress, return that promise (lock mechanism)
    const existingLock = this.locks.get(clusterId);
    if (existingLock) {
      logger.debug({ clusterId, source }, 'Returning existing sync promise');
      return existingLock;
    }

    // Debounce: wait briefly before executing
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingDebounces.delete(clusterId);
        void this.executeSync(cluster, source, force).then(resolve);
      }, force ? 0 : this.debounceMs); // Skip debounce if forced

      // Don't keep the process alive just for this timer
      timer.unref();

      this.pendingDebounces.set(clusterId, timer);
    });
  }

  /**
   * Validate cluster input
   */
  private validateCluster(cluster: MySQLCluster): { valid: boolean; error?: string } {
    if (!cluster) {
      return { valid: false, error: 'Cluster is null or undefined' };
    }

    if (!cluster.clusterId) {
      return { valid: false, error: 'Missing cluster ID' };
    }

    // If no primary and no replicas, nothing to sync
    if (!cluster.primary && cluster.replicas.length === 0) {
      return { valid: false, error: 'Cluster has no instances' };
    }

    return { valid: true };
  }

  /**
   * Execute the actual sync with lock protection
   */
  private async executeSync(
    cluster: MySQLCluster,
    source: 'webhook' | 'poll' | 'manual',
    force: boolean
  ): Promise<SyncResult> {
    const clusterId = cluster.clusterId;

    if (!this.enabled) {
      logger.debug({ clusterId }, 'Sync is disabled');
      return { skipped: true, reason: 'disabled', clusterId, source };
    }

    // Create the sync promise and acquire lock
    const syncPromise = this.doSync(cluster, source, force);
    this.locks.set(clusterId, syncPromise);

    try {
      return await syncPromise;
    } finally {
      this.locks.delete(clusterId);
    }
  }

  /**
   * Perform the actual sync operation
   */
  private async doSync(
    cluster: MySQLCluster,
    source: 'webhook' | 'poll' | 'manual',
    force: boolean
  ): Promise<SyncResult> {
    const clusterId = cluster.clusterId;
    const now = Date.now();
    const lastSync = this.lastSyncTime.get(clusterId) || 0;

    // Check cooldown (unless forced)
    if (!force && now - lastSync < this.cooldownMs) {
      logger.debug(
        { clusterId, source, timeSinceLastSync: now - lastSync },
        'Sync skipped due to cooldown'
      );
      this.stats.skippedSyncs++;
      return { skipped: true, reason: 'cooldown', clusterId, source };
    }

    // Check for topology changes (unless forced)
    const topologyHash = this.computeTopologyHash(cluster);
    if (!force && this.lastTopologyHash.get(clusterId) === topologyHash) {
      logger.debug({ clusterId, source }, 'Sync skipped - no topology change');
      this.stats.skippedSyncs++;
      return { skipped: true, reason: 'no_change', clusterId, source };
    }

    // Perform the sync with retry
    logger.info({ clusterId, source }, 'Syncing ProxySQL with cluster topology');
    this.stats.totalSyncs++;

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const proxysql = getProxySQLManager();
        const result = await proxysql.syncCluster(
          cluster,
          this.writerHostgroup,
          this.readerHostgroup
        );

        if (result.success) {
          // Only update state on success
          this.lastSyncTime.set(clusterId, Date.now());
          this.lastTopologyHash.set(clusterId, topologyHash);
          this.stats.successfulSyncs++;
          this.stats.lastSyncAt = new Date();
          this.stats.lastSyncCluster = clusterId;

          logger.info(
            { clusterId, source, serversSynced: result.serversAdded },
            'ProxySQL sync completed successfully'
          );

          return {
            skipped: false,
            clusterId,
            source,
            serversSynced: result.serversAdded,
          };
        } else {
          lastError = result.errors.join(', ');
          logger.warn(
            { clusterId, attempt, errors: result.errors },
            'Sync attempt failed'
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.error(
          { clusterId, attempt, error: lastError },
          'Sync attempt threw an error'
        );
      }
    }

    // All retries exhausted
    this.stats.failedSyncs++;
    logger.error(
      { clusterId, source, attempts: this.maxRetries, error: lastError },
      'All sync attempts failed'
    );

    return {
      skipped: false,
      reason: 'failed',
      clusterId,
      source,
      error: lastError || 'Unknown error',
    };
  }

  /**
   * Compute a hash of the cluster topology for change detection
   */
  private computeTopologyHash(cluster: MySQLCluster): string {
    const parts: string[] = [
      cluster.clusterId,
      cluster.primary ? `${cluster.primary.host}:${cluster.primary.port}:${cluster.primary.state}` : 'null',
      ...cluster.replicas
        .map(r => `${r.host}:${r.port}:${r.state}`)
        .sort(),
    ];
    return parts.join('|');
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Reset cooldown for a specific cluster
   */
  resetCooldown(clusterId: string): void {
    this.lastSyncTime.delete(clusterId);
    logger.debug({ clusterId }, 'Cooldown reset for cluster');
  }

  /**
   * Clear all cached topology hashes
   */
  clearCache(): void {
    this.lastTopologyHash.clear();
    this.lastSyncTime.clear();
    logger.debug('Sync coordinator cache cleared');
  }

  /**
   * Get the last sync time for a cluster
   */
  getLastSyncTime(clusterId: string): Date | null {
    const timestamp = this.lastSyncTime.get(clusterId);
    return timestamp ? new Date(timestamp) : null;
  }

  /**
   * Check if a cluster is within cooldown period
   */
  isInCooldown(clusterId: string): boolean {
    const lastSync = this.lastSyncTime.get(clusterId);
    if (!lastSync) return false;
    return Date.now() - lastSync < this.cooldownMs;
  }
}

// Singleton instance
let syncCoordinator: SyncCoordinator | null = null;

/**
 * Get the sync coordinator instance
 */
export function getSyncCoordinator(): SyncCoordinator {
  if (!syncCoordinator) {
    const settings = getSettings();
    syncCoordinator = new SyncCoordinator({
      cooldownMs: settings.sync?.syncCooldownMs ?? 5000,
      debounceMs: settings.sync?.debounceMs ?? 1000,
      maxRetries: settings.sync?.maxRetries ?? 2,
      enabled: settings.sync?.enabled ?? true,
    });
  }
  return syncCoordinator;
}

/**
 * Reset the sync coordinator (for testing)
 */
export function resetSyncCoordinator(): void {
  syncCoordinator = null;
}
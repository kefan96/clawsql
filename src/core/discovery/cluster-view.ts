/**
 * ClawSQL - Cluster View Service
 *
 * Merges Orchestrator topology with ProxySQL routing/connection data
 * to provide a unified view of cluster status.
 */

import { getLogger } from '../../utils/logger.js';
import {
  MySQLInstance,
  MergedClusterView,
  MergedInstanceInfo,
  InstanceState,
  HealthStatus,
  SyncWarning,
} from '../../types/index.js';
import { OrchestratorClient } from './topology.js';
import {
  ProxySQLManager,
  ProxySQLServerStats,
  ProxySQLReplicationHostgroup,
} from '../routing/proxysql-manager.js';

const logger = getLogger('cluster-view');

/**
 * Service for creating merged cluster views
 */
export class ClusterViewService {
  constructor(
    private orchestrator: OrchestratorClient,
    private proxysql: ProxySQLManager
  ) {}

  /**
   * Get merged cluster views for all clusters
   */
  async getAllMergedViews(): Promise<MergedClusterView[]> {
    const clusters = await this.orchestrator.getClusters();
    const views: MergedClusterView[] = [];

    for (const clusterName of clusters) {
      const view = await this.getMergedView(clusterName);
      if (view) {
        views.push(view);
      }
    }

    return views;
  }

  /**
   * Get merged cluster view for a specific cluster
   */
  async getMergedView(clusterName: string): Promise<MergedClusterView | null> {
    try {
      // Fetch all data in parallel
      const [topology, serverStats, hostgroups] = await Promise.all([
        this.orchestrator.getTopology(clusterName),
        this.proxysql.getServerStats(),
        this.proxysql.getReplicationHostgroups(),
      ]);

      if (!topology) {
        return null;
      }

      // Create lookup maps
      const statsMap = this.createStatsMap(serverStats);
      const hostgroupMap = this.createHostgroupMap(hostgroups, topology.clusterId);

      // Build merged view
      const primary = topology.primary
        ? this.mergeInstance(topology.primary, statsMap, hostgroupMap.writer)
        : null;

      const replicas = topology.replicas.map((r) =>
        this.mergeInstance(r, statsMap, hostgroupMap.reader)
      );

      // Calculate health
      const health = this.calculateHealth(primary, replicas);

      // Detect sync warnings
      const syncWarnings = this.detectSyncWarnings(
        primary,
        replicas,
        hostgroupMap,
        serverStats
      );

      return {
        clusterId: topology.clusterId,
        displayName: topology.name || clusterName,
        endpoint: {
          host: this.proxysql.getHost(),
          port: this.proxysql.getMySQLPort(),
        },
        hostgroups: hostgroupMap.writer !== undefined
          ? { writer: hostgroupMap.writer, reader: hostgroupMap.reader ?? 20 }
          : undefined,
        primary,
        replicas,
        health,
        syncWarnings,
      };
    } catch (error) {
      logger.error({ error, clusterName }, 'Failed to get merged cluster view');
      return null;
    }
  }

  /**
   * Merge Orchestrator instance data with ProxySQL stats
   */
  private mergeInstance(
    instance: MySQLInstance,
    statsMap: Map<string, ProxySQLServerStats>,
    hostgroup?: number
  ): MergedInstanceInfo {
    const key = `${instance.host}:${instance.port}`;
    const stats = statsMap.get(key);

    return {
      host: instance.host,
      port: instance.port,
      state: instance.state,
      role: instance.role,
      version: instance.version,
      serverId: instance.serverId,
      replicationLag: instance.replicationLag,
      hostgroup,
      proxysqlStatus: stats?.status,
      connections: stats?.connUsed,
    };
  }

  /**
   * Create a lookup map from server stats
   */
  private createStatsMap(
    stats: ProxySQLServerStats[]
  ): Map<string, ProxySQLServerStats> {
    const map = new Map<string, ProxySQLServerStats>();
    for (const stat of stats) {
      const key = `${stat.host}:${stat.port}`;
      map.set(key, stat);
    }
    return map;
  }

  /**
   * Find hostgroup mapping for a cluster
   */
  private createHostgroupMap(
    hostgroups: ProxySQLReplicationHostgroup[],
    clusterId: string
  ): { writer?: number; reader?: number } {
    // Try to find by cluster ID in comment
    for (const hg of hostgroups) {
      if (hg.comment?.includes(clusterId) || hg.comment?.includes('Cluster:')) {
        return { writer: hg.writerHostgroup, reader: hg.readerHostgroup };
      }
    }

    // Default to standard hostgroups
    if (hostgroups.length > 0) {
      return {
        writer: hostgroups[0].writerHostgroup,
        reader: hostgroups[0].readerHostgroup,
      };
    }

    // Fallback to defaults
    return { writer: 10, reader: 20 };
  }

  /**
   * Calculate overall health based on instance states
   */
  private calculateHealth(
    primary: MergedInstanceInfo | null,
    replicas: MergedInstanceInfo[]
  ): HealthStatus {
    const totalInstances = (primary ? 1 : 0) + replicas.length;
    if (totalInstances === 0) {
      return HealthStatus.UNKNOWN;
    }

    let healthyCount = 0;
    if (primary && primary.state === InstanceState.ONLINE) {
      healthyCount++;
    }
    healthyCount += replicas.filter(
      (r) => r.state === InstanceState.ONLINE
    ).length;

    const ratio = healthyCount / totalInstances;
    if (ratio >= 1.0) return HealthStatus.HEALTHY;
    if (ratio >= 0.5) return HealthStatus.DEGRADED;
    return HealthStatus.UNHEALTHY;
  }

  /**
   * Detect sync warnings between Orchestrator and ProxySQL
   */
  private detectSyncWarnings(
    primary: MergedInstanceInfo | null,
    replicas: MergedInstanceInfo[],
    hostgroupMap: { writer?: number; reader?: number },
    allServerStats: ProxySQLServerStats[]
  ): SyncWarning[] {
    const warnings: SyncWarning[] = [];
    const orchestratorInstances = new Set<string>();

    // Check primary
    if (primary) {
      const key = `${primary.host}:${primary.port}`;
      orchestratorInstances.add(key);

      // Check if primary is missing in ProxySQL
      if (!primary.proxysqlStatus) {
        warnings.push({
          type: 'missing_in_proxysql',
          instance: key,
          message: `Primary ${key} is not configured in ProxySQL`,
        });
      }
      // Check if primary is in wrong hostgroup (should be in writer)
      else if (
        hostgroupMap.writer !== undefined &&
        primary.hostgroup !== undefined &&
        primary.hostgroup !== hostgroupMap.writer
      ) {
        warnings.push({
          type: 'wrong_hostgroup',
          instance: key,
          message: `Primary ${key} is in hostgroup ${primary.hostgroup} (should be ${hostgroupMap.writer})`,
        });
      }
    }

    // Check replicas
    for (const replica of replicas) {
      const key = `${replica.host}:${replica.port}`;
      orchestratorInstances.add(key);

      // Check if replica is missing in ProxySQL
      if (!replica.proxysqlStatus) {
        warnings.push({
          type: 'missing_in_proxysql',
          instance: key,
          message: `Replica ${key} is not configured in ProxySQL`,
        });
      }
      // Check if replica is in wrong hostgroup (should be in reader)
      else if (
        hostgroupMap.reader !== undefined &&
        replica.hostgroup !== undefined &&
        replica.hostgroup !== hostgroupMap.reader
      ) {
        warnings.push({
          type: 'wrong_hostgroup',
          instance: key,
          message: `Replica ${key} is in hostgroup ${replica.hostgroup} (should be ${hostgroupMap.reader})`,
        });
      }
    }

    // Check for instances in ProxySQL that are not in Orchestrator topology
    for (const stat of allServerStats) {
      const key = `${stat.host}:${stat.port}`;
      if (!orchestratorInstances.has(key) && stat.status === 'ONLINE') {
        warnings.push({
          type: 'unknown_in_orchestrator',
          instance: key,
          message: `${key} is in ProxySQL but not in Orchestrator topology`,
        });
      }
    }

    return warnings;
  }
}

// Singleton instance
let clusterViewService: ClusterViewService | null = null;

/**
 * Get the cluster view service instance
 */
export function getClusterViewService(): ClusterViewService {
  if (!clusterViewService) {
    const { getOrchestratorClient } = require('./topology.js');
    const { getProxySQLManager } = require('../routing/proxysql-manager.js');
    clusterViewService = new ClusterViewService(
      getOrchestratorClient(),
      getProxySQLManager()
    );
  }
  return clusterViewService;
}
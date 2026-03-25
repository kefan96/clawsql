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
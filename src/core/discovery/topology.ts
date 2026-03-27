/**
 * ClawSQL - Orchestrator Client
 *
 * Client for interacting with Orchestrator API for topology management.
 */

import axios, { AxiosInstance } from 'axios';
import { getLogger } from '../../utils/logger.js';
import {
  MySQLInstance,
  MySQLCluster,
  InstanceRole,
  InstanceState,
  createMySQLInstance,
  createMySQLCluster,
} from '../../types/index.js';
import { OrchestratorError } from '../../utils/exceptions.js';
import { OrchestratorSettings } from '../../config/settings.js';

const logger = getLogger('orchestrator');

/**
 * Orchestrator API client
 */
export class OrchestratorClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(settings?: OrchestratorSettings) {
    const config = settings || {
      url: 'http://orchestrator:3000',
      timeout: 30.0,
    };
    this.baseUrl = config.url.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout * 1000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    logger.debug({ url: this.baseUrl }, 'Orchestrator client initialized');
  }

  /**
   * Get cluster name for an instance
   * Uses the instance's cluster name or derives it from the cluster alias
   */
  async getClusterForInstance(host: string, port: number = 3306): Promise<string | null> {
    try {
      const response = await this.client.get(`/api/instance/${host}/${port}`);
      const data = response.data;

      // Try to get cluster name from response
      const clusterName = data.ClusterName || data.cluster_alias || data.Alias;
      if (clusterName) {
        return clusterName;
      }

      // Fallback: if this is a primary, use its hostname as cluster name
      const masterKey = data.MasterKey as Record<string, unknown> | undefined;
      const replicationDepth = data.ReplicationDepth as number | undefined;
      const isPrimary = (masterKey && !masterKey.Hostname) ||
        (replicationDepth !== undefined && replicationDepth === 0) ||
        data.IsPrimary;

      if (isPrimary) {
        return host;
      }

      // For replicas, get the cluster from the primary/master
      if (masterKey && masterKey.Hostname) {
        return masterKey.Hostname as string;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      logger.error({ error, host, port }, 'Failed to get cluster for instance');
      return null;
    }
  }

  /**
   * Check if Orchestrator is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get all known cluster names
   */
  async getClusters(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/clusters');
      return response.data.map((c: { cluster_name?: string } | string) =>
        typeof c === 'string' ? c : c.cluster_name || ''
      ).filter(Boolean);
    } catch (error) {
      throw new OrchestratorError('Failed to get clusters', { error });
    }
  }

  /**
   * Get all clusters with resolved topology info
   * Returns cluster info with better naming
   */
  async getAllClustersWithInfo(): Promise<Array<{
    clusterName: string;
    displayName: string;
    primaryHost: string;
    primaryPort: number;
  }>> {
    try {
      const clusterNames = await this.getClusters();
      const result: Array<{
        clusterName: string;
        displayName: string;
        primaryHost: string;
        primaryPort: number;
      }> = [];

      for (const clusterName of clusterNames) {
        const topology = await this.getTopology(clusterName);
        if (topology) {
          // Derive a better display name
          let displayName = clusterName;

          // Strip port from cluster name for display
          if (clusterName.includes(':')) {
            displayName = clusterName.split(':')[0];
          }

          // Use the actual primary's hostname if available
          const primaryHost = topology.primary?.host || clusterName.split(':')[0];
          const primaryPort = topology.primary?.port || 3306;

          result.push({
            clusterName,
            displayName,
            primaryHost,
            primaryPort,
          });
        }
      }

      return result;
    } catch (error) {
      throw new OrchestratorError('Failed to get clusters with info', { error });
    }
  }

  /**
   * Get topology for a specific cluster
   */
  async getTopology(clusterName: string): Promise<MySQLCluster | null> {
    try {
      const response = await this.client.get(`/api/cluster/${clusterName}`);
      // Handle both array and object responses
      if (Array.isArray(response.data)) {
        return this.parseTopologyFromArray(response.data, clusterName);
      }
      return this.parseTopology(response.data, clusterName);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new OrchestratorError(`Failed to get topology for ${clusterName}`, { error });
    }
  }

  /**
   * Get instance details
   */
  async getInstance(host: string, port: number = 3306): Promise<MySQLInstance | null> {
    try {
      const response = await this.client.get(`/api/instance/${host}/${port}`);
      logger.debug({ host, port, data: response.data }, 'Orchestrator getInstance response');
      const instance = this.parseInstance(response.data);
      logger.debug({ host, port, instance }, 'Parsed instance');
      return instance;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new OrchestratorError(`Failed to get instance ${host}:${port}`, { error });
    }
  }

  /**
   * Force Orchestrator to discover an instance
   */
  async discoverInstance(host: string, port: number = 3306): Promise<boolean> {
    try {
      // Orchestrator uses GET for discover, not POST
      await this.client.get(`/api/discover/${host}/${port}`);
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to discover instance');
      return false;
    }
  }

  /**
   * Remove instance from Orchestrator's memory
   */
  async forgetInstance(host: string, port: number = 3306): Promise<boolean> {
    try {
      // Orchestrator uses GET for forget, not POST
      await this.client.get(`/api/forget/${host}/${port}`);
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to forget instance');
      return false;
    }
  }

  /**
   * Put instance in maintenance mode
   */
  async beginMaintenance(
    host: string,
    port: number,
    reason: string,
    durationMinutes: number = 60
  ): Promise<boolean> {
    try {
      await this.client.post(`/api/maintenance-begin/${host}/${port}`, {
        reason,
        duration: `${durationMinutes}m`,
      });
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to begin maintenance');
      return false;
    }
  }

  /**
   * Remove instance from maintenance mode
   */
  async endMaintenance(host: string, port: number): Promise<boolean> {
    try {
      // Orchestrator uses GET method for end-downtime endpoint
      await this.client.get(`/api/end-downtime/${host}/${port}`);
      logger.info({ host, port }, 'Instance removed from maintenance');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to end maintenance');
      return false;
    }
  }

  /**
   * Get replication analysis
   */
  async getReplicationAnalysis(): Promise<Record<string, unknown>[]> {
    try {
      const response = await this.client.get('/api/replication-analysis');
      return response.data;
    } catch (error) {
      throw new OrchestratorError('Failed to get replication analysis', { error });
    }
  }

  /**
   * Graceful master takeover - promotes a replica to master (switchover)
   * Uses cluster alias, orchestrator selects the best replica
   */
  async gracefulMasterTakeover(
    clusterAlias: string,
    destinationHost?: string,
    destinationPort?: number
  ): Promise<Record<string, unknown>> {
    try {
      let url = `/api/graceful-master-takeover-auto/${clusterAlias}`;
      if (destinationHost && destinationPort) {
        url = `/api/graceful-master-takeover/${clusterAlias}/${destinationHost}/${destinationPort}`;
      }
      // Orchestrator uses GET for these operations, not POST
      const response = await this.client.get(url);
      return response.data;
    } catch (error) {
      // Extract more detailed error message
      let message = `Failed graceful master takeover for ${clusterAlias}`;
      if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        if (data) {
          if (data.Message) {
            message = data.Message;
          } else if (data.Error) {
            message = data.Error;
          } else if (typeof data === 'string') {
            message = data;
          }
        }
        if (error.response?.status === 500) {
          logger.error({ clusterAlias, status: error.response.status, data }, 'Orchestrator 500 error');
        }
      }
      throw new OrchestratorError(message, { error, clusterAlias });
    }
  }

  /**
   * Force master failover - forcefully promotes a replica when master is down
   * Uses cluster alias, orchestrator selects the best replica
   */
  async forceMasterFailover(
    clusterAlias: string
  ): Promise<Record<string, unknown>> {
    try {
      const url = `/api/force-master-failover/${clusterAlias}`;
      // Orchestrator uses GET for these operations, not POST
      const response = await this.client.get(url);
      return response.data;
    } catch (error) {
      throw new OrchestratorError(`Failed force master failover for ${clusterAlias}`, { error });
    }
  }

  /**
   * Relocate replicas to follow a new primary
   */
  async relocateReplicas(
    host: string,
    port: number,
    destinationHost: string,
    destinationPort: number
  ): Promise<boolean> {
    try {
      // Orchestrator uses GET for relocate operations
      await this.client.get(
        `/api/relocate/${host}/${port}/${destinationHost}/${destinationPort}`
      );
      return true;
    } catch (error) {
      logger.error({ error, host, port, destinationHost, destinationPort }, 'Failed to relocate replicas');
      return false;
    }
  }

  /**
   * Set instance as read-only
   */
  async setReadOnly(host: string, port: number): Promise<boolean> {
    try {
      await this.client.get(`/api/set-read-only/${host}/${port}`);
      logger.info({ host, port }, 'Instance set to read-only');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to set read-only');
      return false;
    }
  }

  /**
   * Set instance as writeable
   */
  async setWriteable(host: string, port: number): Promise<boolean> {
    try {
      await this.client.get(`/api/set-writeable/${host}/${port}`);
      logger.info({ host, port }, 'Instance set to writeable');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to set writeable');
      return false;
    }
  }

  /**
   * Start replication on an instance
   */
  async startSlave(host: string, port: number): Promise<boolean> {
    try {
      await this.client.get(`/api/start-slave/${host}/${port}`);
      logger.info({ host, port }, 'Replication started');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to start replication');
      return false;
    }
  }

  /**
   * Stop replication on an instance
   */
  async stopSlave(host: string, port: number): Promise<boolean> {
    try {
      await this.client.get(`/api/stop-slave/${host}/${port}`);
      logger.info({ host, port }, 'Replication stopped');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to stop replication');
      return false;
    }
  }

  /**
   * Reset replication on an instance
   */
  async resetSlave(host: string, port: number): Promise<boolean> {
    try {
      await this.client.get(`/api/reset-slave/${host}/${port}`);
      logger.info({ host, port }, 'Replication reset');
      return true;
    } catch (error) {
      logger.error({ error, host, port }, 'Failed to reset replication');
      return false;
    }
  }

  /**
   * Parse Orchestrator topology response into MySQLCluster
   */
  private parseTopology(data: Record<string, unknown>, clusterName: string): MySQLCluster {
    // Try to get cluster alias for friendly display name
    // ClusterAlias is user-configured, SuggestedClusterAlias is auto-generated from primary hostname
    const clusterAlias = (data.ClusterAlias as string) ||
                         (data.SuggestedClusterAlias as string);
    const displayName = clusterAlias || clusterName;
    const cluster = createMySQLCluster(clusterName, displayName);

    // Check if this is an instance node
    if (data.Alias) {
      const instance = this.parseInstance(data);
      if (instance && instance.role === InstanceRole.PRIMARY) {
        cluster.primary = instance;
      } else if (instance) {
        cluster.replicas.push(instance);
      }
    }

    // Parse children/replicas
    const children = data.Child as Record<string, unknown>[] | undefined;
    if (children) {
      for (const child of children) {
        const instance = this.parseInstance(child);
        if (instance) {
          cluster.replicas.push(instance);
        }
      }
    }

    // Parse replicas if in different format
    const replicas = data.replicas as Record<string, unknown>[] | undefined;
    if (replicas) {
      for (const replicaData of replicas) {
        const instance = this.parseInstance(replicaData);
        if (instance) {
          cluster.replicas.push(instance);
        }
      }
    }

    return cluster;
  }

  /**
   * Parse Orchestrator cluster array response into MySQLCluster
   * The /api/cluster/{name} endpoint returns a flat array of instances
   */
  private parseTopologyFromArray(instances: Record<string, unknown>[], clusterName: string): MySQLCluster {
    // Try to get the actual cluster name and alias from instance data
    let actualClusterName = clusterName;
    let clusterAlias = '';

    if (instances.length > 0) {
      // ClusterName is the canonical identifier (hostname:port)
      if (instances[0].ClusterName) {
        actualClusterName = instances[0].ClusterName as string;
      }
      // ClusterAlias is the user-friendly name configured in Orchestrator
      // SuggestedClusterAlias is auto-generated from the primary hostname
      clusterAlias = (instances[0].ClusterAlias as string) ||
                     (instances[0].SuggestedClusterAlias as string) || '';
    }

    // Use clusterAlias as display name if available, otherwise use clusterName
    const displayName = clusterAlias || actualClusterName;
    const cluster = createMySQLCluster(actualClusterName, displayName);

    for (const instanceData of instances) {
      const instance = this.parseInstance(instanceData);
      if (instance) {
        // Update instance clusterId to match
        instance.clusterId = actualClusterName;

        // Primary is identified by having no master (MasterKey.Hostname is empty)
        // or ReplicationDepth === 0
        const masterKey = instanceData.MasterKey as Record<string, unknown> | undefined;
        const replicationDepth = instanceData.ReplicationDepth as number | undefined;

        const isPrimary = (masterKey && !masterKey.Hostname) ||
          (replicationDepth !== undefined && replicationDepth === 0);

        if (isPrimary) {
          cluster.primary = instance;
        } else {
          cluster.replicas.push(instance);
        }
      }
    }

    return cluster;
  }

  /**
   * Parse Orchestrator instance data into MySQLInstance
   */
  private parseInstance(data: Record<string, unknown>): MySQLInstance | null {
    if (!data) return null;

    // Determine role - check multiple indicators
    let role = InstanceRole.UNKNOWN;

    // Primary indicators (in order of reliability):
    // 1. IsPrimary flag (if available)
    // 2. IsCoPrimary flag (for co-primary setups)
    // 3. No master (MasterKey.Hostname is empty) and replication depth is 0
    const masterKey = data.MasterKey as Record<string, unknown> | undefined;
    const replicationDepth = data.ReplicationDepth as number | undefined;

    if (data.IsPrimary || data.IsCoPrimary) {
      role = InstanceRole.PRIMARY;
    } else if (data.IsReplica) {
      role = InstanceRole.REPLICA;
    } else if (masterKey && !masterKey.Hostname) {
      // No master means this is the primary
      role = InstanceRole.PRIMARY;
    } else if (replicationDepth !== undefined && replicationDepth === 0) {
      // Replication depth 0 means this is the primary
      role = InstanceRole.PRIMARY;
    } else if (masterKey && masterKey.Hostname) {
      // Has a master, so it's a replica
      role = InstanceRole.REPLICA;
    }

    // Determine state
    let state = InstanceState.OFFLINE;
    // IsLastCheckValid is the actual health check result
    // IsUpToDate just means Orchestrator has recent data for this instance
    if (data.IsLastCheckValid === true) {
      state = InstanceState.ONLINE;
    }

    // Handle maintenance mode
    if (data.in_maintenance || data.IsDowntimed) {
      state = InstanceState.MAINTENANCE;
    }

    // Get host and port
    const key = data.Key as Record<string, unknown> | undefined;
    const host = (data.Hostname || key?.Hostname || '') as string;
    const port = (data.Port || key?.Port || 3306) as number;

    if (!host) return null;

    // Extract replication lag - Orchestrator returns {Int64, Valid} object
    let replicationLag: number | undefined;
    const lagData = data.ReplicationLagSeconds as Record<string, unknown> | undefined;
    if (lagData && typeof lagData === 'object' && 'Int64' in lagData) {
      replicationLag = lagData.Int64 as number;
    } else if (typeof data.ReplicationLagSeconds === 'number') {
      replicationLag = data.ReplicationLagSeconds as number;
    }

    return createMySQLInstance(host, port, {
      serverId: data.ServerID as number | undefined,
      role,
      state,
      version: data.Version as string | undefined,
      replicationLag,
      lastSeen: state === InstanceState.ONLINE ? new Date() : new Date(0),
      clusterId: data.ClusterName as string | undefined,
      labels: {
        alias: (data.Alias as string) || '',
        dataCenter: (data.DataCenter as string) || '',
        environment: (data.Environment as string) || '',
      },
      extra: {
        isCoPrimary: data.IsCoPrimary || false,
        isDetachedPrimary: data.IsDetachedPrimary || false,
        replicationDepth: data.ReplicationDepth || 0,
      },
    });
  }
}

// Singleton instance
let orchestratorClient: OrchestratorClient | null = null;

/**
 * Get the Orchestrator client instance
 */
export function getOrchestratorClient(): OrchestratorClient {
  if (!orchestratorClient) {
    const { getSettings } = require('../../config/settings.js');
    orchestratorClient = new OrchestratorClient(getSettings().orchestrator);
  }
  return orchestratorClient;
}
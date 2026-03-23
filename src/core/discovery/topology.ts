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
    logger.info({ url: this.baseUrl }, 'Orchestrator client initialized');
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
   * Get topology for a specific cluster
   */
  async getTopology(clusterName: string): Promise<MySQLCluster | null> {
    try {
      const response = await this.client.get(`/api/cluster/${clusterName}`);
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
      return this.parseInstance(response.data);
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
      await this.client.post(`/api/discover/${host}/${port}`);
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
      await this.client.post(`/api/forget/${host}/${port}`);
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
      await this.client.post(`/api/maintenance-end/${host}/${port}`);
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
   * Request graceful failover
   */
  async requestFailover(
    host: string,
    port: number,
    destination?: string
  ): Promise<Record<string, unknown>> {
    try {
      const url = `/api/graceful-promote-to/${host}/${port}`;
      const response = destination
        ? await this.client.post(url, { destination })
        : await this.client.post(url);
      return response.data;
    } catch (error) {
      throw new OrchestratorError(`Failed to request failover for ${host}:${port}`, { error });
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
      await this.client.post(
        `/api/relocate/${host}/${port}/${destinationHost}/${destinationPort}`
      );
      return true;
    } catch (error) {
      logger.error({ error, host, port, destinationHost, destinationPort }, 'Failed to relocate replicas');
      return false;
    }
  }

  /**
   * Parse Orchestrator topology response into MySQLCluster
   */
  private parseTopology(data: Record<string, unknown>, clusterName: string): MySQLCluster {
    const cluster = createMySQLCluster(clusterName, clusterName);

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
   * Parse Orchestrator instance data into MySQLInstance
   */
  private parseInstance(data: Record<string, unknown>): MySQLInstance | null {
    if (!data) return null;

    // Determine role
    let role = InstanceRole.UNKNOWN;
    if (data.IsPrimary || data.IsCoPrimary) {
      role = InstanceRole.PRIMARY;
    } else if (data.IsReplica) {
      role = InstanceRole.REPLICA;
    }

    // Determine state
    let state = InstanceState.OFFLINE;
    if (data.IsLastCheckValid || data.IsUpToDate) {
      state = InstanceState.ONLINE;
    }

    // Handle maintenance mode
    if (data.in_maintenance) {
      state = InstanceState.MAINTENANCE;
    }

    // Get host and port
    const key = data.Key as Record<string, unknown> | undefined;
    const host = (data.Hostname || key?.Hostname || '') as string;
    const port = (data.Port || key?.Port || 3306) as number;

    if (!host) return null;

    return createMySQLInstance(host, port, {
      serverId: data.ServerID as number | undefined,
      role,
      state,
      version: data.Version as string | undefined,
      replicationLag: data.ReplicationLagSeconds as number | undefined,
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
    orchestratorClient = new OrchestratorClient();
  }
  return orchestratorClient;
}
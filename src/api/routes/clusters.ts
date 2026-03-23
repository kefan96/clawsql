/**
 * ClawSQL - Clusters API Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  MySQLCluster,
  createMySQLCluster,
  getClusterHealthStatus,
  getInstanceCount,
} from '../../types/index.js';
import { NotFoundError } from '../../utils/exceptions.js';
import { getOrchestratorClient } from '../../core/discovery/topology.js';

// In-memory cluster registry
const clusterRegistry = new Map<string, MySQLCluster>();

/**
 * Convert MySQLCluster to API response
 */
function clusterToResponse(cluster: MySQLCluster) {
  return {
    cluster_id: cluster.clusterId,
    name: cluster.name,
    description: cluster.description ?? null,
    primary: cluster.primary ? {
      instance_id: `${cluster.primary.host}:${cluster.primary.port}`,
      host: cluster.primary.host,
      port: cluster.primary.port,
      server_id: cluster.primary.serverId ?? null,
      role: cluster.primary.role,
      state: cluster.primary.state,
      version: cluster.primary.version ?? null,
      cluster_id: cluster.primary.clusterId ?? null,
      replication_lag: cluster.primary.replicationLag ?? null,
      labels: cluster.primary.labels,
      last_seen: cluster.primary.lastSeen.toISOString(),
      created_at: cluster.primary.lastSeen.toISOString(),
    } : null,
    replicas: cluster.replicas.map(r => ({
      instance_id: `${r.host}:${r.port}`,
      host: r.host,
      port: r.port,
      server_id: r.serverId ?? null,
      role: r.role,
      state: r.state,
      version: r.version ?? null,
      cluster_id: r.clusterId ?? null,
      replication_lag: r.replicationLag ?? null,
      labels: r.labels,
      last_seen: r.lastSeen.toISOString(),
      created_at: r.lastSeen.toISOString(),
    })),
    instance_count: getInstanceCount(cluster),
    health_status: getClusterHealthStatus(cluster),
    created_at: cluster.createdAt.toISOString(),
    updated_at: cluster.updatedAt.toISOString(),
  };
}

const clustersRoutes: FastifyPluginAsync = async (fastify) => {
  // List clusters
  fastify.get<{
    Querystring: { page?: number; page_size?: number };
  }>('/', async (request) => {
    const clusters = Array.from(clusterRegistry.values());

    const page = request.query.page || 1;
    const pageSize = request.query.page_size || 20;
    const total = clusters.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      items: clusters.slice(start, end).map(clusterToResponse),
      total,
      page,
      page_size: pageSize,
    };
  });

  // Get cluster
  fastify.get<{
    Params: { cluster_id: string };
  }>('/:cluster_id', async (request) => {
    // Try local registry first
    let cluster = clusterRegistry.get(request.params.cluster_id);

    // If not found, try Orchestrator
    if (!cluster) {
      try {
        const orchestrator = getOrchestratorClient();
        const orchestratorCluster = await orchestrator.getTopology(request.params.cluster_id);
        if (orchestratorCluster) {
          cluster = orchestratorCluster;
          clusterRegistry.set(request.params.cluster_id, cluster);
        }
      } catch (error) {
        fastify.log.debug({ error }, 'Failed to get topology from Orchestrator');
      }
    }

    if (!cluster) {
      throw new NotFoundError('Cluster', request.params.cluster_id);
    }

    return clusterToResponse(cluster);
  });

  // Create cluster
  fastify.post<{
    Body: { name: string; description?: string };
  }>('/', async (request, reply) => {
    const clusterId = uuidv4();
    const cluster = createMySQLCluster(clusterId, request.body.name, {
      description: request.body.description,
    });

    clusterRegistry.set(clusterId, cluster);
    reply.code(201);
    return clusterToResponse(cluster);
  });

  // Delete cluster
  fastify.delete<{
    Params: { cluster_id: string };
  }>('/:cluster_id', async (request, reply) => {
    if (!clusterRegistry.has(request.params.cluster_id)) {
      throw new NotFoundError('Cluster', request.params.cluster_id);
    }
    clusterRegistry.delete(request.params.cluster_id);
    reply.code(204);
  });

  // Sync cluster from Orchestrator
  fastify.post<{
    Params: { cluster_id: string };
  }>('/:cluster_id/sync', async (request) => {
    const orchestrator = getOrchestratorClient();
    const cluster = await orchestrator.getTopology(request.params.cluster_id);

    if (!cluster) {
      throw new NotFoundError('Cluster', request.params.cluster_id);
    }

    clusterRegistry.set(request.params.cluster_id, cluster);
    return clusterToResponse(cluster);
  });
};

export default clustersRoutes;
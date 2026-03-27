/**
 * ClawSQL - Instances API Routes
 *
 * Instance management with persistence in shared metadata database.
 * - Topology data (role, state, replication) comes from Orchestrator
 * - User metadata (labels, extra) stored in instance_metadata table
 */

import { FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  InstanceRole,
  InstanceState,
  createMySQLInstance,
  createInstanceId,
  MySQLInstance,
} from '../../types/index.js';
import { NotFoundError, AlreadyExistsError } from '../../utils/exceptions.js';
import { getMetricsCollector } from '../../core/monitoring/collector.js';
import { getDatabase } from '../../utils/database.js';
import { getOrchestratorClient } from '../../core/discovery/topology.js';

interface InstanceMetadataRow {
  instance_id: string;
  labels: string;
  extra: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get instance metadata from database
 */
async function getInstanceMetadata(instanceId: string): Promise<InstanceMetadataRow | undefined> {
  const db = getDatabase();
  return db.get<InstanceMetadataRow>(
    'SELECT * FROM instance_metadata WHERE instance_id = ?',
    [instanceId]
  );
}

/**
 * Save instance metadata to database
 */
async function saveInstanceMetadata(
  instanceId: string,
  labels: Record<string, string>,
  extra: Record<string, unknown>
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `INSERT INTO instance_metadata (instance_id, labels, extra)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE labels = VALUES(labels), extra = VALUES(extra)`,
    [instanceId, JSON.stringify(labels), JSON.stringify(extra)]
  );
}

/**
 * Delete instance metadata from database
 */
async function deleteInstanceMetadata(instanceId: string): Promise<void> {
  const db = getDatabase();
  await db.execute('DELETE FROM instance_metadata WHERE instance_id = ?', [instanceId]);
}

/**
 * List all instance metadata from database
 */
async function listInstanceMetadata(): Promise<InstanceMetadataRow[]> {
  const db = getDatabase();
  return db.query<InstanceMetadataRow>('SELECT * FROM instance_metadata');
}

/**
 * Parse JSON field from MySQL (can be object or string)
 */
function parseJsonField(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Parse labels field (string values only)
 */
function parseLabels(value: unknown): Record<string, string> {
  const parsed = parseJsonField(value);
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (typeof val === 'string') {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Convert to API response
 */
function toResponse(
  metadata: InstanceMetadataRow,
  orchestratorData?: MySQLInstance | null
) {
  const labels = parseLabels(metadata.labels);
  const extra = parseJsonField(metadata.extra);

  // Parse instance_id to get host and port
  const [host, portStr] = metadata.instance_id.split(':');
  const port = parseInt(portStr, 10) || 3306;

  // Convert InstanceRole enum to string
  const role = orchestratorData?.role?.toLowerCase() || 'unknown';
  const state = orchestratorData?.state?.toLowerCase() || 'offline';

  return {
    instance_id: metadata.instance_id,
    host,
    port,
    server_id: orchestratorData?.serverId ?? null,
    role,
    state,
    version: orchestratorData?.version ?? null,
    cluster_id: orchestratorData?.clusterId ?? null,
    replication_lag: orchestratorData?.replicationLag ?? null,
    labels,
    extra,
    last_seen: orchestratorData?.lastSeen?.toISOString?.() ?? metadata.updated_at,
    created_at: metadata.created_at,
  };
}

const instancesRoutes: FastifyPluginAsync = async (fastify) => {
  // List instances
  fastify.get<{
    Querystring: {
      cluster_id?: string;
      state?: string;
      role?: string;
      page?: number;
      page_size?: number;
    };
  }>('/', async (request) => {
    const metadataList = await listInstanceMetadata();
    const orchestrator = getOrchestratorClient();

    // Get topology from Orchestrator for enrichment
    let instances = await Promise.all(
      metadataList.map(async (m) => {
        const [host, portStr] = m.instance_id.split(':');
        const port = parseInt(portStr, 10) || 3306;
        try {
          const topo = await orchestrator.getInstance(host, port);
          return toResponse(m, topo);
        } catch {
          return toResponse(m);
        }
      })
    );

    // Apply filters
    if (request.query.cluster_id) {
      instances = instances.filter(i => i.cluster_id === request.query.cluster_id);
    }
    if (request.query.state) {
      instances = instances.filter(i => i.state === request.query.state);
    }
    if (request.query.role) {
      instances = instances.filter(i => i.role === request.query.role);
    }

    // Paginate
    const page = request.query.page || 1;
    const pageSize = request.query.page_size || 20;
    const total = instances.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      items: instances.slice(start, end),
      total,
      page,
      page_size: pageSize,
    };
  });

  // Get instance
  fastify.get<{
    Params: { instance_id: string };
  }>('/:instance_id', async (request) => {
    const metadata = await getInstanceMetadata(request.params.instance_id);
    if (!metadata) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const [host, portStr] = request.params.instance_id.split(':');
    const port = parseInt(portStr, 10) || 3306;
    const orchestrator = getOrchestratorClient();

    try {
      const topo = await orchestrator.getInstance(host, port);
      return toResponse(metadata, topo);
    } catch {
      return toResponse(metadata);
    }
  });

  // Register instance
  fastify.post<{
    Body: {
      host: string;
      port?: number;
      cluster_id?: string;
      labels?: Record<string, string>;
    };
  }>('/', async (request, reply) => {
    const port = request.body.port || 3306;
    const instanceId = createInstanceId(request.body.host, port);

    const existing = await getInstanceMetadata(instanceId);
    if (existing) {
      throw new AlreadyExistsError('Instance', instanceId);
    }

    await saveInstanceMetadata(instanceId, request.body.labels || {}, {
      registeredCluster: request.body.cluster_id,
    });

    // Also discover in Orchestrator
    const orchestrator = getOrchestratorClient();
    try {
      await orchestrator.discoverInstance(request.body.host, port);
    } catch (error) {
      fastify.log.warn({ error, instanceId }, 'Failed to discover instance in Orchestrator');
    }

    const metadata = await getInstanceMetadata(instanceId);
    reply.code(201);
    return toResponse(metadata!);
  });

  // Deregister instance
  fastify.delete<{
    Params: { instance_id: string };
  }>('/:instance_id', async (request, reply) => {
    const existing = await getInstanceMetadata(request.params.instance_id);
    if (!existing) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    await deleteInstanceMetadata(request.params.instance_id);
    reply.code(204);
  });

  // Discover instances
  fastify.post<{
    Body: {
      network_segments: string[];
      port_range?: [number, number];
    };
  }>('/discover', async (request, reply) => {
    const taskId = uuidv4();

    // Simplified discovery - in production this would scan networks
    const discovered: { instance_id: string; host: string; port: number }[] = [];

    for (const segment of request.body.network_segments) {
      fastify.log.info({ segment }, 'Scanning network segment');
    }

    // Register discovered instances
    for (const instance of discovered) {
      const instanceId = createInstanceId(instance.host, instance.port);
      const existing = await getInstanceMetadata(instanceId);
      if (!existing) {
        await saveInstanceMetadata(instanceId, {}, { discovered: true });
      }
    }

    reply.code(202);
    return {
      task_id: taskId,
      status: 'completed',
      network_segments: request.body.network_segments,
      instances_found: discovered.length,
      instances: discovered,
      completed_at: new Date().toISOString(),
    };
  });

  // Set maintenance mode
  fastify.post<{
    Params: { instance_id: string };
    Body: { reason: string; duration_minutes?: number };
  }>('/:instance_id/maintenance', async (request) => {
    const metadata = await getInstanceMetadata(request.params.instance_id);
    if (!metadata) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const extra = parseJsonField(metadata.extra);
    extra.maintenance_reason = request.body.reason;
    extra.maintenance_duration = request.body.duration_minutes || 60;
    extra.maintenance_mode = true;

    const labels = parseLabels(metadata.labels);
    await saveInstanceMetadata(request.params.instance_id, labels, extra);

    return { message: `Instance ${request.params.instance_id} set to maintenance mode` };
  });

  // Remove maintenance mode
  fastify.delete<{
    Params: { instance_id: string };
  }>('/:instance_id/maintenance', async (request, reply) => {
    const metadata = await getInstanceMetadata(request.params.instance_id);
    if (!metadata) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const extra = parseJsonField(metadata.extra);
    if (!extra.maintenance_mode) {
      return reply.code(400).send({
        error: 'INVALID_STATE',
        message: `Instance is not in maintenance mode: ${request.params.instance_id}`,
      });
    }

    delete extra.maintenance_reason;
    delete extra.maintenance_duration;
    delete extra.maintenance_mode;

    const labels = parseLabels(metadata.labels);
    await saveInstanceMetadata(request.params.instance_id, labels, extra);

    return { message: `Instance ${request.params.instance_id} removed from maintenance mode` };
  });

  // Get instance metrics
  fastify.get<{
    Params: { instance_id: string };
  }>('/:instance_id/metrics', async (request) => {
    const metadata = await getInstanceMetadata(request.params.instance_id);
    if (!metadata) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const [host, portStr] = request.params.instance_id.split(':');
    const port = parseInt(portStr, 10) || 3306;

    const instance = createMySQLInstance(host, port, {
      state: InstanceState.ONLINE,
      role: InstanceRole.UNKNOWN,
    });

    const collector = getMetricsCollector();
    const metrics = await collector.collectMetrics(instance);

    return {
      ...metrics,
      timestamp: metrics.timestamp.toISOString(),
    };
  });

  // Get instance health
  fastify.get<{
    Params: { instance_id: string };
  }>('/:instance_id/health', async (request) => {
    const metadata = await getInstanceMetadata(request.params.instance_id);
    if (!metadata) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const [host, portStr] = request.params.instance_id.split(':');
    const port = parseInt(portStr, 10) || 3306;
    const orchestrator = getOrchestratorClient();

    let isOnline = false;
    let replicationLag: number | undefined;

    try {
      const topo = await orchestrator.getInstance(host, port);
      isOnline = true;
      replicationLag = (topo as unknown as { replication_lag_seconds?: number }).replication_lag_seconds;
    } catch {
      isOnline = false;
    }

    const extra = parseJsonField(metadata.extra);
    const inMaintenance = extra.maintenance_mode === true;

    const checks = [
      {
        check_name: 'connectivity',
        status: inMaintenance ? 'maintenance' : (isOnline ? 'healthy' : 'unhealthy'),
        value: isOnline ? 1 : 0,
        message: inMaintenance ? 'Instance is in maintenance mode' : (isOnline ? 'Instance is reachable' : 'Instance is not reachable'),
      },
      {
        check_name: 'replication_lag',
        status: replicationLag !== undefined && replicationLag < 10 ? 'healthy' : 'unhealthy',
        value: replicationLag ?? 0,
        message: replicationLag !== undefined
          ? `Replication lag: ${replicationLag}s`
          : 'Replication not configured',
      },
    ];

    return {
      instance_id: request.params.instance_id,
      status: inMaintenance ? 'maintenance' : (isOnline ? 'healthy' : 'unhealthy'),
      checks,
    };
  });
};

export default instancesRoutes;
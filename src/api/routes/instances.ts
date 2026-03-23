/**
 * ClawSQL - Instances API Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import {
  MySQLInstance,
  InstanceRole,
  InstanceState,
  createMySQLInstance,
  createInstanceId,
} from '../../types/index.js';
import { NotFoundError, AlreadyExistsError } from '../../utils/exceptions.js';
import { getMetricsCollector } from '../../core/monitoring/collector.js';

// In-memory instance registry (would be database-backed in production)
const instanceRegistry = new Map<string, MySQLInstance>();

/**
 * Convert MySQLInstance to API response
 */
function instanceToResponse(instance: MySQLInstance) {
  return {
    instance_id: createInstanceId(instance.host, instance.port),
    host: instance.host,
    port: instance.port,
    server_id: instance.serverId ?? null,
    role: instance.role,
    state: instance.state,
    version: instance.version ?? null,
    cluster_id: instance.clusterId ?? null,
    replication_lag: instance.replicationLag ?? null,
    labels: instance.labels,
    last_seen: instance.lastSeen.toISOString(),
    created_at: instance.lastSeen.toISOString(),
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
    let instances = Array.from(instanceRegistry.values());

    // Apply filters
    if (request.query.cluster_id) {
      instances = instances.filter(i => i.clusterId === request.query.cluster_id);
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
      items: instances.slice(start, end).map(instanceToResponse),
      total,
      page,
      page_size: pageSize,
    };
  });

  // Get instance
  fastify.get<{
    Params: { instance_id: string };
  }>('/:instance_id', async (request) => {
    const instance = instanceRegistry.get(request.params.instance_id);
    if (!instance) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }
    return instanceToResponse(instance);
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

    if (instanceRegistry.has(instanceId)) {
      throw new AlreadyExistsError('Instance', instanceId);
    }

    const instance = createMySQLInstance(request.body.host, port, {
      clusterId: request.body.cluster_id,
      labels: request.body.labels || {},
      state: InstanceState.OFFLINE,
      role: InstanceRole.UNKNOWN,
    });

    instanceRegistry.set(instanceId, instance);
    reply.code(201);
    return instanceToResponse(instance);
  });

  // Deregister instance
  fastify.delete<{
    Params: { instance_id: string };
  }>('/:instance_id', async (request, reply) => {
    if (!instanceRegistry.has(request.params.instance_id)) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }
    instanceRegistry.delete(request.params.instance_id);
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
    const discovered: MySQLInstance[] = [];

    for (const segment of request.body.network_segments) {
      fastify.log.info({ segment }, 'Scanning network segment');
    }

    // Register discovered instances
    for (const instance of discovered) {
      const instanceId = createInstanceId(instance.host, instance.port);
      instanceRegistry.set(instanceId, instance);
    }

    reply.code(202);
    return {
      task_id: taskId,
      status: 'completed',
      network_segments: request.body.network_segments,
      instances_found: discovered.length,
      instances: discovered.map(instanceToResponse),
      completed_at: new Date().toISOString(),
    };
  });

  // Set maintenance mode
  fastify.post<{
    Params: { instance_id: string };
    Body: { reason: string; duration_minutes?: number };
  }>('/:instance_id/maintenance', async (request) => {
    const instance = instanceRegistry.get(request.params.instance_id);
    if (!instance) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    instance.state = InstanceState.MAINTENANCE;
    instance.extra.maintenance_reason = request.body.reason;
    instance.extra.maintenance_duration = request.body.duration_minutes || 60;

    return { message: `Instance ${request.params.instance_id} set to maintenance mode` };
  });

  // Remove maintenance mode
  fastify.delete<{
    Params: { instance_id: string };
  }>('/:instance_id/maintenance', async (request, reply) => {
    const instance = instanceRegistry.get(request.params.instance_id);
    if (!instance) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    if (instance.state !== InstanceState.MAINTENANCE) {
      return reply.code(400).send({
        error: 'INVALID_STATE',
        message: `Instance is not in maintenance mode: ${request.params.instance_id}`,
      });
    }

    instance.state = InstanceState.ONLINE;
    delete instance.extra.maintenance_reason;
    delete instance.extra.maintenance_duration;

    return { message: `Instance ${request.params.instance_id} removed from maintenance mode` };
  });

  // Get instance metrics
  fastify.get<{
    Params: { instance_id: string };
  }>('/:instance_id/metrics', async (request) => {
    const instance = instanceRegistry.get(request.params.instance_id);
    if (!instance) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

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
    const instance = instanceRegistry.get(request.params.instance_id);
    if (!instance) {
      throw new NotFoundError('Instance', request.params.instance_id);
    }

    const checks = [
      {
        check_name: 'connectivity',
        status: instance.state === InstanceState.ONLINE ? 'healthy' : 'unhealthy',
        value: instance.state === InstanceState.ONLINE ? 1 : 0,
        message: instance.state === InstanceState.ONLINE ? 'Instance is reachable' : 'Instance is not reachable',
      },
      {
        check_name: 'replication_lag',
        status: instance.replicationLag !== undefined && instance.replicationLag < 10 ? 'healthy' : 'unhealthy',
        value: instance.replicationLag ?? 0,
        message: instance.replicationLag !== undefined
          ? `Replication lag: ${instance.replicationLag}s`
          : 'Replication not configured',
      },
    ];

    return {
      instance_id: request.params.instance_id,
      status: instance.state === InstanceState.ONLINE ? 'healthy' : 'unhealthy',
      checks,
    };
  });
};

export default instancesRoutes;
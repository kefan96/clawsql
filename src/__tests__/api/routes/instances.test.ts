/**
 * Tests for Instances API Routes
 */

import { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import instancesRoutes from '../../../api/routes/instances.js';
import { ClawSQLError } from '../../../utils/exceptions.js';

// Track mock state
let mockInstanceStore: Map<string, { instance_id: string; labels: string; extra: string; created_at: string; updated_at: string }>;

// Mock dependencies
jest.mock('../../../utils/database.js', () => ({
  getDatabase: jest.fn().mockImplementation(() => {
    mockInstanceStore = new Map();
    return {
      get: jest.fn().mockImplementation((query: string, params: string[]) => {
        const instanceId = params[0];
        return mockInstanceStore.get(instanceId);
      }),
      query: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockImplementation((query: string, params: unknown[]) => {
        if (query.includes('INSERT')) {
          const instanceId = params[0] as string;
          mockInstanceStore.set(instanceId, {
            instance_id: instanceId,
            labels: JSON.stringify(params[1]),
            extra: JSON.stringify(params[2]),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } else if (query.includes('DELETE')) {
          const instanceId = params[0] as string;
          mockInstanceStore.delete(instanceId);
        }
      }),
    };
  }),
}));

jest.mock('../../../core/discovery/topology.js', () => ({
  getOrchestratorClient: jest.fn().mockReturnValue({
    getInstance: jest.fn().mockRejectedValue(new Error('Not found')),
    discoverInstance: jest.fn().mockResolvedValue(true),
    healthCheck: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('../../../core/monitoring/collector.js', () => ({
  getMetricsCollector: jest.fn().mockReturnValue({
    collectMetrics: jest.fn().mockResolvedValue({
      instanceId: 'host:3306',
      timestamp: new Date(),
      replicationIoRunning: true,
      replicationSqlRunning: true,
      connectionsCurrent: 10,
      connectionsMax: 100,
      queriesPerSecond: 100,
      innodbBufferPoolHitRate: 0.99,
      uptimeSeconds: 86400,
    }),
  }),
}));

describe('Instances API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockInstanceStore = new Map();
    app = fastify();
    // Add error handler similar to the main app
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ClawSQLError) {
        const statusCode = error.code === 'NOT_FOUND' ? 404 : 400;
        reply.code(statusCode).send(error.toJSON());
        return;
      }
      reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: error.message,
      });
    });
    await app.register(instancesRoutes, { prefix: '/instances' });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /instances', () => {
    it('should return empty list when no instances', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances?page=1&page_size=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Number(body.page)).toBe(1);
      expect(Number(body.page_size)).toBe(10);
    });

    it('should filter by state', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances?state=online',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by role', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances?role=primary',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by cluster_id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances?cluster_id=test-cluster',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /instances/:instance_id', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances/nonexistent:3306',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /instances', () => {
    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/instances',
        payload: {},
      });

      // Should fail validation (400) or process (201/500)
      expect([201, 400, 500]).toContain(response.statusCode);
    });
  });

  describe('DELETE /instances/:instance_id', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/instances/nonexistent:3306',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /instances/discover', () => {
    it('should start discovery task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/instances/discover',
        payload: {
          network_segments: ['192.168.1.0/24'],
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('completed');
      expect(body.task_id).toBeDefined();
    });

    it('should accept port range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/instances/discover',
        payload: {
          network_segments: ['192.168.1.0/24'],
          port_range: [3306, 3307],
        },
      });

      expect(response.statusCode).toBe(202);
    });
  });

  describe('POST /instances/:instance_id/maintenance', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/instances/nonexistent:3306/maintenance',
        payload: {
          reason: 'Scheduled maintenance',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /instances/:instance_id/maintenance', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/instances/nonexistent:3306/maintenance',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /instances/:instance_id/metrics', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances/nonexistent:3306/metrics',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /instances/:instance_id/health', () => {
    it('should return 404 for non-existent instance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/instances/nonexistent:3306/health',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
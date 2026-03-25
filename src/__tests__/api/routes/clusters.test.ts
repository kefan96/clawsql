/**
 * Tests for Clusters API Routes
 */

import { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import clustersRoutes from '../../../api/routes/clusters.js';
import { ClawSQLError } from '../../../utils/exceptions.js';

// Mock dependencies
jest.mock('../../../core/discovery/topology.js', () => ({
  getOrchestratorClient: jest.fn().mockReturnValue({
    getTopology: jest.fn().mockResolvedValue(null),
    getClusters: jest.fn().mockResolvedValue([]),
  }),
}));

describe('Clusters API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
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
    await app.register(clustersRoutes, { prefix: '/clusters' });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /clusters', () => {
    it('should return empty list when no clusters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/clusters',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/clusters?page=1&page_size=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Number(body.page)).toBe(1);
      expect(Number(body.page_size)).toBe(10);
    });
  });

  describe('POST /clusters', () => {
    it('should create a new cluster', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/clusters',
        payload: {
          name: 'test-cluster',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('test-cluster');
      expect(body.cluster_id).toBeDefined();
    });

    it('should create cluster with description', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/clusters',
        payload: {
          name: 'test-cluster',
          description: 'A test cluster',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.description).toBe('A test cluster');
    });
  });

  describe('GET /clusters/:cluster_id', () => {
    it('should return 404 for non-existent cluster', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/clusters/nonexistent-cluster',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return created cluster', async () => {
      // First create a cluster
      const createResponse = await app.inject({
        method: 'POST',
        url: '/clusters',
        payload: {
          name: 'test-cluster',
        },
      });

      const created = JSON.parse(createResponse.body);
      const clusterId = created.cluster_id;

      // Then get it
      const response = await app.inject({
        method: 'GET',
        url: `/clusters/${clusterId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.cluster_id).toBe(clusterId);
    });
  });

  describe('DELETE /clusters/:cluster_id', () => {
    it('should return 404 for non-existent cluster', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/clusters/nonexistent-cluster',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should delete existing cluster', async () => {
      // First create a cluster
      const createResponse = await app.inject({
        method: 'POST',
        url: '/clusters',
        payload: {
          name: 'test-cluster',
        },
      });

      const created = JSON.parse(createResponse.body);
      const clusterId = created.cluster_id;

      // Then delete it
      const response = await app.inject({
        method: 'DELETE',
        url: `/clusters/${clusterId}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('POST /clusters/:cluster_id/sync', () => {
    it('should return 404 for non-existent cluster', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/clusters/nonexistent-cluster/sync',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
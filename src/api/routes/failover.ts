/**
 * ClawSQL - Failover API Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  FailoverRequest,
  FailoverOperationResponse,
  FailoverListResponse,
} from '../schemas/index.js';
import { NotFoundError } from '../../utils/exceptions.js';
import { getFailoverExecutor } from '../../core/failover/executor.js';
import { getOrchestratorClient } from '../../core/discovery/topology.js';

const failoverRoutes: FastifyPluginAsync = async (fastify) => {
  // List failover operations
  fastify.get<{
    Querystring: { cluster_id?: string; limit?: number };
  }>('/', {
    schema: {
      response: {
        200: FailoverListResponse,
      },
    },
  }, async (request, _reply) => {
    const executor = getFailoverExecutor();
    const operations = executor.getOperationHistory(
      request.query.cluster_id,
      request.query.limit || 100
    );

    return {
      items: operations.map(op => ({
        operation_id: op.operationId,
        cluster_id: op.clusterId,
        old_primary_id: op.oldPrimaryId,
        new_primary_id: op.newPrimaryId ?? null,
        state: op.state,
        started_at: op.startedAt ?? null,
        completed_at: op.completedAt ?? null,
        duration_seconds: op.startedAt && op.completedAt
          ? (op.completedAt.getTime() - op.startedAt.getTime()) / 1000
          : null,
        steps: op.steps,
        error: op.error ?? null,
        manual: op.manual,
        reason: op.reason,
        triggered_by: op.triggeredBy ?? null,
      })),
      total: operations.length,
    };
  });

  // Get failover operation
  fastify.get<{
    Params: { operation_id: string };
  }>('/:operation_id', {
    schema: {
      response: {
        200: FailoverOperationResponse,
        404: z.object({ error: z.string(), message: z.string() }),
      },
    },
  }, async (request, _reply) => {
    const executor = getFailoverExecutor();
    const operation = executor.getOperation(request.params.operation_id);

    if (!operation) {
      throw new NotFoundError('Failover operation', request.params.operation_id);
    }

    return {
      operation_id: operation.operationId,
      cluster_id: operation.clusterId,
      old_primary_id: operation.oldPrimaryId,
      new_primary_id: operation.newPrimaryId ?? null,
      state: operation.state,
      started_at: operation.startedAt ?? null,
      completed_at: operation.completedAt ?? null,
      duration_seconds: operation.startedAt && operation.completedAt
        ? (operation.completedAt.getTime() - operation.startedAt.getTime()) / 1000
        : null,
      steps: operation.steps,
      error: operation.error ?? null,
      manual: operation.manual,
      reason: operation.reason,
      triggered_by: operation.triggeredBy ?? null,
    };
  });

  // Execute manual failover
  fastify.post<{
    Params: { cluster_id: string };
    Body: z.infer<typeof FailoverRequest>;
  }>('/cluster/:cluster_id', {
    schema: {
      body: FailoverRequest,
      response: {
        200: FailoverOperationResponse,
        404: z.object({ error: z.string(), message: z.string() }),
      },
    },
  }, async (request, _reply) => {
    // Get cluster from Orchestrator
    const orchestrator = getOrchestratorClient();
    const cluster = await orchestrator.getTopology(request.params.cluster_id);

    if (!cluster) {
      throw new NotFoundError('Cluster', request.params.cluster_id);
    }

    const executor = getFailoverExecutor();
    const operation = await executor.executeManualFailover(
      cluster,
      request.body.target_instance_id,
      request.body.reason
    );

    const durationSeconds = operation.startedAt && operation.completedAt
      ? (operation.completedAt.getTime() - operation.startedAt.getTime()) / 1000
      : null;

    return {
      operation_id: operation.operationId,
      cluster_id: operation.clusterId,
      old_primary_id: operation.oldPrimaryId,
      new_primary_id: operation.newPrimaryId ?? null,
      state: operation.state,
      started_at: operation.startedAt ?? null,
      completed_at: operation.completedAt ?? null,
      duration_seconds: durationSeconds,
      steps: operation.steps,
      error: operation.error ?? null,
      manual: operation.manual,
      reason: operation.reason,
      triggered_by: operation.triggeredBy ?? null,
    };
  });

  // Cancel failover operation
  fastify.post<{
    Params: { operation_id: string };
  }>('/:operation_id/cancel', {
    schema: {
      response: {
        200: z.object({ message: z.string() }),
        404: z.object({ error: z.string(), message: z.string() }),
      },
    },
  }, async (request, _reply) => {
    const executor = getFailoverExecutor();
    const cancelled = await executor.cancelOperation(request.params.operation_id);

    if (!cancelled) {
      throw new NotFoundError('Failover operation', request.params.operation_id);
    }

    return { message: `Failover operation ${request.params.operation_id} cancelled` };
  });
};

export default failoverRoutes;
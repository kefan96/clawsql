/**
 * ClawSQL - Monitoring API Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { getOrchestratorClient } from '../../core/discovery/topology.js';
import { getProxySQLManager } from '../../core/routing/proxysql-manager.js';
import { getPrometheusExporter } from '../../core/monitoring/exporters.js';
import { getSettings } from '../../config/settings.js';

const monitoringRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check
  fastify.get('/health', async () => {
    const settings = getSettings();
    return {
      status: 'healthy',
      version: settings.appVersion,
    };
  });

  // System health
  fastify.get('/system', async () => {
    const orchestrator = getOrchestratorClient();
    const proxysql = getProxySQLManager();

    // Check Orchestrator
    let orchestratorHealth: 'healthy' | 'unhealthy' = 'unhealthy';
    try {
      orchestratorHealth = await orchestrator.healthCheck() ? 'healthy' : 'unhealthy';
    } catch {
      orchestratorHealth = 'unhealthy';
    }

    // Check ProxySQL
    let proxysqlHealth: 'healthy' | 'unhealthy' = 'unhealthy';
    try {
      await proxysql.connect();
      proxysqlHealth = 'healthy';
    } catch {
      proxysqlHealth = 'unhealthy';
    }

    // Check Prometheus (simplified)
    let prometheusHealth: 'healthy' | 'unhealthy' = 'healthy';
    try {
      const response = await fetch('http://prometheus:9090/-/healthy');
      prometheusHealth = response.ok ? 'healthy' : 'unhealthy';
    } catch {
      prometheusHealth = 'unhealthy';
    }

    const allHealthy = orchestratorHealth === 'healthy' &&
      proxysqlHealth === 'healthy' &&
      prometheusHealth === 'healthy';

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      services: {
        api: 'healthy',
        orchestrator: orchestratorHealth,
        proxysql: proxysqlHealth,
        prometheus: prometheusHealth,
      },
      timestamp: new Date(),
    };
  });

  // Prometheus metrics
  fastify.get('/metrics', async () => {
    const exporter = getPrometheusExporter();
    const metrics = await exporter.getMetrics();
    return metrics;
  });
};

export default monitoringRoutes;
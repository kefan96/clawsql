/**
 * ClawSQL - Prometheus Exporter
 *
 * Exports metrics in Prometheus format.
 */

import client from 'prom-client';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('prometheus');

// Initialize default metrics
client.collectDefaultMetrics();

// Custom metrics
const failoverTotal = new client.Counter({
  name: 'clawsql_failover_total',
  help: 'Total number of failover operations',
  labelNames: ['cluster_id', 'success'],
});

const failoverDuration = new client.Histogram({
  name: 'clawsql_failover_duration_seconds',
  help: 'Duration of failover operations',
  labelNames: ['cluster_id'],
  buckets: [1, 5, 10, 20, 30, 60],
});

const failoverInProgress = new client.Gauge({
  name: 'clawsql_failover_in_progress',
  help: 'Whether a failover is in progress',
  labelNames: ['cluster_id'],
});

const instanceHealth = new client.Gauge({
  name: 'clawsql_instance_health',
  help: 'Health status of MySQL instances (1=healthy, 0=unhealthy)',
  labelNames: ['instance_id', 'cluster_id', 'role'],
});

const replicationLag = new client.Gauge({
  name: 'clawsql_replication_lag_seconds',
  help: 'Replication lag in seconds',
  labelNames: ['instance_id', 'cluster_id'],
});

const connectionsTotal = new client.Gauge({
  name: 'clawsql_connections_total',
  help: 'Total connections to MySQL instance',
  labelNames: ['instance_id', 'cluster_id'],
});

const queriesPerSecond = new client.Gauge({
  name: 'clawsql_queries_per_second',
  help: 'Queries per second on MySQL instance',
  labelNames: ['instance_id', 'cluster_id'],
});

/**
 * Prometheus Exporter
 */
export class PrometheusExporter {
  private registry: client.Registry;

  constructor() {
    this.registry = client.register;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get content type for HTTP response
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Record a failover operation
   */
  recordFailover(clusterId: string, success: boolean, durationSeconds: number): void {
    failoverTotal.inc({ cluster_id: clusterId, success: success.toString() });
    failoverDuration.observe({ cluster_id: clusterId }, durationSeconds);
    logger.debug({ clusterId, success, durationSeconds }, 'Failover recorded');
  }

  /**
   * Set failover in progress status
   */
  setFailoverInProgress(clusterId: string, inProgress: boolean): void {
    failoverInProgress.set({ cluster_id: clusterId }, inProgress ? 1 : 0);
  }

  /**
   * Update instance health metric
   */
  updateInstanceHealth(
    instanceId: string,
    clusterId: string,
    role: string,
    healthy: boolean
  ): void {
    instanceHealth.set(
      { instance_id: instanceId, cluster_id: clusterId, role },
      healthy ? 1 : 0
    );
  }

  /**
   * Update replication lag metric
   */
  updateReplicationLag(instanceId: string, clusterId: string, lagSeconds: number): void {
    replicationLag.set({ instance_id: instanceId, cluster_id: clusterId }, lagSeconds);
  }

  /**
   * Update connections metric
   */
  updateConnections(instanceId: string, clusterId: string, total: number): void {
    connectionsTotal.set({ instance_id: instanceId, cluster_id: clusterId }, total);
  }

  /**
   * Update QPS metric
   */
  updateQPS(instanceId: string, clusterId: string, qps: number): void {
    queriesPerSecond.set({ instance_id: instanceId, cluster_id: clusterId }, qps);
  }
}

// Singleton instance
let prometheusExporter: PrometheusExporter | null = null;

/**
 * Get the Prometheus exporter instance
 */
export function getPrometheusExporter(): PrometheusExporter {
  if (!prometheusExporter) {
    prometheusExporter = new PrometheusExporter();
  }
  return prometheusExporter;
}
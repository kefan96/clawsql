/**
 * ClawSQL - Predefined Templates
 *
 * Benchmarking templates for common MySQL cluster scenarios.
 * These templates are automatically initialized on first start.
 */

import { TopologyTemplate, ReplicationMode, createTopologyTemplate } from '../../types/index.js';
import { randomUUID } from 'crypto';

/**
 * Predefined template definitions
 */
export interface PredefinedTemplateDefinition {
  name: string;
  description: string;
  primaryCount: number;
  replicaCount: number;
  replicationMode: ReplicationMode;
  settings?: TopologyTemplate['settings'];
  useCase: string;
}

/**
 * Predefined benchmarking templates for MySQL clusters
 *
 * These templates cover common deployment scenarios from development
 * to high-availability production setups.
 */
export const PREDEFINED_TEMPLATES: PredefinedTemplateDefinition[] = [
  {
    name: 'dev-single',
    description: 'Single MySQL instance for development/testing',
    primaryCount: 1,
    replicaCount: 0,
    replicationMode: ReplicationMode.ASYNC,
    useCase: 'Local development, testing, CI/CD pipelines',
  },
  {
    name: 'dev-replica',
    description: 'Primary with one replica for development with redundancy',
    primaryCount: 1,
    replicaCount: 1,
    replicationMode: ReplicationMode.ASYNC,
    settings: { maxReplicationLag: 60 },
    useCase: 'Development with backup, read scaling tests',
  },
  {
    name: 'standard',
    description: 'Standard production setup: 1 primary + 2 async replicas',
    primaryCount: 1,
    replicaCount: 2,
    replicationMode: ReplicationMode.ASYNC,
    settings: { maxReplicationLag: 30, failoverPriority: 'lowest-lag' },
    useCase: 'General production workloads, moderate read scaling',
  },
  {
    name: 'ha-semisync',
    description: 'High availability with semi-sync replication: 1 primary + 2 replicas',
    primaryCount: 1,
    replicaCount: 2,
    replicationMode: ReplicationMode.SEMI_SYNC,
    settings: { maxReplicationLag: 10, failoverPriority: 'highest-binlog' },
    useCase: 'Critical production, financial transactions, zero data loss requirement',
  },
  {
    name: 'read-heavy',
    description: 'Read-heavy workload: 1 primary + 4 async replicas',
    primaryCount: 1,
    replicaCount: 4,
    replicationMode: ReplicationMode.ASYNC,
    settings: { maxReplicationLag: 30, failoverPriority: 'lowest-lag' },
    useCase: 'Analytics, reporting, content delivery, high read throughput',
  },
  {
    name: 'production-ha',
    description: 'Maximum availability: 1 primary + 3 semi-sync replicas',
    primaryCount: 1,
    replicaCount: 3,
    replicationMode: ReplicationMode.SEMI_SYNC,
    settings: { maxReplicationLag: 5, failoverPriority: 'highest-binlog' },
    useCase: 'Mission-critical production, enterprise databases, compliance requirements',
  },
  {
    name: 'geo-distributed',
    description: 'Geo-distributed setup: 1 primary + 5 async replicas across regions',
    primaryCount: 1,
    replicaCount: 5,
    replicationMode: ReplicationMode.ASYNC,
    settings: { maxReplicationLag: 120, failoverPriority: 'lowest-lag' },
    useCase: 'Multi-region deployment, disaster recovery, global read availability',
  },
];

/**
 * Create a TopologyTemplate from a predefined definition
 */
export function createPredefinedTemplate(
  definition: PredefinedTemplateDefinition
): TopologyTemplate {
  return createTopologyTemplate(randomUUID(), {
    name: definition.name,
    description: definition.description,
    primaryCount: definition.primaryCount,
    replicaCount: definition.replicaCount,
    replicationMode: definition.replicationMode,
    settings: definition.settings,
  });
}

/**
 * Get predefined template by name
 */
export function getPredefinedTemplate(name: string): PredefinedTemplateDefinition | undefined {
  return PREDEFINED_TEMPLATES.find((t) => t.name === name);
}

/**
 * Check if a template name is a predefined template
 */
export function isPredefinedTemplate(name: string): boolean {
  return PREDEFINED_TEMPLATES.some((t) => t.name === name);
}

/**
 * Get all predefined template names
 */
export function getPredefinedTemplateNames(): string[] {
  return PREDEFINED_TEMPLATES.map((t) => t.name);
}
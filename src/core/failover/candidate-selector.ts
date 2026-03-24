/**
 * ClawSQL - Candidate Selector
 *
 * Selects the best candidate for promotion during failover.
 * Implements the Strategy Pattern for different selection strategies.
 */

import { MySQLCluster, MySQLInstance, InstanceState } from '../../types/index.js';

/**
 * Candidate selection strategy
 */
export interface SelectionStrategy {
  select(replicas: MySQLInstance[]): MySQLInstance | null;
}

/**
 * Default selection strategy
 * Selects the replica with lowest replication lag among healthy instances.
 */
export class LowestLagStrategy implements SelectionStrategy {
  select(replicas: MySQLInstance[]): MySQLInstance | null {
    const healthyReplicas = replicas.filter(
      r => this.isHealthy(r)
    );

    if (healthyReplicas.length === 0) {
      return null;
    }

    // Sort by replication lag (prefer lowest)
    const sorted = [...healthyReplicas].sort((a, b) => {
      const lagA = a.replicationLag ?? Infinity;
      const lagB = b.replicationLag ?? Infinity;
      return lagA - lagB;
    });

    return sorted[0];
  }

  private isHealthy(instance: MySQLInstance): boolean {
    return instance.state === InstanceState.ONLINE;
  }
}

/**
 * Candidate Selector
 * Handles the selection of the best replica to promote.
 */
export class CandidateSelector {
  private strategy: SelectionStrategy;

  constructor(strategy?: SelectionStrategy) {
    this.strategy = strategy || new LowestLagStrategy();
  }

  /**
   * Select the best candidate from cluster replicas
   */
  select(cluster: MySQLCluster): MySQLInstance | null {
    if (!cluster.replicas.length) {
      return null;
    }
    return this.strategy.select(cluster.replicas);
  }

  /**
   * Find a specific replica by ID
   */
  static findReplica(cluster: MySQLCluster, targetId: string): MySQLInstance | undefined {
    return cluster.replicas.find(
      r => `${r.host}:${r.port}` === targetId || r.host === targetId
    );
  }

  /**
   * Get instance ID string
   */
  static getInstanceId(instance: MySQLInstance): string {
    return `${instance.host}:${instance.port}`;
  }
}

/**
 * Default selector instance
 */
export const candidateSelector = new CandidateSelector();
/**
 * ClawSQL - Sync Types
 *
 * Type definitions for synchronization operations.
 */

import { MySQLCluster } from '../../types/index.js';

/**
 * Orchestrator failover webhook payload
 * Sent by Orchestrator after failover completion
 */
export interface OrchestratorFailoverPayload {
  /** Cluster alias/name */
  cluster: string;
  /** Old master (host:port) */
  master: string;
  /** New master (host:port) */
  successor: string;
  /** New master hostname */
  successorHost?: string;
  /** New master port */
  successorPort?: number;
  /** Whether the failover succeeded */
  isSuccessful: boolean;
  /** Type of failover */
  failoverType: 'master' | 'intermediate-master';
  /** Reason for failover */
  reason?: string;
  /** Timestamp of the event */
  timestamp?: string;
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Whether the sync was skipped */
  skipped: boolean;
  /** Reason for skipping (if applicable) */
  reason?: 'cooldown' | 'disabled' | 'no_change' | 'failed' | 'invalid_input';
  /** Cluster ID that was synced */
  clusterId?: string;
  /** Number of servers synced */
  serversSynced?: number;
  /** Error message if sync failed */
  error?: string;
  /** Source of the sync trigger */
  source?: 'webhook' | 'poll' | 'manual';
}

/**
 * Topology hash for change detection
 */
export interface TopologyHash {
  clusterId: string;
  hash: string;
  updatedAt: Date;
}

/**
 * Sync context passed through the sync pipeline
 */
export interface SyncContext {
  cluster: MySQLCluster;
  source: 'webhook' | 'poll' | 'manual';
  webhookPayload?: OrchestratorFailoverPayload;
  force?: boolean;
}

/**
 * Sync coordinator stats
 */
export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  skippedSyncs: number;
  lastSyncAt?: Date;
  lastSyncCluster?: string;
}

/**
 * Webhook handler result
 */
export interface WebhookResult {
  received: boolean;
  processed: boolean;
  message?: string;
  syncResult?: SyncResult;
}
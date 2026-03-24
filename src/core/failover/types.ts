/**
 * ClawSQL - Failover Types
 *
 * Type definitions for failover operations.
 */

import { MySQLCluster, MySQLInstance, FailoverOperation } from '../../types/index.js';

/**
 * Pre/Post failover hook type
 */
export type FailoverHook = (operation: FailoverOperation, cluster: MySQLCluster) => Promise<void>;

/**
 * Old primary awaiting recovery
 */
export interface PendingRecovery {
  clusterId: string;
  instanceId: string;
  host: string;
  port: number;
  newPrimaryId: string;
  failedAt: Date;
  recoveredAt?: Date;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  success: boolean;
  message: string;
}

/**
 * Batch recovery result
 */
export interface BatchRecoveryResult {
  recovered: string[];
  stillPending: string[];
  errors: string[];
}

/**
 * Promotion result
 */
export interface PromotionResult {
  success: boolean;
  error?: string;
}

/**
 * Operation context passed through execution steps
 */
export interface OperationContext {
  operation: FailoverOperation;
  cluster: MySQLCluster;
  newPrimary: MySQLInstance | null;
  addStep: (step: string) => void;
}
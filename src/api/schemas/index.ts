/**
 * ClawSQL - API Schemas
 *
 * Zod schemas for request/response validation.
 */

import { z } from 'zod';

// =============================================================================
// Common Schemas
// =============================================================================

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// =============================================================================
// Instance Schemas
// =============================================================================

export const InstanceRoleSchema = z.enum(['primary', 'replica', 'unknown']);
export const InstanceStateSchema = z.enum(['online', 'offline', 'recovering', 'failed', 'maintenance']);

export const InstanceCreateRequest = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(3306),
  cluster_id: z.string().optional(),
  labels: z.record(z.string()).optional(),
});

export const InstanceDiscoverRequest = z.object({
  network_segments: z.array(z.string()).min(1),
  port_range: z.tuple([z.number(), z.number()]).optional(),
});

export const MaintenanceRequest = z.object({
  reason: z.string().min(1),
  duration_minutes: z.number().int().min(1).max(1440).default(60),
});

export const InstanceResponse = z.object({
  instance_id: z.string(),
  host: z.string(),
  port: z.number(),
  server_id: z.number().nullable(),
  role: InstanceRoleSchema,
  state: InstanceStateSchema,
  version: z.string().nullable(),
  cluster_id: z.string().nullable(),
  replication_lag: z.number().nullable(),
  labels: z.record(z.string()),
  last_seen: z.coerce.date(),
  created_at: z.coerce.date(),
});

export const InstanceListResponse = z.object({
  items: z.array(InstanceResponse),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export const InstanceMetricsResponse = z.object({
  instance_id: z.string(),
  timestamp: z.coerce.date(),
  replication_lag_seconds: z.number().nullable(),
  replication_io_running: z.boolean(),
  replication_sql_running: z.boolean(),
  connections_current: z.number(),
  connections_max: z.number(),
  queries_per_second: z.number(),
  innodb_buffer_pool_hit_rate: z.number(),
  uptime_seconds: z.number(),
});

export const InstanceHealthResponse = z.object({
  instance_id: z.string(),
  status: z.enum(['healthy', 'unhealthy', 'unknown']),
  checks: z.array(z.object({
    check_name: z.string(),
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    value: z.number(),
    message: z.string(),
  })),
});

export const DiscoveryResponse = z.object({
  task_id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  network_segments: z.array(z.string()),
  instances_found: z.number(),
  instances: z.array(InstanceResponse).optional(),
  error: z.string().optional(),
  started_at: z.coerce.date().optional(),
  completed_at: z.coerce.date().optional(),
});

// =============================================================================
// Cluster Schemas
// =============================================================================

export const ClusterCreateRequest = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const ClusterResponse = z.object({
  cluster_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  primary: InstanceResponse.nullable(),
  replicas: z.array(InstanceResponse),
  instance_count: z.number(),
  health_status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const ClusterListResponse = z.object({
  items: z.array(ClusterResponse),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

// =============================================================================
// Failover Schemas
// =============================================================================

export const FailoverStateSchema = z.enum([
  'idle', 'detecting', 'candidate_selection', 'promoting',
  'reconfiguring', 'completed', 'failed'
]);

export const FailoverRequest = z.object({
  target_instance_id: z.string().optional(),
  reason: z.string().optional(),
});

export const FailoverOperationResponse = z.object({
  operation_id: z.string(),
  cluster_id: z.string(),
  old_primary_id: z.string().nullable(),
  new_primary_id: z.string().nullable(),
  state: FailoverStateSchema,
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  steps: z.array(z.string()),
  error: z.string().nullable(),
  manual: z.boolean(),
  reason: z.string().nullable(),
  triggered_by: z.string().nullable(),
});

export const FailoverListResponse = z.object({
  items: z.array(FailoverOperationResponse),
  total: z.number(),
});

// =============================================================================
// Monitoring Schemas
// =============================================================================

export const HealthStatusResponse = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  version: z.string(),
  uptime_seconds: z.number().optional(),
});

export const MonitoringHealthResponse = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  services: z.object({
    api: z.enum(['healthy', 'unhealthy']),
    orchestrator: z.enum(['healthy', 'unhealthy']),
    proxysql: z.enum(['healthy', 'unhealthy']),
    prometheus: z.enum(['healthy', 'unhealthy']),
  }),
  timestamp: z.coerce.date(),
});

// =============================================================================
// Common Response Schemas
// =============================================================================

export const SuccessResponse = z.object({
  message: z.string(),
});

export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
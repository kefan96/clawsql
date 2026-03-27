/**
 * ClawSQL - Configuration Settings
 *
 * Application configuration loaded from environment variables.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// =============================================================================
// Configuration Schemas
// =============================================================================

const MetadataDBSettingsSchema = z.object({
  host: z.string().optional(),  // If not set, use 'metadata-mysql' container
  port: z.number().int().min(1).max(65535).default(3306),
  name: z.string().default('clawsql_meta'),
  user: z.string().default('clawsql'),
  password: z.string().default('clawsql_password'),
  poolSize: z.number().int().min(1).max(100).default(10),
});

const OrchestratorSettingsSchema = z.object({
  url: z.string().url().default('http://localhost:3000'),
  timeout: z.number().positive().default(30.0),
  tlsEnabled: z.boolean().default(false),
  tlsCert: z.string().optional(),
  tlsKey: z.string().optional(),
});

const ProxySQLSettingsSchema = z.object({
  host: z.string().default('localhost'),
  adminPort: z.number().int().default(6032),
  mysqlPort: z.number().int().default(6033),
  adminUser: z.string().default('clawsql'),
  adminPassword: z.string().default('clawsql'),
});

const PrometheusSettingsSchema = z.object({
  url: z.string().url().default('http://localhost:9090'),
  retentionDays: z.number().int().positive().default(15),
});

const MonitoringSettingsSchema = z.object({
  collectionInterval: z.number().positive().default(15.0),
  healthCheckInterval: z.number().positive().default(10.0),
  alertCooldownMinutes: z.number().int().min(0).default(5),
});

const FailoverSettingsSchema = z.object({
  autoFailoverEnabled: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(10).default(30),
  minReplicasForFailover: z.number().int().min(0).default(2),
  confirmationChecks: z.number().int().min(1).default(3),
});

const DiscoverySettingsSchema = z.object({
  networkSegments: z.string().default('172.18.0.0/24'),
  portRangeStart: z.number().int().default(3306),
  portRangeEnd: z.number().int().default(3306),
  timeout: z.number().positive().default(2.0),
  maxConcurrent: z.number().int().positive().default(100),
});

const APISettingsSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(8080),
  tokenSecret: z.string().default('change-me-in-production'),
  tokenExpiryHours: z.number().int().positive().default(24),
});

const MySQLCredentialsSchema = z.object({
  adminUser: z.string().default('clawsql'),
  adminPassword: z.string().default(''),
  replicationUser: z.string().default('repl'),
  replicationPassword: z.string().default(''),
});

const LogSettingsSchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'SILENT']).default('ERROR'),
  format: z.enum(['json', 'text']).default('json'),
});

const AISettingsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['anthropic', 'openai', 'openclaw']).default('openclaw'),
  model: z.string().optional(),
  maxTokens: z.number().int().min(100).max(32000).default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
});

const SyncSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(60000).default(300000), // 5 minutes default
  webhookSecret: z.string().optional(),
  syncCooldownMs: z.number().int().min(1000).default(5000),
  debounceMs: z.number().int().min(100).default(1000),
  maxRetries: z.number().int().min(1).max(5).default(2),
});

const SettingsSchema = z.object({
  appName: z.string().default('ClawSQL'),
  appVersion: z.string().default('0.1.6'),
  debug: z.boolean().default(false),
  metadataDb: MetadataDBSettingsSchema,
  orchestrator: OrchestratorSettingsSchema,
  proxysql: ProxySQLSettingsSchema,
  prometheus: PrometheusSettingsSchema,
  monitoring: MonitoringSettingsSchema,
  failover: FailoverSettingsSchema,
  discovery: DiscoverySettingsSchema,
  api: APISettingsSchema,
  mysql: MySQLCredentialsSchema,
  logging: LogSettingsSchema,
  ai: AISettingsSchema,
  sync: SyncSettingsSchema,
});

// =============================================================================
// Types
// =============================================================================

export type MetadataDBSettings = z.infer<typeof MetadataDBSettingsSchema>;
export type OrchestratorSettings = z.infer<typeof OrchestratorSettingsSchema>;
export type ProxySQLSettings = z.infer<typeof ProxySQLSettingsSchema>;
export type PrometheusSettings = z.infer<typeof PrometheusSettingsSchema>;
export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;
export type FailoverSettings = z.infer<typeof FailoverSettingsSchema>;
export type DiscoverySettings = z.infer<typeof DiscoverySettingsSchema>;
export type APISettings = z.infer<typeof APISettingsSchema>;
export type MySQLCredentials = z.infer<typeof MySQLCredentialsSchema>;
export type LogSettings = z.infer<typeof LogSettingsSchema>;
export type AISettings = z.infer<typeof AISettingsSchema>;
export type SyncSettings = z.infer<typeof SyncSettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

// =============================================================================
// Helper functions for environment variable parsing
// =============================================================================

function getEnvString(key: string, prefix: string = ''): string | undefined {
  return process.env[`${prefix}${key}`];
}

function getEnvNumber(key: string, prefix: string = ''): number | undefined {
  const value = process.env[`${prefix}${key}`];
  return value ? parseFloat(value) : undefined;
}

function getEnvInt(key: string, prefix: string = ''): number | undefined {
  const value = process.env[`${prefix}${key}`];
  return value ? parseInt(value, 10) : undefined;
}

function getEnvBool(key: string, prefix: string = ''): boolean | undefined {
  const value = process.env[`${prefix}${key}`];
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true' || value === '1';
}

// =============================================================================
// Load and validate settings
// =============================================================================

function loadSettings(): Settings {
  const rawSettings = {
    appName: getEnvString('APP_NAME'),
    appVersion: getEnvString('APP_VERSION'),
    debug: getEnvBool('DEBUG'),

    metadataDb: {
      host: getEnvString('METADATA_DB_HOST'),
      port: getEnvInt('METADATA_DB_PORT'),
      name: getEnvString('METADATA_DB_NAME'),
      user: getEnvString('METADATA_DB_USER'),
      password: getEnvString('METADATA_DB_PASSWORD'),
      poolSize: getEnvInt('METADATA_DB_POOL_SIZE'),
    },

    orchestrator: {
      url: getEnvString('ORCHESTRATOR_URL'),
      timeout: getEnvNumber('ORCHESTRATOR_TIMEOUT'),
      tlsEnabled: getEnvBool('ORCHESTRATOR_TLS_ENABLED'),
      tlsCert: getEnvString('ORCHESTRATOR_TLS_CERT'),
      tlsKey: getEnvString('ORCHESTRATOR_TLS_KEY'),
    },

    proxysql: {
      host: getEnvString('PROXYSQL_HOST'),
      adminPort: getEnvInt('PROXYSQL_ADMIN_PORT'),
      mysqlPort: getEnvInt('PROXYSQL_MYSQL_PORT'),
      adminUser: getEnvString('PROXYSQL_ADMIN_USER'),
      adminPassword: getEnvString('PROXYSQL_ADMIN_PASSWORD'),
    },

    prometheus: {
      url: getEnvString('PROMETHEUS_URL'),
      retentionDays: getEnvInt('PROMETHEUS_RETENTION_DAYS'),
    },

    monitoring: {
      collectionInterval: getEnvNumber('MONITORING_COLLECTION_INTERVAL'),
      healthCheckInterval: getEnvNumber('MONITORING_HEALTH_CHECK_INTERVAL'),
      alertCooldownMinutes: getEnvInt('MONITORING_ALERT_COOLDOWN_MINUTES'),
    },

    failover: {
      autoFailoverEnabled: getEnvBool('AUTO_FAILOVER_ENABLED'),
      timeoutSeconds: getEnvInt('FAILOVER_TIMEOUT_SECONDS'),
      minReplicasForFailover: getEnvInt('FAILOVER_MIN_REPLICAS'),
      confirmationChecks: getEnvInt('FAILOVER_CONFIRMATION_CHECKS'),
    },

    discovery: {
      networkSegments: getEnvString('DISCOVERY_NETWORK_SEGMENTS'),
      portRangeStart: getEnvInt('DISCOVERY_PORT_RANGE_START'),
      portRangeEnd: getEnvInt('DISCOVERY_PORT_RANGE_END'),
      timeout: getEnvNumber('DISCOVERY_TIMEOUT'),
      maxConcurrent: getEnvInt('DISCOVERY_MAX_CONCURRENT'),
    },

    api: {
      host: getEnvString('API_HOST'),
      port: getEnvInt('API_PORT'),
      tokenSecret: getEnvString('API_TOKEN_SECRET'),
      tokenExpiryHours: getEnvInt('API_TOKEN_EXPIRY_HOURS'),
    },

    mysql: {
      adminUser: getEnvString('MYSQL_ADMIN_USER'),
      adminPassword: getEnvString('MYSQL_ADMIN_PASSWORD'),
      replicationUser: getEnvString('MYSQL_REPLICATION_USER'),
      replicationPassword: getEnvString('MYSQL_REPLICATION_PASSWORD'),
    },

    logging: {
      level: getEnvString('LOG_LEVEL') as 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'SILENT' | undefined,
      format: getEnvString('LOG_FORMAT') as 'json' | 'text' | undefined,
    },

    ai: {
      enabled: getEnvBool('CLAWSQL_AI_ENABLED'),
      provider: getEnvString('CLAWSQL_AI_PROVIDER') as 'anthropic' | 'openai' | undefined,
      model: getEnvString('CLAWSQL_AI_MODEL'),
      maxTokens: getEnvInt('CLAWSQL_AI_MAX_TOKENS'),
      temperature: getEnvNumber('CLAWSQL_AI_TEMPERATURE'),
    },

    sync: {
      enabled: getEnvBool('SYNC_ENABLED'),
      pollIntervalMs: getEnvInt('SYNC_POLL_INTERVAL_MS'),
      webhookSecret: getEnvString('SYNC_WEBHOOK_SECRET'),
      syncCooldownMs: getEnvInt('SYNC_COOLDOWN_MS'),
      debounceMs: getEnvInt('SYNC_DEBOUNCE_MS'),
      maxRetries: getEnvInt('SYNC_MAX_RETRIES'),
    },
  };

  // Remove undefined values recursively
  const removeUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          result[key] = removeUndefined(value as Record<string, unknown>);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  };

  return SettingsSchema.parse(removeUndefined(rawSettings as Record<string, unknown>));
}

// Cached settings instance
let cachedSettings: Settings | null = null;

/**
 * Get application settings (cached)
 */
export function getSettings(): Settings {
  if (!cachedSettings) {
    cachedSettings = loadSettings();
  }
  return cachedSettings;
}

/**
 * Reset settings cache (for testing)
 */
export function resetSettings(): void {
  cachedSettings = null;
}
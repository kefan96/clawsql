/**
 * ClawSQL - Configuration API Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { getSettings } from '../../config/settings.js';

const configRoutes: FastifyPluginAsync = async (fastify) => {
  // Get current configuration
  fastify.get('/', async () => {
    const settings = getSettings();

    // Return safe configuration (hide secrets)
    return {
      app: {
        name: settings.appName,
        version: settings.appVersion,
        debug: settings.debug,
      },
      api: {
        host: settings.api.host,
        port: settings.api.port,
      },
      database: {
        type: settings.database.type,
        ...(settings.database.type === 'mysql' && {
          host: settings.database.host,
          port: settings.database.port,
          name: settings.database.name,
        }),
        ...(settings.database.type === 'sqlite' && {
          path: settings.database.sqlitePath,
        }),
      },
      orchestrator: {
        url: settings.orchestrator.url,
        timeout: settings.orchestrator.timeout,
      },
      proxysql: {
        host: settings.proxysql.host,
        admin_port: settings.proxysql.adminPort,
        mysql_port: settings.proxysql.mysqlPort,
      },
      prometheus: {
        url: settings.prometheus.url,
      },
      failover: {
        auto_failover_enabled: settings.failover.autoFailoverEnabled,
        timeout_seconds: settings.failover.timeoutSeconds,
        min_replicas_for_failover: settings.failover.minReplicasForFailover,
        confirmation_checks: settings.failover.confirmationChecks,
      },
      monitoring: {
        collection_interval: settings.monitoring.collectionInterval,
        health_check_interval: settings.monitoring.healthCheckInterval,
      },
      logging: {
        level: settings.logging.level,
        format: settings.logging.format,
      },
    };
  });

  // Get version
  fastify.get('/version', async () => {
    const settings = getSettings();
    return {
      version: settings.appVersion,
      name: settings.appName,
    };
  });
};

export default configRoutes;
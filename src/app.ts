/**
 * ClawSQL - Fastify Application
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { getSettings } from './config/settings.js';
import { setupLogger } from './utils/logger.js';
import { initDatabase } from './utils/database.js';
import { ClawSQLError } from './utils/exceptions.js';

// Import routes
import instancesRoutes from './api/routes/instances.js';
import clustersRoutes from './api/routes/clusters.js';
import failoverRoutes from './api/routes/failover.js';
import monitoringRoutes from './api/routes/monitoring.js';
import configRoutes from './api/routes/config.js';
import webhookRoutes from './api/routes/webhooks.js';

// Import sync services
import { getTopologyWatcher } from './core/sync/topology-watcher.js';

/**
 * Create and configure the Fastify application
 */
export async function createApp() {
  const settings = getSettings();
  setupLogger();

  const fastify = Fastify({
    logger: {
      level: settings.logging.level.toLowerCase(),
      transport: settings.logging.format === 'text' || process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  }).withTypeProvider<ZodTypeProvider>();

  // Set up Zod validation
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Register plugins
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Swagger documentation
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'ClawSQL',
        description: `
## MySQL Cluster Automation and Operations Management System

ClawSQL provides comprehensive automation for MySQL cluster management:

### Features
- **Instance Discovery**: Automatically discover MySQL instances in your network
- **Cluster Monitoring**: Real-time monitoring with health checks and alerts
- **Failover Management**: Automatic and manual failover with candidate selection
- **Load Management**: Read/write splitting via ProxySQL integration
- **Configuration Management**: Versioned configuration with rollback capability

### Architecture
- Orchestrator for topology management
- ProxySQL for query routing
- Prometheus for metrics collection
- Grafana for visualization
        `,
        version: '0.1.3',
      },
      servers: [
        { url: '/', description: 'Current server' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      version: settings.appVersion,
    };
  });

  // Root endpoint
  fastify.get('/', async () => {
    return {
      name: 'ClawSQL',
      version: '0.1.3',
      description: 'MySQL Cluster Automation and Operations Management',
      docs: '/docs',
      health: '/health',
    };
  });

  // Register API routes
  await fastify.register(instancesRoutes, { prefix: '/api/v1/instances' });
  await fastify.register(clustersRoutes, { prefix: '/api/v1/clusters' });
  await fastify.register(failoverRoutes, { prefix: '/api/v1/failover' });
  await fastify.register(monitoringRoutes, { prefix: '/api/v1/monitoring' });
  await fastify.register(configRoutes, { prefix: '/api/v1/config' });
  await fastify.register(webhookRoutes, { prefix: '/api/v1/webhooks' });

  // Error handler
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ClawSQLError) {
      reply.code(400).send(error.toJSON());
      return;
    }

    // Fastify validation errors
    if (error.validation) {
      reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      });
      return;
    }

    // Log unexpected errors
    request.log.error(error);
    reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
    });
  });

  return fastify;
}

/**
 * Start the server
 */
export async function startServer() {
  const settings = getSettings();
  const fastify = await createApp();

  // Initialize database
  try {
    await initDatabase();
  } catch (error) {
    fastify.log.warn({ error }, 'Failed to initialize database, continuing without persistence');
  }

  // Start listening
  try {
    await fastify.listen({
      host: settings.api.host,
      port: settings.api.port,
    });

    fastify.log.info(
      `ClawSQL API running at http://${settings.api.host}:${settings.api.port}`
    );
    fastify.log.info(`API Docs available at http://${settings.api.host}:${settings.api.port}/docs`);

    // Start topology watcher for automatic ProxySQL sync
    const topologyWatcher = getTopologyWatcher();
    await topologyWatcher.start();
    fastify.log.info('Topology watcher started - ProxySQL will auto-sync on topology changes');

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      fastify.log.info(`Received ${signal}, shutting down gracefully...`);
      topologyWatcher.stop();
      await fastify.close();
      fastify.log.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return fastify;
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}
/**
 * ClawSQL CLI - Agent Tools
 *
 * Tool definitions for AI agent operations.
 */

import { AgentTool, ToolParameterSchema } from '../providers/base.js';
import { CLIContext } from '../../registry.js';

/**
 * Create the get_topology tool
 */
export function createTopologyTool(ctx: CLIContext): AgentTool {
  const parameters: ToolParameterSchema = {
    type: 'object',
    description: 'Get cluster topology information',
    properties: {
      clusterName: {
        type: 'string',
        description: 'Name of the cluster to get topology for (optional, defaults to all clusters)',
      },
    },
  };

  return {
    name: 'get_topology',
    description: 'Get the current MySQL cluster topology showing primary and replicas with their status',
    parameters,
    execute: async (params: Record<string, unknown>) => {
      try {
        const clusterName = params.clusterName as string | undefined;

        if (clusterName) {
          const cluster = await ctx.orchestrator.getTopology(clusterName);
          if (!cluster) {
            return { error: `Cluster '${clusterName}' not found` };
          }
          return {
            cluster: clusterName,
            primary: cluster.primary ? {
              host: cluster.primary.host,
              port: cluster.primary.port,
              state: cluster.primary.state,
              version: cluster.primary.version,
            } : null,
            replicas: cluster.replicas.map(r => ({
              host: r.host,
              port: r.port,
              state: r.state,
              replicationLag: r.replicationLag,
            })),
          };
        } else {
          const clusters = await ctx.orchestrator.getClusters();
          const results = [];

          for (const name of clusters) {
            const cluster = await ctx.orchestrator.getTopology(name);
            if (cluster) {
              results.push({
                cluster: name,
                primary: cluster.primary ? {
                  host: cluster.primary.host,
                  port: cluster.primary.port,
                  state: cluster.primary.state,
                } : null,
                replicaCount: cluster.replicas.length,
                healthyReplicas: cluster.replicas.filter(r => r.state === 'online').length,
              });
            }
          }

          return { clusters: results };
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Create the get_instance_health tool
 */
export function createInstanceHealthTool(ctx: CLIContext): AgentTool {
  const parameters: ToolParameterSchema = {
    type: 'object',
    description: 'Get health status of MySQL instances',
    properties: {
      host: {
        type: 'string',
        description: 'Specific host to check (optional)',
      },
    },
  };

  return {
    name: 'get_instance_health',
    description: 'Get health status of MySQL instances including connectivity, replication lag, and metrics',
    parameters,
    execute: async (params: Record<string, unknown>) => {
      try {
        const host = params.host as string | undefined;
        const clusters = await ctx.orchestrator.getClusters();
        const results: Array<{
          host: string;
          port: number;
          role: string;
          state: string;
          replicationLag?: number;
        }> = [];

        for (const clusterName of clusters) {
          const cluster = await ctx.orchestrator.getTopology(clusterName);
          if (!cluster) continue;

          if (cluster.primary) {
            if (!host || cluster.primary.host === host) {
              results.push({
                host: cluster.primary.host,
                port: cluster.primary.port,
                role: 'primary',
                state: cluster.primary.state,
              });
            }
          }

          for (const replica of cluster.replicas) {
            if (!host || replica.host === host) {
              results.push({
                host: replica.host,
                port: replica.port,
                role: 'replica',
                state: replica.state,
                replicationLag: replica.replicationLag,
              });
            }
          }
        }

        return { instances: results };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Create the execute_sql tool
 */
export function createExecuteSQLTool(ctx: CLIContext): AgentTool {
  const parameters: ToolParameterSchema = {
    type: 'object',
    description: 'Execute SQL query via ProxySQL',
    properties: {
      query: {
        type: 'string',
        description: 'SQL query to execute (SELECT only for safety)',
      },
      hostgroup: {
        type: 'number',
        description: 'Hostgroup ID (optional, defaults to read hostgroup)',
      },
    },
    required: ['query'],
  };

  return {
    name: 'execute_sql',
    description: 'Execute a SQL query through ProxySQL. Use for SELECT queries to inspect database state.',
    parameters,
    execute: async (params: Record<string, unknown>) => {
      try {
        const query = params.query as string;

        // Safety check - only allow SELECT
        const normalizedQuery = query.trim().toUpperCase();
        if (!normalizedQuery.startsWith('SELECT') && !normalizedQuery.startsWith('SHOW')) {
          return { error: 'Only SELECT and SHOW queries are allowed for safety' };
        }

        // Use MySQL connection to ProxySQL's MySQL port
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: ctx.settings.proxysql.host,
          port: ctx.settings.proxysql.mysqlPort,
          user: ctx.settings.mysql.adminUser,
          password: ctx.settings.mysql.adminPassword,
        });

        const [rows] = await connection.execute(query);
        await connection.end();

        return { rows };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Create the get_failover_status tool
 */
export function createFailoverStatusTool(ctx: CLIContext): AgentTool {
  const parameters: ToolParameterSchema = {
    type: 'object',
    description: 'Get failover status and history',
    properties: {},
  };

  return {
    name: 'get_failover_status',
    description: 'Get the current failover configuration and recent failover history',
    parameters,
    execute: async (_params: Record<string, unknown>) => {
      try {
        const settings = ctx.settings;

        return {
          autoFailoverEnabled: settings.failover.autoFailoverEnabled,
          timeout: settings.failover.timeoutSeconds,
          minReplicas: settings.failover.minReplicasForFailover,
          confirmationChecks: settings.failover.confirmationChecks,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Create the get_clusters tool
 */
export function createClustersTool(ctx: CLIContext): AgentTool {
  const parameters: ToolParameterSchema = {
    type: 'object',
    description: 'List all discovered MySQL clusters',
    properties: {},
  };

  return {
    name: 'get_clusters',
    description: 'List all MySQL clusters managed by ClawSQL',
    parameters,
    execute: async (_params: Record<string, unknown>) => {
      try {
        const clusters = await ctx.orchestrator.getClusters();

        const results = await Promise.all(
          clusters.map(async (name) => {
            const topology = await ctx.orchestrator.getTopology(name);
            return {
              name,
              primaryHost: topology?.primary?.host || 'none',
              replicaCount: topology?.replicas?.length || 0,
              healthy: topology?.primary?.state === 'online',
            };
          })
        );

        return { clusters: results };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Create all agent tools
 */
export function createAgentTools(ctx: CLIContext): AgentTool[] {
  return [
    createTopologyTool(ctx),
    createInstanceHealthTool(ctx),
    createExecuteSQLTool(ctx),
    createFailoverStatusTool(ctx),
    createClustersTool(ctx),
  ];
}
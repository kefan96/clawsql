/**
 * ClawSQL - Cluster Provisioner
 *
 * Provisioning engine for template-based cluster setup.
 */

import mysql from 'mysql2/promise';
import { getLogger } from '../../utils/logger.js';
import { getDatabase } from '../../utils/database.js';
import { getSettings } from '../../config/settings.js';
import { getOrchestratorClient } from '../discovery/topology.js';
import { getProxySQLManager, ProxySQLManager } from '../routing/proxysql-manager.js';
import { getTemplateManager, HostSpec } from './template-manager.js';
import {
  ClusterMetadata,
  ProvisionStatus,
  createClusterMetadata,
} from '../../types/index.js';

const logger = getLogger('cluster-provisioner');

// Timeouts for orchestrator and replication operations
const ORCHESTRATOR_DISCOVERY_DELAY_MS = 1000;  // Wait for primary discovery
const TOPOLOGY_SYNC_DELAY_MS = 2000;           // Wait for topology discovery
const REPLICATION_VERIFY_DELAY_MS = 2000;       // Wait for replication to start

/**
 * Provisioning result
 */
export interface ProvisionResult {
  success: boolean;
  clusterId: string;
  clusterName: string;
  assignedPort: number;
  writerHostgroup: number;
  readerHostgroup: number;
  primary: HostSpec;
  replicas: HostSpec[];
  error?: string;
}

/**
 * Allocation result
 */
interface AllocationResult {
  port: number;
  writerHostgroup: number;
  readerHostgroup: number;
}

/**
 * Cluster Provisioner
 *
 * Handles template-based cluster provisioning including:
 * - Port allocation
 * - Hostgroup allocation
 * - Instance registration
 * - Replication setup
 * - ProxySQL configuration
 */
export class ClusterProvisioner {
  private templateManager = getTemplateManager();
  private db = getDatabase();

  /**
   * Provision a cluster from a template
   */
  async provision(
    templateName: string,
    clusterName: string,
    hosts: HostSpec[]
  ): Promise<ProvisionResult> {
    const settings = getSettings();

    logger.info({ templateName, clusterName, hostCount: hosts.length }, 'Starting cluster provisioning');

    const template = await this.templateManager.get(templateName);
    if (!template) {
      return this.failResult(clusterName, `Template "${templateName}" not found`);
    }

    const validation = await this.templateManager.validateHosts(template, hosts);
    if (!validation.valid) {
      return this.failResult(clusterName, validation.error!);
    }

    const clusterId = clusterName;
    const metadata = createClusterMetadata(clusterId, {
      provisionStatus: ProvisionStatus.PROVISIONING,
      templateId: template.templateId,
    });

    await this.saveMetadata(metadata);

    try {
      const allocation = await this.allocateResources(clusterId);
      metadata.assignedPort = allocation.port;
      metadata.writerHostgroup = allocation.writerHostgroup;
      metadata.readerHostgroup = allocation.readerHostgroup;
      metadata.provisionStatus = ProvisionStatus.PROVISIONING;

      await this.updateMetadata(metadata);

      const primary = hosts[0];
      const replicas = hosts.slice(1);

      await this.registerInstances(primary, replicas);
      await this.setupReplication(primary, replicas, settings.mysql);
      await this.configureProxySQL(clusterId, primary, replicas, allocation, settings.mysql);
      await this.saveProvisionedInstances(clusterId, primary, replicas);

      metadata.provisionStatus = ProvisionStatus.READY;
      await this.updateMetadata(metadata);

      logger.info({ clusterId, port: allocation.port, hostgroups: allocation }, 'Cluster provisioned successfully');

      return {
        success: true,
        clusterId,
        clusterName,
        assignedPort: allocation.port,
        writerHostgroup: allocation.writerHostgroup,
        readerHostgroup: allocation.readerHostgroup,
        primary,
        replicas,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, clusterId }, 'Provisioning failed');

      // Update metadata to failed
      metadata.provisionStatus = ProvisionStatus.FAILED;
      await this.updateMetadata(metadata);

      return this.failResult(clusterName, message);
    }
  }

  /**
   * Allocate port and hostgroups for a new cluster
   */
  private async allocateResources(clusterId: string): Promise<AllocationResult> {
    const settings = getSettings();

    // Get all existing allocations
    const existingPorts = await this.db.query<{ assigned_port: number }>(
      'SELECT assigned_port FROM cluster_metadata WHERE assigned_port IS NOT NULL'
    );
    const existingHostgroups = await this.db.query<{ writer_hostgroup: number }>(
      'SELECT writer_hostgroup FROM cluster_metadata WHERE writer_hostgroup IS NOT NULL'
    );

    // Find next available port
    const usedPorts = new Set(existingPorts.map((r) => r.assigned_port));
    let port = settings.proxysql.portRangeStart;
    while (usedPorts.has(port) && port <= settings.proxysql.portRangeEnd) {
      port++;
    }
    if (port > settings.proxysql.portRangeEnd) {
      throw new Error('No available ports in configured range');
    }

    // Find next available hostgroup block (each cluster gets writer=N, reader=N+10)
    const usedWriterHG = new Set(existingHostgroups.map((r) => r.writer_hostgroup));
    let writerHG = settings.proxysql.hostgroupRangeStart;
    while (usedWriterHG.has(writerHG) && writerHG <= settings.proxysql.hostgroupRangeEnd) {
      writerHG += 10; // Increment by 10 for each block
    }
    if (writerHG > settings.proxysql.hostgroupRangeEnd) {
      throw new Error('No available hostgroups in configured range');
    }
    const readerHG = writerHG + 10;

    logger.info({ clusterId, port, writerHG, readerHG }, 'Resources allocated');

    return { port, writerHostgroup: writerHG, readerHostgroup: readerHG };
  }

  /**
   * Register instances with Orchestrator
   */
  private async registerInstances(primary: HostSpec, replicas: HostSpec[]): Promise<void> {
    const orchestrator = getOrchestratorClient();

    // Register primary
    logger.info({ host: primary.host, port: primary.port }, 'Registering primary');
    await orchestrator.discoverInstance(primary.host, primary.port);

    // Wait for primary discovery
    await new Promise((resolve) => setTimeout(resolve, ORCHESTRATOR_DISCOVERY_DELAY_MS));

    // Register replicas
    for (const replica of replicas) {
      logger.info({ host: replica.host, port: replica.port }, 'Registering replica');
      await orchestrator.discoverInstance(replica.host, replica.port);
    }

    // Wait for topology discovery
    await new Promise((resolve) => setTimeout(resolve, TOPOLOGY_SYNC_DELAY_MS));
  }

  /**
   * Setup replication between primary and replicas
   */
  private async setupReplication(
    primary: HostSpec,
    replicas: HostSpec[],
    mysqlCredentials: { adminUser: string; adminPassword: string; replicationUser: string; replicationPassword: string }
  ): Promise<void> {
    const replUser = mysqlCredentials.replicationUser || 'repl';
    const replPassword = mysqlCredentials.replicationPassword || 'repl_password';

    // Escape values for safe SQL interpolation
    const escape = mysql.escape;
    const escapedReplUser = escape(replUser);
    const escapedReplPassword = escape(replPassword);
    const escapedPrimaryHost = escape(primary.host);

    // Create replication user on primary
    logger.info({ host: primary.host }, 'Creating replication user on primary');
    const primaryConn = await mysql.createConnection({
      host: primary.host,
      port: primary.port,
      user: mysqlCredentials.adminUser,
      password: mysqlCredentials.adminPassword,
      connectTimeout: 10000,
    });

    try {
      await primaryConn.execute(
        `CREATE USER IF NOT EXISTS ${escapedReplUser}@'%' IDENTIFIED WITH mysql_native_password BY ${escapedReplPassword}`
      );
      await primaryConn.execute(`GRANT REPLICATION SLAVE ON *.* TO ${escapedReplUser}@'%'`);
    } finally {
      await primaryConn.end();
    }

    // Configure each replica
    for (const replica of replicas) {
      logger.info({ replica: `${replica.host}:${replica.port}`, primary: `${primary.host}:${primary.port}` }, 'Setting up replication');

      const replicaConn = await mysql.createConnection({
        host: replica.host,
        port: replica.port,
        user: mysqlCredentials.adminUser,
        password: mysqlCredentials.adminPassword,
        connectTimeout: 10000,
      });

      try {
        // Stop slave if running
        await replicaConn.execute('STOP SLAVE');

        // Configure replication with GTID
        await replicaConn.execute(
          `CHANGE MASTER TO
            MASTER_HOST = ${escapedPrimaryHost},
            MASTER_PORT = ${primary.port},
            MASTER_USER = ${escapedReplUser},
            MASTER_PASSWORD = ${escapedReplPassword},
            MASTER_AUTO_POSITION = 1`
        );

        // Start slave
        await replicaConn.execute('START SLAVE');

        // Verify replication started
        await new Promise((resolve) => setTimeout(resolve, REPLICATION_VERIFY_DELAY_MS));
        const [status] = await replicaConn.execute('SHOW SLAVE STATUS');
        const slaveStatus = (status as Record<string, unknown>[])[0];

        if (slaveStatus) {
          const ioRunning = slaveStatus.Slave_IO_Running === 'Yes';
          const sqlRunning = slaveStatus.Slave_SQL_Running === 'Yes';

          if (!ioRunning || !sqlRunning) {
            const error = slaveStatus.Last_IO_Error || slaveStatus.Last_SQL_Error || 'Unknown replication error';
            throw new Error(`Replication not running on ${replica.host}:${replica.port}: ${error}`);
          }
        }
      } finally {
        await replicaConn.end();
      }
    }

    logger.info('Replication setup completed');
  }

  /**
   * Configure ProxySQL with cluster hostgroups and port
   */
  private async configureProxySQL(
    clusterId: string,
    primary: HostSpec,
    replicas: HostSpec[],
    allocation: AllocationResult,
    mysqlCredentials: { adminUser: string; adminPassword: string }
  ): Promise<void> {
    const proxysql = getProxySQLManager();

    // Connect to ProxySQL
    await proxysql.connect();

    // Set monitor credentials
    await proxysql.setMonitorCredentials(mysqlCredentials.adminUser, mysqlCredentials.adminPassword);

    // Create replication hostgroups
    await this.createReplicationHostgroups(proxysql, clusterId, allocation);

    // Add servers to hostgroups
    await this.addServersToProxySQL(proxysql, primary, replicas, allocation);

    // Configure port listening using existing method
    await proxysql.addListeningPort(allocation.port);

    // Load and save configuration
    await proxysql.loadConfigToRuntime();
    await proxysql.saveConfigToDisk();

    logger.info({ clusterId, port: allocation.port, hostgroups: allocation }, 'ProxySQL configured');
  }

  /**
   * Create replication hostgroups in ProxySQL
   */
  private async createReplicationHostgroups(
    proxysql: ProxySQLManager,
    clusterId: string,
    allocation: AllocationResult
  ): Promise<void> {
    // Delete existing hostgroup entry if any
    await proxysql.executeRaw(
      'DELETE FROM mysql_replication_hostgroups WHERE writer_hostgroup = ?',
      [allocation.writerHostgroup]
    );

    // Insert new hostgroup
    await proxysql.executeRaw(
      `INSERT INTO mysql_replication_hostgroups
       (writer_hostgroup, reader_hostgroup, comment)
       VALUES (?, ?, ?)`,
      [allocation.writerHostgroup, allocation.readerHostgroup, `Cluster: ${clusterId}`]
    );

    // Mirror to metadata database
    await this.db.execute(
      `INSERT INTO proxysql_hostgroups (writer_hostgroup, reader_hostgroup, cluster_id, comment)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reader_hostgroup = VALUES(reader_hostgroup), cluster_id = VALUES(cluster_id)`,
      [allocation.writerHostgroup, allocation.readerHostgroup, clusterId, `Cluster: ${clusterId}`]
    );
  }

  /**
   * Add servers to ProxySQL hostgroups
   */
  private async addServersToProxySQL(
    proxysql: ProxySQLManager,
    primary: HostSpec,
    replicas: HostSpec[],
    allocation: AllocationResult
  ): Promise<void> {
    // Add primary to writer hostgroup
    await proxysql.executeRaw(
      `INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
       VALUES (?, ?, ?, 1, 1000, ?)`,
      [allocation.writerHostgroup, primary.host, primary.port, `ClawSQL: ${primary.host}:${primary.port}`]
    );

    // Add replicas to reader hostgroup
    for (const replica of replicas) {
      await proxysql.executeRaw(
        `INSERT INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections, comment)
         VALUES (?, ?, ?, 1, 1000, ?)`,
        [allocation.readerHostgroup, replica.host, replica.port, `ClawSQL: ${replica.host}:${replica.port}`]
      );
    }

    // Mirror to metadata database
    for (const server of [primary, ...replicas]) {
      const hg = server === primary ? allocation.writerHostgroup : allocation.readerHostgroup;
      await this.db.execute(
        `INSERT INTO proxysql_servers (hostgroup_id, hostname, port, status, weight, max_connections, comment)
         VALUES (?, ?, ?, 'ONLINE', 1, 1000, ?)
         ON DUPLICATE KEY UPDATE status = 'ONLINE', synced_at = NOW()`,
        [hg, server.host, server.port, `ClawSQL: ${server.host}:${server.port}`]
      );
    }
  }

  /**
   * Save cluster metadata
   */
  private async saveMetadata(metadata: ClusterMetadata): Promise<void> {
    await this.db.execute(
      `INSERT INTO cluster_metadata
       (cluster_id, template_id, assigned_port, writer_hostgroup, reader_hostgroup, provision_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        metadata.clusterId,
        metadata.templateId ?? null,
        metadata.assignedPort ?? null,
        metadata.writerHostgroup ?? null,
        metadata.readerHostgroup ?? null,
        metadata.provisionStatus,
      ]
    );
  }

  /**
   * Update cluster metadata
   */
  private async updateMetadata(metadata: ClusterMetadata): Promise<void> {
    await this.db.execute(
      `UPDATE cluster_metadata
       SET template_id = ?, assigned_port = ?, writer_hostgroup = ?, reader_hostgroup = ?, provision_status = ?
       WHERE cluster_id = ?`,
      [
        metadata.templateId ?? null,
        metadata.assignedPort ?? null,
        metadata.writerHostgroup ?? null,
        metadata.readerHostgroup ?? null,
        metadata.provisionStatus,
        metadata.clusterId,
      ]
    );
  }

  /**
   * Save provisioned instances
   */
  private async saveProvisionedInstances(
    clusterId: string,
    primary: HostSpec,
    replicas: HostSpec[]
  ): Promise<void> {
    // Save primary
    await this.db.execute(
      `INSERT INTO provisioned_instances (cluster_id, host, port, role, sequence)
       VALUES (?, ?, ?, 'primary', 0)`,
      [clusterId, primary.host, primary.port]
    );

    // Save replicas
    for (let i = 0; i < replicas.length; i++) {
      await this.db.execute(
        `INSERT INTO provisioned_instances (cluster_id, host, port, role, sequence)
         VALUES (?, ?, ?, 'replica', ?)`,
        [clusterId, replicas[i].host, replicas[i].port, i + 1]
      );
    }
  }

  /**
   * Create a failed result
   */
  private failResult(clusterName: string, error: string): ProvisionResult {
    return {
      success: false,
      clusterId: clusterName,
      clusterName,
      assignedPort: 0,
      writerHostgroup: 0,
      readerHostgroup: 0,
      primary: { host: '', port: 0 },
      replicas: [],
      error,
    };
  }

  /**
   * Get cluster metadata
   */
  async getClusterMetadata(clusterId: string): Promise<ClusterMetadata | null> {
    const row = await this.db.get<{
      cluster_id: string;
      template_id: string | null;
      assigned_port: number | null;
      writer_hostgroup: number | null;
      reader_hostgroup: number | null;
      provision_status: string;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM cluster_metadata WHERE cluster_id = ?', [clusterId]);

    if (!row) return null;

    return createClusterMetadata(row.cluster_id, {
      templateId: row.template_id ?? undefined,
      assignedPort: row.assigned_port ?? undefined,
      writerHostgroup: row.writer_hostgroup ?? undefined,
      readerHostgroup: row.reader_hostgroup ?? undefined,
      provisionStatus: row.provision_status as ProvisionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * List all provisioned clusters
   */
  async listClusters(): Promise<ClusterMetadata[]> {
    const rows = await this.db.query<{
      cluster_id: string;
      template_id: string | null;
      assigned_port: number | null;
      writer_hostgroup: number | null;
      reader_hostgroup: number | null;
      provision_status: string;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM cluster_metadata ORDER BY created_at DESC');

    return rows.map((row) =>
      createClusterMetadata(row.cluster_id, {
        templateId: row.template_id ?? undefined,
        assignedPort: row.assigned_port ?? undefined,
        writerHostgroup: row.writer_hostgroup ?? undefined,
        readerHostgroup: row.reader_hostgroup ?? undefined,
        provisionStatus: row.provision_status as ProvisionStatus,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }

  /**
   * Deprovision a cluster
   */
  async deprovision(clusterId: string): Promise<{ success: boolean; error?: string }> {
    const metadata = await this.getClusterMetadata(clusterId);
    if (!metadata) {
      return { success: false, error: `Cluster "${clusterId}" not found` };
    }

    if (!metadata.writerHostgroup || !metadata.readerHostgroup) {
      return { success: false, error: `Cluster "${clusterId}" has incomplete hostgroup configuration` };
    }

    try {
      const proxysql = getProxySQLManager();
      await proxysql.connect();

      // Remove servers from ProxySQL
      await proxysql.executeRaw(
        'DELETE FROM mysql_servers WHERE hostgroup_id IN (?, ?)',
        [metadata.writerHostgroup, metadata.readerHostgroup]
      );

      // Remove replication hostgroups
      await proxysql.executeRaw(
        'DELETE FROM mysql_replication_hostgroups WHERE writer_hostgroup = ?',
        [metadata.writerHostgroup]
      );

      await proxysql.loadConfigToRuntime();
      await proxysql.saveConfigToDisk();

      // Forget instances from Orchestrator
      const orchestrator = getOrchestratorClient();
      const instances = await this.db.query<{ host: string; port: number }>(
        'SELECT host, port FROM provisioned_instances WHERE cluster_id = ?',
        [clusterId]
      );

      for (const inst of instances) {
        await orchestrator.forgetInstance(inst.host, inst.port);
      }

      // Delete from database
      await this.db.execute('DELETE FROM provisioned_instances WHERE cluster_id = ?', [clusterId]);
      await this.db.execute('DELETE FROM proxysql_servers WHERE hostgroup_id IN (?, ?)', [
        metadata.writerHostgroup,
        metadata.readerHostgroup,
      ]);
      await this.db.execute('DELETE FROM proxysql_hostgroups WHERE writer_hostgroup = ?', [
        metadata.writerHostgroup,
      ]);
      await this.db.execute('DELETE FROM cluster_metadata WHERE cluster_id = ?', [clusterId]);

      logger.info({ clusterId }, 'Cluster deprovisioned');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, clusterId }, 'Deprovision failed');
      return { success: false, error: message };
    }
  }
}

// Singleton instance
let clusterProvisioner: ClusterProvisioner | null = null;

/**
 * Get the cluster provisioner instance
 */
export function getClusterProvisioner(): ClusterProvisioner {
  if (!clusterProvisioner) {
    clusterProvisioner = new ClusterProvisioner();
  }
  return clusterProvisioner;
}
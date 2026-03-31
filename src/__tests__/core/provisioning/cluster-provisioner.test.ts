/**
 * Tests for Cluster Provisioner
 */

import { ClusterProvisioner, HostSpec } from '../../../core/provisioning/cluster-provisioner.js';
import { getDatabase } from '../../../utils/database.js';
import { getSettings } from '../../../config/settings.js';
import { getOrchestratorClient } from '../../../core/discovery/topology.js';
import { getProxySQLManager } from '../../../core/routing/proxysql-manager.js';
import { getTemplateManager } from '../../../core/provisioning/template-manager.js';
import { ProvisionStatus } from '../../../types/index.js';
import mysql from 'mysql2/promise';

// Mocks
jest.mock('../../../utils/logger.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));
jest.mock('../../../utils/database.js');
jest.mock('../../../config/settings.js');
jest.mock('../../../core/discovery/topology.js');
jest.mock('../../../core/routing/proxysql-manager.js');
jest.mock('../../../core/provisioning/template-manager.js');
jest.mock('mysql2/promise');

describe('ClusterProvisioner', () => {
  let provisioner: ClusterProvisioner;
  let mockDb: jest.Mocked<{ query: jest.Mock; get: jest.Mock; execute: jest.Mock }>;
  let mockTemplateManager: jest.Mocked<ReturnType<typeof getTemplateManager>>;
  let mockOrchestrator: jest.Mocked<ReturnType<typeof getOrchestratorClient>>;
  let mockProxySQL: jest.Mocked<ReturnType<typeof getProxySQLManager>>;

  const mockSettings = {
    proxysql: {
      portRangeStart: 6033,
      portRangeEnd: 6050,
      hostgroupRangeStart: 10,
      hostgroupRangeEnd: 200,
    },
    mysql: {
      adminUser: 'admin',
      adminPassword: 'password',
      replicationUser: 'repl',
      replicationPassword: 'repl_password',
    },
  };

  const mockTemplate = {
    templateId: 'template-123',
    name: 'standard',
    description: 'Standard 3-node cluster',
    primaryCount: 1,
    replicaCount: 2,
    replicationMode: 'async' as const,
    settings: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockHosts: HostSpec[] = [
    { host: 'mysql1', port: 3306 },
    { host: 'mysql2', port: 3306 },
    { host: 'mysql3', port: 3306 },
  ];

  beforeEach(() => {
    // Setup database mock
    mockDb = {
      query: jest.fn(),
      get: jest.fn(),
      execute: jest.fn(),
    };
    (getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Setup template manager mock
    mockTemplateManager = {
      get: jest.fn(),
      validateHosts: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getTemplateManager>>;
    (getTemplateManager as jest.Mock).mockReturnValue(mockTemplateManager);

    // Setup orchestrator mock
    mockOrchestrator = {
      discoverInstance: jest.fn(),
      forgetInstance: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getOrchestratorClient>>;
    (getOrchestratorClient as jest.Mock).mockReturnValue(mockOrchestrator);

    // Setup proxysql mock
    mockProxySQL = {
      connect: jest.fn(),
      setMonitorCredentials: jest.fn(),
      executeRaw: jest.fn(),
      addListeningPort: jest.fn(),
      loadConfigToRuntime: jest.fn(),
      saveConfigToDisk: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getProxySQLManager>>;
    (getProxySQLManager as jest.Mock).mockReturnValue(mockProxySQL);

    // Setup settings mock
    (getSettings as jest.Mock).mockReturnValue(mockSettings);

    provisioner = new ClusterProvisioner();
    jest.clearAllMocks();
  });

  describe('provision', () => {
    it('should fail when template not found', async () => {
      mockTemplateManager.get.mockResolvedValue(null);

      const result = await provisioner.provision('nonexistent', 'mycluster', mockHosts);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Template "nonexistent" not found');
    });

    it('should fail when validation fails', async () => {
      mockTemplateManager.get.mockResolvedValue(mockTemplate);
      mockTemplateManager.validateHosts.mockResolvedValue({
        valid: false,
        error: 'Host count mismatch',
      });

      const result = await provisioner.provision('standard', 'mycluster', mockHosts);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Host count mismatch');
    });

    it('should allocate resources and provision cluster successfully', async () => {
      mockTemplateManager.get.mockResolvedValue(mockTemplate);
      mockTemplateManager.validateHosts.mockResolvedValue({ valid: true });

      // Mock resource allocation queries
      mockDb.query
        .mockResolvedValueOnce([]) // existing ports
        .mockResolvedValueOnce([]); // existing hostgroups

      // Mock metadata operations
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      // Mock orchestrator discovery
      mockOrchestrator.discoverInstance.mockResolvedValue(true);

      // Mock MySQL connections for replication setup
      const mockPrimaryConn = {
        execute: jest.fn().mockResolvedValue([[], []]),
        end: jest.fn(),
      };
      const mockReplicaConn = {
        execute: jest.fn().mockResolvedValue([[{ Slave_IO_Running: 'Yes', Slave_SQL_Running: 'Yes' }], []]),
        end: jest.fn(),
      };
      (mysql.createConnection as jest.Mock)
        .mockResolvedValueOnce(mockPrimaryConn)
        .mockResolvedValueOnce(mockReplicaConn)
        .mockResolvedValueOnce(mockReplicaConn);

      // Mock ProxySQL
      mockProxySQL.connect.mockResolvedValue(undefined);
      mockProxySQL.setMonitorCredentials.mockResolvedValue(true);
      mockProxySQL.executeRaw.mockResolvedValue([]);
      mockProxySQL.addListeningPort.mockResolvedValue(true);
      mockProxySQL.loadConfigToRuntime.mockResolvedValue(undefined);
      mockProxySQL.saveConfigToDisk.mockResolvedValue(undefined);

      const result = await provisioner.provision('standard', 'mycluster', mockHosts);

      expect(result.success).toBe(true);
      expect(result.clusterId).toBe('mycluster');
      expect(result.assignedPort).toBe(6033);
      expect(result.writerHostgroup).toBe(10);
      expect(result.readerHostgroup).toBe(20);
      expect(result.primary).toEqual(mockHosts[0]);
      expect(result.replicas).toEqual(mockHosts.slice(1));
    }, 30000);

    it('should allocate next available port when first is taken', async () => {
      mockTemplateManager.get.mockResolvedValue(mockTemplate);
      mockTemplateManager.validateHosts.mockResolvedValue({ valid: true });

      // Mock existing allocations
      mockDb.query
        .mockResolvedValueOnce([{ assigned_port: 6033 }, { assigned_port: 6034 }]) // ports taken
        .mockResolvedValueOnce([{ writer_hostgroup: 10 }]); // hostgroup taken

      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });
      mockOrchestrator.discoverInstance.mockResolvedValue(true);

      const mockConn = {
        execute: jest.fn().mockResolvedValue([[], []]),
        end: jest.fn(),
      };
      (mysql.createConnection as jest.Mock).mockResolvedValue(mockConn);
      mockProxySQL.connect.mockResolvedValue(undefined);
      mockProxySQL.setMonitorCredentials.mockResolvedValue(true);
      mockProxySQL.executeRaw.mockResolvedValue([]);
      mockProxySQL.addListeningPort.mockResolvedValue(true);
      mockProxySQL.loadConfigToRuntime.mockResolvedValue(undefined);
      mockProxySQL.saveConfigToDisk.mockResolvedValue(undefined);

      const result = await provisioner.provision('standard', 'mycluster', mockHosts);

      expect(result.assignedPort).toBe(6035);
      expect(result.writerHostgroup).toBe(20);
    }, 30000);

    it('should update metadata to failed on error', async () => {
      mockTemplateManager.get.mockResolvedValue(mockTemplate);
      mockTemplateManager.validateHosts.mockResolvedValue({ valid: true });
      mockDb.query.mockRejectedValue(new Error('Database error'));
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const result = await provisioner.provision('standard', 'mycluster', mockHosts);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('getClusterMetadata', () => {
    it('should return null when cluster not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await provisioner.getClusterMetadata('nonexistent');

      expect(result).toBeNull();
    });

    it('should return cluster metadata', async () => {
      mockDb.get.mockResolvedValue({
        cluster_id: 'mycluster',
        template_id: 'template-123',
        assigned_port: 6034,
        writer_hostgroup: 30,
        reader_hostgroup: 40,
        provision_status: 'ready',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await provisioner.getClusterMetadata('mycluster');

      expect(result).not.toBeNull();
      expect(result?.clusterId).toBe('mycluster');
      expect(result?.assignedPort).toBe(6034);
      expect(result?.provisionStatus).toBe(ProvisionStatus.READY);
    });
  });

  describe('listClusters', () => {
    it('should return empty array when no clusters', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await provisioner.listClusters();

      expect(result).toEqual([]);
    });

    it('should return list of clusters', async () => {
      mockDb.query.mockResolvedValue([
        {
          cluster_id: 'cluster1',
          template_id: 'template-1',
          assigned_port: 6033,
          writer_hostgroup: 10,
          reader_hostgroup: 20,
          provision_status: 'ready',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          cluster_id: 'cluster2',
          template_id: 'template-2',
          assigned_port: 6034,
          writer_hostgroup: 30,
          reader_hostgroup: 40,
          provision_status: 'provisioning',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await provisioner.listClusters();

      expect(result).toHaveLength(2);
      expect(result[0].clusterId).toBe('cluster1');
      expect(result[1].provisionStatus).toBe(ProvisionStatus.PROVISIONING);
    });
  });

  describe('deprovision', () => {
    it('should fail when cluster not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await provisioner.deprovision('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when hostgroups incomplete', async () => {
      mockDb.get.mockResolvedValue({
        cluster_id: 'mycluster',
        template_id: 'template-1',
        assigned_port: 6033,
        writer_hostgroup: null,
        reader_hostgroup: null,
        provision_status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await provisioner.deprovision('mycluster');

      expect(result.success).toBe(false);
      expect(result.error).toContain('incomplete hostgroup configuration');
    });

    it('should deprovision cluster successfully', async () => {
      mockDb.get.mockResolvedValue({
        cluster_id: 'mycluster',
        template_id: 'template-1',
        assigned_port: 6033,
        writer_hostgroup: 10,
        reader_hostgroup: 20,
        provision_status: 'ready',
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockDb.query.mockResolvedValue([
        { host: 'mysql1', port: 3306 },
        { host: 'mysql2', port: 3306 },
      ]);

      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });
      mockOrchestrator.forgetInstance.mockResolvedValue(true);
      mockProxySQL.connect.mockResolvedValue(undefined);
      mockProxySQL.executeRaw.mockResolvedValue([]);

      const result = await provisioner.deprovision('mycluster');

      expect(result.success).toBe(true);
      expect(mockOrchestrator.forgetInstance).toHaveBeenCalledTimes(2);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM cluster_metadata'),
        ['mycluster']
      );
    });

    it('should handle deprovision errors', async () => {
      mockDb.get.mockResolvedValue({
        cluster_id: 'mycluster',
        template_id: 'template-1',
        assigned_port: 6033,
        writer_hostgroup: 10,
        reader_hostgroup: 20,
        provision_status: 'ready',
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockProxySQL.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await provisioner.deprovision('mycluster');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
    });
  });
});
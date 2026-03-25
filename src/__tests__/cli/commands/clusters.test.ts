/**
 * Tests for Clusters Command
 */

// Mock chalk ESM module
jest.mock('chalk', () => ({
  default: {
    bold: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    blue: (str: string) => str,
    cyan: (str: string) => str,
    gray: (str: string) => str,
  },
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  bold: (str: string) => str,
  cyan: (str: string) => str,
  blue: (str: string) => str,
  gray: (str: string) => str,
}));

import { clustersCommand } from '../../../cli/commands/clusters';
import { HealthStatus, InstanceRole, InstanceState } from '../../../types/index';

describe('clustersCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      settings: {
        mysql: {
          adminUser: 'clawsql',
          adminPassword: 'password',
        },
      },
      clusterView: {
        getMergedView: jest.fn(),
        getAllMergedViews: jest.fn().mockResolvedValue([]),
      },
      orchestrator: {
        getClusters: jest.fn().mockResolvedValue([]),
        getTopology: jest.fn(),
        getClusterForInstance: jest.fn(),
        discoverInstance: jest.fn().mockResolvedValue(true),
        forgetInstance: jest.fn().mockResolvedValue(true),
        gracefulMasterTakeover: jest.fn().mockResolvedValue(true),
      },
      proxysql: {
        syncCluster: jest.fn().mockResolvedValue({ success: true, serversAdded: 1, errors: [] }),
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        section: jest.fn().mockImplementation((s: string) => `[${s}]`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        table: jest.fn().mockReturnValue('table-output'),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        warning: jest.fn().mockImplementation((s: string) => `⚠ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
        success: jest.fn().mockImplementation((s: string) => `✓ ${s}`),
        clusterTopology: jest.fn().mockReturnValue('topology-output'),
      },
      outputFormat: 'table',
    };

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should have correct name and description', () => {
    expect(clustersCommand.name).toBe('clusters');
    expect(clustersCommand.description).toBe('List and manage MySQL clusters');
  });

  it('should default to list when no subcommand', async () => {
    await clustersCommand.handler([], mockContext);

    expect(mockContext.clusterView.getAllMergedViews).toHaveBeenCalled();
  });

  it('should handle unknown subcommand', async () => {
    await clustersCommand.handler(['unknown'], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith('Unknown subcommand: unknown');
  });

  describe('listClusters', () => {
    it('should show warning when no clusters found', async () => {
      mockContext.clusterView.getAllMergedViews.mockResolvedValue([]);

      await clustersCommand.handler(['list'], mockContext);

      expect(mockContext.formatter.warning).toHaveBeenCalledWith('No clusters discovered.');
    });

    it('should list clusters', async () => {
      mockContext.clusterView.getAllMergedViews.mockResolvedValue([
        {
          clusterId: 'cluster-1',
          displayName: 'Test Cluster',
          primary: { host: 'primary', port: 3306, state: InstanceState.ONLINE, role: InstanceRole.PRIMARY },
          replicas: [],
          endpoint: { host: 'endpoint', port: 3306 },
          hostgroups: { writer: 10, reader: 20 },
          health: HealthStatus.HEALTHY,
        },
      ]);

      await clustersCommand.handler(['list'], mockContext);

      expect(mockContext.formatter.header).toHaveBeenCalledWith('MySQL Clusters');
      expect(mockContext.formatter.table).toHaveBeenCalled();
    });

    it('should output JSON when format is json', async () => {
      mockContext.outputFormat = 'json';
      mockContext.clusterView.getAllMergedViews.mockResolvedValue([]);

      await clustersCommand.handler(['list'], mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ clusters: [] }, null, 2));
      mockContext.outputFormat = 'table';
    });

    it('should handle errors gracefully', async () => {
      mockContext.clusterView.getAllMergedViews.mockRejectedValue(new Error('Connection error'));

      await clustersCommand.handler(['list'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to list clusters'));
    });

    it('should output JSON error on exception', async () => {
      mockContext.outputFormat = 'json';
      mockContext.clusterView.getAllMergedViews.mockRejectedValue(new Error('Connection error'));

      await clustersCommand.handler(['list'], mockContext);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ error: 'Connection error' }, null, 2));
      mockContext.outputFormat = 'table';
    });
  });

  describe('createCluster', () => {
    it('should show error when name is missing', async () => {
      await clustersCommand.handler(['create'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing required arguments'));
    });

    it('should show error when primary is missing', async () => {
      await clustersCommand.handler(['create', '--name', 'test-cluster'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing required arguments'));
    });

    it('should create cluster with primary only', async () => {
      await clustersCommand.handler(['create', '--name', 'test-cluster', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('primary', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should create cluster with replicas', async () => {
      await clustersCommand.handler([
        'create', '--name', 'test-cluster', '--primary', 'primary:3306',
        '--replicas', 'replica1:3306,replica2:3306'
      ], mockContext);

      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('primary', 3306);
      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('replica1', 3306);
      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('replica2', 3306);
    });

    it('should handle primary registration failure', async () => {
      mockContext.orchestrator.discoverInstance.mockResolvedValueOnce(false);

      await clustersCommand.handler(['create', '--name', 'test-cluster', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith('Failed to register primary instance');
    });

    it('should handle primary registration error', async () => {
      mockContext.orchestrator.discoverInstance.mockRejectedValue(new Error('Connection refused'));

      await clustersCommand.handler(['create', '--name', 'test-cluster', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to register primary'));
    });

    it('should continue on replica registration failure', async () => {
      mockContext.orchestrator.discoverInstance
        .mockResolvedValueOnce(true) // primary
        .mockResolvedValueOnce(false); // replica

      await clustersCommand.handler([
        'create', '--name', 'test-cluster', '--primary', 'primary:3306',
        '--replicas', 'replica1:3306'
      ], mockContext);

      expect(mockContext.formatter.success).toHaveBeenCalled();
    });
  });

  describe('importCluster', () => {
    it('should show error when primary is missing', async () => {
      await clustersCommand.handler(['import'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing primary'));
    });

    it('should import cluster topology', async () => {
      mockContext.orchestrator.getClusterForInstance.mockResolvedValue('cluster-1');
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'imported-cluster',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [{ host: 'replica', port: 3306, state: 'online' }],
      });

      await clustersCommand.handler(['import', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('primary', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle discovery failure', async () => {
      mockContext.orchestrator.discoverInstance.mockResolvedValue(false);

      await clustersCommand.handler(['import', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith('Failed to discover primary instance');
    });

    it('should handle cluster name resolution failure', async () => {
      mockContext.orchestrator.getClusterForInstance.mockResolvedValue(null);

      await clustersCommand.handler(['import', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.formatter.warning).toHaveBeenCalledWith('Topology discovered but cluster name not resolved');
    });

    it('should handle import error', async () => {
      mockContext.orchestrator.discoverInstance.mockRejectedValue(new Error('Import error'));

      await clustersCommand.handler(['import', '--primary', 'primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Import failed'));
    });
  });

  describe('showTopology', () => {
    it('should show all topologies when no name provided', async () => {
      mockContext.clusterView.getAllMergedViews.mockResolvedValue([
        {
          clusterId: 'cluster-1',
          displayName: 'Cluster 1',
          primary: { host: 'primary', port: 3306, state: InstanceState.ONLINE, role: InstanceRole.PRIMARY },
          replicas: [],
          health: HealthStatus.HEALTHY,
        },
      ]);

      await clustersCommand.handler(['topology'], mockContext);

      expect(mockContext.clusterView.getAllMergedViews).toHaveBeenCalled();
    });

    it('should show specific cluster topology', async () => {
      mockContext.clusterView.getMergedView.mockResolvedValue({
        clusterId: 'cluster-1',
        displayName: 'Cluster 1',
        primary: { host: 'primary', port: 3306, state: InstanceState.ONLINE, role: InstanceRole.PRIMARY },
        replicas: [],
        health: HealthStatus.HEALTHY,
      });

      await clustersCommand.handler(['topology', '--name', 'cluster-1'], mockContext);

      expect(mockContext.clusterView.getMergedView).toHaveBeenCalledWith('cluster-1');
    });

    it('should show warning when cluster not found', async () => {
      mockContext.clusterView.getMergedView.mockResolvedValue(null);

      await clustersCommand.handler(['topology', '--name', 'unknown'], mockContext);

      expect(mockContext.formatter.warning).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('addReplica', () => {
    it('should show error when name is missing', async () => {
      await clustersCommand.handler(['add-replica'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing arguments'));
    });

    it('should show error when host is missing', async () => {
      await clustersCommand.handler(['add-replica', '--name', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing arguments'));
    });

    it('should add replica successfully', async () => {
      await clustersCommand.handler(['add-replica', '--name', 'cluster-1', '--host', 'replica:3306'], mockContext);

      expect(mockContext.orchestrator.discoverInstance).toHaveBeenCalledWith('replica', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle add replica failure', async () => {
      mockContext.orchestrator.discoverInstance.mockResolvedValue(false);

      await clustersCommand.handler(['add-replica', '--name', 'cluster-1', '--host', 'replica:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith('Failed to add replica');
    });

    it('should handle add replica error', async () => {
      mockContext.orchestrator.discoverInstance.mockRejectedValue(new Error('Connection refused'));

      await clustersCommand.handler(['add-replica', '--name', 'cluster-1', '--host', 'replica:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Failed to add replica'));
    });
  });

  describe('removeReplica', () => {
    it('should show error when arguments missing', async () => {
      await clustersCommand.handler(['remove-replica'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing arguments'));
    });

    it('should remove replica successfully', async () => {
      await clustersCommand.handler(['remove-replica', '--name', 'cluster-1', '--host', 'replica:3306'], mockContext);

      expect(mockContext.orchestrator.forgetInstance).toHaveBeenCalledWith('replica', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should handle remove failure', async () => {
      mockContext.orchestrator.forgetInstance.mockResolvedValue(false);

      await clustersCommand.handler(['remove-replica', '--name', 'cluster-1', '--host', 'replica:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith('Failed to remove replica');
    });
  });

  describe('promoteReplica', () => {
    it('should show error when arguments missing', async () => {
      await clustersCommand.handler(['promote'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Missing arguments'));
    });

    it('should promote replica successfully', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'cluster-1',
        primary: { host: 'old-primary', port: 3306, state: 'online' },
        replicas: [{ host: 'new-primary', port: 3306, state: 'online' }],
      });

      await clustersCommand.handler(['promote', '--name', 'cluster-1', '--host', 'new-primary:3306'], mockContext);

      expect(mockContext.orchestrator.gracefulMasterTakeover).toHaveBeenCalledWith('cluster-1', 'new-primary', 3306);
      expect(mockContext.formatter.success).toHaveBeenCalled();
    });

    it('should show warning when cluster not found', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue(null);

      await clustersCommand.handler(['promote', '--name', 'unknown', '--host', 'new-primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should handle promotion error', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'cluster-1',
        primary: { host: 'old-primary', port: 3306, state: 'online' },
        replicas: [],
      });
      mockContext.orchestrator.gracefulMasterTakeover.mockRejectedValue(new Error('Promotion failed'));

      await clustersCommand.handler(['promote', '--name', 'cluster-1', '--host', 'new-primary:3306'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Promotion failed'));
    });
  });

  describe('syncCluster', () => {
    it('should sync all clusters when no name provided', async () => {
      mockContext.orchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [],
      });

      await clustersCommand.handler(['sync'], mockContext);

      expect(mockContext.orchestrator.getClusters).toHaveBeenCalled();
      expect(mockContext.formatter.success).toHaveBeenCalledWith(expect.stringContaining('ProxySQL sync complete'));
    });

    it('should sync specific cluster', async () => {
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [],
      });

      await clustersCommand.handler(['sync', '--name', 'cluster-1'], mockContext);

      expect(mockContext.orchestrator.getTopology).toHaveBeenCalledWith('cluster-1');
      expect(mockContext.proxysql.syncCluster).toHaveBeenCalled();
    });

    it('should handle sync failure', async () => {
      mockContext.orchestrator.getClusters.mockResolvedValue(['cluster-1']);
      mockContext.orchestrator.getTopology.mockResolvedValue({
        name: 'cluster-1',
        primary: { host: 'primary', port: 3306, state: 'online' },
        replicas: [],
      });
      mockContext.proxysql.syncCluster.mockResolvedValue({
        success: false,
        serversAdded: 0,
        errors: ['Connection refused'],
      });

      await clustersCommand.handler(['sync', '--name', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Sync failed'));
    });

    it('should handle sync error', async () => {
      mockContext.orchestrator.getTopology.mockRejectedValue(new Error('Sync error'));

      await clustersCommand.handler(['sync', '--name', 'cluster-1'], mockContext);

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Sync failed'));
    });
  });
});
/**
 * Tests for Cluster View Service
 */

import { ClusterViewService } from '../../../core/discovery/cluster-view.js';
import {
  MySQLCluster,
  MySQLInstance,
  InstanceState,
  InstanceRole,
  HealthStatus,
} from '../../../types/index.js';

// Mock types
interface MockProxySQLServerStats {
  host: string;
  port: number;
  status: string;
  connUsed: number;
}

interface MockProxySQLReplicationHostgroup {
  writerHostgroup: number;
  readerHostgroup: number;
  comment?: string;
}

describe('ClusterViewService', () => {
  let service: ClusterViewService;
  let mockOrchestrator: {
    getClusters: jest.Mock;
    getTopology: jest.Mock;
  };
  let mockProxySQL: {
    getServerStats: jest.Mock;
    getServers: jest.Mock;
    getReplicationHostgroups: jest.Mock;
    getHost: jest.Mock;
    getMySQLPort: jest.Mock;
  };

  beforeEach(() => {
    mockOrchestrator = {
      getClusters: jest.fn().mockResolvedValue(['cluster-1']),
      getTopology: jest.fn(),
    };

    mockProxySQL = {
      getServerStats: jest.fn().mockResolvedValue([]),
      getServers: jest.fn().mockResolvedValue([]),
      getReplicationHostgroups: jest.fn().mockResolvedValue([]),
      getHost: jest.fn().mockReturnValue('proxysql'),
      getMySQLPort: jest.fn().mockReturnValue(6033),
    };

    service = new ClusterViewService(
      mockOrchestrator as unknown as ReturnType<typeof import('../../core/discovery/topology.js').getOrchestratorClient>,
      mockProxySQL as unknown as ReturnType<typeof import('../../core/routing/proxysql-manager.js').getProxySQLManager>
    );
  });

  describe('getAllMergedViews', () => {
    it('should return empty array when no clusters', async () => {
      mockOrchestrator.getClusters.mockResolvedValueOnce([]);

      const views = await service.getAllMergedViews();

      expect(views).toEqual([]);
    });

    it('should return views for all clusters', async () => {
      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getClusters.mockResolvedValueOnce(['cluster-1']);
      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);

      const views = await service.getAllMergedViews();

      expect(views).toHaveLength(1);
      expect(views[0].clusterId).toBe('cluster-1');
    });
  });

  describe('getMergedView', () => {
    it('should return null when topology not found', async () => {
      mockOrchestrator.getTopology.mockResolvedValueOnce(null);

      const view = await service.getMergedView('nonexistent');

      expect(view).toBeNull();
    });

    it('should return merged view with primary and replicas', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const replica: MySQLInstance = {
        host: 'replica',
        port: 3306,
        role: InstanceRole.REPLICA,
        state: InstanceState.ONLINE,
        replicationLag: 0,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [replica],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);

      const view = await service.getMergedView('cluster-1');

      expect(view).not.toBeNull();
      expect(view?.clusterId).toBe('cluster-1');
      expect(view?.primary).not.toBeNull();
      expect(view?.primary?.host).toBe('primary');
      expect(view?.replicas).toHaveLength(1);
      expect(view?.replicas[0].host).toBe('replica');
    });

    it('should calculate healthy status when all instances online', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);

      const view = await service.getMergedView('cluster-1');

      expect(view?.health).toBe(HealthStatus.HEALTHY);
    });

    it('should calculate degraded status when some instances offline', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const offlineReplica: MySQLInstance = {
        host: 'replica',
        port: 3306,
        role: InstanceRole.REPLICA,
        state: InstanceState.OFFLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [offlineReplica],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);

      const view = await service.getMergedView('cluster-1');

      expect(view?.health).toBe(HealthStatus.DEGRADED);
    });

    it('should calculate unhealthy status when most instances offline', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.OFFLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const offlineReplica: MySQLInstance = {
        host: 'replica',
        port: 3306,
        role: InstanceRole.REPLICA,
        state: InstanceState.OFFLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [offlineReplica],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);

      const view = await service.getMergedView('cluster-1');

      expect(view?.health).toBe(HealthStatus.UNHEALTHY);
    });

    it('should include ProxySQL connection stats', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);
      mockProxySQL.getServerStats.mockResolvedValueOnce([
        { host: 'primary', port: 3306, status: 'ONLINE', connUsed: 5 },
      ]);

      const view = await service.getMergedView('cluster-1');

      expect(view?.primary?.proxysqlStatus).toBe('ONLINE');
      expect(view?.primary?.connections).toBe(5);
    });

    it('should generate warning for missing ProxySQL config', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);
      // No ProxySQL stats for this instance

      const view = await service.getMergedView('cluster-1');

      expect(view?.syncWarnings).toBeDefined();
      expect(view?.syncWarnings?.some(w => w.type === 'missing_in_proxysql')).toBe(true);
    });

    it('should return null on error', async () => {
      mockOrchestrator.getTopology.mockRejectedValueOnce(new Error('Connection error'));

      const view = await service.getMergedView('cluster-1');

      expect(view).toBeNull();
    });
  });

  describe('hostgroup mapping', () => {
    it('should use default hostgroups when no replication hostgroups configured', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);
      mockProxySQL.getReplicationHostgroups.mockResolvedValueOnce([]);

      const view = await service.getMergedView('cluster-1');

      expect(view?.hostgroups).toEqual({ writer: 10, reader: 20 });
    });

    it('should use configured replication hostgroups', async () => {
      const primary: MySQLInstance = {
        host: 'primary',
        port: 3306,
        role: InstanceRole.PRIMARY,
        state: InstanceState.ONLINE,
        lastSeen: new Date(),
        labels: {},
        extra: {},
      };

      const mockCluster: MySQLCluster = {
        clusterId: 'cluster-1',
        name: 'Test Cluster',
        primary,
        replicas: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockOrchestrator.getTopology.mockResolvedValueOnce(mockCluster);
      mockProxySQL.getReplicationHostgroups.mockResolvedValueOnce([
        { writerHostgroup: 100, readerHostgroup: 200, comment: 'cluster-1' },
      ]);

      const view = await service.getMergedView('cluster-1');

      expect(view?.hostgroups).toEqual({ writer: 100, reader: 200 });
    });
  });
});
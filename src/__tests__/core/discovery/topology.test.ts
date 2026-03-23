/**
 * Tests for Orchestrator client
 */

import { OrchestratorClient, getOrchestratorClient } from '../../../core/discovery/topology.js';
import { InstanceRole, InstanceState } from '../../../types/index.js';
import { OrchestratorError } from '../../../utils/exceptions.js';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OrchestratorClient', () => {
  let client: OrchestratorClient;
  let mockAxiosInstance: {
    get: jest.Mock;
    post: jest.Mock;
  };

  beforeEach(() => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>);
    client = new OrchestratorClient({
      url: 'http://orchestrator:3000',
      timeout: 30,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create axios client with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://orchestrator:3000',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should use default settings when not provided', () => {
      new OrchestratorClient();
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://orchestrator:3000',
        })
      );
    });

    it('should strip trailing slash from URL', () => {
      new OrchestratorClient({
        url: 'http://orchestrator:3000/',
        timeout: 30,
      });
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://orchestrator:3000',
        })
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when health check succeeds', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 200 });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/health');
    });

    it('should return false when health check fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('getClusters', () => {
    it('should return cluster names', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: ['cluster1', 'cluster2'],
      });

      const clusters = await client.getClusters();

      expect(clusters).toEqual(['cluster1', 'cluster2']);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/clusters');
    });

    it('should throw OrchestratorError on failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(client.getClusters()).rejects.toThrow(OrchestratorError);
    });
  });

  describe('getTopology', () => {
    it('should return parsed cluster topology', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          Alias: 'primary',
          Hostname: 'mysql-primary',
          Port: 3306,
          IsPrimary: true,
          IsLastCheckValid: true,
          ServerID: 1,
          Version: '8.0.32',
          ClusterName: 'test-cluster',
          Child: [
            {
              Alias: 'replica1',
              Hostname: 'mysql-replica-1',
              Port: 3306,
              IsReplica: true,
              IsLastCheckValid: true,
              ReplicationLagSeconds: 0,
            },
          ],
        },
      });

      const cluster = await client.getTopology('test-cluster');

      expect(cluster).not.toBeNull();
      expect(cluster?.clusterId).toBe('test-cluster');
      expect(cluster?.primary?.host).toBe('mysql-primary');
      expect(cluster?.primary?.role).toBe(InstanceRole.PRIMARY);
      expect(cluster?.primary?.state).toBe(InstanceState.ONLINE);
      expect(cluster?.replicas).toHaveLength(1);
    });

    it('should return null when cluster not found', async () => {
      const axiosError = {
        response: { status: 404 },
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(axiosError);

      // Need to mock isAxiosError to return true
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      const cluster = await client.getTopology('nonexistent');

      expect(cluster).toBeNull();
    });

    it('should throw OrchestratorError on other failures', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(client.getTopology('test-cluster')).rejects.toThrow(OrchestratorError);
    });
  });

  describe('getInstance', () => {
    it('should return parsed instance', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          Hostname: 'mysql-primary',
          Port: 3306,
          IsPrimary: true,
          IsLastCheckValid: true,
          ServerID: 1,
          Version: '8.0.32',
        },
      });

      const instance = await client.getInstance('mysql-primary', 3306);

      expect(instance).not.toBeNull();
      expect(instance?.host).toBe('mysql-primary');
      expect(instance?.port).toBe(3306);
      expect(instance?.role).toBe(InstanceRole.PRIMARY);
    });

    it('should return null when instance not found', async () => {
      const axiosError = {
        response: { status: 404 },
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(axiosError);

      // Need to mock isAxiosError to return true
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      const instance = await client.getInstance('nonexistent', 3306);

      expect(instance).toBeNull();
    });
  });

  describe('discoverInstance', () => {
    it('should return true on successful discovery', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      const result = await client.discoverInstance('mysql-primary', 3306);

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Failed'));

      const result = await client.discoverInstance('mysql-primary', 3306);

      expect(result).toBe(false);
    });
  });

  describe('requestFailover', () => {
    it('should request failover without destination', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      const result = await client.requestFailover('mysql-replica-1', 3306);

      expect(result).toEqual({ success: true });
    });
  });
});

describe('getOrchestratorClient', () => {
  it('should return singleton instance', () => {
    const client1 = getOrchestratorClient();
    const client2 = getOrchestratorClient();

    expect(client1).toBe(client2);
  });
});
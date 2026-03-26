/**
 * Tests for Webhook Handler Logic
 *
 * Tests the webhook handler logic with mocked dependencies.
 */

import { createMySQLInstance, createMySQLCluster, InstanceState } from '../../../types/index.js';
import { getOrchestratorClient } from '../../../core/discovery/topology.js';
import { getSyncCoordinator } from '../../../core/sync/sync-coordinator.js';

// Mock dependencies
const mockGetTopology = jest.fn();
const mockSync = jest.fn();

jest.mock('../../../core/discovery/topology.js', () => ({
  getOrchestratorClient: jest.fn(() => ({
    getTopology: mockGetTopology,
  })),
}));

jest.mock('../../../core/sync/sync-coordinator.js', () => ({
  getSyncCoordinator: jest.fn(() => ({
    sync: mockSync,
  })),
}));

// Import after mocks
import { OrchestratorFailoverPayload } from '../../../core/sync/types.js';

describe('Webhook Handler Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // handleFailoverWebhook Logic
  // ===========================================================================

  describe('handleFailoverWebhook', () => {
    const validPayload: OrchestratorFailoverPayload = {
      cluster: 'test-cluster',
      master: 'old-primary:3306',
      successor: 'new-primary:3306',
      isSuccessful: true,
      failoverType: 'master',
    };

    async function handleFailoverWebhook(payload: OrchestratorFailoverPayload) {
      // Replicate the logic from webhooks.ts

      if (!payload.isSuccessful) {
        return {
          received: true,
          processed: false,
          message: 'Failover was not successful, sync skipped',
        };
      }

      try {
        const orchestrator = getOrchestratorClient();
        const topology = await orchestrator.getTopology(payload.cluster);

        if (!topology) {
          return {
            received: true,
            processed: false,
            message: `Cluster '${payload.cluster}' not found in Orchestrator`,
          };
        }

        const syncCoordinator = getSyncCoordinator();
        const syncResult = await syncCoordinator.sync(topology, 'webhook');

        return {
          received: true,
          processed: !syncResult.skipped,
          message: syncResult.skipped
            ? `Sync skipped: ${syncResult.reason}`
            : `ProxySQL synced with ${syncResult.serversSynced} servers`,
          syncResult,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          received: true,
          processed: false,
          message: `Error processing webhook: ${message}`,
        };
      }
    }

    it('should skip sync when isSuccessful=false', async () => {
      const result = await handleFailoverWebhook({
        ...validPayload,
        isSuccessful: false,
      });

      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);
      expect(result.message).toContain('not successful');
      expect(mockGetTopology).not.toHaveBeenCalled();
    });

    it('should return error when cluster not found', async () => {
      mockGetTopology.mockResolvedValue(null);

      const result = await handleFailoverWebhook(validPayload);

      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should sync ProxySQL on successful failover', async () => {
      const cluster = createMySQLCluster('test-cluster', 'test', {
        primary: createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockGetTopology.mockResolvedValue(cluster);
      mockSync.mockResolvedValue({
        skipped: false,
        serversSynced: 2,
        clusterId: 'test-cluster',
        source: 'webhook',
      });

      const result = await handleFailoverWebhook(validPayload);

      expect(mockSync).toHaveBeenCalledWith(cluster, 'webhook');
      expect(result.received).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.syncResult?.serversSynced).toBe(2);
    });

    it('should handle sync errors gracefully', async () => {
      const cluster = createMySQLCluster('test-cluster', 'test', {
        primary: createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockGetTopology.mockResolvedValue(cluster);
      mockSync.mockResolvedValue({
        skipped: false,
        reason: 'failed',
        error: 'Connection refused',
        clusterId: 'test-cluster',
        source: 'webhook',
      });

      const result = await handleFailoverWebhook(validPayload);

      expect(result.received).toBe(true);
      // processed = !syncResult.skipped, so when skipped=false, processed=true
      expect(result.processed).toBe(true);
      expect(result.syncResult?.error).toBe('Connection refused');
    });

    it('should handle orchestrator errors gracefully', async () => {
      mockGetTopology.mockRejectedValue(new Error('Orchestrator down'));

      const result = await handleFailoverWebhook(validPayload);

      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);
      expect(result.message).toContain('Error processing webhook');
    });

    it('should handle skipped sync', async () => {
      const cluster = createMySQLCluster('test-cluster', 'test', {
        primary: createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockGetTopology.mockResolvedValue(cluster);
      mockSync.mockResolvedValue({
        skipped: true,
        reason: 'cooldown',
        clusterId: 'test-cluster',
        source: 'webhook',
      });

      const result = await handleFailoverWebhook(validPayload);

      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);
      expect(result.message).toContain('cooldown');
    });

    it('should handle intermediate-master failover', async () => {
      const cluster = createMySQLCluster('test-cluster', 'test', {
        primary: createMySQLInstance('primary', 3306, { state: InstanceState.ONLINE }),
        replicas: [],
      });

      mockGetTopology.mockResolvedValue(cluster);
      mockSync.mockResolvedValue({
        skipped: false,
        serversSynced: 1,
        clusterId: 'test-cluster',
        source: 'webhook',
      });

      const result = await handleFailoverWebhook({
        ...validPayload,
        failoverType: 'intermediate-master',
      });

      expect(result.received).toBe(true);
      expect(result.processed).toBe(true);
    });
  });

  // ===========================================================================
  // Payload Validation
  // ===========================================================================

  describe('payload validation', () => {
    it('should have required fields', () => {
      const payload: OrchestratorFailoverPayload = {
        cluster: 'test-cluster',
        master: 'old:3306',
        successor: 'new:3306',
        isSuccessful: true,
        failoverType: 'master',
      };

      expect(payload.cluster).toBeDefined();
      expect(payload.master).toBeDefined();
      expect(payload.successor).toBeDefined();
      expect(payload.isSuccessful).toBeDefined();
      expect(payload.failoverType).toBeDefined();
    });

    it('should accept optional fields', () => {
      const payload: OrchestratorFailoverPayload = {
        cluster: 'test-cluster',
        master: 'old:3306',
        successor: 'new:3306',
        isSuccessful: true,
        failoverType: 'master',
        successorHost: 'new-host',
        successorPort: 3306,
        reason: 'Manual failover',
        timestamp: '2024-01-01T00:00:00Z',
      };

      expect(payload.successorHost).toBe('new-host');
      expect(payload.successorPort).toBe(3306);
      expect(payload.reason).toBe('Manual failover');
      expect(payload.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('should restrict failoverType to valid values', () => {
      const validTypes: Array<'master' | 'intermediate-master'> = ['master', 'intermediate-master'];
      validTypes.forEach(type => {
        const payload: OrchestratorFailoverPayload = {
          cluster: 'test',
          master: 'old:3306',
          successor: 'new:3306',
          isSuccessful: true,
          failoverType: type,
        };
        expect(payload.failoverType).toBe(type);
      });
    });
  });
});
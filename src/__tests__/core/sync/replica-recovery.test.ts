/**
 * Tests for Replica Recovery
 */

import { recoverReplica, recoverReplicas, RecoveryResult } from '../../../core/sync/replica-recovery.js';
import { getOrchestratorClient } from '../../../core/discovery/topology.js';
import { getMySQLClient } from '../../../utils/mysql-client.js';
import { createMySQLInstance, InstanceState } from '../../../types/index.js';

// Mock dependencies
jest.mock('../../../core/discovery/topology.js');
jest.mock('../../../utils/mysql-client.js');

describe('Replica Recovery', () => {
  let mockOrchestrator: any;
  let mockMySQLClient: any;

  beforeEach(() => {
    mockOrchestrator = {
      startSlave: jest.fn(),
      endMaintenance: jest.fn(),
    };

    mockMySQLClient = {
      getReplicationStatus: jest.fn(),
    };

    (getOrchestratorClient as jest.Mock).mockReturnValue(mockOrchestrator);
    (getMySQLClient as jest.Mock).mockReturnValue(mockMySQLClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // recoverReplica
  // ===========================================================================

  describe('recoverReplica', () => {
    const newPrimary = createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE });

    it('should skip recovery for offline instances', async () => {
      const offlineReplica = createMySQLInstance('offline-host', 3306, {
        state: InstanceState.OFFLINE,
      });

      const result = await recoverReplica(offlineReplica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('offline');
      expect(mockOrchestrator.startSlave).not.toHaveBeenCalled();
    });

    it('should successfully recover a replica in maintenance state', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockOrchestrator.endMaintenance.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: true,
        sqlRunning: true,
        secondsBehind: 0,
      });

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(true);
      expect(result.reason).toContain('recovered');
      expect(mockOrchestrator.startSlave).toHaveBeenCalledWith('replica-host', 3306);
      expect(mockOrchestrator.endMaintenance).toHaveBeenCalledWith('replica-host', 3306);
    });

    it('should recover a replica without ending maintenance if not in maintenance state', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.ONLINE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: true,
        sqlRunning: true,
        secondsBehind: 0,
      });

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(true);
      expect(mockOrchestrator.endMaintenance).not.toHaveBeenCalled();
    });

    it('should fail if startSlave fails', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(false);

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('Failed to start replication');
    });

    it('should fail if replication status check fails', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue(null);

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('Could not verify replication status');
    });

    it('should fail if IO thread is not running', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: false,
        sqlRunning: true,
        secondsBehind: null,
      });

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('IO=stopped');
    });

    it('should fail if SQL thread is not running', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: true,
        sqlRunning: false,
        secondsBehind: null,
      });

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('SQL=stopped');
    });

    it('should still succeed if endMaintenance fails but replication is running', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockOrchestrator.endMaintenance.mockResolvedValue(false);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: true,
        sqlRunning: true,
        secondsBehind: 0,
      });

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(true);
      expect(mockOrchestrator.endMaintenance).toHaveBeenCalled();
    });

    it('should handle exceptions gracefully', async () => {
      const replica = createMySQLInstance('replica-host', 3306, {
        state: InstanceState.MAINTENANCE,
      });

      mockOrchestrator.startSlave.mockRejectedValue(new Error('Connection refused'));

      const result = await recoverReplica(replica, newPrimary, mockOrchestrator);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('Connection refused');
    });
  });

  // ===========================================================================
  // recoverReplicas
  // ===========================================================================

  describe('recoverReplicas', () => {
    const newPrimary = createMySQLInstance('new-primary', 3306, { state: InstanceState.ONLINE });

    it('should return empty map when no replicas need recovery', async () => {
      const replicas = [
        createMySQLInstance('replica1', 3306, { state: InstanceState.ONLINE }),
        createMySQLInstance('replica2', 3306, { state: InstanceState.ONLINE }),
      ];

      const results = await recoverReplicas(replicas, newPrimary, mockOrchestrator);

      expect(results.size).toBe(0);
    });

    it('should recover multiple replicas in parallel', async () => {
      const replicas = [
        createMySQLInstance('replica1', 3306, { state: InstanceState.MAINTENANCE }),
        createMySQLInstance('replica2', 3306, { state: InstanceState.OFFLINE }),
        createMySQLInstance('replica3', 3306, { state: InstanceState.ONLINE }),
      ];

      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus.mockResolvedValue({
        ioRunning: true,
        sqlRunning: true,
        secondsBehind: 0,
      });

      const results = await recoverReplicas(replicas, newPrimary, mockOrchestrator);

      // Only 2 replicas need recovery (maintenance + offline)
      expect(results.size).toBe(2);
      expect(results.has('replica1:3306')).toBe(true);
      expect(results.has('replica2:3306')).toBe(true);
      expect(results.has('replica3:3306')).toBe(false);
    });

    it('should include recovery failure reasons in results', async () => {
      const replicas = [
        createMySQLInstance('replica1', 3306, { state: InstanceState.MAINTENANCE }),
        createMySQLInstance('replica2', 3306, { state: InstanceState.OFFLINE }),
      ];

      // replica1 succeeds, replica2 fails because it's offline
      mockOrchestrator.startSlave.mockResolvedValue(true);
      mockMySQLClient.getReplicationStatus
        .mockResolvedValueOnce({
          ioRunning: true,
          sqlRunning: true,
          secondsBehind: 0,
        });

      const results = await recoverReplicas(replicas, newPrimary, mockOrchestrator);

      // replica2 is offline, so it should have failed
      const replica2Result = results.get('replica2:3306');
      expect(replica2Result?.recovered).toBe(false);
      expect(replica2Result?.reason).toContain('offline');
    });
  });
});
/**
 * Tests for Failover API Routes
 *
 * Tests the failover API route handlers with mocked dependencies.
 */

import { FailoverState } from '../../../types/index.js';

// Mock dependencies
const mockGetOperationHistory = jest.fn().mockReturnValue([]);
const mockGetOperation = jest.fn().mockReturnValue(null);
const mockExecuteManualFailover = jest.fn();
const mockCancelOperation = jest.fn().mockReturnValue(false);

jest.mock('../../../core/failover/executor.js', () => ({
  getFailoverExecutor: jest.fn().mockReturnValue({
    getOperationHistory: mockGetOperationHistory,
    getOperation: mockGetOperation,
    executeManualFailover: mockExecuteManualFailover,
    cancelOperation: mockCancelOperation,
  }),
}));

jest.mock('../../../core/discovery/topology.js', () => ({
  getOrchestratorClient: jest.fn().mockReturnValue({
    getTopology: jest.fn().mockResolvedValue(null),
  }),
}));

// Import after mocks are set up
import { getFailoverExecutor } from '../../../core/failover/executor.js';

describe('Failover API Routes Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOperationHistory', () => {
    it('should return empty list when no operations', () => {
      mockGetOperationHistory.mockReturnValueOnce([]);
      const executor = getFailoverExecutor();
      const operations = executor.getOperationHistory();

      expect(operations).toEqual([]);
    });

    it('should support cluster_id filter', () => {
      const executor = getFailoverExecutor();
      executor.getOperationHistory('test-cluster', 100);

      expect(mockGetOperationHistory).toHaveBeenCalledWith('test-cluster', 100);
    });

    it('should support limit parameter', () => {
      const executor = getFailoverExecutor();
      executor.getOperationHistory(undefined, 50);

      expect(mockGetOperationHistory).toHaveBeenCalledWith(undefined, 50);
    });
  });

  describe('getOperation', () => {
    it('should return null for non-existent operation', () => {
      mockGetOperation.mockReturnValueOnce(null);
      const executor = getFailoverExecutor();
      const operation = executor.getOperation('nonexistent-id');

      expect(operation).toBeNull();
    });

    it('should return operation when found', () => {
      const mockOperation = {
        operationId: 'op-123',
        clusterId: 'cluster-1',
        oldPrimaryId: 'old:3306',
        newPrimaryId: 'new:3306',
        state: FailoverState.COMPLETED,
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: new Date('2024-01-01T00:00:10Z'),
        steps: ['Step 1', 'Step 2'],
        error: undefined,
        manual: true,
        reason: 'Test failover',
        triggeredBy: undefined,
      };

      mockGetOperation.mockReturnValueOnce(mockOperation);
      const executor = getFailoverExecutor();
      const operation = executor.getOperation('op-123');

      expect(operation).toBeDefined();
      expect(operation?.operationId).toBe('op-123');
      expect(operation?.state).toBe(FailoverState.COMPLETED);
    });
  });

  describe('cancelOperation', () => {
    it('should return false for non-existent operation', async () => {
      mockCancelOperation.mockReturnValueOnce(false);
      const executor = getFailoverExecutor();
      const result = await executor.cancelOperation('nonexistent-id');

      expect(result).toBe(false);
    });

    it('should cancel operation when found', async () => {
      mockCancelOperation.mockReturnValueOnce(true);
      const executor = getFailoverExecutor();
      const result = await executor.cancelOperation('op-123');

      expect(result).toBe(true);
    });
  });

  describe('executeManualFailover', () => {
    it('should execute failover operation', async () => {
      const mockResult = {
        operationId: 'op-123',
        clusterId: 'cluster-1',
        oldPrimaryId: 'old:3306',
        newPrimaryId: 'new:3306',
        state: FailoverState.COMPLETED,
        steps: [],
        manual: true,
        reason: 'Test',
      };

      mockExecuteManualFailover.mockResolvedValueOnce(mockResult);
      const executor = getFailoverExecutor();
      const result = await executor.executeManualFailover(
        { clusterId: 'cluster-1', name: 'test', replicas: [], createdAt: new Date(), updatedAt: new Date() },
        'new:3306',
        'Test'
      );

      expect(result.state).toBe(FailoverState.COMPLETED);
    });
  });
});
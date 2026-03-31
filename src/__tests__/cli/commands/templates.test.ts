/**
 * Tests for Templates CLI Command
 */

import { templatesCommand } from '../../../cli/commands/templates.js';
import { getTemplateManager } from '../../../core/provisioning/template-manager.js';
import { getClusterProvisioner } from '../../../core/provisioning/cluster-provisioner.js';
import { CLIContext } from '../../../cli/registry.js';
import { ReplicationMode } from '../../../types/index.js';

jest.mock('../../../core/provisioning/template-manager.js');
jest.mock('../../../core/provisioning/cluster-provisioner.js');

describe('templates command', () => {
  let mockCtx: CLIContext;
  let mockTemplateManager: jest.Mocked<ReturnType<typeof getTemplateManager>>;
  let mockProvisioner: jest.Mocked<ReturnType<typeof getClusterProvisioner>>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTemplateManager = {
      list: jest.fn(),
      get: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      validateHosts: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getTemplateManager>>;
    (getTemplateManager as jest.Mock).mockReturnValue(mockTemplateManager);

    mockProvisioner = {
      listClusters: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getClusterProvisioner>>;
    (getClusterProvisioner as jest.Mock).mockReturnValue(mockProvisioner);

    mockCtx = {
      formatter: {
        error: jest.fn((msg) => `✗ ${msg}`),
        info: jest.fn((msg) => `○ ${msg}`),
        warning: jest.fn((msg) => `⚠ ${msg}`),
        success: jest.fn((msg) => `✓ ${msg}`),
        header: jest.fn((msg) => `── ${msg} ──`),
        keyValue: jest.fn((k, v) => `${k}: ${v}`),
        table: jest.fn((rows, cols) => JSON.stringify(rows)),
      },
      outputFormat: 'table',
    } as unknown as CLIContext;

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should show no templates message when empty', async () => {
      mockTemplateManager.list.mockResolvedValue([]);

      await templatesCommand.handler(['list'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No templates found'));
    });

    it('should list templates', async () => {
      mockTemplateManager.list.mockResolvedValue([
        {
          templateId: 'id1',
          name: 'standard',
          primaryCount: 1,
          replicaCount: 2,
          replicationMode: ReplicationMode.ASYNC,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          templateId: 'id2',
          name: 'ha-cluster',
          description: 'High availability',
          primaryCount: 1,
          replicaCount: 3,
          replicationMode: ReplicationMode.SEMI_SYNC,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await templatesCommand.handler(['list'], mockCtx);

      expect(mockTemplateManager.list).toHaveBeenCalled();
    });

    it('should output JSON format', async () => {
      mockTemplateManager.list.mockResolvedValue([]);
      mockCtx.outputFormat = 'json';

      await templatesCommand.handler(['list'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"templates": []'));
    });
  });

  describe('create', () => {
    it('should show usage when missing name', async () => {
      await templatesCommand.handler(['create'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Missing required argument'));
    });

    it('should validate replication mode', async () => {
      await templatesCommand.handler(['create', '--name', 'test', '--mode', 'invalid'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid replication mode'));
    });

    it('should create template successfully', async () => {
      mockTemplateManager.create.mockResolvedValue({
        templateId: 'new-id',
        name: 'my-template',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await templatesCommand.handler(['create', '--name', 'my-template'], mockCtx);

      expect(mockTemplateManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-template',
          replicaCount: 2,
        })
      );
    });

    it('should handle creation error', async () => {
      mockTemplateManager.create.mockRejectedValue(new Error('Template already exists'));

      await templatesCommand.handler(['create', '--name', 'existing'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
  });

  describe('show', () => {
    it('should show usage when missing name', async () => {
      await templatesCommand.handler(['show'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Missing template name'));
    });

    it('should show template not found', async () => {
      mockTemplateManager.get.mockResolvedValue(null);

      await templatesCommand.handler(['show', 'nonexistent'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should show template details', async () => {
      mockTemplateManager.get.mockResolvedValue({
        templateId: 'test-id',
        name: 'standard',
        description: 'Standard template',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockProvisioner.listClusters.mockResolvedValue([]);

      await templatesCommand.handler(['show', 'standard'], mockCtx);

      expect(mockTemplateManager.get).toHaveBeenCalledWith('standard');
    });

    it('should show clusters using the template', async () => {
      mockTemplateManager.get.mockResolvedValue({
        templateId: 'test-id',
        name: 'standard',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockProvisioner.listClusters.mockResolvedValue([
        { clusterId: 'cluster1', templateId: 'test-id', provisionStatus: 'ready' as const, createdAt: new Date(), updatedAt: new Date() },
        { clusterId: 'cluster2', templateId: 'other', provisionStatus: 'ready' as const, createdAt: new Date(), updatedAt: new Date() },
      ]);

      await templatesCommand.handler(['show', 'standard'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cluster1'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('cluster2'));
    });
  });

  describe('delete', () => {
    it('should show usage when missing name', async () => {
      await templatesCommand.handler(['delete'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Missing template name'));
    });

    it('should show confirmation message without --force', async () => {
      mockTemplateManager.get.mockResolvedValue({
        templateId: 'test-id',
        name: 'standard',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await templatesCommand.handler(['delete', 'standard'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('confirm deletion'));
      expect(mockTemplateManager.delete).not.toHaveBeenCalled();
    });

    it('should delete template with --force', async () => {
      mockTemplateManager.get.mockResolvedValue({
        templateId: 'test-id',
        name: 'standard',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockTemplateManager.delete.mockResolvedValue(true);

      await templatesCommand.handler(['delete', 'standard', '--force'], mockCtx);

      expect(mockTemplateManager.delete).toHaveBeenCalledWith('standard');
    });

    it('should handle delete error', async () => {
      mockTemplateManager.get.mockResolvedValue({
        templateId: 'test-id',
        name: 'standard',
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockTemplateManager.delete.mockRejectedValue(new Error('Template in use'));

      await templatesCommand.handler(['delete', 'standard', '--force'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Template in use'));
    });
  });

  describe('unknown subcommand', () => {
    it('should show error for unknown subcommand', async () => {
      await templatesCommand.handler(['unknown'], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown subcommand'));
    });
  });

  describe('no subcommand', () => {
    it('should show usage when no subcommand', async () => {
      await templatesCommand.handler([], mockCtx);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Missing subcommand'));
    });
  });
});
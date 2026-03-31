/**
 * Tests for Template Manager
 */

import { TemplateManager } from '../../../core/provisioning/template-manager.js';
import { getDatabase } from '../../../utils/database.js';
import { ReplicationMode } from '../../../types/index.js';

// Mock database
jest.mock('../../../utils/database.js');

describe('TemplateManager', () => {
  let templateManager: TemplateManager;
  let mockDb: jest.Mocked<ReturnType<typeof getDatabase>>;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
      get: jest.fn(),
      execute: jest.fn(),
    } as unknown as jest.Mocked<ReturnType<typeof getDatabase>>;

    (getDatabase as jest.Mock).mockReturnValue(mockDb);
    templateManager = new TemplateManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should return empty array when no templates exist', async () => {
      mockDb.query.mockResolvedValue([]);

      const result = await templateManager.list();

      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('FROM topology_templates'));
    });

    it('should return list of templates', async () => {
      mockDb.query.mockResolvedValue([
        {
          template_id: 'test-id-1',
          name: 'standard',
          description: 'Standard template',
          primary_count: 1,
          replica_count: 2,
          replication_mode: 'async',
          settings: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          template_id: 'test-id-2',
          name: 'ha-cluster',
          description: null,
          primary_count: 1,
          replica_count: 3,
          replication_mode: 'semi-sync',
          settings: JSON.stringify({ maxReplicationLag: 10 }),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await templateManager.list();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('standard');
      expect(result[0].replicationMode).toBe(ReplicationMode.ASYNC);
      expect(result[1].name).toBe('ha-cluster');
      expect(result[1].settings?.maxReplicationLag).toBe(10);
    });
  });

  describe('get', () => {
    it('should return null when template not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return template by name', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'standard',
        description: 'Test template',
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.get('standard');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('standard');
      expect(result?.primaryCount).toBe(1);
      expect(result?.replicaCount).toBe(2);
    });
  });

  describe('getById', () => {
    it('should return null when template ID not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.getById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should return template by ID', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id-123',
        name: 'standard',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.getById('test-id-123');

      expect(result).not.toBeNull();
      expect(result?.templateId).toBe('test-id-123');
    });
  });

  describe('create', () => {
    it('should throw error if template name already exists', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'existing-id',
        name: 'existing',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(templateManager.create({
        name: 'existing',
        replicaCount: 2,
      })).rejects.toThrow('Template "existing" already exists');
    });

    it('should create template successfully', async () => {
      mockDb.get.mockResolvedValue(undefined);
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const result = await templateManager.create({
        name: 'new-template',
        description: 'A new template',
        primaryCount: 1,
        replicaCount: 3,
        replicationMode: ReplicationMode.SEMI_SYNC,
      });

      expect(result.name).toBe('new-template');
      expect(result.primaryCount).toBe(1);
      expect(result.replicaCount).toBe(3);
      expect(result.replicationMode).toBe(ReplicationMode.SEMI_SYNC);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should return null when template not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.update('nonexistent', { replicaCount: 3 });

      expect(result).toBeNull();
    });

    it('should return existing template when no updates provided', async () => {
      const existingTemplate = {
        template_id: 'test-id',
        name: 'standard',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockDb.get.mockResolvedValue(existingTemplate);

      const result = await templateManager.update('standard', {});

      expect(result?.name).toBe('standard');
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('should update template fields', async () => {
      const existingTemplate = {
        template_id: 'test-id',
        name: 'standard',
        description: 'Old description',
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockDb.get
        .mockResolvedValueOnce(existingTemplate)
        .mockResolvedValueOnce({
          ...existingTemplate,
          description: 'New description',
          replica_count: 3,
        });
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const result = await templateManager.update('standard', {
        description: 'New description',
        replicaCount: 3,
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE topology_templates'),
        expect.arrayContaining(['New description', 3])
      );
    });
  });

  describe('delete', () => {
    it('should return false when template not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should throw error when template is in use', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'in-use',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockDb.query.mockResolvedValue([{ cluster_id: 'cluster-1' }]);

      await expect(templateManager.delete('in-use')).rejects.toThrow(
        'Template "in-use" is being used by 1 cluster(s)'
      );
    });

    it('should delete template successfully', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'unused',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockDb.query.mockResolvedValue([]);
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const result = await templateManager.delete('unused');

      expect(result).toBe(true);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM topology_templates'),
        ['test-id']
      );
    });
  });

  describe('validateHosts', () => {
    it('should return error when template not found', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.validateHosts('nonexistent', [
        { host: 'host1', port: 3306 },
      ]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when not enough hosts', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'standard',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.validateHosts('standard', [
        { host: 'host1', port: 3306 },
      ]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires 3 instances');
    });

    it('should return error when too many hosts', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'standard',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.validateHosts('standard', [
        { host: 'host1', port: 3306 },
        { host: 'host2', port: 3306 },
        { host: 'host3', port: 3306 },
        { host: 'host4', port: 3306 },
      ]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires exactly 3 instances');
    });

    it('should return valid when host count matches', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'standard',
        description: null,
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.validateHosts('standard', [
        { host: 'host1', port: 3306 },
        { host: 'host2', port: 3306 },
        { host: 'host3', port: 3306 },
      ]);

      expect(result.valid).toBe(true);
    });

    it('should accept template object instead of name', async () => {
      const template = {
        template_id: 'test-id',
        name: 'standard',
        description: null,
        primaryCount: 1,
        replicaCount: 2,
        replicationMode: ReplicationMode.ASYNC,
        settings: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await templateManager.validateHosts(template, [
        { host: 'host1', port: 3306 },
        { host: 'host2', port: 3306 },
        { host: 'host3', port: 3306 },
      ]);

      expect(result.valid).toBe(true);
      expect(mockDb.get).not.toHaveBeenCalled();
    });
  });

  describe('initializePredefinedTemplates', () => {
    it('should skip if already initialized', async () => {
      // First call initializes
      mockDb.query.mockResolvedValue([]);
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      await templateManager.initializePredefinedTemplates();
      const firstCallCount = mockDb.execute.mock.calls.length;

      // Second call should skip
      await templateManager.initializePredefinedTemplates();
      expect(mockDb.execute.mock.calls.length).toBe(firstCallCount);
    });

    it('should batch check existing templates with single query', async () => {
      mockDb.query.mockResolvedValue([{ name: 'dev-single' }]);
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      // Create a new instance to test fresh initialization
      const freshManager = new TemplateManager();
      await freshManager.initializePredefinedTemplates();

      // Should have one query to check existing templates
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT name FROM topology_templates WHERE name IN'),
        expect.any(Array)
      );
    });

    it('should not create templates that already exist', async () => {
      // Mock that ALL predefined templates already exist
      mockDb.query.mockResolvedValue([
        { name: 'dev-single' },
        { name: 'dev-replica' },
        { name: 'standard' },
        { name: 'ha-semisync' },
        { name: 'read-heavy' },
        { name: 'production-ha' },
        { name: 'geo-distributed' },
      ]);
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const freshManager = new TemplateManager();
      const created = await freshManager.initializePredefinedTemplates();

      // Should not insert any templates since all predefined ones exist
      expect(mockDb.execute).not.toHaveBeenCalled();
      expect(created).toBe(0);
    });
  });

  describe('getOrCreate', () => {
    it('should return existing template', async () => {
      mockDb.get.mockResolvedValue({
        template_id: 'test-id',
        name: 'standard',
        description: 'Test',
        primary_count: 1,
        replica_count: 2,
        replication_mode: 'async',
        settings: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await templateManager.getOrCreate('standard');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('standard');
      expect(mockDb.execute).not.toHaveBeenCalled(); // Should not create new
    });

    it('should create predefined template if not exists', async () => {
      mockDb.get.mockResolvedValue(undefined); // Template not found
      mockDb.execute.mockResolvedValue({ changes: 1, lastId: 1 });

      const result = await templateManager.getOrCreate('standard');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('standard');
      expect(mockDb.execute).toHaveBeenCalled(); // Should create new
    });

    it('should return null for non-predefined template that does not exist', async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await templateManager.getOrCreate('custom-template');

      expect(result).toBeNull();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe('isPredefined', () => {
    it('should return true for predefined template names', () => {
      expect(templateManager.isPredefined('dev-single')).toBe(true);
      expect(templateManager.isPredefined('standard')).toBe(true);
      expect(templateManager.isPredefined('production-ha')).toBe(true);
    });

    it('should return false for custom template names', () => {
      expect(templateManager.isPredefined('my-custom')).toBe(false);
      expect(templateManager.isPredefined('random-name')).toBe(false);
    });
  });

  describe('getPredefinedTemplateDefinitions', () => {
    it('should return all predefined template definitions', () => {
      const definitions = templateManager.getPredefinedTemplateDefinitions();
      expect(definitions.length).toBeGreaterThan(0);
      expect(definitions.find((d) => d.name === 'standard')).toBeDefined();
    });
  });
});
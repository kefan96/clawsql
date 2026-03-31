/**
 * ClawSQL - Template Manager
 *
 * Manages topology templates for cluster provisioning.
 */

import { getLogger } from '../../utils/logger.js';
import { getDatabase } from '../../utils/database.js';
import {
  TopologyTemplate,
  ReplicationMode,
  createTopologyTemplate,
} from '../../types/index.js';
import { randomUUID } from 'crypto';
import {
  PREDEFINED_TEMPLATES,
  createPredefinedTemplate,
  isPredefinedTemplate,
  PredefinedTemplateDefinition,
} from './predefined-templates.js';

const logger = getLogger('template-manager');

/**
 * Template creation options
 */
export interface TemplateCreateOptions {
  name: string;
  description?: string;
  primaryCount?: number;
  replicaCount?: number;
  replicationMode?: ReplicationMode;
  settings?: TopologyTemplate['settings'];
}

/**
 * Template update options
 */
export interface TemplateUpdateOptions {
  name?: string;
  description?: string;
  primaryCount?: number;
  replicaCount?: number;
  replicationMode?: ReplicationMode;
  settings?: TopologyTemplate['settings'];
}

/**
 * Host validation result
 */
export interface HostValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Host specification for provisioning
 */
export interface HostSpec {
  host: string;
  port: number;
}

/**
 * Template Manager
 *
 * Handles CRUD operations for topology templates.
 */
export class TemplateManager {
  private db = getDatabase();
  private initialized = false;

  /**
   * List all templates
   */
  async list(): Promise<TopologyTemplate[]> {
    const rows = await this.db.query<{
      template_id: string;
      name: string;
      description: string | null;
      primary_count: number;
      replica_count: number;
      replication_mode: string;
      settings: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM topology_templates ORDER BY created_at DESC');

    return rows.map((row) => this.rowToTemplate(row));
  }

  /**
   * Get a template by name
   */
  async get(name: string): Promise<TopologyTemplate | null> {
    const row = await this.db.get<{
      template_id: string;
      name: string;
      description: string | null;
      primary_count: number;
      replica_count: number;
      replication_mode: string;
      settings: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM topology_templates WHERE name = ?', [name]);

    if (!row) return null;

    return this.rowToTemplate(row);
  }

  /**
   * Get a template by ID
   */
  async getById(templateId: string): Promise<TopologyTemplate | null> {
    const row = await this.db.get<{
      template_id: string;
      name: string;
      description: string | null;
      primary_count: number;
      replica_count: number;
      replication_mode: string;
      settings: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM topology_templates WHERE template_id = ?', [templateId]);

    if (!row) return null;

    return this.rowToTemplate(row);
  }

  /**
   * Create a new template
   */
  async create(options: TemplateCreateOptions): Promise<TopologyTemplate> {
    // Check if template name already exists
    const existing = await this.get(options.name);
    if (existing) {
      throw new Error(`Template "${options.name}" already exists`);
    }

    const templateId = randomUUID();
    const settingsJson = options.settings ? JSON.stringify(options.settings) : null;

    await this.db.execute(
      `INSERT INTO topology_templates
       (template_id, name, description, primary_count, replica_count, replication_mode, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        options.name,
        options.description ?? null,
        options.primaryCount ?? 1,
        options.replicaCount ?? 2,
        options.replicationMode ?? ReplicationMode.ASYNC,
        settingsJson,
      ]
    );

    logger.info({ templateId, name: options.name }, 'Template created');

    return createTopologyTemplate(templateId, {
      name: options.name,
      description: options.description,
      primaryCount: options.primaryCount ?? 1,
      replicaCount: options.replicaCount ?? 2,
      replicationMode: options.replicationMode ?? ReplicationMode.ASYNC,
      settings: options.settings,
    });
  }

  /**
   * Update an existing template
   */
  async update(name: string, updates: TemplateUpdateOptions): Promise<TopologyTemplate | null> {
    const existing = await this.get(name);
    if (!existing) return null;

    // If no updates provided, return existing template
    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const settingsJson = updates.settings ? JSON.stringify(updates.settings) : null;

    await this.db.execute(
      `UPDATE topology_templates
       SET name = ?, description = ?, primary_count = ?, replica_count = ?, replication_mode = ?, settings = ?
       WHERE template_id = ?`,
      [
        updates.name ?? existing.name,
        updates.description ?? existing.description ?? null,
        updates.primaryCount ?? existing.primaryCount,
        updates.replicaCount ?? existing.replicaCount,
        updates.replicationMode ?? existing.replicationMode,
        settingsJson ?? (existing.settings ? JSON.stringify(existing.settings) : null),
        existing.templateId,
      ]
    );

    logger.info({ templateId: existing.templateId, updates }, 'Template updated');

    // Return updated template
    return this.get(updates.name ?? name);
  }

  /**
   * Delete a template
   */
  async delete(name: string): Promise<boolean> {
    const existing = await this.get(name);
    if (!existing) return false;

    // Check if template is being used by any clusters
    const clusters = await this.db.query<{ cluster_id: string }>(
      'SELECT cluster_id FROM cluster_metadata WHERE template_id = ?',
      [existing.templateId]
    );

    if (clusters.length > 0) {
      throw new Error(`Template "${name}" is being used by ${clusters.length} cluster(s)`);
    }

    await this.db.execute(
      'DELETE FROM topology_templates WHERE template_id = ?',
      [existing.templateId]
    );

    logger.info({ templateId: existing.templateId, name }, 'Template deleted');

    return true;
  }

  /**
   * Validate hosts against template requirements
   */
  async validateHosts(
    templateOrName: string | TopologyTemplate,
    hosts: HostSpec[]
  ): Promise<HostValidationResult> {
    // If templateOrName is a string, fetch the template
    const template =
      typeof templateOrName === 'string' ? await this.get(templateOrName) : templateOrName;

    if (!template) {
      return { valid: false, error: `Template "${templateOrName}" not found` };
    }

    const requiredCount = template.primaryCount + template.replicaCount;
    const hostCount = hosts.length;

    if (hostCount < requiredCount) {
      return {
        valid: false,
        error: `Template requires ${requiredCount} instances but only ${hostCount} provided`,
      };
    }

    if (hostCount > requiredCount) {
      return {
        valid: false,
        error: `Template requires exactly ${requiredCount} instances but ${hostCount} provided`,
      };
    }

    return { valid: true };
  }

  /**
   * Initialize predefined templates
   *
   * Creates predefined benchmarking templates if they don't already exist.
   * This is called during platform startup.
   */
  async initializePredefinedTemplates(): Promise<number> {
    // Skip if already initialized
    if (this.initialized) {
      return 0;
    }

    // Batch check existing templates with a single query
    const predefinedNames = PREDEFINED_TEMPLATES.map((t) => t.name);
    const existingRows = await this.db.query<{ name: string }>(
      `SELECT name FROM topology_templates WHERE name IN (${predefinedNames.map(() => '?').join(', ')})`,
      predefinedNames
    );
    const existingNames = new Set(existingRows.map((r) => r.name));

    let created = 0;
    for (const definition of PREDEFINED_TEMPLATES) {
      if (existingNames.has(definition.name)) {
        continue;
      }

      const template = createPredefinedTemplate(definition);
      await this.db.execute(
        `INSERT INTO topology_templates
         (template_id, name, description, primary_count, replica_count, replication_mode, settings)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          template.templateId,
          template.name,
          template.description ?? null,
          template.primaryCount,
          template.replicaCount,
          template.replicationMode,
          template.settings ? JSON.stringify(template.settings) : null,
        ]
      );

      logger.info({ name: template.name, templateId: template.templateId }, 'Predefined template created');
      created++;
    }

    this.initialized = true;

    if (created > 0) {
      logger.info({ count: created }, 'Predefined templates initialized');
    }

    return created;
  }

  /**
   * Get predefined template definitions
   *
   * Returns the list of predefined template definitions with use cases.
   */
  getPredefinedTemplateDefinitions(): PredefinedTemplateDefinition[] {
    return PREDEFINED_TEMPLATES;
  }

  /**
   * Check if a template name is predefined
   */
  isPredefined(name: string): boolean {
    return isPredefinedTemplate(name);
  }

  /**
   * Get template or create predefined if name matches
   *
   * If the name matches a predefined template and it doesn't exist,
   * it will be created automatically.
   */
  async getOrCreate(name: string): Promise<TopologyTemplate | null> {
    // First try to get existing template
    const existing = await this.get(name);
    if (existing) {
      return existing;
    }

    // Check if it's a predefined template
    const definition = PREDEFINED_TEMPLATES.find((t) => t.name === name);
    if (!definition) {
      return null;
    }

    // Create only this one template directly
    const template = createPredefinedTemplate(definition);
    await this.db.execute(
      `INSERT INTO topology_templates
       (template_id, name, description, primary_count, replica_count, replication_mode, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        template.templateId,
        template.name,
        template.description ?? null,
        template.primaryCount,
        template.replicaCount,
        template.replicationMode,
        template.settings ? JSON.stringify(template.settings) : null,
      ]
    );

    logger.info({ name: template.name, templateId: template.templateId }, 'Predefined template created on demand');

    return template;
  }

  /**
   * Convert database row to TopologyTemplate object
   */
  private rowToTemplate(row: {
    template_id: string;
    name: string;
    description: string | null;
    primary_count: number;
    replica_count: number;
    replication_mode: string;
    settings: string | null;
    created_at: Date;
    updated_at: Date;
  }): TopologyTemplate {
    let settings: TopologyTemplate['settings'] = undefined;
    if (row.settings) {
      try {
        settings = JSON.parse(row.settings);
      } catch (error) {
        logger.warn({ templateId: row.template_id, settings: row.settings }, 'Failed to parse template settings JSON');
      }
    }

    return createTopologyTemplate(row.template_id, {
      name: row.name,
      description: row.description ?? undefined,
      primaryCount: row.primary_count,
      replicaCount: row.replica_count,
      replicationMode: row.replication_mode as ReplicationMode,
      settings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

// Singleton instance
let templateManager: TemplateManager | null = null;

/**
 * Get the template manager instance
 */
export function getTemplateManager(): TemplateManager {
  if (!templateManager) {
    templateManager = new TemplateManager();
  }
  return templateManager;
}
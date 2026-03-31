/**
 * Tests for Predefined Templates
 */

import {
  PREDEFINED_TEMPLATES,
  createPredefinedTemplate,
  getPredefinedTemplate,
  isPredefinedTemplate,
  getPredefinedTemplateNames,
} from '../../../core/provisioning/predefined-templates.js';
import { ReplicationMode } from '../../../types/index.js';

describe('Predefined Templates', () => {
  describe('PREDEFINED_TEMPLATES constant', () => {
    it('should have predefined templates', () => {
      expect(PREDEFINED_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('should have valid template definitions', () => {
      for (const template of PREDEFINED_TEMPLATES) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.primaryCount).toBeGreaterThanOrEqual(1);
        expect(template.replicaCount).toBeGreaterThanOrEqual(0);
        expect(['async', 'semi-sync', 'group-replication']).toContain(template.replicationMode);
        expect(template.useCase).toBeTruthy();
      }
    });

    it('should include dev-single template', () => {
      const devSingle = PREDEFINED_TEMPLATES.find((t) => t.name === 'dev-single');
      expect(devSingle).toBeDefined();
      expect(devSingle?.primaryCount).toBe(1);
      expect(devSingle?.replicaCount).toBe(0);
    });

    it('should include standard template', () => {
      const standard = PREDEFINED_TEMPLATES.find((t) => t.name === 'standard');
      expect(standard).toBeDefined();
      expect(standard?.primaryCount).toBe(1);
      expect(standard?.replicaCount).toBe(2);
      expect(standard?.replicationMode).toBe(ReplicationMode.ASYNC);
    });

    it('should include production-ha template with semi-sync', () => {
      const prodHa = PREDEFINED_TEMPLATES.find((t) => t.name === 'production-ha');
      expect(prodHa).toBeDefined();
      expect(prodHa?.replicationMode).toBe(ReplicationMode.SEMI_SYNC);
      expect(prodHa?.replicaCount).toBe(3);
    });
  });

  describe('createPredefinedTemplate', () => {
    it('should create a TopologyTemplate from definition', () => {
      const definition = PREDEFINED_TEMPLATES[0];
      const template = createPredefinedTemplate(definition);

      expect(template.templateId).toBeTruthy();
      expect(template.name).toBe(definition.name);
      expect(template.description).toBe(definition.description);
      expect(template.primaryCount).toBe(definition.primaryCount);
      expect(template.replicaCount).toBe(definition.replicaCount);
      expect(template.replicationMode).toBe(definition.replicationMode);
      expect(template.createdAt).toBeInstanceOf(Date);
      expect(template.updatedAt).toBeInstanceOf(Date);
    });

    it('should create templates with unique IDs', () => {
      const definition = PREDEFINED_TEMPLATES[0];
      const template1 = createPredefinedTemplate(definition);
      const template2 = createPredefinedTemplate(definition);

      expect(template1.templateId).not.toBe(template2.templateId);
    });
  });

  describe('getPredefinedTemplate', () => {
    it('should return template definition by name', () => {
      const template = getPredefinedTemplate('standard');
      expect(template).toBeDefined();
      expect(template?.name).toBe('standard');
    });

    it('should return undefined for unknown template', () => {
      const template = getPredefinedTemplate('nonexistent');
      expect(template).toBeUndefined();
    });
  });

  describe('isPredefinedTemplate', () => {
    it('should return true for predefined template names', () => {
      expect(isPredefinedTemplate('dev-single')).toBe(true);
      expect(isPredefinedTemplate('standard')).toBe(true);
      expect(isPredefinedTemplate('production-ha')).toBe(true);
    });

    it('should return false for custom template names', () => {
      expect(isPredefinedTemplate('my-custom-template')).toBe(false);
      expect(isPredefinedTemplate('random-name')).toBe(false);
    });
  });

  describe('getPredefinedTemplateNames', () => {
    it('should return all predefined template names', () => {
      const names = getPredefinedTemplateNames();
      expect(names.length).toBe(PREDEFINED_TEMPLATES.length);
      expect(names).toContain('dev-single');
      expect(names).toContain('standard');
      expect(names).toContain('production-ha');
    });
  });
});
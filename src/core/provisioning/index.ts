/**
 * ClawSQL - Provisioning Module
 *
 * Template-based cluster provisioning.
 */

export { TemplateManager, getTemplateManager } from './template-manager.js';
export type { TemplateCreateOptions, TemplateUpdateOptions, HostValidationResult, HostSpec } from './template-manager.js';
export { ClusterProvisioner, getClusterProvisioner } from './cluster-provisioner.js';
export type { ProvisionResult } from './cluster-provisioner.js';
export {
  PREDEFINED_TEMPLATES,
  createPredefinedTemplate,
  getPredefinedTemplate,
  isPredefinedTemplate,
  getPredefinedTemplateNames,
} from './predefined-templates.js';
export type { PredefinedTemplateDefinition } from './predefined-templates.js';
/**
 * ClawSQL - Templates CLI Command
 *
 * Manage topology templates for cluster provisioning.
 */

import { getTemplateManager, getClusterProvisioner } from '../../core/provisioning/index.js';
import { ReplicationMode } from '../../types/index.js';
import { CLIContext, Command } from '../registry.js';
import { parseStringArg, getErrorMessage } from '../utils/args.js';

/**
 * Templates command
 */
export const templatesCommand: Command = {
  name: 'templates',
  description: 'Manage topology templates for cluster provisioning',
  usage: '/templates <list|create|show|delete> [options]',
  handler: async (args: string[], ctx: CLIContext): Promise<void> => {
    const subcommand = args[0];

    switch (subcommand) {
      case 'list':
        await handleList(args.slice(1), ctx);
        break;
      case 'create':
        await handleCreate(args.slice(1), ctx);
        break;
      case 'show':
        await handleShow(args.slice(1), ctx);
        break;
      case 'delete':
        await handleDelete(args.slice(1), ctx);
        break;
      default:
        if (subcommand) {
          console.log(ctx.formatter.error(`Unknown subcommand: ${subcommand}`));
        } else {
          console.log(ctx.formatter.error('Missing subcommand. Use: list, create, show, or delete'));
        }
        console.log(`Usage: ${templatesCommand.usage}`);
    }
  },
};

/**
 * List all templates
 */
async function handleList(_args: string[], ctx: CLIContext): Promise<void> {
  const templateManager = getTemplateManager();

  try {
    const templates = await templateManager.list();

    if (ctx.outputFormat === 'json') {
      console.log(JSON.stringify({ templates }, null, 2));
      return;
    }

    if (templates.length === 0) {
      console.log(ctx.formatter.info('No templates found. Create one with: /templates create --name <name>'));
      return;
    }

    console.log(ctx.formatter.header('Topology Templates'));
    console.log();

    for (const template of templates) {
      console.log(ctx.formatter.keyValue('Name', template.name));
      console.log(ctx.formatter.keyValue('  ID', template.templateId));
      if (template.description) {
        console.log(ctx.formatter.keyValue('  Description', template.description));
      }
      console.log(ctx.formatter.keyValue('  Primary/Replica', `${template.primaryCount}/${template.replicaCount}`));
      console.log(ctx.formatter.keyValue('  Replication', template.replicationMode));
      console.log();
    }
  } catch (error) {
    console.log(ctx.formatter.error(`Failed to list templates: ${getErrorMessage(error)}`));
  }
}

/**
 * Create a new template
 */
async function handleCreate(args: string[], ctx: CLIContext): Promise<void> {
  const name = parseStringArg(args, '--name');
  if (!name) {
    console.log(ctx.formatter.error('Missing required argument: --name'));
    console.log('Usage: /templates create --name <name> [--description <desc>] [--replicas <n>] [--mode <async|semi-sync>]');
    return;
  }

  const description = parseStringArg(args, '--description');
  const replicaCount = parseInt(parseStringArg(args, '--replicas') || '2', 10);
  const modeStr = parseStringArg(args, '--mode') || 'async';

  // Validate replication mode
  if (!Object.values(ReplicationMode).includes(modeStr as ReplicationMode)) {
    console.log(ctx.formatter.error(`Invalid replication mode: ${modeStr}. Use: async, semi-sync, or group-replication`));
    return;
  }

  const templateManager = getTemplateManager();

  try {
    const template = await templateManager.create({
      name,
      description,
      replicaCount,
      replicationMode: modeStr as ReplicationMode,
    });

    console.log(ctx.formatter.success(`Template "${template.name}" created successfully`));
    console.log(ctx.formatter.keyValue('ID', template.templateId));
    console.log(ctx.formatter.keyValue('Primary/Replica', `${template.primaryCount}/${template.replicaCount}`));
    console.log(ctx.formatter.keyValue('Replication Mode', template.replicationMode));
  } catch (error) {
    console.log(ctx.formatter.error(`Failed to create template: ${getErrorMessage(error)}`));
  }
}

/**
 * Show template details
 */
async function handleShow(args: string[], ctx: CLIContext): Promise<void> {
  const name = args[0] || parseStringArg(args, '--name');
  if (!name) {
    console.log(ctx.formatter.error('Missing template name'));
    console.log('Usage: /templates show <name>');
    return;
  }

  const templateManager = getTemplateManager();
  const provisioner = getClusterProvisioner();

  try {
    const template = await templateManager.get(name);
    if (!template) {
      console.log(ctx.formatter.error(`Template "${name}" not found`));
      return;
    }

    if (ctx.outputFormat === 'json') {
      console.log(JSON.stringify(template, null, 2));
      return;
    }

    console.log(ctx.formatter.header(`Template: ${template.name}`));
    console.log();
    console.log(ctx.formatter.keyValue('ID', template.templateId));
    if (template.description) {
      console.log(ctx.formatter.keyValue('Description', template.description));
    }
    console.log(ctx.formatter.keyValue('Primary Count', template.primaryCount.toString()));
    console.log(ctx.formatter.keyValue('Replica Count', template.replicaCount.toString()));
    console.log(ctx.formatter.keyValue('Replication Mode', template.replicationMode));
    if (template.settings) {
      console.log(ctx.formatter.keyValue('Settings', JSON.stringify(template.settings)));
    }
    console.log(ctx.formatter.keyValue('Created', template.createdAt.toISOString()));
    console.log(ctx.formatter.keyValue('Updated', template.updatedAt.toISOString()));

    // Show clusters using this template
    const clusters = await provisioner.listClusters();
    const usingClusters = clusters.filter((c) => c.templateId === template.templateId);

    if (usingClusters.length > 0) {
      console.log();
      console.log(ctx.formatter.header('Clusters using this template'));
      for (const cluster of usingClusters) {
        console.log(ctx.formatter.keyValue('  Cluster', `${cluster.clusterId} (${cluster.provisionStatus})`));
      }
    }
  } catch (error) {
    console.log(ctx.formatter.error(`Failed to show template: ${getErrorMessage(error)}`));
  }
}

/**
 * Delete a template
 */
async function handleDelete(args: string[], ctx: CLIContext): Promise<void> {
  const name = args[0] || parseStringArg(args, '--name');
  const force = args.includes('--force');

  if (!name) {
    console.log(ctx.formatter.error('Missing template name'));
    console.log('Usage: /templates delete <name> [--force]');
    return;
  }

  const templateManager = getTemplateManager();

  try {
    // Check if template exists
    const template = await templateManager.get(name);
    if (!template) {
      console.log(ctx.formatter.error(`Template "${name}" not found`));
      return;
    }

    if (!force) {
      console.log(ctx.formatter.warning(`Will delete template "${name}"`));
      console.log('Use --force to confirm deletion');
      return;
    }

    await templateManager.delete(name);
    console.log(ctx.formatter.success(`Template "${name}" deleted successfully`));
  } catch (error) {
    console.log(ctx.formatter.error(`Failed to delete template: ${getErrorMessage(error)}`));
  }
}
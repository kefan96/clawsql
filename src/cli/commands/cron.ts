/**
 * ClawSQL CLI - Cron Command
 *
 * Schedule periodic tasks via OpenClaw.
 */

import { Command, CLIContext } from '../registry.js';
import { theme } from '../ui/components.js';

/**
 * Cron command
 */
export const cronCommand: Command = {
  name: 'cron',
  description: 'Schedule periodic health checks and monitoring via OpenClaw',
  usage: '/cron <list|add|remove|status>',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const subcommand = args[0];

    if (!subcommand) {
      console.log(formatter.error('Missing subcommand. Usage: /cron <list|add|remove|status>'));
      console.log(formatter.info('  list   - List scheduled jobs'));
      console.log(formatter.info('  add    - Schedule a new job'));
      console.log(formatter.info('  remove - Remove a scheduled job'));
      console.log(formatter.info('  status - Check OpenClaw availability'));
      return;
    }

    switch (subcommand) {
      case 'list':
        await listCronJobs(ctx);
        break;
      case 'add':
        await addCronJob(args.slice(1), ctx);
        break;
      case 'remove':
        await removeCronJob(args.slice(1), ctx);
        break;
      case 'status':
        await checkStatus(ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
    }
  },
};

/**
 * List scheduled cron jobs
 */
async function listCronJobs(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  try {
    const { spawn } = await import('child_process');
    const proc = spawn('openclaw', ['cron', 'list', '--json']);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const jobs = JSON.parse(stdout);
          if (jobs.length === 0) {
            console.log(formatter.info('No scheduled jobs found.'));
          } else {
            console.log(formatter.table(
              jobs.map((job: { name: string; schedule: string; enabled: boolean }) => ({
                name: job.name,
                schedule: job.schedule,
                status: job.enabled ? theme.success('enabled') : theme.error('disabled'),
              })),
              [
                { key: 'name', header: 'Name', width: 30 },
                { key: 'schedule', header: 'Schedule', width: 20 },
                { key: 'status', header: 'Status', width: 10 },
              ]
            ));
          }
        } catch {
          console.log(stdout);
        }
      } else {
        console.log(formatter.error(`Failed to list cron jobs: ${stderr || stdout}`));
        console.log(formatter.info('Make sure OpenClaw gateway is running: openclaw gateway'));
      }
    });

    proc.on('error', (err) => {
      console.log(formatter.error(`OpenClaw not available: ${err.message}`));
      console.log(formatter.info('Install OpenClaw: npm install -g openclaw'));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Error: ${message}`));
  }
}

/**
 * Add a new cron job
 */
async function addCronJob(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length < 2) {
    console.log(formatter.error('Usage: /cron add <name> <schedule> [prompt]'));
    console.log(formatter.info('  name     - Job name (e.g., "health-check")'));
    console.log(formatter.info('  schedule - Cron schedule (e.g., "0 * * * *" for hourly)'));
    console.log(formatter.info('  prompt   - Optional custom prompt'));
    console.log();
    console.log(formatter.info('Predefined jobs:'));
    console.log(formatter.info('  health-check  - Hourly cluster health check'));
    console.log(formatter.info('  topology      - Daily topology review'));
    return;
  }

  const name = args[0];
  const schedule = args[1];
  let prompt = args.slice(2).join(' ');

  // Default prompts for predefined jobs
  if (!prompt) {
    switch (name) {
      case 'health-check':
        prompt = 'Check MySQL cluster health using clawsql skill. Report any instances that are down, have high replication lag, or show concerning metrics.';
        break;
      case 'topology':
        prompt = 'Review the MySQL cluster topology using clawsql skill. Verify all instances are properly configured and report any anomalies.';
        break;
      case 'failover-status':
        prompt = 'Check failover configuration and recent history using clawsql skill. Alert if auto-failover is disabled or if there were recent failover events.';
        break;
      default:
        prompt = `Use clawsql skill to perform: ${name}`;
    }
  }

  const fullName = `clawsql:${name}`;

  try {
    const { scheduleCron } = await import('../agent/openclaw-integration.js');
    await scheduleCron(fullName, schedule, prompt);
    console.log(formatter.success(`Scheduled job: ${fullName}`));
    console.log(formatter.info(`Schedule: ${schedule}`));
    console.log(formatter.info(`Prompt: ${prompt}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Failed to schedule job: ${message}`));
    console.log(formatter.info('Make sure OpenClaw gateway is running: openclaw gateway'));
  }
}

/**
 * Remove a scheduled cron job
 */
async function removeCronJob(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length < 1) {
    console.log(formatter.error('Usage: /cron remove <name>'));
    return;
  }

  const name = args[0];
  const fullName = `clawsql:${name}`;

  try {
    const { spawn } = await import('child_process');
    const proc = spawn('openclaw', ['cron', 'remove', fullName]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(formatter.success(`Removed job: ${fullName}`));
      } else {
        console.log(formatter.error(`Failed to remove job: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      console.log(formatter.error(`OpenClaw not available: ${err.message}`));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Error: ${message}`));
  }
}

/**
 * Check OpenClaw status
 */
async function checkStatus(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  try {
    const { isOpenClawAvailable } = await import('../agent/openclaw-integration.js');
    const available = await isOpenClawAvailable();

    if (available) {
      console.log(formatter.success('OpenClaw gateway is running'));
      console.log(formatter.info('AI features: enabled'));
      console.log(formatter.info('Cron scheduling: available'));
      console.log(formatter.info('Channels: available'));
    } else {
      console.log(formatter.warning('OpenClaw gateway is not running'));
      console.log(formatter.info('Start with: openclaw gateway'));
      console.log(formatter.info('Install with: npm install -g openclaw'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatter.error(`Error checking status: ${message}`));
    console.log(formatter.info('Install OpenClaw: npm install -g openclaw'));
  }
}

export default cronCommand;
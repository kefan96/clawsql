/**
 * ClawSQL CLI - Config Command
 *
 * Show current configuration.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';

/**
 * Config command
 */
export const configCommand: Command = {
  name: 'config',
  description: 'Show current configuration',
  usage: '/config',
  handler: async (_args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const settings = ctx.settings;

    console.log(formatter.header('Configuration'));

    // App info
    console.log('\n' + formatter.section('Application'));
    console.log(formatter.keyValue('Name', settings.appName));
    console.log(formatter.keyValue('Version', settings.appVersion));
    console.log(formatter.keyValue('Debug', settings.debug ? chalk.yellow('on') : 'off'));

    // API settings
    console.log('\n' + formatter.section('API'));
    console.log(formatter.keyValue('Listen', `${settings.api.host}:${settings.api.port}`));

    // Database settings
    console.log('\n' + formatter.section('Metadata Database'));
    console.log(formatter.keyValue('Host', settings.metadataDb.host || 'metadata-mysql (auto)'));
    console.log(formatter.keyValue('Database', settings.metadataDb.name));

    // Orchestrator settings
    console.log('\n' + formatter.section('Orchestrator'));
    console.log(formatter.keyValue('URL', settings.orchestrator.url));
    console.log(formatter.keyValue('Timeout', `${settings.orchestrator.timeout}s`));

    // ProxySQL settings
    console.log('\n' + formatter.section('ProxySQL'));
    console.log(formatter.keyValue('Admin', `${settings.proxysql.host}:${settings.proxysql.adminPort}`));
    console.log(formatter.keyValue('MySQL', `${settings.proxysql.host}:${settings.proxysql.mysqlPort}`));

    // Prometheus settings
    console.log('\n' + formatter.section('Prometheus'));
    console.log(formatter.keyValue('URL', settings.prometheus.url));

    // Failover settings
    console.log('\n' + formatter.section('Failover'));
    const autoFailover = settings.failover.autoFailoverEnabled;
    console.log(formatter.keyValue('Auto', autoFailover ? chalk.green('on') : chalk.red('off')));
    console.log(formatter.keyValue('Timeout', `${settings.failover.timeoutSeconds}s`));
    console.log(formatter.keyValue('Min Replicas', settings.failover.minReplicasForFailover));
    console.log(formatter.keyValue('Checks', settings.failover.confirmationChecks));

    // Monitoring settings
    console.log('\n' + formatter.section('Monitoring'));
    console.log(formatter.keyValue('Collect', `${settings.monitoring.collectionInterval}s`));
    console.log(formatter.keyValue('Health Check', `${settings.monitoring.healthCheckInterval}s`));

    // Logging settings
    console.log('\n' + formatter.section('Logging'));
    console.log(formatter.keyValue('Level', settings.logging.level));
    console.log(formatter.keyValue('Format', settings.logging.format));

    // AI settings
    console.log('\n' + formatter.section('AI Agent'));
    const aiEnabled = settings.ai.enabled;
    console.log(formatter.keyValue('Enabled', aiEnabled ? chalk.green('yes') : 'no'));
    console.log(formatter.keyValue('Provider', settings.ai.provider));
    console.log(formatter.keyValue('Max Tokens', settings.ai.maxTokens));
    console.log(formatter.keyValue('Temperature', settings.ai.temperature));

    console.log();
  },
};

export default configCommand;
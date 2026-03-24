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

    console.log(formatter.header('ClawSQL Configuration'));

    // App info
    console.log(chalk.bold('\n📦 Application'));
    console.log(formatter.keyValue('Name', settings.appName));
    console.log(formatter.keyValue('Version', settings.appVersion));
    console.log(formatter.keyValue('Debug Mode', settings.debug ? chalk.yellow('Enabled') : 'Disabled'));

    // API settings
    console.log(chalk.bold('\n🌐 API'));
    console.log(formatter.keyValue('Host', settings.api.host));
    console.log(formatter.keyValue('Port', settings.api.port));

    // Database settings
    console.log(chalk.bold('\n💾 Database'));
    if (settings.database.type === 'sqlite') {
      console.log(formatter.keyValue('Type', 'SQLite'));
      console.log(formatter.keyValue('Path', settings.database.sqlitePath));
    } else {
      console.log(formatter.keyValue('Type', 'MySQL'));
      console.log(formatter.keyValue('Host', settings.database.host));
      console.log(formatter.keyValue('Port', settings.database.port));
      console.log(formatter.keyValue('Database', settings.database.name));
    }

    // Orchestrator settings
    console.log(chalk.bold('\n🔗 Orchestrator'));
    console.log(formatter.keyValue('URL', settings.orchestrator.url));
    console.log(formatter.keyValue('Timeout', `${settings.orchestrator.timeout}s`));

    // ProxySQL settings
    console.log(chalk.bold('\n🔀 ProxySQL'));
    console.log(formatter.keyValue('Host', settings.proxysql.host));
    console.log(formatter.keyValue('Admin Port', settings.proxysql.adminPort));
    console.log(formatter.keyValue('MySQL Port', settings.proxysql.mysqlPort));

    // Prometheus settings
    console.log(chalk.bold('\n📊 Prometheus'));
    console.log(formatter.keyValue('URL', settings.prometheus.url));

    // Failover settings
    console.log(chalk.bold('\n⚡ Failover'));
    const autoFailover = settings.failover.autoFailoverEnabled;
    console.log(formatter.keyValue('Auto Failover', autoFailover ? chalk.green('Enabled') : chalk.red('Disabled')));
    console.log(formatter.keyValue('Timeout', `${settings.failover.timeoutSeconds}s`));
    console.log(formatter.keyValue('Min Replicas', settings.failover.minReplicasForFailover));
    console.log(formatter.keyValue('Confirmation Checks', settings.failover.confirmationChecks));

    // Monitoring settings
    console.log(chalk.bold('\n📈 Monitoring'));
    console.log(formatter.keyValue('Collection Interval', `${settings.monitoring.collectionInterval}s`));
    console.log(formatter.keyValue('Health Check Interval', `${settings.monitoring.healthCheckInterval}s`));

    // Logging settings
    console.log(chalk.bold('\n📝 Logging'));
    console.log(formatter.keyValue('Level', settings.logging.level));
    console.log(formatter.keyValue('Format', settings.logging.format));

    // AI settings
    console.log(chalk.bold('\n🤖 AI Agent'));
    const aiEnabled = settings.ai.enabled;
    console.log(formatter.keyValue('Enabled', aiEnabled ? chalk.green('Yes') : chalk.red('No')));
    console.log(formatter.keyValue('Provider', settings.ai.provider));
    if (settings.ai.model) {
      console.log(formatter.keyValue('Model', settings.ai.model));
    }
    console.log(formatter.keyValue('Max Tokens', settings.ai.maxTokens.toString()));
    console.log(formatter.keyValue('Temperature', settings.ai.temperature.toString()));

    console.log();
  },
};

export default configCommand;
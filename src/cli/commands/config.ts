/**
 * ClawSQL CLI - Config Command
 *
 * Manage ClawSQL configuration.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Config file path
 */
const CONFIG_DIR = path.join(os.homedir(), '.clawsql');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Config command
 */
export const configCommand: Command = {
  name: 'config',
  description: 'Manage configuration',
  usage: '/config <show|init|set|get> [args...]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0 || args[0] === 'show') {
      await showConfig(ctx);
      return;
    }

    const subcommand = args[0].toLowerCase();

    switch (subcommand) {
      case 'init':
        await initConfig(ctx);
        break;
      case 'set':
        await setConfig(args.slice(1), ctx);
        break;
      case 'get':
        await getConfig(args.slice(1), ctx);
        break;
      default:
        console.log(formatter.error(`Unknown subcommand: ${subcommand}`));
        console.log(formatter.info('Available: show, init, set, get'));
    }
  },
};

/**
 * Show current configuration
 */
async function showConfig(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;
  const settings = ctx.settings;

  // Build config object
  const config = {
    application: {
      name: settings.appName,
      version: settings.appVersion,
      debug: settings.debug,
    },
    api: {
      listen: `${settings.api.host}:${settings.api.port}`,
    },
    metadataDb: {
      host: settings.metadataDb.host || 'metadata-mysql (auto)',
      database: settings.metadataDb.name,
    },
    orchestrator: {
      url: settings.orchestrator.url,
      timeout: `${settings.orchestrator.timeout}s`,
    },
    proxysql: {
      admin: `${settings.proxysql.host}:${settings.proxysql.adminPort}`,
      mysql: `${settings.proxysql.host}:${settings.proxysql.mysqlPort}`,
    },
    prometheus: {
      url: settings.prometheus.url,
    },
    failover: {
      auto: settings.failover.autoFailoverEnabled,
      timeout: `${settings.failover.timeoutSeconds}s`,
      minReplicas: settings.failover.minReplicasForFailover,
      checks: settings.failover.confirmationChecks,
    },
    monitoring: {
      collect: `${settings.monitoring.collectionInterval}s`,
      healthCheck: `${settings.monitoring.healthCheckInterval}s`,
    },
    logging: {
      level: settings.logging.level,
      format: settings.logging.format,
    },
    ai: {
      enabled: settings.ai.enabled,
      provider: settings.ai.provider,
      maxTokens: settings.ai.maxTokens,
      temperature: settings.ai.temperature,
    },
  };

  // JSON output
  if (ctx.outputFormat === 'json') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  // Table output
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

  // Config file location
  console.log('\n' + formatter.section('Config File'));
  console.log(formatter.keyValue('Location', CONFIG_FILE));
  console.log(formatter.keyValue('Exists', fs.existsSync(CONFIG_FILE) ? chalk.green('yes') : chalk.yellow('no')));

  console.log();
}

/**
 * Initialize configuration interactively
 */
async function initConfig(ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  console.log(formatter.header('Configuration Wizard'));
  console.log(chalk.gray('This will create a configuration file at ~/.clawsql/config.json\n'));

  // Load existing config if available
  let existingConfig: Record<string, unknown> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      existingConfig = JSON.parse(content);
      console.log(chalk.yellow('Found existing configuration. Press Enter to keep current values.\n'));
    } catch {
      // Ignore parse errors
    }
  }

  // Question types for inquirer
  interface ConfigQuestion {
    type: 'input' | 'password' | 'confirm' | 'list';
    name: string;
    message: string;
    default?: string | number | boolean;
    choices?: string[];
    mask?: string;
  }

  const questions: ConfigQuestion[] = [
    {
      type: 'input',
      name: 'mysqlAdminUser',
      message: 'MySQL Admin User:',
      default: (existingConfig.mysqlAdminUser as string) || ctx.settings.mysql.adminUser || 'clawsql',
    },
    {
      type: 'password',
      name: 'mysqlAdminPassword',
      message: 'MySQL Admin Password:',
      mask: '*',
    },
    {
      type: 'input',
      name: 'mysqlReplUser',
      message: 'MySQL Replication User:',
      default: (existingConfig.mysqlReplUser as string) || ctx.settings.mysql.replicationUser || 'repl',
    },
    {
      type: 'password',
      name: 'mysqlReplPassword',
      message: 'MySQL Replication Password:',
      mask: '*',
    },
    {
      type: 'input',
      name: 'orchestratorUrl',
      message: 'Orchestrator URL:',
      default: (existingConfig.orchestratorUrl as string) || ctx.settings.orchestrator.url,
    },
    {
      type: 'input',
      name: 'proxysqlHost',
      message: 'ProxySQL Host:',
      default: (existingConfig.proxysqlHost as string) || ctx.settings.proxysql.host,
    },
    {
      type: 'input',
      name: 'proxysqlAdminPort',
      message: 'ProxySQL Admin Port:',
      default: String((existingConfig.proxysqlAdminPort as number) || ctx.settings.proxysql.adminPort),
    },
    {
      type: 'confirm',
      name: 'autoFailover',
      message: 'Enable automatic failover?',
      default: (existingConfig.autoFailover as boolean) ?? ctx.settings.failover.autoFailoverEnabled,
    },
    {
      type: 'list',
      name: 'logLevel',
      message: 'Log Level:',
      choices: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'SILENT'],
      default: (existingConfig.logLevel as string) || ctx.settings.logging.level,
    },
  ];

  const answers = await inquirer.prompt(questions);

  // Build config object
  const config: Record<string, unknown> = {
    mysqlAdminUser: answers.mysqlAdminUser,
    mysqlReplUser: answers.mysqlReplUser,
    orchestratorUrl: answers.orchestratorUrl,
    proxysqlHost: answers.proxysqlHost,
    proxysqlAdminPort: answers.proxysqlAdminPort,
    autoFailover: answers.autoFailover,
    logLevel: answers.logLevel,
  };

  // Only include passwords if provided
  if (answers.mysqlAdminPassword) {
    config.mysqlAdminPassword = answers.mysqlAdminPassword;
  }
  if (answers.mysqlReplPassword) {
    config.mysqlReplPassword = answers.mysqlReplPassword;
  }

  // Create config directory
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write config file
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log();
  console.log(formatter.success(`Configuration saved to ${CONFIG_FILE}`));
  console.log(formatter.info('Restart ClawSQL to apply changes.'));
}

/**
 * Set a configuration value
 */
async function setConfig(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length < 2) {
    console.log(formatter.error('Usage: /config set <key> <value>'));
    console.log(formatter.info('Example: /config set mysql.admin_password mypassword'));
    console.log();
    console.log(formatter.info('Available keys:'));
    console.log(formatter.info('  mysql.admin_user          MySQL admin username'));
    console.log(formatter.info('  mysql.admin_password      MySQL admin password'));
    console.log(formatter.info('  mysql.repl_user           MySQL replication username'));
    console.log(formatter.info('  mysql.repl_password       MySQL replication password'));
    console.log(formatter.info('  orchestrator.url          Orchestrator URL'));
    console.log(formatter.info('  proxysql.host             ProxySQL hostname'));
    console.log(formatter.info('  proxysql.admin_port       ProxySQL admin port'));
    console.log(formatter.info('  failover.auto_enabled     Enable auto failover (true/false)'));
    console.log(formatter.info('  log.level                 Log level (DEBUG/INFO/WARNING/ERROR/SILENT)'));
    return;
  }

  const key = args[0].toLowerCase();
  const value = args.slice(1).join(' ');

  // Map key to config key
  const keyMap: Record<string, string> = {
    'mysql.admin_user': 'mysqlAdminUser',
    'mysql.admin_password': 'mysqlAdminPassword',
    'mysql.repl_user': 'mysqlReplUser',
    'mysql.repl_password': 'mysqlReplPassword',
    'orchestrator.url': 'orchestratorUrl',
    'proxysql.host': 'proxysqlHost',
    'proxysql.admin_port': 'proxysqlAdminPort',
    'failover.auto_enabled': 'autoFailover',
    'log.level': 'logLevel',
  };

  const configKey = keyMap[key];
  if (!configKey) {
    console.log(formatter.error(`Unknown config key: ${key}`));
    console.log(formatter.info('Run "/config set" without arguments to see available keys.'));
    return;
  }

  // Load existing config
  let config: Record<string, unknown> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // Ignore parse errors
    }
  }

  // Parse value based on key
  let parsedValue: unknown = value;
  if (configKey === 'autoFailover') {
    parsedValue = value.toLowerCase() === 'true' || value === '1';
  } else if (configKey === 'proxysqlAdminPort') {
    const portNum = parseInt(value, 10);
    if (isNaN(portNum)) {
      console.log(formatter.error('Port must be a number'));
      return;
    }
    parsedValue = portNum;
  }

  // Set value
  config[configKey] = parsedValue;

  // Create config directory if needed
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write config
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log(formatter.success(`Set ${key} = ${configKey === 'mysqlAdminPassword' || configKey === 'mysqlReplPassword' ? '***' : value}`));
  console.log(formatter.info('Restart ClawSQL to apply changes.'));
}

/**
 * Get a configuration value
 */
async function getConfig(args: string[], ctx: CLIContext): Promise<void> {
  const formatter = ctx.formatter;

  if (args.length === 0) {
    console.log(formatter.error('Usage: /config get <key>'));
    return;
  }

  const key = args[0].toLowerCase();

  // Map key to settings path
  const keyPaths: Record<string, () => unknown> = {
    'mysql.admin_user': () => ctx.settings.mysql.adminUser,
    'mysql.admin_password': () => ctx.settings.mysql.adminPassword ? '***' : '(not set)',
    'mysql.repl_user': () => ctx.settings.mysql.replicationUser,
    'mysql.repl_password': () => ctx.settings.mysql.replicationPassword ? '***' : '(not set)',
    'orchestrator.url': () => ctx.settings.orchestrator.url,
    'proxysql.host': () => ctx.settings.proxysql.host,
    'proxysql.admin_port': () => ctx.settings.proxysql.adminPort,
    'failover.auto_enabled': () => ctx.settings.failover.autoFailoverEnabled,
    'log.level': () => ctx.settings.logging.level,
  };

  const getter = keyPaths[key];
  if (!getter) {
    console.log(formatter.error(`Unknown config key: ${key}`));
    return;
  }

  const value = getter();
  console.log(formatter.keyValue(key, String(value)));
}

export default configCommand;
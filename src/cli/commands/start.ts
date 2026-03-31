/**
 * ClawSQL CLI - Start Command
 *
 * Start the ClawSQL platform using Docker Compose.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { ensureDockerFiles, ensureEnvFile } from '../utils/docker-files.js';
import {
  checkDockerPrerequisites,
  getDockerInstallGuidance,
  getComposeInstallGuidance,
  configureRegistryMirror,
  REGISTRY_MIRRORS,
} from '../utils/docker-prereq.js';
import {
  executeCommand,
  clearProgressCache,
} from '../utils/command-executor.js';
import { getOpenClawStatus, printUnknownGatewayGuidance } from '../agent/index.js';
import { detectAIConfigFromEnv, getAIConfigDisplay } from '../utils/ai-config.js';
import { spawn } from 'child_process';

/**
 * Start command
 */
export const startCommand: Command = {
  name: 'start',
  description: 'Start the ClawSQL platform',
  usage: '/start [--demo] [--pull]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const demoMode = args.includes('--demo');
    const allInOneMode = args.includes('--allinone');
    const pullMode = args.includes('--pull');

    // Parse --registry flag
    const registryIndex = args.indexOf('--registry');
    const registryMirror = registryIndex !== -1 && args[registryIndex + 1] ? args[registryIndex + 1] : null;

    console.log(formatter.header('Starting ClawSQL Platform'));

    if (allInOneMode) {
      console.log(formatter.info('Using all-in-one container mode'));
    }

    // Check Docker prerequisites
    const dockerInfo = await checkDockerPrerequisites();

    if (!dockerInfo.runtime) {
      console.log(formatter.error('No container runtime found (docker or podman required)'));
      console.log(getDockerInstallGuidance());
      return;
    }

    if (!dockerInfo.daemonRunning) {
      console.log(formatter.error(`${dockerInfo.runtime} daemon is not running`));
      console.log(formatter.info(`Start ${dockerInfo.runtime} and try again`));
      return;
    }

    if (!dockerInfo.composeCommand) {
      console.log(formatter.error('Docker Compose not found'));
      console.log(getComposeInstallGuidance(dockerInfo.runtime));
      return;
    }

    console.log(formatter.keyValue('Runtime', `${dockerInfo.runtime} ${dockerInfo.version}`));
    console.log(formatter.keyValue('Compose', dockerInfo.composeCommand.join(' ')));

    // Configure registry mirror if specified
    if (registryMirror && dockerInfo.runtime) {
      const mirror = REGISTRY_MIRRORS[registryMirror as keyof typeof REGISTRY_MIRRORS] || registryMirror;
      console.log(formatter.info(`Configuring registry mirror: ${mirror}`));
      const configured = await configureRegistryMirror(dockerInfo.runtime, mirror);
      if (configured) {
        console.log(formatter.success('Registry mirror configured'));
      } else {
        console.log(formatter.error('Failed to configure registry mirror'));
        console.log(formatter.info('You may need to run with sudo or configure manually'));
      }
    }

    // Ensure Docker files are extracted
    let dockerPath: string;
    try {
      dockerPath = await ensureDockerFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(message));
      return;
    }

    // Ensure .env file exists
    await ensureEnvFile();

    // Check for OpenClaw availability
    // Use getOpenClawStatus which properly prioritizes local over Docker
    const openClawStatus = await getOpenClawStatus();
    const useLocalOpenClaw = openClawStatus.isLocal;
    const hasOpenClaw = openClawStatus.available;
    const hasUnknownGateway = openClawStatus.isUnknown;

    // Handle unknown gateway (running but source unclear)
    if (hasUnknownGateway) {
      console.log(formatter.warning('OpenClaw gateway detected on port 18789 but source is unknown'));
      printUnknownGatewayGuidance(openClawStatus.error, msg => console.log(formatter.error(msg)));
      console.log(formatter.info('  3. Continue without AI features (OpenClaw will not be started)'));
      console.log();
    } else if (hasOpenClaw) {
      if (useLocalOpenClaw) {
        console.log(formatter.success('OpenClaw gateway detected (using local installation)'));
      } else {
        console.log(formatter.success('OpenClaw gateway detected (using Docker container)'));
      }
    } else {
      console.log(formatter.info('No OpenClaw found - will start in Docker'));
    }

    // Build compose arguments
    const composeArgs: string[] = [];
    const composeEnv: Record<string, string> = {};
    const isPodmanCompose = dockerInfo.composeCommand[0] === 'podman-compose';

    // Always use 'clawsql' as the project name for consistency
    composeArgs.push('-p', 'clawsql');

    // Select compose file based on mode
    if (allInOneMode) {
      composeArgs.push('-f', 'docker-compose.allinone.yml');
      console.log(formatter.info('Starting all-in-one container...'));
    } else if (demoMode) {
      composeArgs.push('-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml');
      console.log(formatter.info('Starting with demo MySQL cluster...'));
      // Auto-detect host IP for demo MySQL containers' report_host
      // This ensures Orchestrator can properly discover instances using their actual IP
      const hostIp = process.env.HOST_IP || await detectHostIp();
      composeEnv.HOST_IP = hostIp;
      console.log(formatter.keyValue('Host IP', hostIp));
    } else {
      console.log(formatter.info('Starting platform services (bring your own MySQL)...'));
    }

    // Add metadata profile if no external DB configured (not for all-in-one)
    if (!allInOneMode) {
      const metadataDbHost = process.env.METADATA_DB_HOST;
      if (!metadataDbHost) {
        // podman-compose doesn't support --profile flag, use environment variable instead
        if (isPodmanCompose) {
          composeEnv.COMPOSE_PROFILES = 'metadata';
        } else {
          composeArgs.push('--profile', 'metadata');
        }
        console.log(formatter.info('Auto-provisioning metadata database...'));
      }
    }

    // Add up command with pull policy
    composeArgs.push('up', '-d');

    // Add pull policy based on flags
    if (pullMode) {
      composeArgs.push('--pull', 'always');
    }
    // Note: By default, docker-compose will pull missing images automatically
    // We don't add --no-pull because we want the fallback behavior

    // Skip OpenClaw service if already running locally or if gateway source is unknown
    if (useLocalOpenClaw || hasUnknownGateway) {
      composeArgs.push('--scale', 'openclaw=0');
    }

    // Clear progress cache for fresh start
    clearProgressCache();

    // Show services to be started
    console.log();
    console.log(chalk.bold('Services:'));
    const services = getServiceList(demoMode, allInOneMode, !useLocalOpenClaw && !hasUnknownGateway);
    for (const service of services) {
      console.log(`  ${chalk.gray('○')} ${service}`);
    }
    console.log();

    // Track progress messages shown
    const progressMessages = new Set<string>();
    const showProgress = (msg: string) => {
      if (!progressMessages.has(msg)) {
        progressMessages.add(msg);
        // Use different formatting based on message type
        if (msg.includes('✓')) {
          console.log(`  ${chalk.green(msg)}`);
        } else if (msg.includes('...')) {
          console.log(`  ${chalk.cyan(msg)}`);
        } else {
          console.log(formatter.info(msg));
        }
      }
    };

    // Execute compose up with abstract progress output
    console.log(chalk.bold('Starting containers:'));
    const result = await executeCommand(dockerInfo.composeCommand, composeArgs, {
      cwd: dockerPath,
      env: Object.keys(composeEnv).length > 0 ? composeEnv : undefined,
      logCommand: demoMode ? '/start --demo' : allInOneMode ? '/start --allinone' : '/start',
      onProgress: showProgress,
    });

    if (!result.success) {
      console.log(formatter.error('Failed to start services'));

      // Check if error is related to missing images
      const stderr = result.stderr.toLowerCase();
      if (stderr.includes('no such image') ||
          stderr.includes('image') && stderr.includes('not found') ||
          stderr.includes('pull access denied') ||
          stderr.includes('manifest unknown')) {
        console.log();
        console.log(formatter.info('Some Docker images are missing.'));
        console.log(formatter.info('Run "/install" to download required images first.'));
        if (demoMode) {
          console.log(formatter.info('Or run "/install --demo" for demo MySQL images.'));
        }
      } else {
        console.log(formatter.info('Check logs: ~/.clawsql/logs/clawsql.log'));
      }
      return;
    }

    // Wait for services to be ready
    console.log();
    console.log(chalk.bold('Waiting for services:'));

    // Wait for metadata MySQL to be ready (if auto-provisioned)
    if (!process.env.METADATA_DB_HOST && !allInOneMode) {
      console.log(`  ${chalk.cyan('Metadata MySQL...')}`);
      const metadataReady = await waitForMetadataMySQL(60);

      if (!metadataReady) {
        console.log(`  ${chalk.yellow('Metadata MySQL timeout (using external DB?)')}`);
      } else {
        console.log(`  ${chalk.green('Metadata MySQL ready ✓')}`);

        // Apply Orchestrator schema before Orchestrator starts
        // This prevents MySQL 8.0 compatibility issues with AFTER clauses
        console.log(`  ${chalk.cyan('Orchestrator schema...')}`);
        await applyOrchestratorSchema();
        console.log(`  ${chalk.green('Orchestrator schema ready ✓')}`);
      }
    }

    // Wait for Orchestrator to be ready
    console.log(`  ${chalk.cyan('Orchestrator...')}`);
    const orchestratorReady = await waitForOrchestrator(90);

    if (!orchestratorReady) {
      console.log(`  ${chalk.red('Orchestrator timeout ✗')}`);
      console.log(formatter.info('Check logs: podman logs orchestrator'));
      return;
    }
    console.log(`  ${chalk.green('Orchestrator ready ✓')}`);

    // Create ClawSQL application tables
    console.log(`  ${chalk.cyan('ClawSQL schema...')}`);
    await createClawSQLTables();
    console.log(`  ${chalk.green('ClawSQL schema ready ✓')}`);

    // Wait for ClawSQL API to be ready
    console.log(`  ${chalk.cyan('ClawSQL API...')}`);
    const apiReady = await waitForAPI(ctx, 60);

    if (!apiReady) {
      console.log(`  ${chalk.red('ClawSQL API timeout ✗')}`);
      console.log(formatter.info('Check logs: podman logs clawsql'));
      return;
    }
    console.log(`  ${chalk.green('ClawSQL API ready ✓')}`);

    // Wait for OpenClaw gateway to be ready (skip if using local or unknown)
    if (!useLocalOpenClaw && !hasUnknownGateway && !hasOpenClaw) {
      console.log(`  ${chalk.cyan('OpenClaw gateway...')}`);
      console.log(formatter.info('  OpenClaw may take 30-60 seconds to initialize (AI model loading)'));
      const openclawReady = await waitForOpenClaw(60);

      if (!openclawReady) {
        console.log(`  ${chalk.yellow('OpenClaw gateway not ready after 60 seconds')}`);
        console.log(formatter.info('  AI features may be limited. Check logs: podman logs openclaw'));
        console.log(formatter.info('  Gateway will become available when ready - check with /status'));
      } else {
        console.log(`  ${chalk.green('OpenClaw gateway ready ✓')}`);
      }
    } else if (useLocalOpenClaw) {
      console.log(`  ${chalk.green('OpenClaw gateway ready ✓')} ${chalk.gray('(local)')}`);
    } else if (hasUnknownGateway) {
      console.log(`  ${chalk.yellow('OpenClaw gateway: skipped')} ${chalk.gray('(port 18789 already in use by unknown source)')}`);
    }

    console.log(formatter.success('ClawSQL platform is ready!'));
    console.log();
    console.log(chalk.bold('Services:'));
    console.log(`  ClawSQL API:    http://localhost:${ctx.settings.api.port}`);
    console.log(`  API Docs:       http://localhost:${ctx.settings.api.port}/docs`);
    console.log(`  Orchestrator:   http://localhost:3000`);
    console.log(`  Prometheus:     http://localhost:9090`);
    console.log(`  Grafana:        http://localhost:3001 (admin/admin)`);
    console.log(`  ProxySQL:       localhost:${ctx.settings.proxysql.mysqlPort} (MySQL traffic)`);

    // Show OpenClaw info based on mode
    console.log();
    console.log(chalk.bold.cyan('OpenClaw AI Gateway:'));

    // Detect AI config from environment
    const aiConfig = detectAIConfigFromEnv();

    if (hasUnknownGateway) {
      console.log(`  ${chalk.yellow('Status:')}       Unknown (port 18789 in use)`);
      console.log(`  ${chalk.yellow('Warning:')}      Gateway detected but source unclear`);
      console.log(chalk.yellow('  AI features may not work correctly.'));
      console.log(formatter.info('  Install openclaw CLI or stop the gateway to use Docker'));
    } else if (useLocalOpenClaw) {
      console.log(`  ${chalk.green('Status:')}       Using local installation`);
      console.log(`  ${chalk.cyan('Control UI:')}    http://localhost:18790`);
      console.log(`  ${chalk.gray('Features:')}      Chat with AI, manage sessions, view logs`);
    } else {
      console.log(`  ${chalk.green('Status:')}       Running in Docker`);
      console.log(`  ${chalk.cyan('Control UI:')}    http://localhost:18790`);
      console.log(`  ${chalk.gray('Gateway:')}       ws://localhost:18789`);
      console.log(`  ${chalk.gray('Features:')}      Chat with AI, manage sessions, view logs`);

      // Show detected AI config
      if (aiConfig.provider !== 'none') {
        console.log(`  ${chalk.green('Model:')}         ${getAIConfigDisplay(aiConfig)} (auto-detected)`);
        if (aiConfig.baseUrl) {
          console.log(`  ${chalk.gray('Base URL:')}      ${aiConfig.baseUrl}`);
        }
      } else {
        console.log(`  ${chalk.gray('Model:')}         bundled qwen (default)`);
        console.log();
        console.log(chalk.yellow('  Tip: Set ANTHROPIC_API_KEY or OPENAI_API_KEY for better AI'));
      }
    }

    if (demoMode) {
      console.log();
      console.log(chalk.bold('Demo MySQL Cluster:'));
      console.log('  Primary:   localhost:3306 (root/rootpassword)');
      console.log('  Replica 1: localhost:3307');
      console.log('  Replica 2: localhost:3308');
    }

    console.log();
    console.log(formatter.info('Run "/status" to check platform health'));
    console.log(formatter.info('Run "/doctor" to diagnose any issues'));
    console.log(formatter.info('Run "/openclaw status" for AI gateway details'));
  },
};

/**
 * Wait for API to be ready
 */
async function waitForAPI(ctx: CLIContext, timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${ctx.settings.api.port}/health`);
      if (response.ok) {
        const data = await response.json() as { status?: string };
        if (data.status === 'healthy') {
          return true;
        }
      }
    } catch {
      // API not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Wait for OpenClaw gateway to be ready
 */
async function waitForOpenClaw(timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch('http://localhost:18789/health', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // OpenClaw not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Apply Orchestrator schema before Orchestrator starts
 * This pre-creates all tables with complete schema to avoid MySQL 8.0 compatibility issues
 */
async function applyOrchestratorSchema(): Promise<boolean> {
  const schemaPath = '/root/clawsql/docker/orchestrator/orchestrator-schema.sql';

  // Read the schema file
  const fs = await import('fs/promises');
  let schemaSQL: string;
  try {
    schemaSQL = await fs.readFile(schemaPath, 'utf-8');
  } catch {
    // Schema file not found, let Orchestrator handle its own schema
    return false;
  }

  return new Promise((resolve) => {
    const mysql = spawn('podman', ['exec', '-i', 'metadata-mysql', 'mysql', '-uclawsql', '-pclawsql_password', 'clawsql_meta'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mysql.stdin?.write(schemaSQL);
    mysql.stdin?.end();

    let stderr = '';
    mysql.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    mysql.on('close', (code) => {
      if (code === 0 || stderr.includes('already exists')) {
        resolve(true);
      } else {
        // Log error but don't fail - Orchestrator will try its own schema
        console.log(`  ${chalk.yellow('Schema application had issues, Orchestrator will handle schema')}`);
        resolve(false);
      }
    });

    mysql.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Wait for MySQL metadata database to be ready
 */
async function waitForMetadataMySQL(timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const mysql = spawn('podman', ['exec', 'metadata-mysql', 'mysqladmin', 'ping', '-h', 'localhost'], {
        stdio: 'pipe',
      });

      const result = await new Promise<boolean>((resolve) => {
        mysql.on('close', (code) => {
          resolve(code === 0);
        });
        mysql.on('error', () => {
          resolve(false);
        });
      });

      if (result) {
        return true;
      }
    } catch {
      // MySQL not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Wait for Orchestrator to be ready (creates its own schema)
 */
async function waitForOrchestrator(timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch('http://localhost:3000/api/health', {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json() as { Code?: string };
        if (data.Code === 'OK') {
          return true;
        }
      }
    } catch {
      // Orchestrator not ready yet
    }

    await sleep(2000);
  }

  return false;
}

/**
 * Create ClawSQL application tables after Orchestrator schema is ready
 */
async function createClawSQLTables(): Promise<void> {
  const sqlStatements = `
-- Drop old ClawSQL tables if they exist (schema may have changed)
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS instance_metadata;
DROP TABLE IF EXISTS schema_metadata;
DROP TABLE IF EXISTS config_snapshots;
DROP TABLE IF EXISTS proxysql_servers;
DROP TABLE IF EXISTS proxysql_hostgroups;
DROP TABLE IF EXISTS proxysql_query_rules;
DROP TABLE IF EXISTS proxysql_audit_log;

-- Create ClawSQL application tables
CREATE TABLE alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    instance_id VARCHAR(255),
    alert_type VARCHAR(50),
    severity VARCHAR(20),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged BOOLEAN DEFAULT FALSE
);

CREATE TABLE instance_metadata (
    instance_id VARCHAR(255) PRIMARY KEY,
    labels JSON,
    extra JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE schema_metadata (
    id INT AUTO_INCREMENT PRIMARY KEY,
    instance_id VARCHAR(255) NOT NULL,
    database_name VARCHAR(255),
    table_name VARCHAR(255),
    table_rows BIGINT,
    data_size BIGINT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE config_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    component VARCHAR(50),
    config_type VARCHAR(50),
    config_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE proxysql_servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hostgroup_id INT,
    hostname VARCHAR(255),
    port INT,
    status VARCHAR(20),
    weight INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE proxysql_hostgroups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    writer_hostgroup INT,
    reader_hostgroup INT,
    cluster_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE proxysql_query_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_id INT,
    match_pattern VARCHAR(255),
    destination_hostgroup INT,
    apply BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE proxysql_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50),
    username VARCHAR(255),
    schemaname VARCHAR(255),
    query TEXT,
    duration_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

  return new Promise((resolve) => {
    const mysql = spawn('podman', ['exec', '-i', 'metadata-mysql', 'mysql', '-uclawsql', '-pclawsql_password', 'clawsql_meta'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mysql.stdin?.write(sqlStatements);
    mysql.stdin?.end();

    mysql.on('close', () => {
      resolve();
    });

    mysql.on('error', () => {
      resolve(); // Don't fail start if table creation fails
    });
  });
}

/**
 * Detect the host's primary IP address
 * Used for setting MySQL report_host in demo mode
 */
async function detectHostIp(): Promise<string> {
  try {
    const execa = (await import('execa')).default;
    // Get the first non-localhost IP
    const result = await execa('hostname', ['-I']);
    const ips = result.stdout.trim().split(/\s+/);
    // Find the first IP that's not localhost
    for (const ip of ips) {
      if (ip && !ip.startsWith('127.') && !ip.startsWith('169.254.')) {
        return ip;
      }
    }
    // Fallback to first IP if no suitable one found
    return ips[0] || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

/**
 * Get list of services to be started
 */
function getServiceList(demoMode: boolean, allInOneMode: boolean, includeOpenClaw: boolean): string[] {
  const services: { name: string; desc: string }[] = [];

  if (allInOneMode) {
    services.push({ name: 'clawsql-allinone', desc: 'All-in-one container' });
    return services.map(s => `${s.name} - ${s.desc}`);
  }

  // Core platform services
  if (includeOpenClaw) {
    services.push({ name: 'OpenClaw', desc: 'AI Agent Gateway' });
  }
  services.push({ name: 'Orchestrator', desc: 'MySQL topology management' });
  services.push({ name: 'ProxySQL', desc: 'MySQL traffic routing' });
  services.push({ name: 'Prometheus', desc: 'Metrics collection' });
  services.push({ name: 'Grafana', desc: 'Visualization dashboards' });
  services.push({ name: 'ClawSQL API', desc: 'Main application' });

  // Metadata database (if auto-provisioned)
  if (!process.env.METADATA_DB_HOST) {
    services.push({ name: 'Metadata MySQL', desc: 'Internal state database' });
  }

  // Demo MySQL cluster
  if (demoMode) {
    services.push({ name: 'MySQL Primary', desc: 'Demo cluster writer (port 3306)' });
    services.push({ name: 'MySQL Replica 1', desc: 'Demo cluster reader (port 3307)' });
    services.push({ name: 'MySQL Replica 2', desc: 'Demo cluster reader (port 3308)' });
  }

  return services.map(s => `${s.name} - ${s.desc}`);
}

export default startCommand;
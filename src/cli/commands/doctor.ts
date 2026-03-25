/**
 * ClawSQL CLI - Doctor Command
 *
 * Diagnoses system health and suggests fixes for common issues.
 * Similar to `brew doctor` or `npm doctor`.
 */

import { Command, CLIContext } from '../registry.js';
import chalk from 'chalk';
import { spawn } from 'child_process';

/**
 * Diagnostic result severity
 */
type Severity = 'ok' | 'warning' | 'error' | 'info';

/**
 * Diagnostic check result
 */
interface DiagnosticResult {
  name: string;
  severity: Severity;
  message: string;
  detail?: string;
  fix?: string;
  fixCommand?: string;
}

/**
 * Doctor command
 */
export const doctorCommand: Command = {
  name: 'doctor',
  description: 'Diagnose system issues and suggest fixes',
  usage: '/doctor [--fix]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;
    const shouldFix = args.includes('--fix');

    console.log(formatter.header('ClawSQL Doctor'));
    console.log(chalk.gray('Running diagnostics...\n'));

    const results: DiagnosticResult[] = [];

    // Run all diagnostic checks
    await runDiagnostics(ctx, results);

    // Display results
    displayResults(results);

    // Summary
    const errors = results.filter(r => r.severity === 'error');
    const warnings = results.filter(r => r.severity === 'warning');

    console.log();
    if (errors.length === 0 && warnings.length === 0) {
      console.log(chalk.green('✓ All systems healthy!'));
    } else {
      console.log(chalk.yellow(`Found ${errors.length} error(s) and ${warnings.length} warning(s)`));

      if (!shouldFix && (errors.length > 0 || warnings.length > 0)) {
        console.log(chalk.gray('\nSome issues may have automatic fixes available.'));
      }
    }
  },
};

/**
 * Run all diagnostic checks
 */
async function runDiagnostics(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  // Platform checks
  await checkContainerRuntime(results);
  await checkClawSQLAPI(ctx, results);
  await checkOrchestrator(ctx, results);
  await checkProxySQL(ctx, results);
  await checkPrometheus(ctx, results);

  // Configuration checks
  checkConfiguration(ctx, results);

  // MySQL checks
  await checkMySQLInstances(ctx, results);
  await checkReplicationTopology(ctx, results);
}

/**
 * Check container runtime availability
 */
async function checkContainerRuntime(results: DiagnosticResult[]): Promise<void> {
  const runtimes = ['docker', 'podman'];
  let foundRuntime = '';

  for (const runtime of runtimes) {
    try {
      const result = await execCommand([runtime, 'info'], true);
      if (result.success) {
        foundRuntime = runtime;
        break;
      }
    } catch {
      // Continue to next runtime
    }
  }

  if (foundRuntime) {
    results.push({
      name: 'Container Runtime',
      severity: 'ok',
      message: `${foundRuntime} is installed and running`,
    });

    // Check if containers are running
    try {
      const psResult = await execCommand(
        [foundRuntime, 'ps', '--filter', 'name=clawsql', '--filter', 'name=orchestrator',
         '--filter', 'name=proxysql', '-q'],
        true
      );
      const containerCount = psResult.stdout.trim().split('\n').filter(Boolean).length;

      if (containerCount === 0) {
        results.push({
          name: 'Platform Containers',
          severity: 'warning',
          message: 'No ClawSQL containers are running',
          fix: 'Start the platform with: /start',
          fixCommand: '/start',
        });
      } else {
        results.push({
          name: 'Platform Containers',
          severity: 'ok',
          message: `${containerCount} container(s) running`,
        });
      }
    } catch {
      results.push({
        name: 'Platform Containers',
        severity: 'warning',
        message: 'Could not check container status',
      });
    }
  } else {
    results.push({
      name: 'Container Runtime',
      severity: 'error',
      message: 'No container runtime found (docker or podman required)',
      fix: 'Install Docker from https://docs.docker.com/get-docker/',
    });
  }
}

/**
 * Check ClawSQL API health
 */
async function checkClawSQLAPI(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${ctx.settings.api.port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { status?: string };
      if (data.status === 'healthy') {
        results.push({
          name: 'ClawSQL API',
          severity: 'ok',
          message: `Running on port ${ctx.settings.api.port}`,
        });
      } else {
        results.push({
          name: 'ClawSQL API',
          severity: 'error',
          message: `API returned status: ${data.status}`,
          fix: 'Check logs: docker logs clawsql',
        });
      }
    } else {
      results.push({
        name: 'ClawSQL API',
        severity: 'error',
        message: `API returned HTTP ${response.status}`,
        fix: 'Check logs: docker logs clawsql',
      });
    }
  } catch {
    results.push({
      name: 'ClawSQL API',
      severity: 'error',
      message: 'API is not responding',
      detail: `Expected at http://localhost:${ctx.settings.api.port}`,
      fix: 'Start the platform with: /start',
      fixCommand: '/start',
    });
  }
}

/**
 * Check Orchestrator health
 */
async function checkOrchestrator(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const isHealthy = await ctx.orchestrator.healthCheck();
    if (isHealthy) {
      results.push({
        name: 'Orchestrator',
        severity: 'ok',
        message: `Running at ${ctx.settings.orchestrator.url}`,
      });

      // Check if instances are discovered
      try {
        const clusters = await ctx.orchestrator.getClusters();
        if (clusters.length === 0) {
          results.push({
            name: 'MySQL Topology',
            severity: 'warning',
            message: 'No MySQL instances discovered in Orchestrator',
            fix: 'Register instances with: /instances register <host>',
            fixCommand: '/instances register <mysql-host>',
          });
        } else {
          results.push({
            name: 'MySQL Topology',
            severity: 'ok',
            message: `${clusters.length} cluster(s) discovered`,
          });
        }
      } catch {
        results.push({
          name: 'MySQL Topology',
          severity: 'warning',
          message: 'Could not retrieve topology information',
        });
      }
    } else {
      results.push({
        name: 'Orchestrator',
        severity: 'error',
        message: 'Health check failed',
        fix: 'Check Orchestrator container: docker logs orchestrator',
      });
    }
  } catch {
    results.push({
      name: 'Orchestrator',
      severity: 'error',
      message: 'Cannot connect to Orchestrator',
      detail: `Expected at ${ctx.settings.orchestrator.url}`,
      fix: 'Ensure Orchestrator container is running: docker ps | grep orchestrator',
    });
  }
}

/**
 * Check ProxySQL health
 */
async function checkProxySQL(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    await ctx.proxysql.connect();

    results.push({
      name: 'ProxySQL',
      severity: 'ok',
      message: `Admin interface running on port ${ctx.settings.proxysql.adminPort}`,
    });

    // Check if MySQL servers are configured
    try {
      const servers = await ctx.proxysql.getServers();
      if (servers.length === 0) {
        results.push({
          name: 'ProxySQL Servers',
          severity: 'warning',
          message: 'No MySQL servers configured in ProxySQL',
          fix: 'Register MySQL instances, then sync with: /clusters sync',
        });
      } else {
        const onlineServers = servers.filter(s => s.status === 'ONLINE');
        if (onlineServers.length === servers.length) {
          results.push({
            name: 'ProxySQL Servers',
            severity: 'ok',
            message: `${onlineServers.length}/${servers.length} servers online`,
          });
        } else {
          results.push({
            name: 'ProxySQL Servers',
            severity: 'warning',
            message: `${onlineServers.length}/${servers.length} servers online`,
            fix: 'Check MySQL server connectivity and credentials',
          });
        }
      }
    } catch {
      results.push({
        name: 'ProxySQL Servers',
        severity: 'warning',
        message: 'Could not retrieve server configuration',
      });
    }

    await ctx.proxysql.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name: 'ProxySQL',
      severity: 'error',
      message: 'Cannot connect to ProxySQL admin interface',
      detail: message,
      fix: 'Ensure ProxySQL container is running: docker ps | grep proxysql',
    });
  }
}

/**
 * Check Prometheus health
 */
async function checkPrometheus(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const response = await fetch(`${ctx.settings.prometheus.url}/-/healthy`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      results.push({
        name: 'Prometheus',
        severity: 'ok',
        message: `Running at ${ctx.settings.prometheus.url}`,
      });
    } else {
      results.push({
        name: 'Prometheus',
        severity: 'warning',
        message: `Health check returned status ${response.status}`,
        fix: 'Check Prometheus container: docker logs prometheus',
      });
    }
  } catch {
    results.push({
      name: 'Prometheus',
      severity: 'warning',
      message: 'Cannot connect to Prometheus',
      detail: `Expected at ${ctx.settings.prometheus.url}`,
      fix: 'Prometheus is optional. Start with: /start',
    });
  }
}

/**
 * Check configuration issues
 */
function checkConfiguration(ctx: CLIContext, results: DiagnosticResult[]): void {
  // Check API token secret
  if (ctx.settings.api.tokenSecret === 'change-me-in-production') {
    results.push({
      name: 'API Token Secret',
      severity: 'warning',
      message: 'Using default token secret (not secure for production)',
      fix: 'Set environment variable: API_TOKEN_SECRET=<your-secret>',
    });
  }

  // Check MySQL credentials
  if (!ctx.settings.mysql.adminPassword) {
    results.push({
      name: 'MySQL Credentials',
      severity: 'warning',
      message: 'MySQL admin password not configured',
      detail: 'Required for instance discovery and management',
      fix: 'Set environment variable: MYSQL_ADMIN_PASSWORD=<password>',
    });
  }

  // Check auto-failover
  if (!ctx.settings.failover.autoFailoverEnabled) {
    results.push({
      name: 'Auto Failover',
      severity: 'info',
      message: 'Automatic failover is disabled',
      fix: 'Enable with: AUTO_FAILOVER_ENABLED=true',
    });
  }

  // Check metadata database
  if (!ctx.settings.metadataDb.host) {
    results.push({
      name: 'Metadata Database',
      severity: 'ok',
      message: 'Using auto-provisioned metadata-mysql container',
    });
  }
}

/**
 * Check MySQL instances health
 */
async function checkMySQLInstances(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const clusters = await ctx.orchestrator.getClusters();

    for (const clusterName of clusters) {
      const topology = await ctx.orchestrator.getTopology(clusterName);
      if (!topology) continue;

      // Check primary
      if (topology.primary) {
        if (topology.primary.state !== 'online') {
          results.push({
            name: `Primary [${topology.name || clusterName}]`,
            severity: 'error',
            message: `Primary ${topology.primary.host}:${topology.primary.port} is ${topology.primary.state}`,
            fix: 'Check MySQL instance status and connectivity',
          });
        } else {
          results.push({
            name: `Primary [${topology.name || clusterName}]`,
            severity: 'ok',
            message: `${topology.primary.host}:${topology.primary.port} is online`,
          });
        }
      } else {
        results.push({
          name: `Primary [${topology.name || clusterName}]`,
          severity: 'error',
          message: 'No primary found for cluster',
          fix: 'Check replication setup or promote a replica: /failover switchover',
        });
      }

      // Check replicas
      for (const replica of topology.replicas) {
        if (replica.state !== 'online') {
          results.push({
            name: `Replica [${topology.name || clusterName}]`,
            severity: 'warning',
            message: `Replica ${replica.host}:${replica.port} is ${replica.state}`,
            fix: 'Check replica MySQL status and replication connection',
          });
        } else if (replica.replicationLag !== undefined && replica.replicationLag > 60) {
          results.push({
            name: `Replica Lag [${topology.name || clusterName}]`,
            severity: 'warning',
            message: `Replica ${replica.host}:${replica.port} has high lag (${replica.replicationLag}s)`,
            fix: 'Check replica performance and network connectivity',
          });
        }
      }
    }
  } catch {
    // Already handled in Orchestrator check
  }
}

/**
 * Check replication topology issues
 */
async function checkReplicationTopology(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const analysis = await ctx.orchestrator.getReplicationAnalysis();

    for (const issue of analysis) {
      const analysisType = issue.Analysis as string;
      const description = issue.Description as string;
      const affectedHost = (issue.Key as Record<string, string>)?.Hostname;

      if (analysisType && !analysisType.includes('NoProblem')) {
        results.push({
          name: 'Replication Analysis',
          severity: 'warning',
          message: `${analysisType}: ${affectedHost || 'unknown'}`,
          detail: description as string,
          fix: 'Review Orchestrator UI for details: http://localhost:3000',
        });
      }
    }
  } catch {
    // Orchestrator may not be available
  }
}

/**
 * Display diagnostic results
 */
function displayResults(results: DiagnosticResult[]): void {
  // Group by severity
  const errors = results.filter(r => r.severity === 'error');
  const warnings = results.filter(r => r.severity === 'warning');
  const ok = results.filter(r => r.severity === 'ok');
  const info = results.filter(r => r.severity === 'info');

  // Display errors first
  if (errors.length > 0) {
    console.log(chalk.red.bold('\n❌ Errors:\n'));
    for (const result of errors) {
      displayResult(result);
    }
  }

  // Display warnings
  if (warnings.length > 0) {
    console.log(chalk.yellow.bold('\n⚠️  Warnings:\n'));
    for (const result of warnings) {
      displayResult(result);
    }
  }

  // Display info
  if (info.length > 0) {
    console.log(chalk.blue.bold('\nℹ️  Information:\n'));
    for (const result of info) {
      displayResult(result);
    }
  }

  // Display healthy checks
  if (ok.length > 0) {
    console.log(chalk.green.bold('\n✓ Healthy:\n'));
    for (const result of ok) {
      console.log(chalk.gray(`  ${result.name}: `) + chalk.green(result.message));
    }
  }
}

/**
 * Display a single diagnostic result
 */
function displayResult(result: DiagnosticResult): void {
  const severityIcons = {
    error: chalk.red('✗'),
    warning: chalk.yellow('!'),
    ok: chalk.green('✓'),
    info: chalk.blue('i'),
  };

  const icon = severityIcons[result.severity];

  console.log(`  ${icon} ${chalk.bold(result.name)}: ${result.message}`);

  if (result.detail) {
    console.log(chalk.gray(`      ${result.detail}`));
  }

  if (result.fix) {
    console.log(chalk.cyan(`      Fix: ${result.fix}`));
  }

  if (result.fixCommand) {
    console.log(chalk.gray(`      Command: ${result.fixCommand}`));
  }

  console.log();
}

/**
 * Execute a shell command
 */
function execCommand(cmd: string[], silent: boolean = false): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: silent ? 'pipe' : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (silent) {
      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });
    }

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
      });
    });

    proc.on('error', () => {
      resolve({
        success: false,
        stdout: '',
        stderr: 'Failed to execute command',
      });
    });
  });
}

export default doctorCommand;
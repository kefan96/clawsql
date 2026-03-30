/**
 * ClawSQL CLI - Doctor Command
 *
 * Diagnoses system health and suggests fixes for common issues.
 */

import { Command, CLIContext } from '../registry.js';
import { theme, indicators } from '../ui/components.js';
import { spawn } from 'child_process';
import {
  getDetailedOpenClawStatus,
  CONFIG,
} from '../agent/openclaw-integration.js';
import {
  detectRuntime,
  checkImagesInstalled,
} from '../utils/docker-prereq.js';
import { detectAIConfigFromEnv } from '../utils/ai-config.js';

// ============================================================================
// Types
// ============================================================================

type Severity = 'ok' | 'warning' | 'error' | 'info';

interface DiagnosticResult {
  name: string;
  severity: Severity;
  message: string;
  detail?: string;
  fix?: string;
  fixCommand?: string;
}

// ============================================================================
// Command Definition
// ============================================================================

export const doctorCommand: Command = {
  name: 'doctor',
  description: 'Diagnose system issues and suggest fixes',
  usage: '/doctor [--fix]',
  handler: async (_args: string[], ctx: CLIContext) => {
    console.log(ctx.formatter.header('ClawSQL Doctor'));
    console.log(theme.muted('Running diagnostics...\n'));

    const results: DiagnosticResult[] = [];
    await runDiagnostics(ctx, results);
    displayResults(results);
    printSummary(results);
  },
};

// ============================================================================
// Diagnostic Runner
// ============================================================================

async function runDiagnostics(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  const runtime = await checkContainerRuntime(results);

  await Promise.all([
    checkDockerImages(runtime, results),
    checkClawSQLAPI(ctx, results),
    checkOrchestrator(ctx, results),
    checkProxySQL(ctx, results),
    checkPrometheus(ctx, results),
    checkOpenClaw(ctx, results),
  ]);

  checkConfiguration(ctx, results);
}

// ============================================================================
// Individual Checks
// ============================================================================

async function checkContainerRuntime(results: DiagnosticResult[]): Promise<string | null> {
  const runtime = await detectRuntime();

  if (!runtime) {
    results.push({
      name: 'Container Runtime',
      severity: 'error',
      message: 'No container runtime found (docker or podman required)',
      fix: 'Install Docker from https://docs.docker.com/get-docker/',
    });
    return null;
  }

  results.push({
    name: 'Container Runtime',
    severity: 'ok',
    message: `${runtime} is installed and running`,
  });

  const psResult = await execCommand([runtime, 'ps', '--filter', 'name=clawsql', '--filter', 'name=orchestrator', '--filter', 'name=proxysql', '-q'], true);
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

  return runtime;
}

async function checkDockerImages(runtime: string | null, results: DiagnosticResult[]): Promise<void> {
  if (!runtime) return;

  const status = await checkImagesInstalled(runtime);

  if (status.installed.length === status.total) {
    results.push({ name: 'Docker Images', severity: 'ok', message: `All ${status.total} images installed` });
  } else if (status.installed.length === 0) {
    results.push({
      name: 'Docker Images',
      severity: 'error',
      message: 'No Docker images installed',
      fix: 'Pull images with: /install',
      fixCommand: '/install',
    });
  } else {
    const missing = status.missing.slice(0, 3).map(i => i.split('/').pop()).join(', ');
    results.push({
      name: 'Docker Images',
      severity: 'warning',
      message: `${status.installed.length}/${status.total} images installed`,
      detail: `Missing: ${missing}${status.missing.length > 3 ? '...' : ''}`,
      fix: 'Pull missing images with: /install',
      fixCommand: '/install',
    });
  }
}

async function checkClawSQLAPI(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${ctx.settings.api.port}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      results.push({
        name: 'ClawSQL API',
        severity: 'error',
        message: `API returned HTTP ${response.status}`,
        fix: 'Check logs: docker logs clawsql',
      });
      return;
    }

    const data = await response.json() as { status?: string };
    if (data.status === 'healthy') {
      results.push({ name: 'ClawSQL API', severity: 'ok', message: `Running on port ${ctx.settings.api.port}` });
    } else {
      results.push({
        name: 'ClawSQL API',
        severity: 'error',
        message: `API returned status: ${data.status}`,
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

async function checkOrchestrator(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  // Health check
  try {
    const isHealthy = await ctx.orchestrator.healthCheck();
    if (!isHealthy) {
      results.push({
        name: 'Orchestrator',
        severity: 'error',
        message: 'Health check failed',
        fix: 'Check Orchestrator container: docker logs orchestrator',
      });
      return;
    }

    results.push({ name: 'Orchestrator', severity: 'ok', message: `Running at ${ctx.settings.orchestrator.url}` });
  } catch {
    results.push({
      name: 'Orchestrator',
      severity: 'error',
      message: 'Cannot connect to Orchestrator',
      detail: `Expected at ${ctx.settings.orchestrator.url}`,
      fix: 'Ensure container is running: docker ps | grep orchestrator',
    });
  }
}

async function checkProxySQL(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    await ctx.proxysql.connect();
    results.push({ name: 'ProxySQL', severity: 'ok', message: `Admin interface on port ${ctx.settings.proxysql.adminPort}` });

    const servers = await ctx.proxysql.getServers();
    if (servers.length === 0) {
      results.push({
        name: 'ProxySQL Servers',
        severity: 'warning',
        message: 'No MySQL servers configured',
        fix: 'Register instances, then sync with: /clusters sync',
      });
    } else {
      const online = servers.filter(s => s.status === 'ONLINE').length;
      if (online === servers.length) {
        results.push({ name: 'ProxySQL Servers', severity: 'ok', message: `${online}/${servers.length} servers online` });
      } else {
        results.push({
          name: 'ProxySQL Servers',
          severity: 'warning',
          message: `${online}/${servers.length} servers online`,
          fix: 'Check MySQL server connectivity and credentials',
        });
      }
    }

    await ctx.proxysql.close();
  } catch (error) {
    results.push({
      name: 'ProxySQL',
      severity: 'error',
      message: 'Cannot connect to ProxySQL admin interface',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Ensure container is running: docker ps | grep proxysql',
    });
  }
}

async function checkPrometheus(ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const response = await fetch(`${ctx.settings.prometheus.url}/-/healthy`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      results.push({ name: 'Prometheus', severity: 'ok', message: `Running at ${ctx.settings.prometheus.url}` });
    } else {
      results.push({
        name: 'Prometheus',
        severity: 'warning',
        message: `Health check returned status ${response.status}`,
        fix: 'Check container: docker logs prometheus',
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

async function checkOpenClaw(_ctx: CLIContext, results: DiagnosticResult[]): Promise<void> {
  try {
    const status = await getDetailedOpenClawStatus();

    if (!status.available) {
      // Check if container exists but stopped
      const runtime = await detectRuntime();
      if (runtime) {
        const psResult = await execCommand([runtime, 'ps', '-a', '--filter', 'name=openclaw', '--format', '{{.Status}}'], true);
        const containerStatus = psResult.stdout.trim();

        if (containerStatus && !containerStatus.toLowerCase().includes('up')) {
          results.push({
            name: 'OpenClaw Gateway',
            severity: 'warning',
            message: 'OpenClaw container exists but is not running',
            detail: `Status: ${containerStatus}`,
            fix: 'Restart the platform with: /start',
            fixCommand: '/start',
          });
          return;
        }
      }

      results.push({
        name: 'OpenClaw Gateway',
        severity: 'warning',
        message: 'OpenClaw gateway is not available',
        detail: 'AI features will not work without OpenClaw',
        fix: 'Start with: /start',
        fixCommand: '/start',
      });
      return;
    }

    if (!status.gatewayHealthy) {
      results.push({
        name: 'OpenClaw Gateway',
        severity: 'warning',
        message: 'Gateway is not responding',
        fix: 'Check logs: docker logs openclaw',
      });
      return;
    }

    const modeDisplay = status.mode === 'docker' ? 'Running in Docker' : 'Using local installation';
    results.push({ name: 'OpenClaw Gateway', severity: 'ok', message: `${modeDisplay} (ws://localhost:18789)` });

    // Check for auto-detected AI config from environment
    const aiConfig = detectAIConfigFromEnv();

    // Model info
    if (status.modelInfo.configured && status.modelInfo.model) {
      results.push({
        name: 'OpenClaw Model',
        severity: 'ok',
        message: `${status.modelInfo.provider || 'custom'}: ${status.modelInfo.model}`,
      });
    } else if (aiConfig.provider !== 'none') {
      results.push({
        name: 'OpenClaw Model',
        severity: 'ok',
        message: `${aiConfig.provider}${aiConfig.model ? '/' + aiConfig.model : ''} (auto-detected)`,
      });
    } else {
      results.push({
        name: 'OpenClaw Model',
        severity: 'info',
        message: 'Using bundled qwen model (limited)',
        fix: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY for better AI',
      });
    }

    // Quick AI test - optional, can be slow
    // Use a simple gateway health check instead of full AI query
    const httpUrl = CONFIG.gatewayUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    try {
      const start = Date.now();
      const response = await fetch(`${httpUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;

      if (response.ok) {
        results.push({ name: 'OpenClaw AI Test', severity: 'ok', message: `Gateway healthy (${latency}ms)` });
      } else {
        results.push({
          name: 'OpenClaw AI Test',
          severity: 'warning',
          message: `Gateway returned ${response.status}`,
          fix: 'Check logs: docker logs openclaw',
        });
      }
    } catch {
      results.push({
        name: 'OpenClaw AI Test',
        severity: 'warning',
        message: 'Gateway health check failed',
        fix: 'Check logs: docker logs openclaw',
      });
    }
  } catch (error) {
    results.push({
      name: 'OpenClaw Gateway',
      severity: 'warning',
      message: 'Could not check status',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Ensure container is running: docker ps | grep openclaw',
    });
  }
}

function checkConfiguration(ctx: CLIContext, results: DiagnosticResult[]): void {
  if (ctx.settings.api.tokenSecret === 'change-me-in-production') {
    results.push({
      name: 'API Token Secret',
      severity: 'warning',
      message: 'Using default token secret (not secure for production)',
      fix: 'Set: API_TOKEN_SECRET=<your-secret>',
    });
  }

  if (!ctx.settings.mysql.adminPassword) {
    results.push({
      name: 'MySQL Credentials',
      severity: 'warning',
      message: 'MySQL admin password not configured',
      fix: 'Set: MYSQL_ADMIN_PASSWORD=<password>',
    });
  }

  if (!ctx.settings.failover.autoFailoverEnabled) {
    results.push({
      name: 'Auto Failover',
      severity: 'info',
      message: 'Automatic failover is disabled',
      fix: 'Enable with: AUTO_FAILOVER_ENABLED=true',
    });
  }

  if (!ctx.settings.metadataDb.host) {
    results.push({ name: 'Metadata Database', severity: 'ok', message: 'Using auto-provisioned container' });
  }
}

// ============================================================================
// Display Utilities
// ============================================================================

function displayResults(results: DiagnosticResult[]): void {
  const groups: Record<Severity, DiagnosticResult[]> = {
    error: [],
    warning: [],
    info: [],
    ok: [],
  };

  for (const r of results) {
    groups[r.severity].push(r);
  }

  if (groups.error.length > 0) {
    console.log(theme.error.bold('✗ Errors:'));
    groups.error.forEach(displayResult);
  }

  if (groups.warning.length > 0) {
    console.log(theme.warning.bold('◆ Warnings:'));
    groups.warning.forEach(displayResult);
  }

  if (groups.info.length > 0) {
    console.log(theme.info.bold('○ Information:'));
    groups.info.forEach(displayResult);
  }

  if (groups.ok.length > 0) {
    console.log(theme.success.bold('✓ Healthy:'));
    groups.ok.forEach(r => console.log(theme.muted(`  ${r.name}: `) + theme.success(r.message)));
  }
}

function displayResult(result: DiagnosticResult): void {
  const icons: Record<Severity, string> = {
    error: theme.error(indicators.cross),
    warning: theme.warning(indicators.warning),
    info: theme.info(indicators.info),
    ok: theme.success(indicators.check),
  };

  const colorFn = {
    error: theme.error,
    warning: theme.warning,
    info: theme.info,
    ok: theme.success,
  }[result.severity];

  console.log(`  ${icons[result.severity]} ${colorFn.bold(result.name)}: ${result.message}`);

  if (result.detail) console.log(theme.muted(`      ${result.detail}`));
  if (result.fix) console.log(theme.primary(`      Fix: ${result.fix}`));
  if (result.fixCommand) console.log(theme.muted(`      Command: ${result.fixCommand}`));
}

function printSummary(results: DiagnosticResult[]): void {
  const errors = results.filter(r => r.severity === 'error').length;
  const warnings = results.filter(r => r.severity === 'warning').length;

  if (errors === 0 && warnings === 0) {
    console.log(theme.success(`${indicators.check} All systems healthy!`));
  } else {
    console.log(theme.warning(`Found ${errors} error(s) and ${warnings} warning(s)`));
  }

  // Add hint for MySQL cluster details
  console.log();
  console.log(theme.muted('  For MySQL cluster details, use: /topology or /clusters'));
}

// ============================================================================
// Process Execution
// ============================================================================

function execCommand(cmd: string[], silent = false): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: silent ? 'pipe' : 'inherit' });

    let stdout = '';
    let stderr = '';

    if (silent) {
      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });
    }

    proc.on('close', (code) => resolve({ success: code === 0, stdout, stderr }));
    proc.on('error', () => resolve({ success: false, stdout: '', stderr: 'Failed to execute' }));
  });
}

export default doctorCommand;
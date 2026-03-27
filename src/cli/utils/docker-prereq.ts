/**
 * ClawSQL CLI - Docker Prerequisites
 *
 * Detects and validates Docker/container runtime prerequisites.
 * Consolidates Docker detection logic used across multiple commands.
 */

import { spawn } from 'child_process';

/**
 * Docker runtime information
 */
export interface DockerInfo {
  /** Container runtime (docker or podman) */
  runtime: 'docker' | 'podman' | null;
  /** Compose command as array (e.g., ['docker', 'compose'] or ['docker-compose']) */
  composeCommand: string[] | null;
  /** Runtime version string */
  version: string;
  /** Whether Docker daemon is running */
  daemonRunning: boolean;
}

/**
 * Execute a shell command and return result
 */
function execCommand(
  cmd: string[],
  options?: { silent?: boolean; timeout?: number }
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), {
      stdio: options?.silent ? 'pipe' : 'inherit',
      timeout: options?.timeout,
    });

    let stdout = '';
    let stderr = '';

    if (options?.silent) {
      proc.stdout?.on('data', (data) => {
        stdout += data;
      });
      proc.stderr?.on('data', (data) => {
        stderr += data;
      });
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

/**
 * Detect available container runtime
 */
export async function detectRuntime(): Promise<'docker' | 'podman' | null> {
  const runtimes: Array<'docker' | 'podman'> = ['docker', 'podman'];

  for (const runtime of runtimes) {
    try {
      const result = await execCommand([runtime, 'info'], { silent: true, timeout: 5000 });
      if (result.success) {
        // Check if docker is actually podman
        if (runtime === 'docker') {
          const versionResult = await execCommand(['docker', '--version'], { silent: true });
          if (versionResult.stdout.toLowerCase().includes('podman')) {
            return 'podman';
          }
        }
        return runtime;
      }
    } catch {
      // Continue to next runtime
    }
  }

  return null;
}

/**
 * Detect compose command for the given runtime
 */
export async function detectComposeCommand(
  runtime: 'docker' | 'podman'
): Promise<string[] | null> {
  // Try docker-compose first (standalone)
  try {
    const result = await execCommand(['docker-compose', 'version'], { silent: true });
    if (result.success) {
      return ['docker-compose'];
    }
  } catch {
    // Continue
  }

  // Try docker compose plugin
  if (runtime === 'docker') {
    try {
      const result = await execCommand(['docker', 'compose', 'version'], { silent: true });
      if (result.success) {
        return ['docker', 'compose'];
      }
    } catch {
      // Continue
    }
  }

  // Try podman-compose
  if (runtime === 'podman') {
    try {
      const result = await execCommand(['podman-compose', 'version'], { silent: true });
      if (result.success) {
        return ['podman-compose'];
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Check Docker daemon is running
 */
export async function checkDaemonRunning(runtime: 'docker' | 'podman'): Promise<boolean> {
  try {
    const result = await execCommand([runtime, 'info'], { silent: true, timeout: 5000 });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Get runtime version
 */
export async function getRuntimeVersion(runtime: 'docker' | 'podman'): Promise<string> {
  try {
    const result = await execCommand([runtime, '--version'], { silent: true });
    // Parse version from output like "Docker version 24.0.5, build ced0996"
    const match = result.stdout.match(/version\s+([0-9.]+)/i);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Check all Docker prerequisites and return comprehensive info
 */
export async function checkDockerPrerequisites(): Promise<DockerInfo> {
  const runtime = await detectRuntime();

  if (!runtime) {
    return {
      runtime: null,
      composeCommand: null,
      version: '',
      daemonRunning: false,
    };
  }

  const [composeCommand, version, daemonRunning] = await Promise.all([
    detectComposeCommand(runtime),
    getRuntimeVersion(runtime),
    checkDaemonRunning(runtime),
  ]);

  return {
    runtime,
    composeCommand,
    version,
    daemonRunning,
  };
}

/**
 * Get installation guidance for Docker Compose or Podman Compose
 */
export function getComposeInstallGuidance(runtime: 'docker' | 'podman' | null): string {
  if (runtime === 'podman') {
    return `Install podman-compose:
  • Linux (dnf):   dnf install podman-compose
  • Linux (apt):   apt install podman-compose
  • pip:           pip install podman-compose`;
  }

  // Docker or no runtime detected
  return `Install Docker Compose:
  • Docker Desktop (Mac/Windows): Includes docker compose
  • Linux (apt):   apt install docker-compose-plugin
  • Linux (dnf):   dnf install docker-compose-plugin
  • Standalone:    https://github.com/docker/compose/releases`;
}

/**
 * Get installation guidance for Docker
 */
export function getDockerInstallGuidance(): string {
  return `Docker is required to run ClawSQL platform.

Install Docker:
  • macOS:   https://docs.docker.com/desktop/install/mac-install/
  • Windows: https://docs.docker.com/desktop/install/windows-install/
  • Linux:   https://docs.docker.com/engine/install/

After installing Docker, also ensure Docker Compose is available:
  • Docker Desktop (Mac/Windows): Includes docker compose
  • Linux: apt install docker-compose-plugin
  • Standalone: https://github.com/docker/compose/releases

Alternative: Podman
  • Install: https://podman.io/getting-started/installation
  • Compose: dnf install podman-compose or apt install podman-compose`;
}

/**
 * Format Docker info for display
 */
export function formatDockerInfo(info: DockerInfo): string {
  if (!info.runtime) {
    return 'Docker not found';
  }

  const lines = [
    `Runtime: ${info.runtime} ${info.version}`,
    `Compose: ${info.composeCommand?.join(' ') || 'not found'}`,
    `Daemon: ${info.daemonRunning ? 'running' : 'not running'}`,
  ];

  return lines.join('\n');
}
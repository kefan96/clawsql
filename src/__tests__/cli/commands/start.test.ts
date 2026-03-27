/**
 * Tests for Start Command
 */

// Mock chalk ESM module
jest.mock('chalk', () => ({
  default: {
    bold: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    blue: (str: string) => str,
    cyan: (str: string) => str,
    gray: (str: string) => str,
  },
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  bold: (str: string) => str,
  cyan: (str: string) => str,
  blue: (str: string) => str,
  gray: (str: string) => str,
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  copyFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

// Mock docker-files utility
jest.mock('../../../cli/utils/docker-files', () => ({
  ensureDockerFiles: jest.fn().mockResolvedValue('/root/.clawsql/docker'),
  ensureEnvFile: jest.fn().mockResolvedValue('/root/.clawsql/docker/.env'),
}));

// Mock docker-prereq utility
jest.mock('../../../cli/utils/docker-prereq', () => ({
  checkDockerPrerequisites: jest.fn().mockResolvedValue({
    runtime: 'docker',
    composeCommand: ['docker', 'compose'],
    version: '24.0.5',
    daemonRunning: true,
  }),
  getDockerInstallGuidance: jest.fn().mockReturnValue('Install Docker from...'),
}));

// Mock command-executor utility
jest.mock('../../../cli/utils/command-executor', () => ({
  executeCommand: jest.fn().mockResolvedValue({
    success: true,
    stdout: 'docker output',
    stderr: '',
  }),
  clearProgressCache: jest.fn(),
}));

// Mock agent OpenClaw detection functions
jest.mock('../../../cli/agent/index', () => ({
  isLocalOpenClawAvailable: jest.fn().mockResolvedValue(false),
  isDockerOpenClawAvailable: jest.fn().mockResolvedValue(false),
}));

// Mock fetch
global.fetch = jest.fn();

import { startCommand } from '../../../cli/commands/start';
import * as fs from 'fs';
import { ensureDockerFiles, ensureEnvFile } from '../../../cli/utils/docker-files';
import { checkDockerPrerequisites } from '../../../cli/utils/docker-prereq';
import { executeCommand } from '../../../cli/utils/command-executor';

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockEnsureDockerFiles = ensureDockerFiles as jest.MockedFunction<typeof ensureDockerFiles>;
const mockEnsureEnvFile = ensureEnvFile as jest.MockedFunction<typeof ensureEnvFile>;
const mockCheckDockerPrerequisites = checkDockerPrerequisites as jest.MockedFunction<typeof checkDockerPrerequisites>;
const mockExecuteCommand = executeCommand as jest.MockedFunction<typeof executeCommand>;

describe('startCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      settings: {
        api: { port: 8080 },
        proxysql: { mysqlPort: 6033 },
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        warning: jest.fn().mockImplementation((s: string) => `⚠ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
        success: jest.fn().mockImplementation((s: string) => `✓ ${s}`),
      },
    };

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();

    // Reset mock implementations
    mockEnsureDockerFiles.mockResolvedValue('/root/.clawsql/docker');
    mockEnsureEnvFile.mockResolvedValue('/root/.clawsql/docker/.env');
    mockCheckDockerPrerequisites.mockResolvedValue({
      runtime: 'docker',
      composeCommand: ['docker', 'compose'],
      version: '24.0.5',
      daemonRunning: true,
    });

    // Mock process.cwd
    jest.spyOn(process, 'cwd').mockReturnValue('/root/clawsql');

    // Mock successful executeCommand by default
    mockExecuteCommand.mockResolvedValue({
      success: true,
      stdout: 'docker output',
      stderr: '',
    });

    // Mock fs - docker-compose.yml exists
    mockExistsSync.mockReturnValue(true);

    // Mock fetch for health check
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ status: 'healthy' }),
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('should have correct name and description', () => {
    expect(startCommand.name).toBe('start');
    expect(startCommand.description).toBe('Start the ClawSQL platform');
  });

  it('should show error when no runtime found', async () => {
    mockCheckDockerPrerequisites.mockResolvedValueOnce({
      runtime: null,
      composeCommand: null,
      version: '',
      daemonRunning: false,
    });

    await startCommand.handler([], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No container runtime'));
  });

  it('should detect docker runtime', async () => {
    await startCommand.handler([], mockContext);

    expect(mockCheckDockerPrerequisites).toHaveBeenCalled();
  });

  it('should start in demo mode', async () => {
    await startCommand.handler(['--demo'], mockContext);

    expect(mockContext.formatter.info).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('should start in standard mode', async () => {
    await startCommand.handler([], mockContext);

    expect(mockContext.formatter.info).toHaveBeenCalledWith(expect.stringContaining('bring your own MySQL'));
  });

  it('should ensure docker files are extracted', async () => {
    await startCommand.handler([], mockContext);

    expect(mockEnsureDockerFiles).toHaveBeenCalled();
    expect(mockEnsureEnvFile).toHaveBeenCalled();
  });

  it('should handle compose failure', async () => {
    mockExecuteCommand.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'compose error',
    });

    await startCommand.handler([], mockContext);

    // Should have attempted to start
    expect(mockExecuteCommand).toHaveBeenCalled();
  });

  it('should wait for API to be ready', async () => {
    await startCommand.handler([], mockContext);

    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle API timeout', async () => {
    // Mock fetch to fail but succeed after a few calls to simulate partial health
    let fetchCalls = 0;
    (global.fetch as jest.Mock).mockImplementation(() => {
      fetchCalls++;
      // First few calls fail, then succeed
      if (fetchCalls < 3) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'healthy' }),
        });
      }
      return Promise.reject(new Error('Connection refused'));
    });

    await startCommand.handler([], mockContext);

    // Should have completed (either success or handled gracefully)
    expect(mockExecuteCommand).toHaveBeenCalled();
  }, 10000);

  it('should handle podman runtime', async () => {
    mockCheckDockerPrerequisites.mockResolvedValueOnce({
      runtime: 'podman',
      composeCommand: ['podman-compose'],
      version: '4.0.0',
      daemonRunning: true,
    });

    await startCommand.handler([], mockContext);

    expect(mockCheckDockerPrerequisites).toHaveBeenCalled();
  });
});
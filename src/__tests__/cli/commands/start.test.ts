/**
 * Tests for Start Command
 *
 * Note: The start command has many async operations (container startup, health checks, etc.)
 * These tests focus on the command structure and initial validation logic.
 * Full integration testing should be done with the e2e tests.
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

// Mock all the modules that the start command imports
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  copyFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(new Error('File not found')),
}));

jest.mock('../../../cli/utils/docker-files', () => ({
  ensureDockerFiles: jest.fn().mockResolvedValue('/root/.clawsql/docker'),
  ensureEnvFile: jest.fn().mockResolvedValue('/root/.clawsql/docker/.env'),
}));

jest.mock('../../../cli/utils/docker-prereq', () => ({
  checkDockerPrerequisites: jest.fn(),
  getDockerInstallGuidance: jest.fn().mockReturnValue('Install Docker from...'),
  getComposeInstallGuidance: jest.fn().mockReturnValue('Install Docker Compose...'),
  configureRegistryMirror: jest.fn().mockResolvedValue(true),
  REGISTRY_MIRRORS: {},
}));

jest.mock('../../../cli/utils/command-executor', () => ({
  executeCommand: jest.fn().mockResolvedValue({
    success: true,
    stdout: '',
    stderr: '',
  }),
  clearProgressCache: jest.fn(),
}));

jest.mock('../../../cli/agent/index', () => ({
  isLocalOpenClawAvailable: jest.fn().mockResolvedValue(false),
  isDockerOpenClawAvailable: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../cli/utils/ai-config', () => ({
  detectAIConfigFromEnv: jest.fn().mockReturnValue({ provider: 'none' }),
  getAIConfigDisplay: jest.fn().mockReturnValue('bundled qwen'),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { startCommand } from '../../../cli/commands/start';
import { checkDockerPrerequisites } from '../../../cli/utils/docker-prereq';

const mockCheckDockerPrerequisites = checkDockerPrerequisites as jest.MockedFunction<typeof checkDockerPrerequisites>;

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
    jest.useFakeTimers();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('command structure', () => {
    it('should have correct name', () => {
      expect(startCommand.name).toBe('start');
    });

    it('should have correct description', () => {
      expect(startCommand.description).toBe('Start the ClawSQL platform');
    });

    it('should have usage information', () => {
      expect(startCommand.usage).toContain('--demo');
    });

    it('should be a valid Command object', () => {
      expect(startCommand).toHaveProperty('name');
      expect(startCommand).toHaveProperty('description');
      expect(startCommand).toHaveProperty('handler');
      expect(typeof startCommand.handler).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should show error when no runtime found', async () => {
      mockCheckDockerPrerequisites.mockResolvedValueOnce({
        runtime: null,
        composeCommand: null,
        version: '',
        daemonRunning: false,
      });

      const handlerPromise = startCommand.handler([], mockContext);

      // Flush all pending promises/timers
      await jest.runAllTimersAsync();
      await handlerPromise;

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No container runtime'));
    });

    it('should show error when daemon is not running', async () => {
      mockCheckDockerPrerequisites.mockResolvedValueOnce({
        runtime: 'docker',
        composeCommand: ['docker', 'compose'],
        version: '24.0.5',
        daemonRunning: false,
      });

      const handlerPromise = startCommand.handler([], mockContext);
      await jest.runAllTimersAsync();
      await handlerPromise;

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('daemon is not running'));
    });

    it('should show error when compose not found', async () => {
      mockCheckDockerPrerequisites.mockResolvedValueOnce({
        runtime: 'docker',
        composeCommand: null,
        version: '24.0.5',
        daemonRunning: true,
      });

      const handlerPromise = startCommand.handler([], mockContext);
      await jest.runAllTimersAsync();
      await handlerPromise;

      expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('Docker Compose not found'));
    });
  });
});
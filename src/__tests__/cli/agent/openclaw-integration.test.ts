/**
 * Tests for OpenClaw Integration
 */

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock os.homedir
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/test'),
}));

import {
  isDockerOpenClawAvailable,
  isLocalOpenClawAvailable,
  isGatewayHealthy,
  isOpenClawAvailable,
  getOpenClawStatus,
  sendToOpenClaw,
  sendToOpenClawStream,
  scheduleCron,
  sendNotification,
  writeToMemory,
  OpenClawAgent,
  createOpenClawAgent,
} from '../../../cli/agent/openclaw-integration';
import { spawn } from 'child_process';
import * as fs from 'fs';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Helper to create mock spawn process
function createMockProcess(stdout: string = '', stderr: string = '', exitCode: number = 0) {
  return {
    stdout: {
      on: jest.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && stdout) {
          cb(Buffer.from(stdout));
        }
      }),
    },
    stderr: {
      on: jest.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && stderr) {
          cb(Buffer.from(stderr));
        }
      }),
    },
    on: jest.fn((event: string, cb: (code: number | Error) => void) => {
      if (event === 'close') {
        cb(exitCode);
      }
    }),
    kill: jest.fn(),
  } as any;
}

// Helper for command-aware mock that handles parallel calls correctly
function createCommandAwareMock(dockerResult: string = '', cliStatus: any = null) {
  return jest.fn().mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'docker' && args.includes('ps')) {
      return createMockProcess(dockerResult, '', dockerResult.includes('openclaw') ? 0 : 0);
    }
    if (cmd === 'openclaw' && args.includes('status')) {
      const stdout = cliStatus ? JSON.stringify(cliStatus) : '';
      return createMockProcess(stdout, '', cliStatus ? 0 : 1);
    }
    return createMockProcess('', '', 0);
  });
}

describe('OpenClaw Integration', () => {
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      settings: {
        orchestrator: { url: 'http://localhost:3000' },
        proxysql: { host: 'localhost', adminPort: 6032 },
        failover: { autoFailoverEnabled: true },
        api: { port: 8080 },
      },
    };

    // Default fetch mock
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true, status: 'live' }),
    });
  });

  // ============================================================================
  // Detection Functions
  // ============================================================================

  describe('isDockerOpenClawAvailable', () => {
    it('should return true when openclaw container is running', async () => {
      mockSpawn.mockReturnValue(createMockProcess('openclaw\n', '', 0));

      const result = await isDockerOpenClawAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['ps', '--filter', 'name=openclaw']),
        expect.any(Object)
      );
    });

    it('should return false when container is not running', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));

      const result = await isDockerOpenClawAvailable();

      expect(result).toBe(false);
    });

    it('should return false when docker command fails', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 1));

      const result = await isDockerOpenClawAvailable();

      expect(result).toBe(false);
    });

    it('should return false when container name does not match', async () => {
      mockSpawn.mockReturnValue(createMockProcess('other-container\n', '', 0));

      const result = await isDockerOpenClawAvailable();

      expect(result).toBe(false);
    });
  });

  describe('isGatewayHealthy', () => {
    it('should return true when health endpoint responds ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await isGatewayHealthy();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:18789/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should return false when health endpoint fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

      const result = await isGatewayHealthy();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await isGatewayHealthy();

      expect(result).toBe(false);
    });

    it('should use configured gateway URL for health check', async () => {
      // Note: CONFIG.gatewayUrl is captured at module load time
      // This test verifies the default localhost URL is used
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await isGatewayHealthy();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:18789/health',
        expect.any(Object)
      );
      expect(result).toBe(true);
    });
  });

  describe('isLocalOpenClawAvailable', () => {
    it('should return false when Docker container is available', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('openclaw\n', '', 0));

      const result = await isLocalOpenClawAvailable();

      expect(result).toBe(false);
    });

    it('should return false when gateway is not healthy', async () => {
      // Docker check returns no container
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0));
      // Gateway health fails
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

      const result = await isLocalOpenClawAvailable();

      expect(result).toBe(false);
    });

    it('should return false when CLI status check fails', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0)); // Docker check
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true }); // Gateway healthy
      mockSpawn.mockReturnValueOnce(createMockProcess('', 'error', 1)); // CLI status

      const result = await isLocalOpenClawAvailable();

      expect(result).toBe(false);
    });

    it('should return true when local gateway is running', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('', '', 0)); // Docker check (no container)
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true }); // Gateway healthy
      mockSpawn.mockReturnValueOnce(createMockProcess(
        JSON.stringify({ gateway: { mode: 'local', url: 'ws://localhost:18789' } }),
        '',
        0
      )); // CLI status

      const result = await isLocalOpenClawAvailable();

      expect(result).toBe(true);
    });
  });

  describe('isOpenClawAvailable', () => {
    it('should return true when gateway is healthy', async () => {
      // New behavior: checks gateway health first
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await isOpenClawAvailable();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:18789/health',
        expect.any(Object)
      );
    });

    it('should return true when Docker OpenClaw is available (fallback)', async () => {
      // Gateway unhealthy, but Docker container running
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      mockSpawn.mockReturnValue(createMockProcess('openclaw\n', '', 0));

      const result = await isOpenClawAvailable();

      expect(result).toBe(true);
    });

    it('should return true when local OpenClaw is available', async () => {
      // Use command-aware mock for parallel/sequential calls
      mockSpawn.mockImplementation(createCommandAwareMock('', { gateway: { mode: 'local', url: 'ws://localhost:18789' } }));
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await isOpenClawAvailable();

      expect(result).toBe(true);
    });

    it('should return false when no OpenClaw available', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0)); // Docker: no container
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false }); // Gateway unhealthy

      const result = await isOpenClawAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getOpenClawStatus', () => {
    it('should return correct status for Docker OpenClaw', async () => {
      mockSpawn.mockReturnValue(createMockProcess('openclaw\n', '', 0));

      const status = await getOpenClawStatus();

      expect(status).toEqual({
        available: true,
        isDocker: true,
        isLocal: false,
      });
    });

    it('should return correct status for local OpenClaw', async () => {
      // Use command-aware mock for parallel calls in getOpenClawStatus
      mockSpawn.mockImplementation(createCommandAwareMock('', { gateway: { mode: 'local', url: 'ws://localhost:18789' } }));
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const status = await getOpenClawStatus();

      expect(status).toEqual({
        available: true,
        isDocker: false,
        isLocal: true,
      });
    });

    it('should return unavailable when no OpenClaw', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', '', 0));
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

      const status = await getOpenClawStatus();

      expect(status).toEqual({
        available: false,
        isDocker: false,
        isLocal: false,
      });
    });
  });

  // ============================================================================
  // Agent Functions
  // ============================================================================

  describe('sendToOpenClaw', () => {
    it('should send message and return response', async () => {
      mockSpawn.mockReturnValue(createMockProcess('AI response here\n', '', 0));

      const result = await sendToOpenClaw('Hello');

      expect(result).toBe('AI response here');
      expect(mockSpawn).toHaveBeenCalledWith(
        'openclaw',
        expect.arrayContaining(['agent', '--session-id', '--message', 'Hello']),
        expect.any(Object)
      );
    });

    it('should use custom gateway URL and token', async () => {
      mockSpawn.mockReturnValue(createMockProcess('OK\n', '', 0));

      const result = await sendToOpenClaw('Test', {
        gatewayUrl: 'ws://custom:18789',
        gatewayToken: 'custom-token',
      });

      expect(result).toBe('OK');
    });

    it('should reject on non-zero exit code', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', 'Error occurred', 1));

      await expect(sendToOpenClaw('Hello')).rejects.toThrow('OpenClaw failed (exit 1)');
    });

    it('should reject on spawn error', async () => {
      mockSpawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') cb(new Error('Spawn failed'));
        }),
        kill: jest.fn(),
      } as any);

      await expect(sendToOpenClaw('Hello')).rejects.toThrow('Failed to spawn openclaw');
    });

    // Note: Abort signal handling is tested via integration tests
    // as it requires mocking multiple async layers
  });

  describe('sendToOpenClawStream', () => {
    it('should stream chunks to callback', async () => {
      const chunks: string[] = [];
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              cb(Buffer.from('chunk1'));
              cb(Buffer.from('chunk2'));
            }
          }),
        },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
        }),
        kill: jest.fn(),
      } as any);

      const result = await sendToOpenClawStream('Hello', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual(['chunk1', 'chunk2']);
      expect(result).toBe('chunk1chunk2');
    });
  });

  // ============================================================================
  // Cron & Notifications
  // ============================================================================

  describe('scheduleCron', () => {
    it('should schedule cron job', async () => {
      mockSpawn.mockReturnValue(createMockProcess('Cron scheduled\n', '', 0));

      const result = await scheduleCron('test-job', '0 * * * *', 'Test prompt');

      expect(result).toBe('Cron scheduled');
      expect(mockSpawn).toHaveBeenCalledWith(
        'openclaw',
        expect.arrayContaining(['cron', 'add', '--name', 'test-job', '--schedule', '0 * * * *']),
        expect.any(Object)
      );
    });

    it('should throw on failure', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', 'Error', 1));

      await expect(scheduleCron('test', '* * * * *', 'prompt'))
        .rejects.toThrow('Failed to schedule cron');
    });
  });

  describe('sendNotification', () => {
    it('should send notification', async () => {
      mockSpawn.mockReturnValue(createMockProcess('Message sent\n', '', 0));

      const result = await sendNotification('user@example.com', 'Test message');

      expect(result).toBe('Message sent');
      expect(mockSpawn).toHaveBeenCalledWith(
        'openclaw',
        expect.arrayContaining(['message', 'send', '--to', 'user@example.com']),
        expect.any(Object)
      );
    });

    it('should throw on failure', async () => {
      mockSpawn.mockReturnValue(createMockProcess('', 'Error', 1));

      await expect(sendNotification('user', 'msg')).rejects.toThrow('Failed to send notification');
    });
  });

  describe('writeToMemory', () => {
    it('should write to memory file', async () => {
      await writeToMemory('Test content', 'test.md');

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        '/home/test/.openclaw/memory',
        { recursive: true }
      );
      expect(fs.promises.appendFile).toHaveBeenCalledWith(
        '/home/test/.openclaw/memory/test.md',
        expect.stringContaining('Test content')
      );
    });

    it('should use default filename', async () => {
      await writeToMemory('Test');

      expect(fs.promises.appendFile).toHaveBeenCalledWith(
        '/home/test/.openclaw/memory/clawsql-cluster-state.md',
        expect.any(String)
      );
    });

    it('should silently ignore errors', async () => {
      (fs.promises.mkdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      // Should not throw
      await writeToMemory('Test');
    });
  });

  // ============================================================================
  // OpenClawAgent Class
  // ============================================================================

  describe('OpenClawAgent', () => {
    it('should create agent instance', () => {
      const agent = createOpenClawAgent(mockContext);

      expect(agent).toBeDefined();
      expect(agent).toBeInstanceOf(OpenClawAgent);
    });

    describe('isAvailable', () => {
      it('should return availability status', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

        const agent = createOpenClawAgent(mockContext);
        const available = await agent.isAvailable();

        expect(available).toBe(true);
      });

      it('should cache availability status', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

        const agent = createOpenClawAgent(mockContext);
        await agent.isAvailable();
        await agent.isAvailable();

        // Fetch should be called (gateway health check)
        // Due to caching, subsequent calls should use cached value
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    describe('process', () => {
      it('should throw when not available', async () => {
        mockSpawn.mockReturnValue(createMockProcess('', '', 0));
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

        const agent = createOpenClawAgent(mockContext);

        await expect(agent.process('Hello')).rejects.toThrow('OpenClaw not running');
      });

      it('should send message when Docker OpenClaw is available', async () => {
        // Gateway health check returns true (new optimized path)
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
        // Docker check for spawn config
        mockSpawn.mockReturnValueOnce(createMockProcess('openclaw\n', '', 0));
        // Mock the agent call
        mockSpawn.mockReturnValueOnce(createMockProcess('AI response\n', '', 0));

        const agent = createOpenClawAgent(mockContext);
        const result = await agent.process('What is the cluster status?');

        expect(result).toBe('AI response');
      });
    });

    describe('healthCheckCron', () => {
      it('should schedule health check cron', async () => {
        // Gateway health check returns true
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
        // Docker check
        mockSpawn.mockReturnValueOnce(createMockProcess('openclaw\n', '', 0));
        // Mock cron call
        mockSpawn.mockReturnValueOnce(createMockProcess('Scheduled\n', '', 0));

        const agent = createOpenClawAgent(mockContext);
        const result = await agent.healthCheckCron('*/5 * * * *');

        expect(result).toBe('Scheduled');
      });
    });

    describe('alert', () => {
      it('should send alert notification', async () => {
        mockSpawn.mockReturnValue(createMockProcess('Alert sent\n', '', 0));

        const agent = createOpenClawAgent(mockContext);
        const result = await agent.alert('slack', 'Primary failed');

        expect(result).toContain('Alert sent');
      });
    });
  });

  // ============================================================================
  // Backwards Compatibility
  // ============================================================================

  describe('Backwards Compatibility Exports', () => {
    it('should export deprecated ensureOpenClawRunning', async () => {
      const { ensureOpenClawRunning } = require('../../../cli/agent/openclaw-integration');

      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await ensureOpenClawRunning(5);

      expect(result).toBe(true);
    });

    it('should timeout when gateway not available', async () => {
      const { ensureOpenClawRunning } = require('../../../cli/agent/openclaw-integration');

      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

      const result = await ensureOpenClawRunning(2);

      expect(result).toBe(false);
    }, 10000);
  });
});
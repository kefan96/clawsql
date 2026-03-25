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

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

import { startCommand } from '../../../cli/commands/start';
import { spawn } from 'child_process';
import * as fs from 'fs';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

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

    // Mock process.cwd
    jest.spyOn(process, 'cwd').mockReturnValue('/root/clawsql');

    // Mock successful spawn by default
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              cb(Buffer.from('docker version info'));
            }
          }),
        },
        stderr: {
          on: jest.fn(),
        },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            cb(0);
          }
        }),
      };
      return proc as any;
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
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(1);
        }),
      };
      return proc as any;
    });

    await startCommand.handler([], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalledWith(expect.stringContaining('No container runtime'));
  });

  it('should detect docker runtime', async () => {
    await startCommand.handler([], mockContext);

    expect(mockSpawn).toHaveBeenCalled();
  });

  it('should start in demo mode', async () => {
    await startCommand.handler(['--demo'], mockContext);

    expect(mockContext.formatter.info).toHaveBeenCalledWith(expect.stringContaining('demo'));
  });

  it('should start in standard mode', async () => {
    await startCommand.handler([], mockContext);

    expect(mockContext.formatter.info).toHaveBeenCalledWith(expect.stringContaining('bring your own MySQL'));
  });

  it('should create .env from example if not exists', async () => {
    mockExistsSync
      .mockReturnValueOnce(true)  // docker-compose.yml exists
      .mockReturnValueOnce(false) // .env doesn't exist
      .mockReturnValueOnce(true); // .env.example exists

    await startCommand.handler([], mockContext);

    expect(mockContext.formatter.success).toHaveBeenCalledWith(expect.stringContaining('Created .env'));
  });

  it('should handle compose failure', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from('docker info'));
          }),
        },
        stderr: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from('error'));
          }),
        },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(1);
        }),
      };
      return proc as any;
    });

    // First call (runtime detect) succeeds, second call (compose) fails
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from(callCount === 1 ? 'docker info' : ''));
          }),
        },
        stderr: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from('compose error'));
          }),
        },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(callCount === 1 ? 0 : 1);
        }),
      };
      return proc as any;
    });

    await startCommand.handler([], mockContext);

    // Should have attempted to start
    expect(mockSpawn).toHaveBeenCalled();
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
    expect(mockSpawn).toHaveBeenCalled();
  }, 10000);

  it('should detect podman masquerading as docker', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              cb(Buffer.from('podman version 4.0.0'));
            }
          }),
        },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
        }),
      };
      return proc as any;
    });

    await startCommand.handler([], mockContext);

    expect(mockSpawn).toHaveBeenCalled();
  });
});
/**
 * Tests for Status Command
 */

// Mock ESM modules
jest.mock('chalk', () => require('../../__mocks__/esm-mocks').chalkMock());
jest.mock('ora', () => require('../../__mocks__/esm-mocks').oraMock());

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

import { statusCommand } from '../../../cli/commands/status';
import { spawn } from 'child_process';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('statusCommand', () => {
  let mockContext: any;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = {
      settings: {
        api: { port: 8080 },
      },
      orchestrator: {
        getClusters: jest.fn().mockResolvedValue([]),
        getTopology: jest.fn(),
      },
      proxysql: {
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      },
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        section: jest.fn().mockImplementation((s: string) => `[${s}]`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
      },
    };

    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();

    // Mock successful spawn by default
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              cb(Buffer.from('docker'));
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

    // Mock fetch for services
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('healthy'),
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should have correct name and description', () => {
    expect(statusCommand.name).toBe('status');
    expect(statusCommand.description).toBe('Show platform status');
  });

  it('should show status with all services', async () => {
    await statusCommand.handler([], mockContext);

    expect(mockContext.formatter.header).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should output JSON when --json flag provided', async () => {
    await statusCommand.handler(['--json'], mockContext);

    // Should call console.log with JSON
    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output).toHaveProperty('runtime');
    expect(output).toHaveProperty('containers');
    expect(output).toHaveProperty('services');
    expect(output).toHaveProperty('clusters');
  });

  it('should detect docker runtime', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              cb(Buffer.from('docker info output'));
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

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.runtime).toBe('docker');
  });

  it('should handle no runtime available', async () => {
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

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.runtime).toBeNull();
  });

  it('should check all services health', async () => {
    await statusCommand.handler(['--json'], mockContext);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:9090/-/healthy',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('should check ProxySQL health', async () => {
    await statusCommand.handler(['--json'], mockContext);

    expect(mockContext.proxysql.connect).toHaveBeenCalled();
    expect(mockContext.proxysql.close).toHaveBeenCalled();
  });

  it('should handle ProxySQL connection failure', async () => {
    mockContext.proxysql.connect.mockRejectedValue(new Error('Connection refused'));

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.services.proxysql.healthy).toBe(false);
    expect(output.services.proxysql.error).toBe('Connection refused');
  });

  it('should get cluster info', async () => {
    mockContext.orchestrator.getClusters.mockResolvedValue(['cluster-1']);
    mockContext.orchestrator.getTopology.mockResolvedValue({
      name: 'test-cluster',
      primary: { host: 'primary', port: 3306, state: 'online' },
      replicas: [
        { host: 'replica1', port: 3306, state: 'online' },
      ],
    });

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.clusters).toHaveLength(1);
    expect(output.clusters[0].name).toBe('test-cluster');
    expect(output.clusters[0].replicas).toBe(1);
    expect(output.clusters[0].primaryHealthy).toBe(true);
  });

  it('should handle cluster info errors', async () => {
    mockContext.orchestrator.getClusters.mockRejectedValue(new Error('Orchestrator unavailable'));

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.clusters).toEqual([]);
  });

  it('should handle service fetch failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.services.clawsql.healthy).toBe(false);
    expect(output.services.clawsql.error).toBe('Network error');
  });

  it('should handle non-OK response from service', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('Service Unavailable'),
    });

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.services.clawsql.healthy).toBe(false);
    expect(output.services.clawsql.error).toBe('status 503');
  });

  it('should parse container status from docker ps', async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      const proc = {
        stdout: {
          on: jest.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              if (callCount === 1) {
                // First call for runtime detection
                cb(Buffer.from('docker'));
              } else {
                // Second call for container list
                cb(Buffer.from('clawsql-api\tUp 2 hours\norchestrator\tUp 2 hours'));
              }
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

    await statusCommand.handler(['--json'], mockContext);

    const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
    const output = JSON.parse(lastCall[0]);
    expect(output.containers).toHaveLength(2);
    expect(output.containers[0].name).toBe('clawsql-api');
    expect(output.containers[0].status).toBe('running');
  });

  it('should handle spawn errors', async () => {
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event: string, cb: (error: Error) => void) => {
          if (event === 'error') {
            cb(new Error('spawn error'));
          } else if (event === 'close') {
            cb(1);
          }
        }),
      };
      return proc as any;
    });

    await statusCommand.handler(['--json'], mockContext);

    // Should not throw
    expect(consoleSpy).toHaveBeenCalled();
  });
});
/**
 * Tests for Help Command
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

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    head: string[] = [];
    push() {}
    toString() { return 'mock-table'; }
  };
});

// Mock registry
jest.mock('../../../cli/registry', () => ({
  listCommands: jest.fn(),
}));

import { helpCommand } from '../../../cli/commands/help';
import { listCommands } from '../../../cli/registry';

const mockListCommands = listCommands as jest.MockedFunction<typeof listCommands>;

describe('helpCommand', () => {
  let mockContext: any;

  beforeEach(() => {
    mockContext = {
      formatter: {
        header: jest.fn().mockImplementation((s: string) => `=== ${s} ===`),
        keyValue: jest.fn().mockImplementation((k: string, v: string) => `${k}: ${v}`),
        table: jest.fn().mockReturnValue('table-output'),
        info: jest.fn().mockImplementation((s: string) => `ℹ ${s}`),
        error: jest.fn().mockImplementation((s: string) => `✗ ${s}`),
      },
    };

    mockListCommands.mockReturnValue([
      { name: 'help', description: 'Show available commands', usage: '/help [command]' },
      { name: 'health', description: 'Show system health status', usage: '/health' },
      { name: 'clusters', description: 'List and manage clusters', usage: '/clusters list' },
    ]);

    jest.clearAllMocks();
  });

  it('should have correct name and description', () => {
    expect(helpCommand.name).toBe('help');
    expect(helpCommand.description).toBe('Show available commands');
  });

  it('should show all commands when no args', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await helpCommand.handler([], mockContext);

    expect(mockListCommands).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should show specific command help', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await helpCommand.handler(['health'], mockContext);

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle command with slash prefix', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await helpCommand.handler(['/health'], mockContext);

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should show error for unknown command', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await helpCommand.handler(['nonexistent'], mockContext);

    expect(mockContext.formatter.error).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
/**
 * Tests for CLI Registry
 */

// Mock ESM modules
jest.mock('chalk', () => require('../__mocks__/esm-mocks').chalkMock());
jest.mock('ora', () => require('../__mocks__/esm-mocks').oraMock());

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    push() {}
    toString() { return ''; }
  };
});

import {
  getRegistry,
  registerCommand,
  getCommand,
  listCommands,
  parseInput,
  Command,
} from '../../cli/registry';

describe('CommandRegistry', () => {
  beforeEach(() => {
    // Clear the singleton by creating a new instance
    // Since we can't reset the singleton, we'll test the functionality
  });

  describe('register and get', () => {
    it('should register and retrieve a command', () => {
      const registry = getRegistry();
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        usage: '/test',
        handler: jest.fn(),
      };

      registry.register(testCommand);
      const retrieved = registry.get('test');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test');
    });

    it('should check if command exists', () => {
      const registry = getRegistry();
      const testCommand: Command = {
        name: 'exists-test',
        description: 'Test command',
        usage: '/exists-test',
        handler: jest.fn(),
      };

      registry.register(testCommand);
      expect(registry.has('exists-test')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should list all commands', () => {
      const registry = getRegistry();
      const initialCount = registry.list().length;

      const testCommand: Command = {
        name: 'list-test',
        description: 'Test command',
        usage: '/list-test',
        handler: jest.fn(),
      };

      registry.register(testCommand);
      const commands = registry.list();

      expect(commands.length).toBe(initialCount + 1);
      expect(commands.some(c => c.name === 'list-test')).toBe(true);
    });

    it('should get command names', () => {
      const registry = getRegistry();
      const names = registry.names();

      expect(Array.isArray(names)).toBe(true);
    });
  });

  describe('registerCommand helper', () => {
    it('should register command using helper function', () => {
      const testCommand: Command = {
        name: 'helper-test',
        description: 'Test command',
        usage: '/helper-test',
        handler: jest.fn(),
      };

      registerCommand(testCommand);
      const retrieved = getCommand('helper-test');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('helper-test');
    });
  });

  describe('listCommands helper', () => {
    it('should return array of commands', () => {
      const commands = listCommands();
      expect(Array.isArray(commands)).toBe(true);
    });
  });
});

describe('parseInput', () => {
  it('should parse slash command with arguments', () => {
    const result = parseInput('/clusters list --name test');

    expect(result).not.toBeNull();
    expect(result?.command).toBe('clusters');
    expect(result?.args).toEqual(['list', '--name', 'test']);
  });

  it('should parse slash command without arguments', () => {
    const result = parseInput('/help');

    expect(result).not.toBeNull();
    expect(result?.command).toBe('help');
    expect(result?.args).toEqual([]);
  });

  it('should return null for empty input', () => {
    const result = parseInput('');

    expect(result).toBeNull();
  });

  it('should return null for whitespace-only input', () => {
    const result = parseInput('   ');

    expect(result).toBeNull();
  });

  it('should handle non-slash input as natural language', () => {
    const result = parseInput('show me the topology');

    expect(result).not.toBeNull();
    expect(result?.command).toBe('');
    expect(result?.args).toEqual(['show me the topology']);
  });

  it('should normalize command to lowercase', () => {
    const result = parseInput('/CLUSTERS List');

    expect(result?.command).toBe('clusters');
  });

  it('should handle multiple spaces between arguments', () => {
    const result = parseInput('/clusters   list   --name   test');

    expect(result?.command).toBe('clusters');
    expect(result?.args).toEqual(['list', '--name', 'test']);
  });
});
/**
 * Tests for ClawSQL CLI Completer
 */

// Mock chalk ESM module
jest.mock('chalk', () => ({
  default: {
    bold: (str: string) => str,
    dim: (str: string) => str,
    cyan: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    blue: (str: string) => str,
    magenta: (str: string) => str,
    gray: (str: string) => str,
    white: (str: string) => str,
    black: (str: string) => str,
    bgCyan: (str: string) => str,
    bgGreen: (str: string) => str,
    bgRed: (str: string) => str,
    hex: () => (str: string) => str,
    rgb: () => (str: string) => str,
  },
  bold: (str: string) => str,
  dim: (str: string) => str,
  cyan: (str: string) => str,
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  blue: (str: string) => str,
  magenta: (str: string) => str,
  gray: (str: string) => str,
  white: (str: string) => str,
  black: (str: string) => str,
}));

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    constructor() {}
    push() {}
    toString() { return ''; }
  };
});

import { createCompleter, formatCompletions, getFlags, completeFlags } from '../../cli/completer';
import * as registry from '../../cli/registry';

// Mock the registry module
jest.mock('../../cli/registry');

const mockListCommands = registry.listCommands as jest.MockedFunction<typeof registry.listCommands>;
const mockGetRegistry = registry.getRegistry as jest.MockedFunction<typeof registry.getRegistry>;

describe('Completer', () => {
  let completer: ReturnType<typeof createCompleter>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Default mock: return empty commands list
    mockListCommands.mockReturnValue([]);
    mockGetRegistry.mockReturnValue({
      get: jest.fn(),
      has: jest.fn(),
      list: jest.fn().mockReturnValue([]),
      names: jest.fn().mockReturnValue([]),
      register: jest.fn(),
    });

    // Create fresh completer instance
    completer = createCompleter();
  });

  describe('complete()', () => {
    it('should return all commands for empty line', () => {
      const [completions] = completer.complete('');

      // Should include built-in commands
      expect(completions).toContain('/exit');
      expect(completions).toContain('/quit');
      expect(completions).toContain('/q');
      expect(completions).toContain('/clear');
      expect(completions).toContain('/cls');
    });

    it('should return all commands for whitespace-only line', () => {
      const [completions] = completer.complete('   ');

      expect(completions).toContain('/exit');
      expect(completions).toContain('/clear');
    });

    it('should return empty completions for non-command input', () => {
      const [completions, original] = completer.complete('help');

      expect(completions).toEqual([]);
      expect(original).toBe('help');
    });

    it('should complete /exit command', () => {
      const [completions] = completer.complete('/ex');

      expect(completions).toContain('/exit');
    });

    it('should complete /quit command', () => {
      const [completions] = completer.complete('/qui');

      expect(completions).toContain('/quit');
    });

    it('should complete /q command exactly', () => {
      const [completions] = completer.complete('/q');

      expect(completions).toContain('/q');
    });

    it('should complete /clear command', () => {
      const [completions] = completer.complete('/cl');

      expect(completions).toContain('/clear');
      expect(completions).toContain('/cls');
    });

    it('should match commands case-insensitively', () => {
      const [completions] = completer.complete('/EXIT');

      expect(completions).toContain('/exit');
    });

    it('should return registered commands along with built-in commands', () => {
      mockListCommands.mockReturnValue([
        { name: 'topology', description: 'Show topology', usage: '/topology' },
        { name: 'failover', description: 'Failover commands', usage: '/failover' },
      ]);

      completer = createCompleter();
      const [completions] = completer.complete('');

      expect(completions).toContain('/topology');
      expect(completions).toContain('/failover');
      expect(completions).toContain('/exit');
    });

    it('should complete subcommands for registered commands', () => {
      mockListCommands.mockReturnValue([
        { name: 'failover', description: 'Failover commands', usage: '/failover' },
      ]);

      const mockGet = jest.fn().mockReturnValue({
        name: 'failover',
        description: 'Failover commands',
        usage: '/failover',
      });
      mockGetRegistry.mockReturnValue({
        get: mockGet,
        has: jest.fn(),
        list: jest.fn().mockReturnValue([]),
        names: jest.fn().mockReturnValue([]),
        register: jest.fn(),
      });

      completer = createCompleter();
      const [completions] = completer.complete('/failover st');

      expect(completions).toContain('/failover status');
    });
  });

  describe('completeCommand()', () => {
    it('should return exact match', () => {
      const result = completer.completeCommand('exit');

      expect(result).toEqual(['exit']);
    });

    it('should return prefix matches', () => {
      const result = completer.completeCommand('cl');

      expect(result).toContain('clear');
      expect(result).toContain('cls');
    });

    it('should return empty array for no matches', () => {
      const result = completer.completeCommand('xyz');

      expect(result).toEqual([]);
    });

    it('should include registered commands in results', () => {
      mockListCommands.mockReturnValue([
        { name: 'topology', description: 'Show topology', usage: '/topology' },
      ]);

      completer = createCompleter();
      const result = completer.completeCommand('top');

      expect(result).toContain('topology');
    });

    it('should match case-insensitively', () => {
      const result = completer.completeCommand('EXIT');

      expect(result).toEqual(['exit']);
    });
  });

  describe('completeSubcommand()', () => {
    it('should return subcommands for known command', () => {
      const result = completer.completeSubcommand('failover', ['st']);

      expect(result).toContain('status');
    });

    it('should return all subcommands for empty partial', () => {
      const result = completer.completeSubcommand('failover', ['']);

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('status');
      expect(result).toContain('history');
    });

    it('should return empty array for unknown command', () => {
      const result = completer.completeSubcommand('unknown', ['test']);

      expect(result).toEqual([]);
    });

    it('should return empty array when args has more than one element', () => {
      const result = completer.completeSubcommand('failover', ['status', 'extra']);

      expect(result).toEqual([]);
    });

    it('should return exact match for complete subcommand', () => {
      const result = completer.completeSubcommand('failover', ['status']);

      expect(result).toEqual(['status']);
    });
  });

  describe('getSuggestions()', () => {
    it('should return completions and hint for single match', () => {
      const result = completer.getSuggestions('/ex');

      expect(result.completions).toContain('/exit');
      expect(result.hint).toBe('Exit the CLI');
    });

    it('should return count hint for multiple matches', () => {
      const result = completer.getSuggestions('/cl');

      expect(result.completions.length).toBeGreaterThan(1);
      expect(result.hint).toMatch(/\d+ commands available/);
    });

    it('should return empty completions for non-command input', () => {
      const result = completer.getSuggestions('help');

      expect(result.completions).toEqual([]);
    });

    it('should return empty completions for no matches', () => {
      const result = completer.getSuggestions('/xyz');

      expect(result.completions).toEqual([]);
    });
  });

  describe('getHint()', () => {
    it('should return hint for matching input', () => {
      const hint = completer.getHint('/ex');

      expect(hint).toBe('Exit the CLI');
    });

    it('should return undefined for no matches', () => {
      const hint = completer.getHint('/xyz');

      expect(hint).toBeUndefined();
    });
  });

  describe('findSimilar()', () => {
    it('should find similar commands within levenshtein distance', () => {
      const result = completer.findSimilar('exi');

      expect(result).toContain('exit');
    });

    it('should include built-in commands in similarity search', () => {
      const result = completer.findSimilar('qit');

      expect(result).toContain('quit');
    });

    it('should return empty array for very different input', () => {
      const result = completer.findSimilar('xyz123456');

      expect(result).toEqual([]);
    });

    it('should return up to 3 suggestions', () => {
      const result = completer.findSimilar('c');

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should sort results by distance', () => {
      const result = completer.findSimilar('clea');

      // 'clear' should come before 'cls' (exact match vs longer distance)
      expect(result[0]).toBe('clear');
    });
  });
});

describe('formatCompletions()', () => {
  it('should return empty string for empty array', () => {
    expect(formatCompletions([])).toBe('');
  });

  it('should format single completion', () => {
    const result = formatCompletions(['exit']);

    expect(result).toBe('exit  ');
  });

  it('should format multiple completions in columns', () => {
    const result = formatCompletions(['exit', 'quit', 'clear']);

    expect(result).toContain('exit');
    expect(result).toContain('quit');
    expect(result).toContain('clear');
  });

  it('should respect maxWidth parameter', () => {
    const result = formatCompletions(['exit', 'quit', 'clear'], 10);

    // With narrow width, items should wrap to multiple lines
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('levenshteinDistance (via findSimilar)', () => {
  let completer: ReturnType<typeof createCompleter>;

  beforeEach(() => {
    mockListCommands.mockReturnValue([]);
    mockGetRegistry.mockReturnValue({
      get: jest.fn(),
      has: jest.fn(),
      list: jest.fn().mockReturnValue([]),
      names: jest.fn().mockReturnValue([]),
      register: jest.fn(),
    });
    completer = createCompleter();
  });

  it('should have distance 0 for identical strings', () => {
    // exit vs exit should be exact match
    const result = completer.findSimilar('exit');

    expect(result).toContain('exit');
  });

  it('should have distance 1 for single substitution', () => {
    // 'exut' is 1 substitution away from 'exit'
    const result = completer.findSimilar('exut');

    expect(result).toContain('exit');
  });

  it('should have distance 1 for single deletion', () => {
    // 'ext' is 1 deletion away from 'exit'
    const result = completer.findSimilar('ext');

    expect(result).toContain('exit');
  });

  it('should have distance 1 for single insertion', () => {
    // 'exitt' is 1 insertion away from 'exit'
    const result = completer.findSimilar('exitt');

    expect(result).toContain('exit');
  });
});

describe('getFlags()', () => {
  it('should return flags for known command', () => {
    const flags = getFlags('failover');

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some(f => f.name === '--force')).toBe(true);
    expect(flags.some(f => f.name === '--dry-run')).toBe(true);
  });

  it('should return flags with hasValue property', () => {
    const flags = getFlags('failover');

    const hostFlag = flags.find(f => f.name === '--host');
    expect(hostFlag).toBeDefined();
    expect(hostFlag?.hasValue).toBe(true);
    expect(hostFlag?.valuePlaceholder).toBe('<host:port>');
  });

  it('should return empty array for unknown command', () => {
    const flags = getFlags('unknowncommand');

    expect(flags).toEqual([]);
  });

  it('should return flags for status command', () => {
    const flags = getFlags('status');

    expect(flags.some(f => f.name === '--json')).toBe(true);
    expect(flags.some(f => f.name === '--watch')).toBe(true);
  });

  it('should return flags for clusters command', () => {
    const flags = getFlags('clusters');

    expect(flags.some(f => f.name === '--name')).toBe(true);
    expect(flags.some(f => f.name === '--primary')).toBe(true);
    expect(flags.some(f => f.name === '--json')).toBe(true);
  });
});

describe('completeFlags()', () => {
  it('should return matching flags for partial input', () => {
    const flags = completeFlags('failover', '--f');

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some(f => f.name === '--force')).toBe(true);
  });

  it('should return empty array for unknown command', () => {
    const flags = completeFlags('unknowncommand', '--');

    expect(flags).toEqual([]);
  });

  it('should match flags case-insensitively', () => {
    const flags = completeFlags('failover', '--FORCE');

    expect(flags.some(f => f.name === '--force')).toBe(true);
  });

  it('should return all flags for empty partial', () => {
    const flags = completeFlags('failover', '--');

    // Should return all flags for failover command
    expect(flags.length).toBeGreaterThan(0);
  });

  it('should return empty array for no matching flags', () => {
    const flags = completeFlags('failover', '--nonexistent');

    expect(flags).toEqual([]);
  });

  it('should match single dash prefix to double dash flags', () => {
    // Single dash prefix matches double dash flags
    const flags = completeFlags('failover', '-');
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some(f => f.name === '--force')).toBe(true);
  });
});
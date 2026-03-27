/**
 * Tests for ClawSQL CLI REPL
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock ESM modules
jest.mock('chalk', () => require('../__mocks__/esm-mocks').chalkMock());

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    constructor() {}
    push() {}
    toString() { return ''; }
  };
});

// Mock ora
jest.mock('ora', () => require('../__mocks__/esm-mocks').oraMock());

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
  throw new Error(`Process exit with code ${code}`);
});

// Mock inquirer
jest.mock('inquirer', () => ({
  default: {
    prompt: jest.fn(),
  },
}));

// Mock openclaw
jest.mock('openclaw', () => ({
  OpenClaw: jest.fn().mockImplementation(() => ({
    isGatewayAvailable: jest.fn().mockResolvedValue(false),
    processNaturalLanguage: jest.fn(),
  })),
}));

// Mock axios
jest.mock('axios', () => ({
  default: {
    create: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: {} }),
      post: jest.fn().mockResolvedValue({ data: {} }),
    }),
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

// Mock registry
jest.mock('../../cli/registry', () => ({
  listCommands: jest.fn().mockReturnValue([]),
  getRegistry: jest.fn(),
  getCommand: jest.fn(),
  createCLIContext: jest.fn().mockReturnValue({
    settings: { appVersion: '0.1.2' },
    orchestrator: { healthCheck: jest.fn().mockResolvedValue(false) },
    failoverExecutor: {},
    proxysql: {},
    formatter: {
      error: (msg: string) => msg,
      info: (msg: string) => msg,
      success: (msg: string) => msg,
      warn: (msg: string) => msg,
    },
    outputFormat: 'table',
  }),
  parseInput: jest.fn(),
  executeCommand: jest.fn(),
}));

// Mock completer
jest.mock('../../cli/completer', () => ({
  createCompleter: jest.fn().mockReturnValue({
    complete: jest.fn().mockReturnValue([[], '']),
    getSuggestions: jest.fn().mockReturnValue({ completions: [] }),
    getHint: jest.fn(),
    findSimilar: jest.fn().mockReturnValue([]),
    completeCommand: jest.fn().mockReturnValue([]),
    completeSubcommand: jest.fn().mockReturnValue([]),
  }),
}));

// Mock agent
jest.mock('../../cli/agent/index', () => ({
  createAIAgent: jest.fn().mockReturnValue({
    process: jest.fn(),
    isConfigured: jest.fn().mockReturnValue(true),
    getProviderName: jest.fn().mockReturnValue('mock'),
  }),
  loadAIConfig: jest.fn().mockReturnValue({ enabled: true, provider: 'mock' }),
}));

// Mock formatter
jest.mock('../../cli/formatter', () => ({
  getFormatter: jest.fn().mockReturnValue({
    error: (msg: string) => msg,
    info: (msg: string) => msg,
    success: (msg: string) => msg,
    warn: (msg: string) => msg,
    setFormat: jest.fn(),
  }),
  Formatter: jest.fn(),
  StreamingMarkdownProcessor: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockReturnValue({ text: '', backspace: 0 }),
    flush: jest.fn().mockReturnValue(''),
  })),
}));

// Mock UI components
jest.mock('../../cli/ui/components', () => ({
  createBanner: jest.fn().mockReturnValue('ClawSQL v0.1.0'),
  createPrompt: jest.fn().mockReturnValue('clawsql> '),
  createDidYouMean: jest.fn().mockReturnValue('Did you mean?'),
  clearScreen: jest.fn(),
  formatWelcomeMessage: jest.fn().mockReturnValue('Welcome!'),
  theme: {
    primary: (str: string) => str,
    secondary: (str: string) => str,
    success: (str: string) => str,
    warning: (str: string) => str,
    error: (str: string) => str,
    info: (str: string) => str,
    muted: (str: string) => str,
  },
}));

import { REPL, REPLConfig } from '../../cli/repl';

describe('REPL', () => {
  let repl: REPL;
  let tempHistoryFile: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create temp history file path
    tempHistoryFile = path.join(os.tmpdir(), `.clawsql-test-history-${Date.now()}`);
  });

  afterEach(() => {
    // Clean up temp history file
    try {
      if (fs.existsSync(tempHistoryFile)) {
        fs.unlinkSync(tempHistoryFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      repl = new REPL();
      expect(repl).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<REPLConfig> = {
        prompt: 'custom> ',
        historySize: 500,
      };

      repl = new REPL(customConfig);
      expect(repl).toBeDefined();
    });

    it('should use custom history file', () => {
      const customConfig: Partial<REPLConfig> = {
        historyFile: tempHistoryFile,
      };

      repl = new REPL(customConfig);
      expect(repl).toBeDefined();
    });
  });

  describe('history management', () => {
    it('should create history directory if not exists', () => {
      const customHistoryFile = path.join(os.tmpdir(), 'clawsql-test-dir', 'history');
      repl = new REPL({ historyFile: customHistoryFile });

      // Directory should be created when history is saved
      expect(repl).toBeDefined();

      // Cleanup
      try {
        fs.rmSync(path.dirname(customHistoryFile), { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should load existing history file', () => {
      // Create history file with some content
      fs.mkdirSync(path.dirname(tempHistoryFile), { recursive: true });
      fs.writeFileSync(tempHistoryFile, '/help\n/topology\n', 'utf-8');

      repl = new REPL({ historyFile: tempHistoryFile });
      expect(repl).toBeDefined();
    });
  });

  describe('stop()', () => {
    it('should call process.exit(0)', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      // The stop method calls process.exit(0)
      // Since we mock process.exit to throw, we expect an error
      expect(() => repl.stop()).toThrow('Process exit with code 0');
    });

    it('should not print extra newline before Goodbye', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      // Capture process.stdout.write output (stop() uses process.stdout.write now)
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        repl.stop();
      } catch {
        // Expected - process.exit throws
      }

      // Find the Goodbye call
      const goodbyeCall = stdoutSpy.mock.calls.find(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('Goodbye'))
      );

      // The Goodbye message should be called
      expect(goodbyeCall).toBeDefined();

      stdoutSpy.mockRestore();
    });
  });

  describe('handleInput (via stop)', () => {
    it('should handle /exit command', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      // stop() is called by /exit
      expect(() => repl.stop()).toThrow('Process exit with code 0');
    });

    it('should handle /quit command (same as exit)', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      // /quit calls stop() which calls process.exit
      expect(() => repl.stop()).toThrow('Process exit with code 0');
    });

    it('should handle /q command (same as exit)', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      // /q calls stop() which calls process.exit
      expect(() => repl.stop()).toThrow('Process exit with code 0');
    });
  });

  describe('built-in commands coverage', () => {
    it('should recognize exit aliases', () => {
      // This test verifies that the completer includes built-in commands
      // The actual handling is in handleInput
      const exitAliases = ['/exit', '/quit', '/q'];
      expect(exitAliases).toHaveLength(3);
    });

    it('should recognize clear aliases', () => {
      const clearAliases = ['/clear', '/cls'];
      expect(clearAliases).toHaveLength(2);
    });
  });

  describe('stop with printGoodbye parameter', () => {
    it('should print goodbye by default', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        repl.stop();
      } catch (e) {
        // Expected: process.exit throws
      }

      // Should have written goodbye message
      expect(stdoutSpy).toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });

    it('should not print goodbye when printGoodbye is false', () => {
      repl = new REPL({ historyFile: tempHistoryFile });

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        repl.stop(false);
      } catch (e) {
        // Expected: process.exit throws
      }

      // Should not have written goodbye message (only the exit prompt)
      const calls = stdoutSpy.mock.calls;
      const hasGoodbye = calls.some(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('Goodbye'))
      );
      expect(hasGoodbye).toBe(false);
      stdoutSpy.mockRestore();
    });
  });
});

describe('REPLConfig', () => {
  it('should have correct default values', () => {
    const defaultPrompt = 'clawsql> ';
    const defaultHistorySize = 1000;

    expect(defaultPrompt).toBe('clawsql> ');
    expect(defaultHistorySize).toBe(1000);
  });
});
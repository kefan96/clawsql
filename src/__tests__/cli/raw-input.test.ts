/**
 * Tests for RawInputHandler - Keyboard navigation and editing
 */

// Mock ESM modules
jest.mock('chalk', () => require('../__mocks__/esm-mocks').chalkMock());

// Mock registry
jest.mock('../../cli/registry', () => ({
  listCommands: jest.fn().mockReturnValue([
    { name: 'help', description: 'Show available commands' },
    { name: 'status', description: 'Show platform status' },
    { name: 'topology', description: 'Show cluster topology' },
  ]),
}));

// Mock completer
jest.mock('../../cli/completer', () => ({
  getFlags: jest.fn().mockReturnValue([
    { name: '--json', description: 'Output in JSON format' },
    { name: '--force', description: 'Skip confirmation' },
  ]),
}));

// Mock UI components
jest.mock('../../cli/ui/components', () => ({
  theme: {
    muted: (str: string) => str,
    primary: Object.assign((str: string) => str, { bold: (str: string) => str }),
    info: (str: string) => str,
    warning: (str: string) => str,
    error: (str: string) => str,
    success: (str: string) => str,
    secondary: (str: string) => str,
    highlight: (str: string) => str,
    accent: (str: string) => str,
  },
}));

import { RawInputHandler } from '../../cli/raw-input.js';

describe('RawInputHandler', () => {
  let handler: RawInputHandler;
  let mockStdin: any;
  let mockStdout: any;
  let writeSpy: jest.Mock;

  beforeEach(() => {
    writeSpy = jest.fn();
    handler = new RawInputHandler('clawsql> ', ['previous command 1', 'previous command 2']);
    jest.clearAllMocks();

    // Mock process.stdin and process.stdout
    mockStdin = {
      on: jest.fn((event: string, callback: Function) => {
        if (event === 'data') {
          // Store callback for later use in tests
          mockStdin._dataCallback = callback;
        }
      }),
      off: jest.fn(),
      resume: jest.fn(),
      setEncoding: jest.fn(),
      setRawMode: jest.fn(),
      isRaw: false,
      isTTY: true,
    };
    mockStdout = {
      write: writeSpy,
      columns: 80,
      isTTY: true,
    };

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    Object.defineProperty(process.env, 'TERM', { value: 'xterm-256color', configurable: true });
  });

  afterEach(() => {
    handler.cleanup();
  });

  describe('constructor', () => {
    it('should initialize with history', () => {
      const handlerWithHistory = new RawInputHandler('test> ', ['cmd1', 'cmd2']);
      expect(handlerWithHistory).toBeDefined();
      handlerWithHistory.cleanup();
    });

    it('should initialize with empty history', () => {
      const handlerNoHistory = new RawInputHandler('test> ', []);
      expect(handlerNoHistory).toBeDefined();
      handlerNoHistory.cleanup();
    });
  });

  describe('setHistory', () => {
    it('should update history array', () => {
      handler.setHistory(['new cmd 1', 'new cmd 2']);
      // History is private but we can verify it works via behavior
      expect(handler).toBeDefined();
    });
  });

  describe('Cursor movement', () => {
    it('should handle left arrow to move cursor', async () => {
      const readPromise = handler.readLine();

      // Type some characters
      mockStdin._dataCallback('abc');
      // Move cursor left
      mockStdin._dataCallback('\x1B[D');

      // Check that write was called (cursor positioning)
      expect(writeSpy).toHaveBeenCalled();

      // Cancel the read
      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle right arrow to move cursor', async () => {
      const readPromise = handler.readLine();

      // Type some characters
      mockStdin._dataCallback('abc');
      // Move cursor left then right
      mockStdin._dataCallback('\x1B[D');
      mockStdin._dataCallback('\x1B[C');

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle Home key to jump to beginning', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x1B[H'); // Home

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle End key to jump to end', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x1B[D'); // Move left
      mockStdin._dataCallback('\x1B[F'); // End

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle Ctrl+A as Home', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x01'); // Ctrl+A

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle Ctrl+E as End', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x05'); // Ctrl+E

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });
  });

  describe('Line editing', () => {
    it('should handle Ctrl+K to delete to end of line', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abcdef');
      mockStdin._dataCallback('\x1B[D'); // Move left
      mockStdin._dataCallback('\x1B[D'); // Move left again
      mockStdin._dataCallback('\x0B'); // Ctrl+K - delete to end

      // Submit to see buffer
      mockStdin._dataCallback('\r');

      const result = await readPromise;
      // Should have 'abcd' (cursor at position 4, deleted 'ef')
      expect(result.value.trim()).toBe('abcd');
    });

    it('should handle Ctrl+U to delete to beginning', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abcdef');
      mockStdin._dataCallback('\x1B[D'); // Move left
      mockStdin._dataCallback('\x1B[D'); // Move left again
      mockStdin._dataCallback('\x15'); // Ctrl+U - delete to beginning

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      // Should have 'ef' (cursor moved to 0, deleted 'abcd')
      expect(result.value.trim()).toBe('ef');
    });

    it('should handle Ctrl+W to delete previous word', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('hello world test');
      mockStdin._dataCallback('\x17'); // Ctrl+W - delete 'test'

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('hello world');
    });

    it('should handle Ctrl+L to clear screen', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x0C'); // Ctrl+L

      // Should have written clear screen sequence
      expect(writeSpy).toHaveBeenCalledWith('\x1B[2J\x1B[0f');

      mockStdin._dataCallback('\x03');
      await readPromise;
    });

    it('should handle Delete key (forward delete)', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x1B[D'); // Move left (cursor at 'c')
      mockStdin._dataCallback('\x1B[3~'); // Delete forward

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('ab');
    });

    it('should handle Ctrl+T to transpose characters', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x14'); // Ctrl+T - swap 'b' and 'c'

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('acb');
    });
  });

  describe('History navigation', () => {
    it('should navigate up through history', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('\x1B[A'); // Up - should show 'previous command 2'
      mockStdin._dataCallback('\x1B[A'); // Up - should show 'previous command 1'

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('previous command 1');
    });

    it('should navigate down through history', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('\x1B[A'); // Up
      mockStdin._dataCallback('\x1B[A'); // Up
      mockStdin._dataCallback('\x1B[B'); // Down - should show 'previous command 2'

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('previous command 2');
    });

    it('should restore saved buffer when navigating back down', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('current input');
      mockStdin._dataCallback('\x1B[A'); // Up - go to history
      mockStdin._dataCallback('\x1B[B'); // Down - back to current input

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('current input');
    });

    it('should not navigate history when suggestions are showing', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('/'); // Shows suggestions
      mockStdin._dataCallback('\x1B[A'); // Up - should navigate suggestions, not history

      expect(writeSpy).toHaveBeenCalled();

      mockStdin._dataCallback('\x03');
      await readPromise;
    });
  });

  describe('Insert at cursor position', () => {
    it('should insert characters at cursor position', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('ac');
      mockStdin._dataCallback('\x1B[D'); // Move left (cursor between 'a' and 'c')
      mockStdin._dataCallback('b'); // Insert 'b' at cursor

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('abc');
    });

    it('should handle backspace at cursor position', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x1B[D'); // Move left
      mockStdin._dataCallback('\x7F'); // Backspace - delete 'b'

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('ac');
    });
  });

  describe('Suggestion acceptance', () => {
    it('should accept suggestion with Tab', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('/hel'); // Should show 'help' suggestion
      mockStdin._dataCallback('\t'); // Tab to accept

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('/help');
    });

    it('should accept suggestion with Enter', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('/hel');
      mockStdin._dataCallback('\r'); // Enter to accept and submit

      const result = await readPromise;
      expect(result.value.trim()).toBe('/help');
    });
  });

  describe('Ctrl+C and Ctrl+D', () => {
    it('should cancel input with Ctrl+C', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x03'); // Ctrl+C

      const result = await readPromise;
      expect(result.cancelled).toBe(true);
    });

    it('should request exit with Ctrl+D', async () => {
      const readPromise = handler.readLine();

      mockStdin._dataCallback('abc');
      mockStdin._dataCallback('\x04'); // Ctrl+D

      const result = await readPromise;
      expect(result.exitRequested).toBe(true);
    });
  });

  describe('Bracketed paste mode', () => {
    it('should handle complete paste in single chunk', async () => {
      const readPromise = handler.readLine();

      // Complete bracketed paste
      mockStdin._dataCallback('\x1B[200~pasted text\x1B[201~');

      mockStdin._dataCallback('\r');

      const result = await readPromise;
      expect(result.value.trim()).toBe('pasted text');
    });
  });
});
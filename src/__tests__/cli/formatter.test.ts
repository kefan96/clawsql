/**
 * Tests for CLI Formatter
 */

// Mock chalk ESM module
jest.mock('chalk', () => {
  const mockChalk = {
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
    italic: (str: string) => str,
    underline: (str: string) => str,
  };
  // Create a chainable color function
  const createChainable = () => {
    const fn = (str: string) => str;
    Object.assign(fn, mockChalk);
    return fn;
  };
  return {
    __esModule: true,
    default: {
      ...mockChalk,
      hex: createChainable,
      rgb: createChainable,
    },
    ...mockChalk,
  };
});

// Mock cli-table3
jest.mock('cli-table3', () => {
  return class MockTable {
    head: string[] = [];
    push() {}
    toString() { return 'mock-table'; }
  };
});

import { Formatter, createFormatter, getFormatter, StreamingMarkdownProcessor } from '../../cli/formatter';

describe('Formatter', () => {
  describe('constructor', () => {
    it('should create formatter with default options', () => {
      const formatter = new Formatter();
      expect(formatter).toBeDefined();
    });

    it('should create formatter with custom options', () => {
      const formatter = new Formatter({ format: 'json', colors: false });
      expect(formatter).toBeDefined();
    });
  });

  describe('table', () => {
    it('should format data as table', () => {
      const formatter = new Formatter({ colors: false });
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];

      const result = formatter.table(data, [
        { key: 'name', header: 'Name' },
        { key: 'age', header: 'Age' },
      ]);

      // Mock table returns 'mock-table'
      expect(result).toBeDefined();
    });

    it('should return warning for empty data', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.table([], [{ key: 'name', header: 'Name' }]);

      expect(result).toContain('No data');
    });

    it('should handle null values', () => {
      const formatter = new Formatter({ colors: false });
      const data = [{ name: 'Alice', age: null }];

      const result = formatter.table(data, [
        { key: 'name', header: 'Name' },
        { key: 'age', header: 'Age' },
      ]);

      expect(result).toBeDefined();
    });
  });

  describe('json', () => {
    it('should format data as JSON', () => {
      const formatter = new Formatter();
      const data = { name: 'test', value: 123 };

      const result = formatter.json(data);

      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 123');
    });
  });

  describe('success', () => {
    it('should format success message', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.success('Operation completed');

      expect(result).toContain('✓');
      expect(result).toContain('Operation completed');
    });
  });

  describe('error', () => {
    it('should format error message', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.error('Something went wrong');

      expect(result).toContain('✗');
      expect(result).toContain('Something went wrong');
    });
  });

  describe('warning', () => {
    it('should format warning message', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.warning('Be careful');

      expect(result).toContain('⚠');
      expect(result).toContain('Be careful');
    });
  });

  describe('info', () => {
    it('should format info message', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.info('Information');

      expect(result).toContain('ℹ');
      expect(result).toContain('Information');
    });
  });

  describe('header', () => {
    it('should format header', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.header('Test Header');

      expect(result).toContain('Test Header');
    });
  });

  describe('section', () => {
    it('should format section header', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.section('Section');

      expect(result).toContain('Section');
    });
  });

  describe('keyValue', () => {
    it('should format key-value pair', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.keyValue('Host', 'localhost');

      expect(result).toContain('Host');
      expect(result).toContain('localhost');
    });

    it('should handle null values', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.keyValue('Host', null);

      expect(result).toContain('Host');
      expect(result).toContain('not set');
    });

    it('should handle undefined values', () => {
      const formatter = new Formatter({ colors: false });
      const result = formatter.keyValue('Host', undefined);

      expect(result).toContain('Host');
      expect(result).toContain('not set');
    });
  });

  describe('tree', () => {
    it('should format tree structure', () => {
      const formatter = new Formatter({ colors: false });
      const nodes = [
        {
          name: 'primary:3306',
          type: 'primary' as const,
          status: 'online',
        },
        {
          name: 'replica:3306',
          type: 'replica' as const,
          status: 'online',
          extra: 'lag: 0s',
        },
      ];

      const result = formatter.tree(nodes);

      expect(result).toContain('primary:3306');
      expect(result).toContain('replica:3306');
      expect(result).toContain('online');
    });

    it('should handle nested children', () => {
      const formatter = new Formatter({ colors: false });
      const nodes = [
        {
          name: 'parent',
          type: 'primary' as const,
          children: [
            { name: 'child', type: 'replica' as const },
          ],
        },
      ];

      const result = formatter.tree(nodes);

      expect(result).toContain('parent');
      expect(result).toContain('child');
    });
  });

  describe('setFormat and getFormat', () => {
    it('should change output format', () => {
      const formatter = new Formatter();
      expect(formatter.getFormat()).toBe('table');

      formatter.setFormat('json');
      expect(formatter.getFormat()).toBe('json');
    });
  });
});

describe('StreamingMarkdownProcessor', () => {
  it('should process plain text', () => {
    const processor = new StreamingMarkdownProcessor();
    const result = processor.process('Hello world');

    expect(result.text).toBe('Hello world');
    expect(result.backspace).toBe(0);
  });

  it('should flush remaining buffer', () => {
    const processor = new StreamingMarkdownProcessor();
    processor.process('Incomplete **bold');
    const flushed = processor.flush();

    expect(typeof flushed).toBe('string');
  });
});

describe('createFormatter', () => {
  it('should create new formatter instance', () => {
    const formatter = createFormatter({ format: 'json' });
    expect(formatter).toBeDefined();
    expect(formatter.getFormat()).toBe('json');
  });
});

describe('getFormatter', () => {
  it('should return default formatter instance', () => {
    const formatter1 = getFormatter();
    const formatter2 = getFormatter();

    expect(formatter1).toBe(formatter2);
  });
});
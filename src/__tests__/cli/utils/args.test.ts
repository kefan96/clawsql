/**
 * Tests for CLI Argument Utilities
 */

import { parseStringArg, parseNumberArg, parseHostPort, getErrorMessage } from '../../../cli/utils/args.js';

describe('parseStringArg', () => {
  it('should return undefined when argument not found', () => {
    const result = parseStringArg(['--foo', 'bar'], '--name');
    expect(result).toBeUndefined();
  });

  it('should return undefined when no value after flag', () => {
    const result = parseStringArg(['--name'], '--name');
    expect(result).toBeUndefined();
  });

  it('should return the value after the flag', () => {
    const result = parseStringArg(['--name', 'myname'], '--name');
    expect(result).toBe('myname');
  });

  it('should work with multiple arguments', () => {
    const args = ['--name', 'test', '--count', '5', '--mode', 'async'];
    expect(parseStringArg(args, '--name')).toBe('test');
    expect(parseStringArg(args, '--count')).toBe('5');
    expect(parseStringArg(args, '--mode')).toBe('async');
  });
});

describe('parseNumberArg', () => {
  it('should return default value when argument not found', () => {
    const result = parseNumberArg(['--foo', 'bar'], '--count', 10);
    expect(result).toBe(10);
  });

  it('should return default value when no value after flag', () => {
    const result = parseNumberArg(['--count'], '--count', 5);
    expect(result).toBe(5);
  });

  it('should return parsed number value', () => {
    const result = parseNumberArg(['--count', '42'], '--count', 0);
    expect(result).toBe(42);
  });

  it('should return default value for non-numeric input', () => {
    const result = parseNumberArg(['--count', 'abc'], '--count', 10);
    expect(result).toBe(10);
  });

  it('should handle negative numbers', () => {
    const result = parseNumberArg(['--value', '-5'], '--value', 0);
    expect(result).toBe(-5);
  });
});

describe('parseHostPort', () => {
  it('should parse host:port format', () => {
    const result = parseHostPort('localhost:3306');
    expect(result).toEqual({ host: 'localhost', port: 3306 });
  });

  it('should use default port when not specified', () => {
    const result = parseHostPort('localhost');
    expect(result).toEqual({ host: 'localhost', port: 3306 });
  });

  it('should allow custom default port', () => {
    const result = parseHostPort('localhost', 6033);
    expect(result).toEqual({ host: 'localhost', port: 6033 });
  });

  it('should parse IP address with port', () => {
    const result = parseHostPort('192.168.1.100:3307');
    expect(result).toEqual({ host: '192.168.1.100', port: 3307 });
  });

  it('should parse hostname with port', () => {
    const result = parseHostPort('mysql-primary.example.com:3306');
    expect(result).toEqual({ host: 'mysql-primary.example.com', port: 3306 });
  });

  it('should handle invalid port gracefully', () => {
    const result = parseHostPort('localhost:abc');
    expect(result).toEqual({ host: 'localhost', port: 3306 });
  });
});

describe('getErrorMessage', () => {
  it('should extract message from Error object', () => {
    const error = new Error('Something went wrong');
    const result = getErrorMessage(error);
    expect(result).toBe('Something went wrong');
  });

  it('should convert string to string', () => {
    const result = getErrorMessage('Simple error string');
    expect(result).toBe('Simple error string');
  });

  it('should convert other types to string', () => {
    expect(getErrorMessage(123)).toBe('123');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
    expect(getErrorMessage({ foo: 'bar' })).toBe('[object Object]');
  });
});
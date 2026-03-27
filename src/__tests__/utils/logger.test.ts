/**
 * Tests for Logger Utility
 */

// Import version from package.json as source of truth
import { version } from '../../../package.json';

// Mock pino
jest.mock('pino', () => {
  const mockLogger = {
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  };
  const pinoMock = jest.fn(() => mockLogger);
  pinoMock.stdTimeFunctions = {
    isoTime: jest.fn(),
  };
  return pinoMock;
});

// Mock settings
jest.mock('../../config/settings', () => ({
  getSettings: jest.fn().mockReturnValue({
    appName: 'ClawSQL',
    appVersion: version,
    logging: {
      level: 'INFO',
      format: 'text',
    },
  }),
}));

import { getLogger, setupLogger, createLogger } from '../../utils/logger';

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton by re-importing
    jest.resetModules();
  });

  describe('getLogger', () => {
    it('should return logger instance', () => {
      const logger = getLogger();
      expect(logger).toBeDefined();
    });

    it('should return child logger with module name', () => {
      const logger = getLogger('test-module');
      expect(logger).toBeDefined();
    });

    it('should return same logger instance', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBe(logger2);
    });
  });

  describe('setupLogger', () => {
    it('should setup logger', () => {
      const logger = setupLogger();
      expect(logger).toBeDefined();
    });
  });

  describe('createLogger', () => {
    it('should create child logger with context', () => {
      const logger = createLogger({ requestId: '123' });
      expect(logger).toBeDefined();
    });
  });
});
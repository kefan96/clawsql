/**
 * Shared test mocks for ESM modules
 *
 * Use in test files:
 * ```typescript
 * jest.mock('chalk', () => require('../__mocks__/esm-mocks').chalkMock());
 * jest.mock('ora', () => require('../__mocks__/esm-mocks').oraMock());
 * ```
 */

/**
 * Mock chalk ESM module
 */
export const chalkMock = () => {
  const mockChalk = {
    bold: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    blue: (str: string) => str,
    cyan: (str: string) => str,
    gray: (str: string) => str,
    dim: (str: string) => str,
    white: (str: string) => str,
    magenta: (str: string) => str,
    black: (str: string) => str,
    bgCyan: (str: string) => str,
    bgGreen: (str: string) => str,
    bgRed: (str: string) => str,
    italic: (str: string) => str,
    underline: (str: string) => str,
  };
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
};

/**
 * Mock ora ESM module
 */
export const oraMock = () => {
  const mockOra = () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    info: jest.fn().mockReturnThis(),
    text: '',
    color: '',
  });
  return {
    __esModule: true,
    default: mockOra,
  };
};
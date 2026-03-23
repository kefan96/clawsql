/**
 * Tests for ClawSQL custom exceptions
 */

import {
  ClawSQLError,
  ValidationError,
  NotFoundError,
  AlreadyExistsError,
  ConnectionError,
  OrchestratorError,
  ProxySQLError,
  FailoverError,
  AuthenticationError,
  AuthorizationError,
} from '../../utils/exceptions';

describe('ClawSQLError', () => {
  it('should create error with code and message', () => {
    const error = new ClawSQLError('TEST_ERROR', 'Test error message');

    expect(error.name).toBe('ClawSQLError');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test error message');
    expect(error.details).toEqual({});
  });

  it('should create error with details', () => {
    const details = { key: 'value', count: 42 };
    const error = new ClawSQLError('TEST_ERROR', 'Test message', details);

    expect(error.details).toEqual(details);
  });

  it('should serialize to JSON correctly', () => {
    const error = new ClawSQLError('TEST_ERROR', 'Test message', { foo: 'bar' });
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'TEST_ERROR',
      message: 'Test message',
      details: { foo: 'bar' },
    });
  });

  it('should have stack trace', () => {
    const error = new ClawSQLError('TEST_ERROR', 'Test message');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ClawSQLError');
  });
});

describe('ValidationError', () => {
  it('should create validation error', () => {
    const error = new ValidationError('Invalid input', { field: 'name' });

    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Invalid input');
    expect(error.details).toEqual({ field: 'name' });
  });
});

describe('NotFoundError', () => {
  it('should create not found error for resource', () => {
    const error = new NotFoundError('Cluster', 'cluster-123');

    expect(error.name).toBe('NotFoundError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Cluster not found: cluster-123');
    expect(error.details).toEqual({ resource: 'Cluster', identifier: 'cluster-123' });
  });

  it('should create not found error for instance', () => {
    const error = new NotFoundError('Instance', 'localhost:3306');

    expect(error.message).toBe('Instance not found: localhost:3306');
  });
});

describe('AlreadyExistsError', () => {
  it('should create already exists error', () => {
    const error = new AlreadyExistsError('Instance', 'localhost:3306');

    expect(error.name).toBe('AlreadyExistsError');
    expect(error.code).toBe('ALREADY_EXISTS');
    expect(error.message).toBe('Instance already exists: localhost:3306');
    expect(error.details).toEqual({ resource: 'Instance', identifier: 'localhost:3306' });
  });
});

describe('ConnectionError', () => {
  it('should create connection error', () => {
    const error = new ConnectionError('Failed to connect to database', { host: 'localhost' });

    expect(error.name).toBe('ConnectionError');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.message).toBe('Failed to connect to database');
    expect(error.details).toEqual({ host: 'localhost' });
  });
});

describe('OrchestratorError', () => {
  it('should create orchestrator error', () => {
    const error = new OrchestratorError('Orchestrator unreachable', { url: 'http://orchestrator:3000' });

    expect(error.name).toBe('OrchestratorError');
    expect(error.code).toBe('ORCHESTRATOR_ERROR');
    expect(error.message).toBe('Orchestrator unreachable');
  });
});

describe('ProxySQLError', () => {
  it('should create proxysql error', () => {
    const error = new ProxySQLError('Failed to add server', { hostgroup: 10 });

    expect(error.name).toBe('ProxySQLError');
    expect(error.code).toBe('PROXYSQL_ERROR');
    expect(error.message).toBe('Failed to add server');
  });
});

describe('FailoverError', () => {
  it('should create failover error', () => {
    const error = new FailoverError('Failover failed', { clusterId: 'cluster-1' });

    expect(error.name).toBe('FailoverError');
    expect(error.code).toBe('FAILOVER_ERROR');
    expect(error.message).toBe('Failover failed');
  });
});

describe('AuthenticationError', () => {
  it('should create authentication error with default message', () => {
    const error = new AuthenticationError();

    expect(error.name).toBe('AuthenticationError');
    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.message).toBe('Authentication failed');
  });

  it('should create authentication error with custom message', () => {
    const error = new AuthenticationError('Invalid token');

    expect(error.message).toBe('Invalid token');
  });
});

describe('AuthorizationError', () => {
  it('should create authorization error with default message', () => {
    const error = new AuthorizationError();

    expect(error.name).toBe('AuthorizationError');
    expect(error.code).toBe('AUTHORIZATION_ERROR');
    expect(error.message).toBe('Access denied');
  });

  it('should create authorization error with custom message', () => {
    const error = new AuthorizationError('Insufficient permissions');

    expect(error.message).toBe('Insufficient permissions');
  });
});

describe('Error inheritance', () => {
  it('all errors should be instance of ClawSQLError', () => {
    const errors = [
      new ValidationError('test'),
      new NotFoundError('Resource', 'id'),
      new AlreadyExistsError('Resource', 'id'),
      new ConnectionError('test'),
      new OrchestratorError('test'),
      new ProxySQLError('test'),
      new FailoverError('test'),
      new AuthenticationError(),
      new AuthorizationError(),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(ClawSQLError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
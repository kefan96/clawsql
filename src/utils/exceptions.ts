/**
 * ClawSQL - Custom Exceptions
 *
 * Custom error classes for ClawSQL.
 */

/**
 * Base ClawSQL error class
 */
export class ClawSQLError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ClawSQLError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Validation error
 */
export class ValidationError extends ClawSQLError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends ClawSQLError {
  constructor(resource: string, identifier: string) {
    super('NOT_FOUND', `${resource} not found: ${identifier}`, { resource, identifier });
    this.name = 'NotFoundError';
  }
}

/**
 * Already exists error
 */
export class AlreadyExistsError extends ClawSQLError {
  constructor(resource: string, identifier: string) {
    super('ALREADY_EXISTS', `${resource} already exists: ${identifier}`, { resource, identifier });
    this.name = 'AlreadyExistsError';
  }
}

/**
 * Connection error
 */
export class ConnectionError extends ClawSQLError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('CONNECTION_ERROR', message, details);
    this.name = 'ConnectionError';
  }
}

/**
 * Orchestrator error
 */
export class OrchestratorError extends ClawSQLError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('ORCHESTRATOR_ERROR', message, details);
    this.name = 'OrchestratorError';
  }
}

/**
 * ProxySQL error
 */
export class ProxySQLError extends ClawSQLError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('PROXYSQL_ERROR', message, details);
    this.name = 'ProxySQLError';
  }
}

/**
 * Failover error
 */
export class FailoverError extends ClawSQLError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('FAILOVER_ERROR', message, details);
    this.name = 'FailoverError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends ClawSQLError {
  constructor(message: string = 'Authentication failed') {
    super('AUTHENTICATION_ERROR', message, {});
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends ClawSQLError {
  constructor(message: string = 'Access denied') {
    super('AUTHORIZATION_ERROR', message, {});
    this.name = 'AuthorizationError';
  }
}
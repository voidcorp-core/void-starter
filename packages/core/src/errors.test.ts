import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from './errors';

describe('AppError', () => {
  it('captures code, status, and cause', () => {
    const cause = new Error('underlying');
    const err = new AppError({ message: 'boom', code: 'TEST', status: 418, cause });
    expect(err.message).toBe('boom');
    expect(err.code).toBe('TEST');
    expect(err.status).toBe(418);
    expect(err.cause).toBe(cause);
  });

  it('defaults status to 500 and code to APP_ERROR', () => {
    const err = new AppError({ message: 'boom' });
    expect(err.code).toBe('APP_ERROR');
    expect(err.status).toBe(500);
  });
});

describe('typed subclasses', () => {
  it('ValidationError uses status 400 and code VALIDATION', () => {
    const err = new ValidationError('invalid');
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION');
  });

  it('NotFoundError uses 404', () => {
    expect(new NotFoundError('missing').status).toBe(404);
  });

  it('UnauthorizedError uses 401', () => {
    expect(new UnauthorizedError('login required').status).toBe(401);
  });

  it('ForbiddenError uses 403', () => {
    expect(new ForbiddenError('no rights').status).toBe(403);
  });

  it('ConflictError uses 409', () => {
    expect(new ConflictError('dup').status).toBe(409);
  });
});

describe('isAppError', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError({ message: 'x' }))).toBe(true);
    expect(isAppError(new ValidationError('x'))).toBe(true);
  });

  it('returns false for plain errors and non-errors', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

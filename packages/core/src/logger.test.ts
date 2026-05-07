import { describe, expect, it } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  it('exposes the standard log levels', () => {
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('has a level field that reflects the configured threshold', () => {
    expect(typeof logger.level).toBe('string');
  });
});

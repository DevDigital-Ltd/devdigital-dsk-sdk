import { describe, expect, it } from 'vitest';
import { DskVposClient, DskVposError } from '../src/index.js';

describe('package entry point', () => {
  it('exports DskVposClient and DskVposError', () => {
    expect(typeof DskVposClient).toBe('function');
    expect(typeof DskVposError).toBe('function');
    expect(new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' })).toBeInstanceOf(DskVposClient);
  });
});

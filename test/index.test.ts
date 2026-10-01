import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DskVposClient, DskVposError, VERSION } from '../src/index.js';

describe('package entry point', () => {
  it('exports DskVposClient and DskVposError', () => {
    expect(typeof DskVposClient).toBe('function');
    expect(typeof DskVposError).toBe('function');
    expect(new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' })).toBeInstanceOf(DskVposClient);
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

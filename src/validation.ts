export function assertNonEmptyString(value: unknown, paramName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${paramName} must be a non-empty string`);
  }
}

export function assertNonNegativeInteger(value: unknown, paramName: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${paramName} must be a non-negative integer, got: ${String(value)}`);
  }
}

export function assertCurrency(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{3}$/.test(value)) {
    throw new TypeError(`currency must be a numeric ISO 4217 code such as "978", got: ${String(value)}`);
  }
}

export function assertHttpUrl(value: unknown, paramName: string): asserts value is string {
  let parsed: URL | undefined;
  try {
    parsed = typeof value === 'string' ? new URL(value) : undefined;
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new TypeError(`${paramName} must be an absolute http(s) URL, got: ${String(value)}`);
  }
}

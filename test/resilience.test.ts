import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DskVposClient, DskVposError, VERSION } from '../src/index.js';

const STATUS_OK = {
  errorCode: '0',
  errorMessage: 'Success',
  orderNumber: 'x',
  orderStatus: 2,
  actionCode: 0,
  actionCodeDescription: '',
  amount: 100,
  currency: '978',
  paymentAmountInfo: {
    paymentState: 'DEPOSITED',
    approvedAmount: 100,
    depositedAmount: 100,
    refundedAmount: 0,
    feeAmount: 0,
    totalAmount: 100
  }
};
const STATUS_CREATED = { ...STATUS_OK, orderStatus: 0 };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const httpError = (status: number) => ({ ok: false, status, json: async () => ({}) });

const make = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  new DskVposClient({
    apiLogin: 'login',
    apiPassword: 'super-secret',
    environment: 'uat',
    fetch: fetchImpl,
    retryBaseDelayMs: 0,
    ...extra
  });

afterEach(() => vi.unstubAllGlobals());

describe('retries', () => {
  it('retries getOrderStatus on HTTP 503 and then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(httpError(503)).mockResolvedValueOnce(ok(STATUS_OK));
    const result = await make(fetchMock as unknown as typeof fetch).getOrderStatus('x');
    expect(result.status).toBe('charged');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries getOrderStatus on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(ok(STATUS_OK));
    await make(fetchMock as unknown as typeof fetch).getOrderStatus('x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxNetworkRetries and throws the last error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpError(502));
    await expect(
      make(fetchMock as unknown as typeof fetch, { maxNetworkRetries: 2 }).getOrderStatus('x')
    ).rejects.toMatchObject({
      errorCode: 'http_502',
      httpStatus: 502,
      endpoint: 'getOrderStatusExtended.do'
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a gateway business error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ errorCode: '2', errorMessage: 'Unknown order' }));
    await expect(make(fetchMock as unknown as typeof fetch).getOrderStatus('x')).rejects.toThrow('Unknown order');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'registerOrder',
      (c: DskVposClient) =>
        c.registerOrder({ orderNumber: 'o', amountCents: 100, currency: '978', returnUrl: 'https://x.test' })
    ],
    ['capture', (c: DskVposClient) => c.capture('o', 100)],
    ['refund', (c: DskVposClient) => c.refund('o', 100)],
    ['reverse', (c: DskVposClient) => c.reverse('o')]
  ])('never retries %s (money-moving, outcome unknown after a failure)', async (_name, invoke) => {
    const fetchMock = vi.fn().mockResolvedValue(httpError(503));
    await expect(invoke(make(fetchMock as unknown as typeof fetch))).rejects.toThrow(DskVposError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout with errorCode "timeout" and keeps the cause', async () => {
    const cause = new DOMException('timed out', 'TimeoutError');
    const fetchMock = vi.fn().mockRejectedValue(cause);
    await expect(make(fetchMock as unknown as typeof fetch).reverse('o')).rejects.toMatchObject({
      errorCode: 'timeout',
      cause
    });
  });
});

describe('waitForFinalStatus', () => {
  it('polls until the order leaves "created"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(STATUS_CREATED))
      .mockResolvedValueOnce(ok(STATUS_CREATED))
      .mockResolvedValueOnce(ok(STATUS_OK));
    const result = await make(fetchMock as unknown as typeof fetch).waitForFinalStatus('x', {
      intervalMs: 1,
      timeoutMs: 5000
    });
    expect(result.status).toBe('charged');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resolves with the last "created" status when the timeout elapses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(STATUS_CREATED));
    const result = await make(fetchMock as unknown as typeof fetch).waitForFinalStatus('x', {
      intervalMs: 5,
      timeoutMs: 20
    });
    expect(result.status).toBe('created');
  });
});

describe('input validation', () => {
  const client = make(vi.fn() as unknown as typeof fetch);
  const base = { orderNumber: 'o', amountCents: 100, currency: '978', returnUrl: 'https://x.test' };

  it.each([
    ['empty orderNumber', { orderNumber: ' ' }],
    ['non-numeric currency', { currency: 'EUR' }],
    ['relative returnUrl', { returnUrl: '/return' }],
    ['non-http failUrl', { failUrl: 'javascript:alert(1)' }]
  ])('rejects %s without calling fetch', async (_name, override) => {
    await expect(client.registerOrder({ ...base, ...override })).rejects.toThrow(TypeError);
  });

  it('rejects an empty orderId', async () => {
    await expect(client.getOrderStatus('')).rejects.toThrow(TypeError);
  });

  it('rejects empty credentials and unknown environment at construction', () => {
    expect(() => new DskVposClient({ apiLogin: '', apiPassword: 'b', environment: 'uat' })).toThrow(TypeError);
    expect(() => new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'staging' as never })).toThrow(
      TypeError
    );
  });
});

describe('secrets and observability', () => {
  it('does not expose credentials through JSON, inspect or enumeration', () => {
    const client = make(vi.fn() as unknown as typeof fetch);
    expect(JSON.stringify(client)).not.toContain('super-secret');
    expect(inspect(client, { showHidden: true, depth: 5 })).not.toContain('super-secret');
    expect(Object.keys(client).join()).not.toMatch(/password/i);
  });

  it('logger receives outcome events without credentials or params', async () => {
    const events: unknown[] = [];
    const fetchMock = vi.fn().mockResolvedValue(ok(STATUS_OK));
    await make(fetchMock as unknown as typeof fetch, { logger: (e: unknown) => events.push(e) }).getOrderStatus(
      'secret-order-id'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ endpoint: 'getOrderStatusExtended.do', attempt: 1, outcome: 'ok' });
    expect(JSON.stringify(events)).not.toMatch(/super-secret|secret-order-id/);
  });

  it('sends a User-Agent with SDK version and appInfo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(STATUS_OK));
    await make(fetchMock as unknown as typeof fetch, { appInfo: { name: 'shop', version: '1.2.3' } }).getOrderStatus(
      'x'
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(`devdigital-dsk-sdk/${VERSION} shop/1.2.3`);
  });

  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

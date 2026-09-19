import { afterEach, describe, expect, it, vi } from 'vitest';
import { DskVposClient } from '../src/client.js';
import { DskVposError } from '../src/errors.js';

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DskVposClient.registerOrder', () => {
  it('posts to the UAT base URL with credentials and order fields', async () => {
    const fetchMock = mockFetchOnce({
      orderId: '385aca7f-a29c-70ec-b71a-2d422efa1c13',
      formUrl: 'https://uat.dskbank.bg/payment/merchants/multiecom/payment.html?mdOrder=385aca7f-a29c-70ec-b71a-2d422efa1c13'
    });

    const client = new DskVposClient({ apiLogin: 'devdigital-api', apiPassword: 'secret', environment: 'uat' });
    const result = await client.registerOrder({
      orderNumber: 'inv-42',
      amountCents: 100,
      currency: '978',
      returnUrl: 'https://devdigital.bg/pay/return'
    });

    expect(result.orderId).toBe('385aca7f-a29c-70ec-b71a-2d422efa1c13');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uat.dskbank.bg/payment/rest/register.do');
    const body = init.body as URLSearchParams;
    expect(body.get('userName')).toBe('devdigital-api');
    expect(body.get('password')).toBe('secret');
    expect(body.get('orderNumber')).toBe('inv-42');
    expect(body.get('amount')).toBe('100');
    expect(body.get('currency')).toBe('978');
    expect(body.get('returnUrl')).toBe('https://devdigital.bg/pay/return');
    expect(body.get('failUrl')).toBeNull();
  });

  it('posts to the production base URL when environment is production', async () => {
    const fetchMock = mockFetchOnce({ orderId: 'x', formUrl: 'https://epg.dskbank.bg/payment/merchants/multiecom/payment.html?mdOrder=x' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'production' });
    await client.registerOrder({ orderNumber: 'o1', amountCents: 100, currency: '978', returnUrl: 'https://x' });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://epg.dskbank.bg/payment/rest/register.do');
  });

  it('throws DskVposError on a gateway business error', async () => {
    mockFetchOnce({ errorCode: '1', errorMessage: 'Order number is duplicated, order with given order number is processed already' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });

  it('throws DskVposError on a non-2xx HTTP response', async () => {
    mockFetchOnce({}, 500);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });
});

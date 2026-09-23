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

    const client = new DskVposClient({ apiLogin: 'test-login', apiPassword: 'secret', environment: 'uat' });
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
    expect(body.get('userName')).toBe('test-login');
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

  it('throws DskVposError with an http_-prefixed errorCode on a non-2xx HTTP response', async () => {
    mockFetchOnce({}, 500);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    try {
      await client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' });
      throw new Error('expected registerOrder to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DskVposError);
      expect((error as DskVposError).errorCode).toBe('http_500');
    }
  });

  it('rejects with a TypeError, without calling fetch, when amountCents is not a non-negative integer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 19.99, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with a TypeError, without calling fetch, when amountCents is negative', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: -100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with DskVposError when the request exceeds timeoutMs', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat', timeoutMs: 1 });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });

  it('throws DskVposError, not a raw TypeError, when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });

  it('throws DskVposError, not a raw SyntaxError, when the response body is not valid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });

  it('throws DskVposError, not a raw TypeError, when the response body is null', async () => {
    mockFetchOnce(null);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(
      client.registerOrder({ orderNumber: 'inv-42', amountCents: 100, currency: '978', returnUrl: 'https://x' })
    ).rejects.toThrow(DskVposError);
  });
});

describe('DskVposClient.getOrderStatus', () => {
  it('maps orderStatus to a friendly status', async () => {
    mockFetchOnce({
      errorCode: '0',
      errorMessage: 'Success',
      orderNumber: 'inv-42',
      orderStatus: 0,
      actionCode: -100,
      actionCodeDescription: 'Waiting for payment attempt',
      amount: 100,
      currency: '978',
      date: 1789806038586,
      orderDescription: '',
      paymentAmountInfo: {
        paymentState: 'CREATED',
        approvedAmount: 0,
        depositedAmount: 0,
        refundedAmount: 0,
        feeAmount: 0,
        totalAmount: 100
      }
    });

    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    const result = await client.getOrderStatus('385aca7f-a29c-70ec-b71a-2d422efa1c13');

    expect(result.status).toBe('created');
    expect(result.orderStatus).toBe(0);
    expect(result.paymentAmountInfo.paymentState).toBe('CREATED');
    expect(result.date).toBe(1789806038586);
    expect(result.orderDescription).toBe('');
  });

  it('maps orderStatus 1 and 2 to preAuthorized and charged', async () => {
    mockFetchOnce({ errorCode: '0', errorMessage: 'Success', orderNumber: 'x', orderStatus: 1, actionCode: 0, actionCodeDescription: '', amount: 100, currency: '978', paymentAmountInfo: { paymentState: 'APPROVED', approvedAmount: 100, depositedAmount: 0, refundedAmount: 0, feeAmount: 0, totalAmount: 100 } });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    expect((await client.getOrderStatus('x')).status).toBe('preAuthorized');

    mockFetchOnce({ errorCode: '0', errorMessage: 'Success', orderNumber: 'x', orderStatus: 2, actionCode: 0, actionCodeDescription: '', amount: 100, currency: '978', paymentAmountInfo: { paymentState: 'DEPOSITED', approvedAmount: 100, depositedAmount: 100, refundedAmount: 0, feeAmount: 0, totalAmount: 100 } });
    expect((await client.getOrderStatus('x')).status).toBe('charged');
  });

  it('maps orderStatus 4 to refunded', async () => {
    mockFetchOnce({ errorCode: '0', errorMessage: 'Success', orderNumber: 'x', orderStatus: 4, actionCode: 0, actionCodeDescription: '', amount: 100, currency: '978', paymentAmountInfo: { paymentState: 'REFUNDED', approvedAmount: 100, depositedAmount: 0, refundedAmount: 100, feeAmount: 0, totalAmount: 100 } });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    expect((await client.getOrderStatus('x')).status).toBe('refunded');
  });
});

describe('DskVposClient capture/refund/reverse', () => {
  it('capture posts to deposit.do', async () => {
    const fetchMock = mockFetchOnce({ errorCode: '0', errorMessage: 'Success' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await client.capture('order-1', 100);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://uat.dskbank.bg/payment/rest/deposit.do');
  });

  it('capture throws DskVposError when the order is not in a capturable state', async () => {
    mockFetchOnce({ errorCode: '7', errorMessage: 'Deposit is impossible for current transaction state' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(client.capture('order-1', 100)).rejects.toThrow('Deposit is impossible for current transaction state');
  });

  it('capture rejects with a TypeError, without calling fetch, when amountCents is not a non-negative integer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(client.capture('order-1', 19.99)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refund posts to refund.do', async () => {
    const fetchMock = mockFetchOnce({ errorCode: '0', errorMessage: 'Success' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await client.refund('order-1', 50);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://uat.dskbank.bg/payment/rest/refund.do');
  });

  it('refund rejects with a TypeError, without calling fetch, when amountCents is not a non-negative integer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await expect(client.refund('order-1', 19.99)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reverse posts to reverse.do', async () => {
    const fetchMock = mockFetchOnce({ errorCode: '0', errorMessage: 'Success' });
    const client = new DskVposClient({ apiLogin: 'a', apiPassword: 'b', environment: 'uat' });
    await client.reverse('order-1');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://uat.dskbank.bg/payment/rest/reverse.do');
  });
});

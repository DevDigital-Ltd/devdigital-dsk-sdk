import { describe, expect, it } from 'vitest';
import { DskVposClient, DskVposError } from '../../src/index.js';

const apiLogin = process.env.DSK_VPOS_TEST_API_LOGIN;
const apiPassword = process.env.DSK_VPOS_TEST_API_PASSWORD;

describe.skipIf(!apiLogin || !apiPassword)('DskVposClient against the real UAT sandbox', () => {
  const client = new DskVposClient({ apiLogin: apiLogin ?? '', apiPassword: apiPassword ?? '', environment: 'uat' });

  it('registers an order and reads back its created status', async () => {
    const orderNumber = `sdk-test-${Date.now()}`;
    const registered = await client.registerOrder({
      orderNumber,
      amountCents: 100,
      currency: '978',
      returnUrl: 'https://example.com/return',
      failUrl: 'https://example.com/fail'
    });

    expect(registered.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(registered.formUrl).toContain(registered.orderId);

    const status = await client.getOrderStatus(registered.orderId);
    expect(status.orderNumber).toBe(orderNumber);
    expect(status.status).toBe('created');
    expect(status.paymentAmountInfo.paymentState).toBe('CREATED');
  });

  it('rejects a duplicate orderNumber', async () => {
    const orderNumber = `sdk-test-dup-${Date.now()}`;
    await client.registerOrder({
      orderNumber,
      amountCents: 100,
      currency: '978',
      returnUrl: 'https://example.com/return'
    });

    await expect(
      client.registerOrder({ orderNumber, amountCents: 100, currency: '978', returnUrl: 'https://example.com/return' })
    ).rejects.toThrow(DskVposError);
  });

  it('rejects reverse/refund/capture on an order still waiting for payment', async () => {
    const orderNumber = `sdk-test-state-${Date.now()}`;
    const registered = await client.registerOrder({
      orderNumber,
      amountCents: 100,
      currency: '978',
      returnUrl: 'https://example.com/return'
    });

    await expect(client.reverse(registered.orderId)).rejects.toThrow(DskVposError);
    await expect(client.refund(registered.orderId, 100)).rejects.toThrow(DskVposError);
    await expect(client.capture(registered.orderId, 100)).rejects.toThrow(DskVposError);
  });

  it('rejects an invalid password', async () => {
    const badClient = new DskVposClient({
      apiLogin: apiLogin ?? '',
      apiPassword: 'not-the-real-password',
      environment: 'uat'
    });
    await expect(
      badClient.registerOrder({
        orderNumber: `sdk-test-badauth-${Date.now()}`,
        amountCents: 100,
        currency: '978',
        returnUrl: 'https://example.com/return'
      })
    ).rejects.toThrow(DskVposError);
  });
  it('survives a burst of concurrent orders with unique ids', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        client.registerOrder({
          orderNumber: `sdk-test-burst-${Date.now()}-${i}`,
          amountCents: 100,
          currency: '978',
          returnUrl: 'https://example.com/return'
        })
      )
    );
    expect(new Set(results.map((r) => r.orderId)).size).toBe(15);
  }, 30000);

  it('reports a short timeout as a DskVposError and recovers on the next call', async () => {
    const impatient = new DskVposClient({
      apiLogin: apiLogin ?? '',
      apiPassword: apiPassword ?? '',
      environment: 'uat',
      timeoutMs: 1
    });
    await expect(
      impatient.registerOrder({
        orderNumber: `sdk-test-timeout-${Date.now()}`,
        amountCents: 100,
        currency: '978',
        returnUrl: 'https://example.com/return'
      })
    ).rejects.toThrow(DskVposError);

    const ok = await client.registerOrder({
      orderNumber: `sdk-test-recover-${Date.now()}`,
      amountCents: 100,
      currency: '978',
      returnUrl: 'https://example.com/return'
    });
    expect(ok.orderId).toBeTruthy();
  });
});

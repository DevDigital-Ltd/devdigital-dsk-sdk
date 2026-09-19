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
    await client.registerOrder({ orderNumber, amountCents: 100, currency: '978', returnUrl: 'https://example.com/return' });

    await expect(
      client.registerOrder({ orderNumber, amountCents: 100, currency: '978', returnUrl: 'https://example.com/return' })
    ).rejects.toThrow(DskVposError);
  });

  it('rejects reverse/refund/capture on an order still waiting for payment', async () => {
    const orderNumber = `sdk-test-state-${Date.now()}`;
    const registered = await client.registerOrder({ orderNumber, amountCents: 100, currency: '978', returnUrl: 'https://example.com/return' });

    await expect(client.reverse(registered.orderId)).rejects.toThrow(DskVposError);
    await expect(client.refund(registered.orderId, 100)).rejects.toThrow(DskVposError);
    await expect(client.capture(registered.orderId, 100)).rejects.toThrow(DskVposError);
  });

  it('rejects an invalid password', async () => {
    const badClient = new DskVposClient({ apiLogin: apiLogin ?? '', apiPassword: 'not-the-real-password', environment: 'uat' });
    await expect(
      badClient.registerOrder({ orderNumber: `sdk-test-badauth-${Date.now()}`, amountCents: 100, currency: '978', returnUrl: 'https://example.com/return' })
    ).rejects.toThrow(DskVposError);
  });
});

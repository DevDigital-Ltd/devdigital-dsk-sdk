import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { DskVposClient, DskVposError } from '../../src/index.js';

const apiLogin = process.env.DSK_VPOS_TEST_API_LOGIN;
const apiPassword = process.env.DSK_VPOS_TEST_API_PASSWORD;

// Public UAT test card (SSL, no 3DS): https://uat.dskbank.bg/sandbox/en/integration/structure/test-cards.html
// The docs list expiry 12/26, which stops working in 2027. The sandbox also accepts 12/34 for this PAN.
// 3DS2 cards need a browser (collect-data-3ds2.html) and cannot be driven through the API.
const TEST_CARD = { pan: '4444555511113333', cvc: '123', year: '2034', month: '12' };
const PAYMENT_URL = 'https://uat.dskbank.bg/payment/rest/processform.do';

describe.skipIf(!apiLogin || !apiPassword)('DskVposClient full paid lifecycle on the UAT sandbox', () => {
  const client = new DskVposClient({
    apiLogin: apiLogin || 'skipped',
    apiPassword: apiPassword || 'skipped',
    environment: 'uat'
  });
  let sequence = 0;
  const evidence: string[] = [];

  async function record(scenario: string, orderId: string): Promise<void> {
    const order = await client.getOrderStatus(orderId);
    const { paymentState, depositedAmount, refundedAmount } = order.paymentAmountInfo;
    evidence.push(
      `| ${scenario} | ${order.orderNumber} | ${orderId} | ${order.status} | ${paymentState} | ${order.amount} | ${depositedAmount} | ${refundedAmount} |`
    );
  }

  afterAll(() => {
    if (evidence.length === 0) return;
    const header = [
      `# DSK VPOS UAT evidence (${new Date().toISOString()})`,
      '',
      '| Scenario | orderNumber | orderId | status | paymentState | amount | deposited | refunded |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |'
    ];
    writeFileSync('uat-evidence.md', [...header, ...evidence, ''].join('\n'));
  });

  async function registerOrder(amountCents = 1000): Promise<string> {
    const registered = await client.registerOrder({
      orderNumber: `sdk-paid-${Date.now()}-${++sequence}`,
      amountCents,
      currency: '978',
      returnUrl: 'https://example.com/return',
      failUrl: 'https://example.com/fail'
    });
    return registered.orderId;
  }

  /** Submits card data to the hosted page's own endpoint, exactly as the browser form does. */
  async function submitCard(orderId: string, card: Partial<typeof TEST_CARD> = {}) {
    const { pan, cvc, year, month } = { ...TEST_CARD, ...card };
    const response = await fetch(PAYMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MDORDER: orderId,
        $PAN: pan,
        $CVC: cvc,
        YYYY: year,
        MM: month,
        TEXT: 'TEST HOLDER',
        language: 'en'
      })
    });
    return (await response.json()) as { errorCode: number; errorTypeName?: string };
  }

  it('pays, partially refunds, fully refunds, and rejects invalid follow-up operations', async () => {
    const orderId = await registerOrder(1000);
    expect((await submitCard(orderId)).errorCode).toBe(0);

    const charged = await client.waitForFinalStatus(orderId, { timeoutMs: 15000, intervalMs: 500 });
    expect(charged.status).toBe('charged');
    expect(charged.paymentAmountInfo).toMatchObject({ paymentState: 'DEPOSITED', depositedAmount: 1000 });

    await expect(client.capture(orderId, 100)).rejects.toThrow(DskVposError);
    await client.refund(orderId, 400);
    const partial = await client.getOrderStatus(orderId);
    expect(partial.status).toBe('refunded');
    expect(partial.paymentAmountInfo).toMatchObject({ depositedAmount: 600, refundedAmount: 400 });

    await expect(client.refund(orderId, 900)).rejects.toThrow(/exceeds deposited amount/);

    await client.refund(orderId, 600);
    const full = await client.getOrderStatus(orderId);
    expect(full.paymentAmountInfo).toMatchObject({ depositedAmount: 0, refundedAmount: 1000 });

    await expect(client.reverse(orderId)).rejects.toThrow(DskVposError);
    await record('pay, partial refund, full refund', orderId);
  }, 60000);

  it('pays and then reverses an order', async () => {
    const orderId = await registerOrder();
    await submitCard(orderId);
    await client.reverse(orderId);

    const reversed = await client.getOrderStatus(orderId);
    expect(reversed.status).toBe('reversed');
    expect(reversed.paymentAmountInfo).toMatchObject({ paymentState: 'REVERSED', approvedAmount: 0 });
    await record('pay, reverse', orderId);
  }, 30000);

  it('records a decline for a wrong CVC and leaves the order unpaid', async () => {
    const orderId = await registerOrder();
    const result = await submitCard(orderId, { cvc: '999' });
    expect(result.errorTypeName).toBe('DATA_INPUT_ERROR');

    const declined = await client.getOrderStatus(orderId);
    expect(declined.actionCode).toBe(71015);
    expect(declined.status).toBe('declined');
    expect(declined.paymentAmountInfo.paymentState).toBe('DECLINED');
    await expect(client.refund(orderId, 100)).rejects.toThrow(DskVposError);
    await record('wrong CVC decline', orderId);
  }, 30000);

  it('rejects an expired card before the order is touched', async () => {
    const orderId = await registerOrder();
    const result = await submitCard(orderId, { year: '2020' });
    expect(result.errorCode).toBe(1);
    expect((await client.getOrderStatus(orderId)).status).toBe('created');
    await record('expired card rejected', orderId);
  }, 30000);
});

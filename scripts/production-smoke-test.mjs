// Manual end-to-end check against the live gateway with a real card.
//
//   npm run build
//   DSK_VPOS_API_LOGIN=... DSK_VPOS_API_PASSWORD=... node scripts/production-smoke-test.mjs [--amount-cents 100] [--refund]
//
// It registers one order, prints the payment link, waits while you pay in a browser, and prints the
// final status. With --refund a charged order is refunded in full afterwards.
// Set DSK_VPOS_ENV=uat to rehearse the same flow on the sandbox first.
import { DskVposClient } from '../dist/index.mjs';

const args = process.argv.slice(2);
const amountIndex = args.indexOf('--amount-cents');
const amountCents = amountIndex === -1 ? 100 : Number(args[amountIndex + 1]);
const refundAfter = args.includes('--refund');
const environment = process.env.DSK_VPOS_ENV ?? 'production';

if (!process.env.DSK_VPOS_API_LOGIN || !process.env.DSK_VPOS_API_PASSWORD) {
  console.error('Set DSK_VPOS_API_LOGIN and DSK_VPOS_API_PASSWORD.');
  process.exit(1);
}

const client = new DskVposClient({
  apiLogin: process.env.DSK_VPOS_API_LOGIN,
  apiPassword: process.env.DSK_VPOS_API_PASSWORD,
  environment
});

function summarize(order) {
  const { paymentState, approvedAmount, depositedAmount, refundedAmount } = order.paymentAmountInfo ?? {};
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentState,
    amount: order.amount,
    approvedAmount,
    depositedAmount,
    refundedAmount,
    actionCode: order.actionCode,
    approvalCode: order.cardAuthInfo?.approvalCode,
    maskedPan: order.cardAuthInfo?.maskedPan
  };
}

const { orderId, formUrl } = await client.registerOrder({
  orderNumber: `smoke-${Date.now()}`,
  amountCents,
  currency: '978',
  returnUrl: 'https://devdigital.bg',
  description: 'Integration smoke test'
});

console.log(`Environment: ${environment}`);
console.log(`Order id:    ${orderId}`);
console.log(`Amount:      ${amountCents} cents`);
console.log(`Open this link and pay with a real card:\n${formUrl}\n`);
console.log('Waiting up to 10 minutes for the payment...');

const final = await client.waitForFinalStatus(orderId, { timeoutMs: 600000, intervalMs: 3000 });
console.log('Result:', summarize(final));

if (final.status !== 'charged') {
  console.error(`Order is not charged (status: ${final.status}).`);
  process.exit(2);
}

if (refundAfter) {
  await client.refund(orderId, final.amount);
  console.log('After refund:', summarize(await client.getOrderStatus(orderId)));
}

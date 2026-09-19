# devdigital-dsk-sdk

Unofficial TypeScript client for DSK Bank's VPOS e-commerce payment gateway
(redirect flow). Built by [DevDigital](https://devdigital.bg) because no
Node.js/TypeScript SDK existed for this API.

Not affiliated with or endorsed by DSK Bank / OTP Group. Use at your own
risk; always test against the UAT sandbox before going live.

## Scope

Redirect flow only: `register.do` -> your customer pays on DSK's hosted
page -> you confirm the result server-side with `getOrderStatusExtended.do`.
Card data never touches your server, so this SDK carries no PCI DSS scope.
Direct API card payments, tokenization and recurring payments are not
implemented.

## Install

```bash
npm install devdigital-dsk-sdk
```

## Usage

```ts
import { DskVposClient } from 'devdigital-dsk-sdk';

const client = new DskVposClient({
  apiLogin: process.env.DSK_VPOS_API_LOGIN!,
  apiPassword: process.env.DSK_VPOS_API_PASSWORD!,
  environment: 'uat'
});

const { orderId, formUrl } = await client.registerOrder({
  orderNumber: 'invoice-123',
  amountCents: 1999,
  currency: '978',
  returnUrl: 'https://example.com/pay/return',
  failUrl: 'https://example.com/pay/fail'
});

// redirect the customer to formUrl, then on return:
const status = await client.getOrderStatus(orderId);
if (status.status === 'charged') {
  // paid
} else if (status.status === 'preAuthorized') {
  await client.capture(orderId, 1999);
}
```

Any `status` other than `'charged'` or `'preAuthorized'` — including a
declined or reversed authorization — comes back as `'other'`: this SDK
doesn't assert meanings for order-status codes it hasn't independently
verified against the live gateway. Treat anything that isn't `'charged'`
after checking status as "not paid", and inspect the raw `orderStatus` /
`actionCode` fields on the result if you need to distinguish why.

The redirect flow's `returnUrl` is best-effort — a customer who pays and
then closes their browser before being redirected back never hits it. A
real integration should reconcile by polling `getOrderStatus` for orders
left in `'created'`, rather than relying on the return URL alone.

## API

- `new DskVposClient({ apiLogin, apiPassword, environment })`
- `registerOrder({ orderNumber, amountCents, currency, returnUrl, failUrl?, description? })`
- `getOrderStatus(orderId)`
- `capture(orderId, amountCents)`
- `refund(orderId, amountCents)`
- `reverse(orderId)`

`reverse` cancels an authorization that hasn't been captured yet (a
same-session cancellation); `refund` returns funds after a capture has
already settled.

All money amounts are integer minor units (cents). `currency` is a numeric
ISO 4217 string (e.g. `"978"` for EUR).

Every method throws `DskVposError` (with an `errorCode` matching DSK's own
error codes) on any gateway-reported or transport failure.

## Testing this package

```bash
npm test
```

Unit tests run with no setup. The integration suite additionally needs your
own DSK UAT sandbox credentials in a local, gitignored `.env.test.local`
(copy `.env.example`) — it is skipped automatically otherwise.

## License

MIT

# devdigital-dsk-sdk

[![npm version](https://img.shields.io/npm/v/devdigital-dsk-sdk.svg)](https://www.npmjs.com/package/devdigital-dsk-sdk)
[![CI](https://github.com/DevDigital-Ltd/devdigital-dsk-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/DevDigital-Ltd/devdigital-dsk-sdk/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/devdigital-dsk-sdk.svg)](package.json)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Unofficial TypeScript client for **DSK Bank's VPOS e-commerce payment gateway** (redirect flow).
Zero runtime dependencies, ESM + CJS, full type definitions. Built by [DevDigital](https://devdigital.bg)
because no Node.js/TypeScript SDK existed for this API.

> Not affiliated with or endorsed by DSK Bank / OTP Group. Always test on the UAT sandbox before going live.
> Official gateway documentation: [dev.dskbank.bg/ecommerce](https://dev.dskbank.bg/ecommerce/ecomm-general-info).

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Complete flow with Express](#complete-flow-with-express)
- [Order statuses](#order-statuses)
- [API reference](#api-reference)
- [Errors](#errors)
- [Reliability](#reliability)
- [Security](#security)
- [Production checklist](#production-checklist)
- [Кратко на български](#кратко-на-български)

## Features

- Full order lifecycle: register, check status, capture, refund, reverse.
- **Redirect flow**: card data is entered on DSK's hosted page and never reaches your server (no PCI DSS scope for your app).
- Typed errors (`DskVposError`) with DSK's own error codes, HTTP status, endpoint and original cause.
- Automatic retries with backoff for safe read calls. Money-moving calls are never retried blindly.
- Input validation before any request is sent.
- Credentials never leak into logs, `JSON.stringify` or `util.inspect`.
- Node.js 18+ (uses the built-in `fetch`). Server-side only.

## Install

```bash
npm install devdigital-dsk-sdk
```

## Quick start

```ts
import { DskVposClient, DskVposError } from 'devdigital-dsk-sdk';

const client = new DskVposClient({
  apiLogin: process.env.DSK_VPOS_API_LOGIN!,
  apiPassword: process.env.DSK_VPOS_API_PASSWORD!,
  environment: 'uat' // use 'production' only with production credentials
});

// 1. Register the order and send the customer to DSK's payment page.
const { orderId, formUrl } = await client.registerOrder({
  orderNumber: 'invoice-123', // must be unique per order
  amountCents: 1999, // 19.99, integer minor units
  currency: '978', // numeric ISO 4217, 978 = EUR
  returnUrl: 'https://example.com/pay/return',
  failUrl: 'https://example.com/pay/fail'
});
// -> redirect the customer to formUrl and store orderId with your order

// 2. When the customer returns, confirm the result server-side. Never trust the URL alone.
try {
  const status = await client.getOrderStatus(orderId);
  if (status.status === 'charged') {
    // paid: fulfil the order
  } else if (status.status === 'preAuthorized') {
    await client.capture(orderId, 1999); // two-step payments only
  } else {
    // not paid
  }
} catch (error) {
  if (error instanceof DskVposError) console.error(error.errorCode, error.httpStatus, error.endpoint);
  throw error;
}
```

## Complete flow with Express

```ts
import express from 'express';
import { DskVposClient } from 'devdigital-dsk-sdk';

const app = express();
const dsk = new DskVposClient({
  apiLogin: process.env.DSK_VPOS_API_LOGIN!,
  apiPassword: process.env.DSK_VPOS_API_PASSWORD!,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'uat',
  appInfo: { name: 'my-shop', version: '1.0.0' }
});

app.post('/checkout', async (req, res) => {
  const order = await createOrderInYourDb(req); // your code: returns { id, totalCents }
  const { orderId, formUrl } = await dsk.registerOrder({
    orderNumber: order.id,
    amountCents: order.totalCents,
    currency: '978',
    returnUrl: `https://shop.example/pay/return?order=${order.id}`,
    failUrl: `https://shop.example/pay/return?order=${order.id}`
  });
  await saveDskOrderId(order.id, orderId); // your code: keep the mapping
  res.redirect(303, formUrl);
});

// The customer lands here after paying or failing. The URL is NOT proof of payment:
// look up the DSK order id you stored and ask the gateway.
app.get('/pay/return', async (req, res) => {
  const dskOrderId = await findDskOrderId(String(req.query.order)); // your code
  const result = await dsk.waitForFinalStatus(dskOrderId, { timeoutMs: 15000, intervalMs: 1500 });
  if (result.status === 'charged') return res.redirect('/thank-you');
  res.redirect('/payment-failed');
});
```

Some customers pay and close the browser before being redirected, so `returnUrl` is best-effort.
Run a background job that calls `getOrderStatus` for every order still in `created` after a few
minutes, and fulfil or cancel it from the result.

## Order statuses

`getOrderStatus` returns the raw gateway fields plus a friendly `status`:

| `orderStatus` | `status`        | Meaning                           | What to do                                                                          |
| ------------- | --------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `0`           | `created`       | Registered, no payment finished   | Wait, or reconcile later. Do not fulfil.                                            |
| `1`           | `preAuthorized` | Funds held, not yet captured      | `capture` to take the money, or `reverse` to release it                             |
| `2`           | `charged`       | Payment completed                 | Fulfil the order                                                                    |
| `4`           | `refunded`      | Refunded after capture            | Mark the order refunded                                                             |
| anything else | `other`         | Declined, reversed, or unverified | Treat as **not paid**; inspect `orderStatus`, `actionCode`, `actionCodeDescription` |

The SDK only assigns meanings to codes that were verified against the live UAT gateway. Everything else
comes back as `other` with the raw fields intact, so you never act on a guess.

## API reference

### `new DskVposClient(options)`

| Option              | Type                    | Default  | Description                                                                    |
| ------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------ |
| `apiLogin`          | `string`                | required | Gateway API user name                                                          |
| `apiPassword`       | `string`                | required | Gateway API password                                                           |
| `environment`       | `'uat' \| 'production'` | required | Selects the gateway base URL                                                   |
| `timeoutMs`         | `number`                | `30000`  | Per-request timeout                                                            |
| `maxNetworkRetries` | `number`                | `2`      | Retries for `getOrderStatus` on network errors, timeouts, HTTP 429/5xx         |
| `retryBaseDelayMs`  | `number`                | `250`    | Base delay for exponential backoff (with jitter, capped at 2s)                 |
| `fetch`             | `typeof fetch`          | global   | Custom HTTP client (proxy, instrumentation, tests)                             |
| `logger`            | `(event) => void`       | none     | Receives `{ endpoint, attempt, durationMs, outcome, errorCode?, httpStatus? }` |
| `appInfo`           | `{ name; version? }`    | none     | Added to the `User-Agent` header                                               |

Invalid credentials or an unknown `environment` throw `TypeError` at construction.

### Methods

| Method                                                                                     | Gateway endpoint            | Notes                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `registerOrder({ orderNumber, amountCents, currency, returnUrl, failUrl?, description? })` | `register.do`               | Returns `{ orderId, formUrl }`. Duplicate `orderNumber` is rejected by DSK.                                            |
| `getOrderStatus(orderId)`                                                                  | `getOrderStatusExtended.do` | Retried automatically on transient failures.                                                                           |
| `waitForFinalStatus(orderId, { timeoutMs?, intervalMs? })`                                 | `getOrderStatusExtended.do` | Polls until the order leaves `created` (defaults 120s / 3s). On timeout resolves with the last status, does not throw. |
| `capture(orderId, amountCents)`                                                            | `deposit.do`                | Completes a pre-authorized payment.                                                                                    |
| `refund(orderId, amountCents)`                                                             | `refund.do`                 | Returns funds after a capture has settled.                                                                             |
| `reverse(orderId)`                                                                         | `reverse.do`                | Cancels an authorization that was not captured yet.                                                                    |

Money amounts are integer minor units (cents). `currency` is a numeric ISO 4217 string (`"978"` = EUR).
Invalid input (empty ids, non-numeric currency, relative URLs, fractional or negative amounts) throws
`TypeError` before any request is sent.

## Errors

Every gateway-reported or transport failure throws `DskVposError`:

| Field        | Meaning                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorCode`  | DSK's own code (e.g. `'1'` duplicate order, `'5'` access denied, `'7'` invalid state), or `network`, `timeout`, `invalid_response`, `http_<status>` |
| `message`    | Gateway or transport message                                                                                                                        |
| `httpStatus` | HTTP status when the failure came from an HTTP response                                                                                             |
| `endpoint`   | Gateway endpoint, e.g. `register.do`                                                                                                                |
| `cause`      | Original error for network and parse failures                                                                                                       |

```ts
try {
  await client.capture(orderId, 1999);
} catch (error) {
  if (error instanceof DskVposError && error.errorCode === 'timeout') {
    // Outcome unknown. Check getOrderStatus before retrying.
  }
}
```

## Reliability

- `getOrderStatus` is retried on network errors, timeouts and HTTP 429/5xx (exponential backoff with jitter).
- `registerOrder`, `capture`, `refund` and `reverse` are **never** retried automatically. After a timeout their
  outcome is unknown: call `getOrderStatus` to see what happened before deciding to try again. DSK rejects a
  repeated `orderNumber`, which protects against duplicate orders.
- Use the `logger` option to feed metrics and tracing. Events never contain credentials or request parameters.

## Security

- Use this package on the server only. Never expose `apiLogin` / `apiPassword` to a browser.
- Credentials are kept in private fields and do not appear in `JSON.stringify`, `console.log` or `util.inspect`.
- Confirm payment with `getOrderStatus` before fulfilling an order.
- Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Production checklist

- [ ] Credentials come from environment variables or a secret manager, never from source control.
- [ ] `environment: 'production'` and production credentials are used only in production.
- [ ] Orders are fulfilled only when `getOrderStatus(...).status === 'charged'`.
- [ ] A background job reconciles orders stuck in `created`.
- [ ] `DskVposError` is logged with `errorCode`, `httpStatus` and `endpoint`, without credentials.
- [ ] You tested pay, decline, refund and reverse on UAT.

## Scope

Redirect flow only. Direct API card payments, tokenization and recurring payments are not implemented.

## Кратко на български

Неофициален TypeScript клиент за виртуалния ПОС (VPOS) на ДСК Банк. Клиентът се пренасочва към
платежната страница на банката, картовите данни не минават през вашия сървър.

```bash
npm install devdigital-dsk-sdk
```

1. `registerOrder(...)` връща `formUrl`, към който пренасочвате клиента.
2. След връщането проверявате `getOrderStatus(orderId)` от сървъра. Изпълнявайте поръчката само при `status === 'charged'`.
3. За поръчки, останали в `created`, пускайте периодична проверка, защото клиентът може да затвори браузъра преди пренасочването.
4. Сумите са цели числа в стотинки, `currency` е числов код по ISO 4217 (`"978"` за EUR).
5. Тествайте на UAT среда преди `environment: 'production'`.

Пакетът не е свързан с ДСК Банк / OTP Group.

## Links

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Issues](https://github.com/DevDigital-Ltd/devdigital-dsk-sdk/issues)

## License

MIT

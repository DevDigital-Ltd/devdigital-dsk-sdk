# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [0.2.0]

### Added

- Automatic retries with exponential backoff and jitter for `getOrderStatus` (network errors, timeouts, HTTP 429/5xx). Configurable via `maxNetworkRetries` and `retryBaseDelayMs`.
- `waitForFinalStatus(orderId, { timeoutMs, intervalMs })` to reconcile orders left in `created`.
- `DskVposError` now carries `httpStatus`, `endpoint` and the original `cause`. Timeouts use `errorCode: 'timeout'`.
- `fetch` option for custom HTTP clients (proxies, instrumentation, tests).
- `logger` hook receiving structured events that never contain credentials or request parameters.
- `appInfo` option and a `User-Agent` header identifying the SDK version.
- Input validation for `orderNumber`, `orderId`, `currency` (ISO 4217 numeric) and `returnUrl`/`failUrl`, plus credential and `environment` checks at construction.
- Exported `VERSION` constant.

### Changed

- Credentials are held in private fields, so they do not appear in `JSON.stringify`, `console.log` or `util.inspect` output.
- Money-moving calls (`registerOrder`, `capture`, `refund`, `reverse`) are explicitly never retried automatically.

## [0.1.0]

- Initial release: `registerOrder`, `getOrderStatus`, `capture`, `refund`, `reverse` for the DSK VPOS redirect flow.

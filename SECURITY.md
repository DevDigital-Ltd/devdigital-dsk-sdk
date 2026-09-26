# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **hi@devdigital.bg** with a description and
reproduction steps. We aim to acknowledge reports within 3 business days.

## Scope and guidance

- This SDK uses the redirect flow: card data is entered on DSK's hosted page and never reaches your server.
- Keep `apiLogin` / `apiPassword` in environment variables or a secret manager. Never commit them and never expose them to a browser.
- Use this SDK server-side only.
- Always confirm payment server-side with `getOrderStatus` before fulfilling an order. Do not trust the `returnUrl` query string.
- Vulnerabilities in DSK Bank's gateway itself should be reported to DSK Bank.

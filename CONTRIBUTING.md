# Contributing

```bash
npm ci
npm run typecheck && npm run lint && npm test
```

- Unit tests run without setup. Integration tests need your own DSK UAT credentials in `.env.test.local` (copy `.env.example`) and are skipped otherwise.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
- Add a test for every behaviour change and an entry to `CHANGELOG.md`.
- Never assert meanings for gateway status codes that were not verified against the live UAT gateway.
- Run `npm run format` before committing.

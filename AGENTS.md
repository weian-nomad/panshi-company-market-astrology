# Panshi Project Rules

## Product boundary

- Treat planetary and market comparisons as cultural research and historical exploration.
- Never add buy, sell, hold, target-price, guaranteed-return, or accuracy claims.
- Keep failed and mixed historical cases visible; correlation is not causation.
- Always label the price basis, date precision, time proxy, and data source.

## Data and privacy

- Use public company and market data only unless a separate privacy review is completed.
- Do not commit secrets, private user data, analytics exports, or runtime logs.
- Environment variables belong in deployment configuration, never source files.

## Development

- Node.js 24 is the supported runtime.
- Run `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm test` before release.
- Keep the Docker container non-root and expose only port 3000.
- `/api/health` must remain lightweight and independent of upstream market-data availability.

## Deployment

- Public route: `https://nomadsustaintech.com/apps/panshi/`.
- Deploy with a health check and preserve the previous image for rollback.
- Do not place infrastructure credentials, private hostnames, or server paths in this public repository.

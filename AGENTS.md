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
- Covers both TWSE (上市) and TPEx (上櫃) listed companies. Daily OHLCV is cached locally in SQLite (`MARKET_DB_PATH`, default `data/panshi-market.db`) via bulk whole-market endpoints — never fetch a full historical range per-symbol at request time. `lib/market-data.ts` reads cache-first and only live-fetches a small, wall-clock-capped recent gap; a deep/empty cache degrades gracefully (`coverage.complete: false`), it must never make the request hang.
- `scripts/backfill-market-history.ts` (one-time, resumable) and `scripts/update-latest-market-day.ts` (daily incremental) populate the cache; run via `node --import ./scripts/register-path-alias.mjs <script>` since they execute outside the Next.js bundler and need the `@/` alias + JSON import-attribute shims that loader provides.

## Daily video engine

- `docs/STUDIO.md` is the canonical daily-video contract. Keep selection,
  narration, subtitles, visible figures, description metadata, and QC bound to
  one fact manifest.
- Produce one stock for each category: 市場異動、量能異常、相位密集、歷史分歧、
  今昔反差. Every selected active exact configuration needs at least five D+20
  samples, including at least one positive and one negative case. A required
  「樣本不足」result excludes the stock; five qualified stocks are required or
  the batch stops.
- Every stock scene must state the current daily direction and magnitude, the
  exact active configuration, D+20 sample/up/down counts, and a median or
  interquartile result. Preserve mixed and failed historical cases.
- Open with a concrete data contradiction, unusual volume/price relationship,
  or historical split that is audible within the first three seconds. Hooks can
  create curiosity but cannot imply a forecast or a buy/sell instruction.
- The voice is an adult male Taiwan-Mandarin low-mid register: close-mic, clean
  chest resonance, slight breathiness, restrained smile, and changing cadence.
  Do not force the bass, whisper throughout, or use a rigid newsreader rhythm.
  Default TTS speed is `1.0`; post-processing speech rate must not exceed `1.08`.
- Render exactly seven scenes at 1080 x 1920, 30 fps, H.264/AAC, 48 kHz, and
  45–90 seconds. Content, decode, codec, loudness, duration, hash, and publishing
  identity checks fail closed.
- Publishing state is deployment-specific. Isolated tests stay private with
  subscriber notifications off; never infer the live `AUTO_PUBLISH` setting
  from an example env file or a sample upload.

## Development

- Node.js 24 is the supported runtime.
- Run `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm test` before release.
- Keep the Docker container non-root and expose only port 3000.
- `/api/health` must remain lightweight and independent of upstream market-data availability.

## Visual and motion system

- Apply the installed Taste design guidance to the marketing shell and narrative sections. Keep the research workspace and charts task-first.
- Use generated, project-specific raster imagery for major storytelling surfaces. Keep all meaningful copy as accessible HTML rather than baking words into images.
- Motion must communicate hierarchy, exploration, feedback, or state. Use Motion values or browser-native scroll animation, animate only transforms and opacity, and provide a static `prefers-reduced-motion` experience.
- Fine-pointer parallax must collapse on touch and coarse pointers. Never use React state for continuous pointer or scroll coordinates.
- Use the licensed display face only for brand and editorial hierarchy. Keep interface copy in a Taiwan Traditional Chinese system sans stack and prices, dates, and identifiers in the data mono face.
- Protect LCP, INP, and CLS: reserve media dimensions, preload the hero asset, keep the generated source optimized, and avoid heavy filters or perpetual animation.

## Deployment

- Public route: `https://panshi.nomadsustaintech.com/` (own subdomain, own host — not a path under the main site).
- Deploy with a health check and preserve the previous image for rollback.
- Do not place infrastructure credentials, private hostnames, or server paths in this public repository.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, cp, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const templateRoot = new URL("../", import.meta.url);

async function openPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function render() {
  await Promise.all([
    cp(new URL("../.next/static", import.meta.url), new URL("../.next/standalone/.next/static", import.meta.url), {
      recursive: true,
    }),
    cp(new URL("../public", import.meta.url), new URL("../.next/standalone/public", import.meta.url), {
      recursive: true,
    }),
  ]);
  const port = await openPort();
  const child = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/apps/panshi/`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return { child, origin, response };
    } catch {
      // The standalone server is still starting.
    }
    if (child.exitCode !== null) break;
    await delay(100);
  }

  child.kill("SIGTERM");
  throw new Error("Standalone Next.js server did not become ready");
}

test("server-renders and serves the complete app under its production base path", async () => {
  const { child, origin, response } = await render();
  try {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /<html lang="zh-Hant" class=/);
    assert.match(html, /<title>盤勢 · 企業命盤 × 股價時間線<\/title>/);
    assert.match(html, /把公司的時間/);
    assert.match(html, /開始對照/);
    assert.match(html, /CASTING \/ 起盤/);
    assert.match(html, /日期是一級資料/);
    assert.match(html, /不構成投資、法律或財務建議/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /\/apps\/panshi\/og\.jpg/);
    assert.match(html, /\/apps\/panshi\/images\/panshi-celestial-market\.webp/);
    assert.doesNotMatch(html, /(?:src|href)="\/_next\//);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);

    const staticAssets = [...html.matchAll(/(?:src|href)="(\/apps\/panshi\/_next\/static\/[^"]+)"/g)]
      .map((match) => match[1]);
    assert.ok(staticAssets.length >= 3);
    for (const assetPath of new Set(staticAssets)) {
      const asset = await fetch(`${origin}${assetPath}`);
      assert.equal(asset.status, 200, assetPath);
    }

    const health = await fetch(`${origin}/apps/panshi/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  } finally {
    child.kill("SIGTERM");
  }
});

test("removes starter assets and keeps product-specific sources", async () => {
  const [
    page,
    layout,
    css,
    packageJson,
    nextConfig,
    heroInstrument,
    companyExplorer,
    dockerfile,
    registry,
    socialCard,
    heroImage,
    displayFont,
    fontLicense,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HeroInstrument.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CompanyExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    stat(new URL("../data/twse-company-registry.json", import.meta.url)),
    stat(new URL("../public/og.jpg", import.meta.url)),
    stat(new URL("../public/images/panshi-celestial-market.webp", import.meta.url)),
    stat(new URL("../public/fonts/panshi-display.woff2", import.meta.url)),
    stat(new URL("../public/fonts/OFL-Chiron-Sung-HK.txt", import.meta.url)),
  ]);

  assert.match(page, /CompanyExplorer/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /images: \[imageUrl\]/);
  assert.match(layout, /next\/font\/local/);
  assert.match(css, /--vermilion:\s*#b64236/);
  assert.match(css, /--jade:\s*#2f7163/);
  assert.match(css, /--display:\s*var\(--font-panshi-display\)/);
  assert.doesNotMatch(css, /url\("\/fonts\//);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(packageJson, /"name": "panshi-company-market-astrology"/);
  assert.match(packageJson, /"motion"/);
  assert.match(nextConfig, /basePath:\s*APP_BASE_PATH/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter/);
  assert.match(heroInstrument, /from "motion\/react"/);
  assert.match(heroInstrument, /useReducedMotion/);
  assert.match(heroInstrument, /`\$\{APP_BASE_PATH\}\/images\/panshi-celestial-market\.webp`/);
  assert.match(heroInstrument, /unoptimized/);
  assert.match(heroInstrument, /initial=\{false\}/);
  assert.match(companyExplorer, /`\$\{APP_BASE_PATH\}\/api\/company\?/);
  assert.doesNotMatch(companyExplorer, /fetch\(`\/api\/company\?/);
  assert.match(dockerfile, /\/apps\/panshi\/api\/health/);
  assert.ok(registry.size > 100_000);
  assert.ok(socialCard.size > 100_000);
  assert.ok(heroImage.size > 200_000 && heroImage.size < 500_000);
  assert.ok(displayFont.size > 80_000 && displayFont.size < 250_000);
  assert.ok(fontLicense.size > 4_000);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
  await assert.rejects(access(new URL("public/favicon.svg", templateRoot)));
  await assert.rejects(access(new URL(".openai/hosting.json", templateRoot)));
});

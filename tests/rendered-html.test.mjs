import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile, stat } from "node:fs/promises";
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

  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return { child, response };
    } catch {
      // The standalone server is still starting.
    }
    if (child.exitCode !== null) break;
    await delay(100);
  }

  child.kill("SIGTERM");
  throw new Error("Standalone Next.js server did not become ready");
}

test("server-renders the 盤勢 product shell and metadata", async () => {
  const { child, response } = await render();
  try {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /<html lang="zh-Hant">/);
    assert.match(html, /<title>盤勢 · 企業命盤 × 股價時間線<\/title>/);
    assert.match(html, /把公司的時間/);
    assert.match(html, /開始對照/);
    assert.match(html, /CASTING \/ 起盤/);
    assert.match(html, /日期是一級資料/);
    assert.match(html, /不構成投資、法律或財務建議/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /\/og\.jpg/);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  } finally {
    child.kill("SIGTERM");
  }
});

test("removes starter assets and keeps product-specific sources", async () => {
  const [page, layout, css, packageJson, registry, socialCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    stat(new URL("../data/twse-company-registry.json", import.meta.url)),
    stat(new URL("../public/og.jpg", import.meta.url)),
  ]);

  assert.match(page, /CompanyExplorer/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /images: \[imageUrl\]/);
  assert.match(css, /--vermilion:\s*#b64236/);
  assert.match(css, /--jade:\s*#2f7163/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(packageJson, /"name": "panshi-company-market-astrology"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter/);
  assert.ok(registry.size > 100_000);
  assert.ok(socialCard.size > 100_000);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
  await assert.rejects(access(new URL("public/favicon.svg", templateRoot)));
  await assert.rejects(access(new URL(".openai/hosting.json", templateRoot)));
});

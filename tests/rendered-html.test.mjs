import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the 盤勢 product shell and metadata", async () => {
  const response = await render();
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
});

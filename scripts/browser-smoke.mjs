import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const targetUrl = process.env.PANSHI_URL || process.argv[2];
if (!targetUrl) {
  throw new Error("Set PANSHI_URL or pass the Panshi URL as the first argument.");
}

const browserCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let browserPath;
for (const candidate of browserCandidates) {
  try {
    await access(candidate, constants.X_OK);
    browserPath = candidate;
    break;
  } catch {
    // Try the next known browser location.
  }
}
if (!browserPath) throw new Error("Chrome or Chromium is required for the browser smoke test.");

const profile = await mkdtemp(join(tmpdir(), "panshi-browser-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-gpu",
  "--force-prefers-reduced-motion",
  "--no-default-browser-check",
  "--no-first-run",
  "--remote-debugging-pipe",
  `--user-data-dir=${profile}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
});

const commandPipe = browser.stdio[3];
const eventPipe = browser.stdio[4];
if (!commandPipe || !eventPipe) throw new Error("Chrome debugging pipe was not created.");

let nextId = 0;
let buffer = "";
const pending = new Map();
const eventWaiters = new Map();
const responses = [];
const exceptions = [];
const consoleErrors = [];

eventPipe.setEncoding("utf8");
eventPipe.on("data", (chunk) => {
  buffer += chunk;
  const messages = buffer.split("\0");
  buffer = messages.pop() || "";
  for (const raw of messages) {
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      continue;
    }
    if (message.method === "Network.responseReceived") {
      responses.push({
        mimeType: message.params.response.mimeType,
        status: message.params.response.status,
        type: message.params.type,
        url: message.params.response.url,
      });
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push(message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || "").join(" "));
    }
    const key = `${message.sessionId || "browser"}:${message.method}`;
    const waiters = eventWaiters.get(key);
    if (waiters) {
      eventWaiters.delete(key);
      for (const resolve of waiters) resolve(message.params);
    }
  }
});

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  commandPipe.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method, sessionId, timeoutMs = 20_000) {
  const key = `${sessionId || "browser"}:${method}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    const wrapped = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    eventWaiters.set(key, [...(eventWaiters.get(key) || []), wrapped]);
  });
}

async function evaluate(expression, sessionId) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function poll(expression, predicate, sessionId, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression, sessionId);
    if (predicate(value)) return value;
    await delay(250);
  }
  throw new Error(`Browser condition was not met: ${JSON.stringify(value)}`);
}

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all([
    send("Network.enable", {}, sessionId),
    send("Page.enable", {}, sessionId),
    send("Runtime.enable", {}, sessionId),
  ]);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  const loaded = once("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url: targetUrl }, sessionId);
  await loaded;

  const stateExpression = `(() => {
    const hero = document.querySelector('.hero-instrument');
    const image = document.querySelector('.hero-instrument img');
    const main = document.querySelector('main');
    return {
      alert: Boolean(document.querySelector('[role=alert]')),
      activeLens: document.querySelector('[data-active-lens]')?.dataset.activeLens || null,
      chart: Boolean(document.querySelector('[aria-labelledby=price-title]')),
      company: document.querySelector('.company-identity h2')?.textContent?.trim() || null,
      heroOpacity: hero ? getComputedStyle(hero).opacity : null,
      heroWidth: hero ? Math.round(hero.getBoundingClientRect().width) : 0,
      imageLoaded: Boolean(image && image.complete && image.naturalWidth > 0),
      lensButtons: document.querySelectorAll('.hero-instrument-tabs button').length,
      loading: Boolean(document.querySelector('[aria-busy=true]')),
      inquiry: Boolean(document.querySelector('#inquiry')),
      price: document.querySelector('.latest-price strong')?.textContent?.trim() || null,
      reactAttached: Boolean(main && Object.keys(main).some((key) => key.startsWith('__react'))),
      ticker: document.querySelector('.ticker-badge')?.textContent?.trim() || null,
    };
  })()`;

  const initial = await poll(
    stateExpression,
    (state) => state.ticker === "2330" && Boolean(state.company) && Boolean(state.price) && state.imageLoaded,
    sessionId,
  );
  await evaluate("document.querySelectorAll('.hero-instrument-tabs button')[1].click()", sessionId);
  const afterClick = await poll(stateExpression, (state) => state.activeLens === "timeline", sessionId);
  const timelinePressed = await evaluate(
    "document.querySelectorAll('.hero-instrument-tabs button')[1].getAttribute('aria-pressed')",
    sessionId,
  );

  const inquirySetup = await evaluate(`(() => {
    const target = document.querySelector('#inquiry-target-date');
    if (!target) return null;
    const start = new Date(String(target.min) + 'T00:00:00Z');
    while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() + 1);
    const weekend = start.toISOString().slice(0, 10);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(target, weekend);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const buy = document.querySelector('input[name="inquiry-intent"][value="consider_buy"]');
    buy.click();
    const five = document.querySelector('input[name="inquiry-horizon"][value="5"]');
    five.click();
    document.querySelector('.inquiry-form button[type="submit"]').click();
    return weekend;
  })()`, sessionId);
  assert.ok(inquirySetup, "The inquiry form was not available.");

  const inquiryStateExpression = `(() => {
    const result = document.querySelector('.inquiry-result');
    const marks = [...document.querySelectorAll('.inquiry-layer-mark')].map((item) => item.textContent.trim());
    return {
      adjusted: document.querySelector('.trading-date-note')?.classList.contains('is-adjusted') || false,
      error: document.querySelector('.inquiry-error')?.textContent?.trim() || null,
      loading: Boolean(document.querySelector('.inquiry-loading')),
      marks,
      result: Boolean(result),
      resultCopy: result?.textContent || '',
      sampleSize: Number(document.querySelector('.inquiry-evidence-stats strong')?.textContent || 0),
      status: document.querySelector('.inquiry-observation')?.textContent?.trim() || null,
    };
  })()`;
  const inquiryReady = await poll(
    inquiryStateExpression,
    (state) => state.result && !state.loading && !state.error,
    sessionId,
    60_000,
  );
  assert.equal(inquiryReady.adjusted, true, "A weekend inquiry was not visibly adjusted.");
  assert.match(inquiryReady.resultCopy, /歷史對照期/);
  assert.match(inquiryReady.resultCopy, /5 個交易日/);
  assert.match(inquiryReady.resultCopy, /已校正觀測日/);
  assert.ok(inquiryReady.sampleSize >= 0, "The evidence summary did not render.");
  for (const mark of ["象", "證", "事", "界", "記"]) {
    assert.ok(inquiryReady.marks.includes(mark), `Inquiry layer ${mark} did not render.`);
  }

  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const reason = document.querySelector('#inquiry-reason');
    const boundary = document.querySelector('#inquiry-disconfirming');
    setValue.call(reason, '營收與訂單趨勢符合原先假設');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(boundary, '法說下修展望時重新檢查');
    boundary.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.inquiry-journal form button[type="submit"]').click();
  })()`, sessionId);
  const savedState = await poll(
    `(() => {
      const items = JSON.parse(localStorage.getItem('panshi:inquiries:v1') || '[]');
      const first = items[0] || null;
      return {
        feedback: document.querySelector('.inquiry-save-feedback')?.textContent?.trim() || '',
        first: first ? {
          disconfirmingEvidence: first.disconfirmingEvidence,
          horizon: first.horizon,
          intent: first.intent,
          reason: first.reason,
          reviewedAt: first.reviewedAt,
        } : null,
        saved: items.length,
      };
    })()`,
    (state) => state.saved > 0 && state.feedback.includes("已記下"),
    sessionId,
  );
  assert.equal(savedState.first.intent, "consider_buy");
  assert.equal(savedState.first.horizon, 5);
  assert.equal(savedState.first.reason, "營收與訂單趨勢符合原先假設");
  assert.equal(savedState.first.disconfirmingEvidence, "法說下修展望時重新檢查");

  await evaluate("document.querySelector('.inquiry-history-actions button:nth-child(2)').click()", sessionId);
  const reviewedState = await poll(
    `(() => {
      const first = JSON.parse(localStorage.getItem('panshi:inquiries:v1') || '[]')[0];
      return { reviewedAt: first?.reviewedAt || null };
    })()`,
    (state) => Boolean(state.reviewedAt),
    sessionId,
  );

  if (process.env.PANSHI_SCREENSHOT) {
    const screenshot = await send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    }, sessionId);
    await writeFile(process.env.PANSHI_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  }, sessionId);
  const mobileLayout = await poll(
    `(() => ({
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workbenchWidth: Math.round(document.querySelector('.inquiry-workbench')?.getBoundingClientRect().width || 0),
    }))()`,
    (state) => state.workbenchWidth > 0,
    sessionId,
  );
  if (process.env.PANSHI_MOBILE_SCREENSHOT) {
    const screenshot = await send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      format: "png",
      fromSurface: true,
    }, sessionId);
    await writeFile(process.env.PANSHI_MOBILE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  const targetPath = new URL(targetUrl).pathname.replace(/\/+$/, "");
  const apiResponses = responses.filter((item) => item.url.includes("/api/company"));
  const apiResponse = apiResponses.at(-1);
  const inquiryResponses = responses.filter((item) => item.url.includes("/api/inquiry"));
  const inquiryResponse = inquiryResponses.at(-1);
  const documentResponse = responses.filter((item) => item.type === "Document" && item.status === 200).at(-1);
  const badAssets = responses.filter((item) => item.status >= 400 && /\/(?:_next|images|fonts)\//.test(item.url));

  assert.ok(documentResponse, "Main document did not return 200.");
  assert.equal(initial.reactAttached, true, "React did not attach.");
  assert.equal(initial.alert, false, "The workspace rendered an error alert.");
  assert.equal(initial.loading, false, "The workspace remained busy.");
  assert.equal(initial.inquiry, true, "The inquiry workbench did not server-render.");
  assert.equal(initial.chart, true, "The price chart did not render.");
  assert.equal(initial.heroOpacity, "1", "The hero remained hidden.");
  assert.ok(initial.heroWidth > 0, "The hero has no rendered width.");
  assert.equal(initial.lensButtons, 3, "The hero lenses are incomplete.");
  assert.equal(afterClick.activeLens, "timeline", "The hero lens did not change.");
  assert.equal(timelinePressed, "true", "The clicked lens did not update its pressed state.");
  assert.ok(apiResponse, "No company API response was observed.");
  assert.equal(new URL(apiResponse.url).pathname, `${targetPath}/api/company`);
  assert.equal(apiResponse.status, 200);
  assert.match(apiResponse.mimeType, /^application\/json\b/);
  assert.ok(inquiryResponse, "No inquiry API response was observed.");
  assert.equal(new URL(inquiryResponse.url).pathname, `${targetPath}/api/inquiry`);
  assert.equal(inquiryResponse.status, 200);
  assert.equal(savedState.saved > 0, true, "The decision journal did not persist.");
  assert.equal(mobileLayout.scrollWidth, mobileLayout.innerWidth, "The page overflows horizontally at 390px.");
  const pageCopy = await evaluate("document.body.innerText", sessionId);
  assert.doesNotMatch(pageCopy, /立即買進|建議買進|建議賣出|立即賣出/);
  assert.equal(badAssets.length, 0, "One or more static assets failed.");
  assert.equal(exceptions.length, 0, "The page raised a runtime exception.");
  assert.equal(
    consoleErrors.length,
    0,
    `The page logged a console error: ${JSON.stringify(consoleErrors)}`,
  );

  console.log(JSON.stringify({
    api: { mimeType: apiResponse.mimeType, path: new URL(apiResponse.url).pathname, status: apiResponse.status },
    companyLoaded: Boolean(initial.company && initial.price),
    exceptionCount: exceptions.length,
    heroVisible: initial.heroOpacity === "1" && initial.heroWidth > 0 && initial.imageLoaded,
    hydration: initial.reactAttached,
    interaction: afterClick.activeLens === "timeline" && timelinePressed === "true",
    inquiry: Boolean(inquiryReady.result && inquiryResponse?.status === 200),
    journalSaved: savedState.saved > 0,
    journalReviewed: Boolean(reviewedState.reviewedAt),
    mobileOverflow: mobileLayout.scrollWidth - mobileLayout.innerWidth,
    path: targetPath,
    staticAssetFailures: badAssets.length,
  }, null, 2));
} finally {
  await send("Browser.close").catch(() => {});
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(3_000)]);
  if (browser.exitCode === null) browser.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}

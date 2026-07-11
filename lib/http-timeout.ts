/** fetch() with a hard AbortController timeout — a plain fetch() with no
 * signal can hang indefinitely on a stalled connection, which turns into an
 * un-retryable, un-cancellable request-handler hang (bit us in practice with
 * the TWSE/TPEx bulk + registry endpoints).
 *
 * Also forces `Connection: close`: observed on the backfill host, a pooled
 * keep-alive socket to these endpoints would occasionally go silently dead
 * (NAT/conntrack dropping an idle connection) — the NEXT request over that
 * reused socket then hung for the full timeout before a fresh connection on
 * retry succeeded in well under a second. Closing the connection after every
 * response means we always pay a fresh handshake, trading a little latency
 * for never hitting that stall. */
export async function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...init.headers, Connection: "close" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

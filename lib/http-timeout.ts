/** fetch() with a hard AbortController timeout — a plain fetch() with no
 * signal can hang indefinitely on a stalled connection, which turns into an
 * un-retryable, un-cancellable request-handler hang (bit us in practice with
 * the TWSE/TPEx bulk + registry endpoints). */
export async function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const DEFAULT_SITE_URL = "https://panshi.nomadsustaintech.com";

function canonicalSiteOrigin(siteUrl: string) {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (!(url.protocol === "https:" || url.protocol === "http:")
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")) {
    return null;
  }
  if (process.env.NODE_ENV === "production"
    && url.protocol !== "https:"
    && !(url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) {
    return null;
  }
  return url.origin;
}

function requestOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!(url.protocol === "https:" || url.protocol === "http:")
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isTrustedStudioPost(
  request: Pick<Request, "headers">,
  siteUrl = process.env.SITE_URL?.trim() || DEFAULT_SITE_URL,
) {
  const expectedOrigin = canonicalSiteOrigin(siteUrl);
  if (!expectedOrigin) return false;

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() || null;
  if (fetchSite && fetchSite !== "same-origin") return false;

  const suppliedOrigin = request.headers.get("origin");
  const origin = requestOrigin(suppliedOrigin);
  if (suppliedOrigin && !origin) return false;
  if (origin && origin !== expectedOrigin) return false;

  // Modern browsers send at least one of Origin or Sec-Fetch-Site on a form
  // POST. Requiring positive same-origin evidence keeps legacy/cross-site
  // requests from relying on the session cookie alone.
  return fetchSite === "same-origin" || origin === expectedOrigin;
}

export function studioLocation(notice?: string, tradeDate?: string) {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (tradeDate) params.set("date", tradeDate);
  const query = params.toString();
  return query ? `/studio?${query}` : "/studio";
}

export function forbiddenStudioPost() {
  return new Response("無法驗證這項操作的來源。請重新載入 Studio 後再試。", {
    status: 403,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

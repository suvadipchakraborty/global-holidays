/**
 * Cultural Compass — Cloudflare Worker
 *
 * Responsibilities:
 *  1. Proxy the published Google Sheets CSV through /api/holidays so the
 *     browser never has to deal with Google's CORS / redirect behaviour,
 *     and so we can cache the feed at the edge for a few minutes.
 *  2. Fall through to the static asset binding for everything else
 *     (the public/ directory, deployed via the [assets] block in
 *     wrangler.toml).
 */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRmdr9UYdJ5vV_s1su3WeLlMvMk1qsGIko2QxLI5y4MVOy-ZwSGF6WWJ3QhnLIV9d4CzRtxjqO3myez/pub?gid=863779762&single=true&output=csv";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/holidays") {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      try {
        const upstream = await fetch(SHEET_CSV_URL, {
          cf: { cacheTtl: 300, cacheEverything: true },
          headers: { "user-agent": "cultural-compass-worker" },
        });

        if (!upstream.ok) {
          return new Response(
            `Upstream sheet returned ${upstream.status}`,
            { status: 502, headers: CORS_HEADERS }
          );
        }

        const csv = await upstream.text();
        return new Response(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "cache-control": "public, max-age=300",
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return new Response("Unable to reach the holiday data source.", {
          status: 502,
          headers: CORS_HEADERS,
        });
      }
    }

    // Everything else is a static asset (index.html, css, js, icons...).
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

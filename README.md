# Cultural Compass 🧭

A mobile-first calendar of global cultural holidays, bank holidays, and
observances — pulled live from a published Google Sheet, served from a
Cloudflare Worker.

## What's inside

```
public/                  Static frontend (deployed via the Worker's [assets] binding)
  index.html              App shell: calendar view, About view, bottom sheet, country explorer
  css/styles.css          All styling — design tokens live at the top of the file
  js/csv-parser.js        Dependency-free CSV parsing + lenient date parsing
  js/app.js               App state, rendering, gestures, sharing, service worker registration
  manifest.webmanifest    PWA metadata (installable / "Add to Home Screen")
  sw.js                   Basic offline app-shell caching
  assets/                 Icons + Open Graph share image (SVG)
src/worker.js             Cloudflare Worker: proxies the CSV feed at /api/holidays,
                           serves everything else from the ASSETS binding
wrangler.toml             Worker + static-assets configuration
```

## Data source

The app reads holidays from this published Google Sheets CSV export:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vRmdr9UYdJ5vV_s1su3WeLlMvMk1qsGIko2QxLI5y4MVOy-ZwSGF6WWJ3QhnLIV9d4CzRtxjqO3myez/pub?gid=863779762&single=true&output=csv
```

Expected columns (header names are matched loosely, case-insensitive):
`Date`, `Holiday Name`, `Description`, `Country`, `Type`.

- `Date` accepts `YYYY-MM-DD`, `M/D/YYYY`, or most human-readable formats
  (e.g. "January 1, 2026").
- `Type` drives the color coding. Recognized values: `Public Holiday`,
  `Bank Holiday`, `Religious`, `Cultural`, `Observance`, `National`.
  Anything else falls back to a neutral color automatically — nothing breaks.
- `Country` drives the flag emoji and the country explorer. Unrecognized
  country names still work, they just show a plain flag placeholder — extend
  the `COUNTRY_TO_ISO2` map in `public/js/app.js` to add more.

The frontend calls the Worker's `/api/holidays` proxy first (which adds
edge caching and sidesteps CORS), and falls back to fetching the Google
Sheets URL directly if that route isn't available — handy for previewing
the static files without deploying the Worker.

## Local preview

Any static file server works for a quick look at the UI (the direct-fetch
fallback will kick in, though Google may still block cross-origin reads
from `file://` or unfamiliar origins — the Worker proxy is the reliable path):

```bash
npx serve public
```

For the full experience (Worker + assets, exactly as it will run in
production):

```bash
npm install -g wrangler   # if you don't have it
wrangler dev
```

## Deploying to Cloudflare via GitHub sync

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Connect to Git**,
   and select this repo.
3. Cloudflare will detect `wrangler.toml` automatically. Confirm:
   - Build command: none needed (static files + a plain Worker script).
   - Deploy config: uses `main = "src/worker.js"` and the `[assets]` block
     already pointing at `public/`.
4. Deploy. Your app will be live at `https://<worker-name>.<your-subdomain>.workers.dev`.
5. This project is pre-configured for **`https://global-holidays.suvadipchakraborty.workers.dev`**
   (see `name = "global-holidays"` in `wrangler.toml` and the Open Graph
   URLs in `public/index.html`) — if you deploy under a different name or
   custom domain, update both places so link previews resolve correctly.

## Notes

- The About tab and the "ⓘ" icon in the top bar both surface the
  "Built by Suva" credit and a pre-filled feedback email link.
- The Web Share API is used for sharing individual holidays and the app
  itself, with a clipboard-copy / WhatsApp-link fallback for browsers
  that don't support it (mainly desktop).
- Replace `public/assets/og-image.svg` with a raster (PNG/JPG) version if
  you need a platform that doesn't render SVG Open Graph images.

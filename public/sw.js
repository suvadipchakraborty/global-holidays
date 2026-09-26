const SHELL_CACHE = "compass-shell-v1";
const SHELL_FILES = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/csv-parser.js",
  "/js/app.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/assets/icon.svg",
  "/assets/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Holiday data: always try the network first so content stays fresh,
  // fall back to whatever we last saw if the device is offline.
  if (url.pathname === "/api/holidays") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: cache-first.
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

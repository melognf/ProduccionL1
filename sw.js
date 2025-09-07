// sw.js
const CACHE_NAME = "prod-app-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./estilos.css",
  "./app.js",
  "./firebase-config.js",
  "./icons/pwa-192.png",
  "./icons/pwa-512.png",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

// Instala y precachea
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activa y limpia caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Serve from cache (fallback a red)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Solo GET
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        // Cache-then-network (best effort)
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached) // offline fallback
    )
  );
});

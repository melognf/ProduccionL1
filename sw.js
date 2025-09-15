// sw.js
// sw.js — cache simple para PWA
const CACHE_NAME = "prod-app-v2"; // si cambiás archivos, subí a v2, v3...
const ASSETS = [
  "./",
  "./index.html",
  "./estilos.css",
  "./app.js",
  "./firebase-config.js",

  // Iconos en la MISMA carpeta
  "./pwa-192.png",
  "./pwa-512.png",
  "./apple-touch-icon-180.png",
  "./favicon-32.png",
  "./favicon-16.png"
];

// Instala y precachea
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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

// Responde desde cache y actualiza en segundo plano
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached)
    )
  );
});

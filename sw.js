// sw.js — Produccion L1 (network-first para app y html)
const CACHE = "produccionl1-v6"; // ← cambialo cuando subas una versión nueva

// Archivos estáticos que vale cachear de una (sin JS de lógica)
const PRECACHE = [
  "./",
  "./index.html",
  "./estilos.css",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./favicon-16.png",
  "./apple-touch-icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Helper: guarda en caché sin bloquear la respuesta
async function putCache(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch (e) {}
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Siempre NETWORK-FIRST para HTML y módulos clave
  const isHTML = request.mode === "navigate" || request.destination === "document";
  const isCoreJS =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/firebase-config.js");

  if (isHTML || isCoreJS) {
    event.respondWith(
      fetch(request)
        .then((resp) => putCache(request, resp))
        .catch(() => caches.match(request))
    );
    return;
  }

  // 2) Resto: cache-first con revalidación
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((resp) => putCache(request, resp))
        .catch(() => cached); // si falla red, devolvé lo cacheado si existe
      return cached || fetchPromise;
    })
  );
});

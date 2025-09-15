// sw.js — Produccion L1 (network-first para HTML y app.js/firebase-config.js)
const CACHE = "produccionl1-v7"; // 👈 cambialo cuando subas una nueva versión

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
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function putCache(req, resp) {
  try { const c = await caches.open(CACHE); await c.put(req, resp.clone()); } catch {}
  return resp;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isHTML = request.mode === "navigate" || request.destination === "document";
  const isCoreJS = url.pathname.endsWith("/app.js") || url.pathname.endsWith("/firebase-config.js");

  // Network-first para HTML y JS core: siempre intenta bajar lo último
  if (isHTML || isCoreJS) {
    event.respondWith(
      fetch(request).then((r) => putCache(request, r)).catch(() => caches.match(request))
    );
    return;
  }

  // Resto: cache-first con revalidación
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((r) => putCache(request, r)).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// sw.js — Producción L1 (network-first para HTML y scripts del mismo origen)
const CACHE = "produccionl1-v10";

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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function putCache(req, resp) {
  try { const c = await caches.open(CACHE); await c.put(req, resp.clone()); } catch {}
  return resp;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo MISMO ORIGEN (deja CDNs como gstatic sin tocar)
  if (url.origin !== location.origin) return;

  const isHTML   = request.mode === "navigate" || request.destination === "document";
  const isScript = request.destination === "script";

  if (isHTML || isScript) {
    event.respondWith(
      fetch(request).then((r) => putCache(request, r)).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((r) => putCache(request, r)).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

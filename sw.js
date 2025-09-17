// sw.js — network-first para HTML, cache-first para estáticos
const CACHE = "produccionl1-v11"; // ← ¡SUBILO en cada cambio!

const PRECACHE = [
  "./",
  "./index.html?v=2025-09-16-1",
  "./estilos.css?v=2025-09-16-1",
  "./app.js?v=2025-09-16-1",
  "./manifest.webmanifest?v=2025-09-16-1",
  "./favicon-32.png",
  "./favicon-16.png",
  "./apple-touch-icon-180.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // ← toma control sin esperar
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim(); // ← controla de inmediato
    // Avisar a las páginas que hay versión nueva
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clientsList.forEach(client => client.postMessage({ type: "SW_UPDATED" }));
  })());
});

// Network-first para HTML; cache-first para estáticos
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // HTML: network-first
  if (req.mode === "navigate" || (req.method === "GET" && req.headers.get("accept")?.includes("text/html"))) {
    event.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Estáticos: cache-first
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return r;
    }))
  );
});

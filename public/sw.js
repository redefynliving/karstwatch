// KarstWatch service worker: cache map tiles + static assets for faster
// repeat visits. Cache-first for tiles, network-first for everything else.
const CACHE = "karstwatch-v1";
const TILE_HOSTS = ["s3.amazonaws.com", "tile.openstreetmap.org"];

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isTile = TILE_HOSTS.some((h) => url.hostname === h) && url.pathname.endsWith(".png");
  if (!isTile || event.request.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      try {
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      } catch {
        return new Response("", { status: 504 });
      }
    }),
  );
});

const CACHE = "no-alibi-v5";
const ROOT = "/the/no-alibi/";
const ASSETS = [
  ROOT,
  ROOT + "index.html",
  ROOT + "data/part-0.txt",
  ROOT + "data/part-1.txt",
  ROOT + "data/part-2.txt",
  ROOT + "data/part-3.txt",
  ROOT + "data/part-4.txt",
  ROOT + "data/part-5.txt",
  ROOT + "data/part-6.txt",
  ROOT + "data/part-7.txt"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("no-alibi-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === "navigate";
  const isLocalAsset = url.origin === self.location.origin && url.pathname.startsWith(ROOT);
  if (!isNavigation && !isLocalAsset) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: isNavigation }).then(hit => {
      if (hit) return hit;
      return fetch(event.request).then(response => {
        if (response && response.ok && isLocalAsset) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => isNavigation ? caches.match(ROOT + "index.html") : Response.error());
    })
  );
});

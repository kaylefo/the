const CACHE="no-alibi-literal-2000-v1";
const ASSETS=["./","./index.html","./style.css?v=literal-2000-1","./loader.js?v=literal-2000-1","./app.js?v=literal-2000-1",...Array.from({length:9},(_,i)=>`./expansion-${String(i).padStart(2,"0")}.b64?v=literal-2000-1`)];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(caches.match(event.request,{ignoreSearch:false}).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok&&new URL(event.request.url).origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;})));});

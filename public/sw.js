const CACHE="annare-ordini-v2";
const FILE=["./","index.html","pdf-lib.min.js","manifest.webmanifest","icona-192.png","icona-512.png","icona-180.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILE)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  // never cache the API: login state and orders must always hit the server
  if(e.request.method!=="GET"||new URL(e.request.url).pathname.startsWith("/api/"))return;
  if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put("index.html",c));return r}).catch(()=>caches.match("index.html")));return}
  e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==="opaque"){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r})));
});

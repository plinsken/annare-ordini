const CACHE="annare-ordini-v6";
const FILE=["./","index.html","app.js","gestione.js","simplewebauthn.umd.min.js","prodotti.json","manifest.webmanifest","icona-192.png","icona-512.png","icona-180.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILE)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
// Network first, cached copy when offline. Only good responses are cached.
const rete=(req,chiave)=>fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(chiave,c))}return r}).catch(()=>caches.match(chiave));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  // never cache the API: login state and orders must always hit the server
  if(e.request.method!=="GET"||u.pathname.startsWith("/api/"))return;
  if(e.request.mode==="navigate"){e.respondWith(rete(e.request,"index.html"));return}
  // the product list must match what the server checks against
  if(u.pathname==="/prodotti.json"||u.pathname.endsWith(".js")&&u.pathname!=="/simplewebauthn.umd.min.js"){e.respondWith(rete(e.request,u.pathname.slice(1)));return}
  e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r})));
});

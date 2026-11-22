const CACHE = 'rtp-v1';
const STATIC = ['/login', '/register', '/style.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(()=>{}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') { e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503}))); return; }
  if (e.request.url.match(/\.(css|js|png|jpg|svg|ico)$/)) { e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const cl=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,cl));return r;}))); return; }
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});

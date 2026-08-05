const CACHE_NAME = 'backstage-shell-v1';
const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App shell files: cache-first. Everything else (API calls): always network.
self.addEventListener('fetch', (event)=>{
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some(f => url.pathname.endsWith(f.replace('./','')));
  if(!isShellFile) return; // let API/network calls pass through untouched

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

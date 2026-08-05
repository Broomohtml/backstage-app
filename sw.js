// Strategia: NETWORK-FIRST.
// Si prova sempre la rete: così ogni modifica caricata su GitHub arriva subito,
// senza dover ricordarsi di cambiare il numero di versione della cache.
// La cache serve solo come rete di sicurezza quando il telefono è offline.
const CACHE_NAME = 'backstage-shell';
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

self.addEventListener('fetch', (event)=>{
  const req = event.request;

  // Tocchiamo solo i file di questa app: le chiamate a Groq, Claude e GitHub
  // devono passare intatte (sono POST e su altri domini).
  if(req.method !== 'GET') return;
  if(new URL(req.url).origin !== self.location.origin) return;

  // cache:'no-store' salta anche la cache HTTP del browser: senza questo il
  // telefono "va in rete" ma si riprende la propria copia scaduta di recente,
  // e le modifiche appena pubblicate non arrivano per una decina di minuti.
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        // Copia aggiornata in cache per il prossimo avvio offline.
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req)) // offline: si usa l'ultima versione salvata
  );
});

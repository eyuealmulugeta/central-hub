// Lets Central Hub open with no signal. Network first: while online everything is fresh, and each
// file fetched is kept; offline, the last copy kept is used. Only this site's own files and the
// Firebase scripts are kept. Data never goes through here: Firestore keeps its own offline copy.

const CACHE = 'central-hub-shell-v19';
const FIRST = ['./', 'index.html', 'css/app.css', 'assets/logo.png', 'manifest.webmanifest'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FIRST)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const own = url.origin === location.origin;
  const firebaseScript = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  // the PDF tools (see js/sync/share.js), kept after first use so sharing works offline too
  const pdfTool = url.hostname === 'cdnjs.cloudflare.com' && ['/ajax/libs/html2canvas/', '/ajax/libs/jspdf/'].some(path => url.pathname.startsWith(path));
  if (!own && !firebaseScript && !pdfTool) return;   // sign-in and database traffic goes straight through
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(async () => {
      const kept = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
      return kept || (request.mode === 'navigate' ? caches.match('index.html') : Response.error());
    }),
  );
});

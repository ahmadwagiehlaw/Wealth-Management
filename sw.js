const CACHE_NAME = 'my-wealth-v11-ui'; // UI Polish
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './firebase-config.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;800&family=Inter:wght@300;400;600;700&display=swap'
];

// Install: Cache files + Skip Waiting
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting()) // FORCE ACTIVATE
    );
});

// Activate: Clean old caches + Claim Clients
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('Clearing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim()) // TAKE CONTROL IMMEDIATELY
    );
});

// Fetch: Network First for HTML, Cache First for others (or StaleWhileRevalidate)
// For simplicity and safety during dev, let's use Network First for critical files
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Always fetch HTML from network to avoid "sticky index"
    if (url.pathname.endsWith('index.html') || url.pathname.endsWith('/')) {
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
        return;
    }

    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});

const CACHE_NAME = 'foodmapper-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/static/index.html',
    '/static/login.html',
    '/static/css/output.css',
    '/static/js/app.js',
    '/favicon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('fetch', (event) => {
    // Network first, fall back to cache for API calls might be tricky without offline support logic in app.js
    // For now, Stale-While-Revalidate for static assets, Network First for API?
    const url = new URL(event.request.url);

    if (url.pathname.startsWith('/api/')) {
        // API: Network only (or Network First) - avoiding cache for now to prevent stale data issues
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                return response || fetch(event.request);
            })
    );
});

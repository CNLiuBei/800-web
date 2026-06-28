// Conservative PWA Service Worker.
//
// Web 静态（src/styles/icons）与 Worker 同源部署；播放器/Shaka 仍走 R2 CDN。

const VERSION = 'v147-no-nosrc-cache';
const APP_CACHE = `gy-app-${VERSION}`;
const API_CACHE = `gy-api-${VERSION}`;
const IMAGE_CACHE = `gy-image-${VERSION}`;
const CDN_STATIC_CACHE = `gy-cdn-static-${VERSION}`;
const CDN_STATIC_PREFIXES = [
    '/static/player/',
    '/static/vendor/',
];
const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            deleteOldCaches(),
            self.clients.claim(),
        ])
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (request.mode === 'navigate') {
        event.respondWith(navigationResponse(request));
        return;
    }

    if (isImageRequest(request, url)) {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    if (isCdnStaticAsset(url)) {
        if (url.pathname.startsWith('/static/player/')) {
            event.respondWith(fetch(request, { cache: 'no-store' }));
            return;
        }
        event.respondWith(
            isCriticalCdnAsset(url)
                ? networkFirst(request, CDN_STATIC_CACHE)
                : staleWhileRevalidate(request, CDN_STATIC_CACHE)
        );
        return;
    }

    if (isApiRequest(url) && !isLargeMediaRequest(url)) {
        event.respondWith(apiNetworkFirst(request, API_CACHE, apiOfflineResponse()));
        return;
    }

    if (url.origin === location.origin && isOriginStaticAsset(url)) {
        event.respondWith(
            isCriticalOriginStatic(url)
                ? networkFirst(request, APP_CACHE)
                : staleWhileRevalidate(request, APP_CACHE)
        );
        return;
    }

    if (url.origin === location.origin && isOriginShellAsset(url)) {
        event.respondWith(staleWhileRevalidate(request, APP_CACHE));
    }
});

async function navigationResponse(request) {
    try {
        const response = await fetch(request, { redirect: 'follow' });
        const clean = await rebuildResponse(response);
        if (clean.ok) {
            const cache = await caches.open(APP_CACHE);
            cache.put('/index.html', clean.clone()).catch(() => {});
        }
        return clean;
    } catch {
        const cached = await caches.match('/index.html') || await caches.match('/');
        if (cached) return cached;
        return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title><p>当前离线，且应用壳尚未缓存。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function networkFirst(request, cacheName, fallback) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
    } catch {
        return await cache.match(request) || fallback;
    }
}

async function apiNetworkFirst(request, cacheName, fallback) {
    const cache = await caches.open(cacheName);
    const url = new URL(request.url);
    const tmdbDetail = isTmdbDetailApi(url);
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
            if (tmdbDetail) {
                cacheTmdbDetailIfSourced(request, response, cache).catch(() => {});
            } else {
                cache.put(request, response.clone()).catch(() => {});
            }
        }
        return response;
    } catch {
        if (tmdbDetail) {
            const cached = await cache.match(request);
            if (cached && await tmdbDetailHasPlaySourcesResponse(cached)) return cached;
            return fallback;
        }
        return await cache.match(request) || fallback;
    }
}

function isTmdbDetailApi(url) {
    return /^\/api\/v1\/3\/(movie|tv)\/\d+$/.test(url.pathname);
}

async function tmdbDetailHasPlaySourcesResponse(response) {
    try {
        const data = await response.clone().json();
        const sources = data?.guangying?.play_sources;
        return Array.isArray(sources) && sources.length > 0;
    } catch {
        return false;
    }
}

async function cacheTmdbDetailIfSourced(request, response, cache) {
    if (await tmdbDetailHasPlaySourcesResponse(response)) {
        await cache.put(request, response.clone());
        return;
    }
    await cache.delete(request);
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const fresh = fetch(request)
        .then((response) => {
            if (canCacheResponse(response)) cache.put(request, response.clone()).catch(() => {});
            return response;
        })
        .catch(() => null);
    return cached || await fresh || new Response('', { status: 504 });
}

function canCacheResponse(response) {
    return response?.ok || response?.type === 'opaque';
}

function apiOfflineResponse() {
    return new Response(JSON.stringify({ offline: true, message: '当前无网络' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function isApiRequest(url) {
    return url.origin === location.origin && url.pathname.startsWith('/api/');
}

function isLargeMediaRequest(url) {
    return url.pathname.startsWith('/api/r2/videos/') ||
        url.pathname.startsWith('/r2/videos/') ||
        /\.(m3u8|mp4|m4v|mov|webm|ts|m4s|mpd)$/i.test(url.pathname);
}

function isImageRequest(request, url) {
    if (request.destination === 'image') return true;
    return url.pathname.startsWith('/t/p/') ||
        url.pathname.startsWith('/api/t/p/') ||
        /\.(png|jpe?g|webp|gif|avif|svg|ico)$/i.test(url.pathname);
}

function isCdnStaticAsset(url) {
    return url.hostname.endsWith('guangying.org')
        && CDN_STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isCriticalCdnAsset(url) {
    return url.pathname.startsWith('/static/player/');
}

function isOriginStaticAsset(url) {
    return url.pathname.startsWith('/src/') ||
        url.pathname.startsWith('/styles/') ||
        url.pathname.startsWith('/icons/');
}

function isCriticalOriginStatic(url) {
    if (url.pathname.endsWith('/config.js')) return true;
    if (url.pathname.includes('/src/services/library')) return true;
    if (url.pathname.includes('/src/pages/account.js')) return true;
    if (url.pathname.includes('/src/pages/sessions.js')) return true;
    return false;
}

function isOriginShellAsset(url) {
    return APP_SHELL.includes(url.pathname);
}

async function deleteOldCaches() {
    const keys = await caches.keys();
    await Promise.all(
        keys
            .filter((key) => key.startsWith('gy-') && key !== APP_CACHE && key !== API_CACHE && key !== IMAGE_CACHE && key !== CDN_STATIC_CACHE && key !== 'gy-api-response-v2')
            .map((key) => caches.delete(key))
    );
}

async function rebuildResponse(response) {
    if (!response) throw new Error('Empty response');
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

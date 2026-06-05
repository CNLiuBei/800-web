// Service Worker rescue build.
//
// iOS Safari can fail hard when an old Service Worker returns a navigation
// Response with redirected=true. This build only takes over, clears old
// gy-* caches, unregisters itself, and navigates controlled pages back to
// normal browser network loading.

const VERSION = 'v39-rescue';

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(rescueClients());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetchWithoutRedirectMetadata(event.request));
    }
});

async function rescueClients() {
    await clearGyCaches();
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await self.registration.unregister();
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)));
}

async function clearGyCaches() {
    try {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter((key) => key.startsWith('gy-'))
                .map((key) => caches.delete(key))
        );
    } catch {}
}

async function fetchWithoutRedirectMetadata(request) {
    try {
        const response = await fetch(request, { redirect: 'follow', cache: 'reload' });
        return rebuildResponse(response);
    } catch {
        return new Response(
            '<!doctype html><meta charset="utf-8"><title>网络异常</title><p>网络异常，请稍后重试。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function rebuildResponse(response) {
    if (!response) throw new Error('Empty response');
    const body = await response.arrayBuffer();
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

// TODO: 待 iOS Safari 稳定后，重新评估是否恢复离线缓存能力。

// Service Worker 救援版
//
// iOS Safari 一旦旧 SW 返回带 redirected=true 的导航响应，会直接阻止页面打开。
// 这一版只做一件事：安装后立即接管、清理旧缓存、注销自身，让后续访问回到浏览器原生网络加载。

const VERSION = 'v37-rescue';

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
        return stripRedirectMetadata(response);
    } catch {
        return new Response(
            '<!doctype html><meta charset="utf-8"><title>网络异常</title><p>网络异常，请稍后重试。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

function stripRedirectMetadata(response) {
    if (!response?.redirected) return response;
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

// TODO: 待 iOS Safari 稳定后，重新评估是否恢复离线缓存能力。

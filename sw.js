// Service Worker - 缓存策略 + 版本管理 + 更新通知

const VERSION = 'v36';
const STATIC_CACHE = `gy-static-${VERSION}`;
const API_CACHE = 'gy-api';
const IMG_CACHE = 'gy-img';

// 仅预缓存「首屏关键资源」，保证离线可开机。
// 其余懒加载模块（页面、播放器、按需 CSS）由 SWR 策略在首次访问时自然缓存，
// 避免预缓存清单过大拖慢安装，也避免单个文件缺失导致 addAll 整体失败。
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/styles/critical.css',
    '/src/main.js',
    '/src/core/signal.js',
    '/src/core/router.js',
    '/src/core/html.js',
    '/src/services/theme.js',
    '/src/services/i18n.js',
    '/src/services/config.js',
    '/src/services/api.js',
    '/src/services/history-lite.js',
    '/src/components/app-shell.js',
    '/src/components/poster-grid.js',
    '/src/pages/home.js',
];

// 安装：预缓存首屏资源（逐个 put，单个失败不影响整体）
// v36 修复 iOS Safari 导航重定向致命错误，安装后立即接管，避免旧 SW 持续拦截导致手机打不开。
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then(async (cache) => {
            await Promise.all(STATIC_ASSETS.map(async (url) => {
                try {
                    const res = await fetch(url, { cache: 'reload', redirect: 'follow' });
                    if (res.ok && res.type !== 'opaqueredirect') {
                        await cache.put(url, stripRedirectMetadata(res));
                    }
                } catch { /* 单个资源失败忽略，不阻断安装 */ }
            }));
        }).then(() => self.skipWaiting())
    );
});

// 收到前端「立即更新」指令 → 跳过等待，触发 activate + controllerchange
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// 激活：清理旧缓存并接管页面（不再无条件 postMessage 误报更新）
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k.startsWith('gy-static-') && k !== STATIC_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 仅处理 GET，其余（POST 登录/下单等）直接放行
    if (event.request.method !== 'GET') return;

    // 后端 API 请求：同域 /api/*（生产）或跨域 hono.guangying.org（本地回退）
    const isSameOriginApi = url.origin === self.location.origin &&
        (url.pathname.startsWith('/api/') || url.pathname.startsWith('/addon/'));
    const isCrossOriginApi = url.hostname === 'hono.guangying.org';

    if (isSameOriginApi || isCrossOriginApi) {
        // 认证、用户态、视频流/带 token 的资源不缓存（含敏感信息且会过期）
        // 同时兼容同域 /api 前缀与跨域裸路径两种形态
        const p = url.pathname;
        if (p.startsWith('/api/auth') ||
            p.startsWith('/auth') ||
            p.startsWith('/api/me') ||
            p.startsWith('/me') ||
            p.includes('/r2/videos') ||
            url.searchParams.has('token')) {
            return; // 走默认网络，绝不缓存
        }
        // 图片资源（海报/背景）：内容不变，用 SWR 单独缓存，避免挤占元数据缓存
        if (p.includes('/r2/images') || /\.(jpg|jpeg|png|webp|avif|gif)$/i.test(p)) {
            event.respondWith(staleWhileRevalidate(event.request, IMG_CACHE).then((r) => {
                trimCache(IMG_CACHE, 300);
                return r;
            }));
            return;
        }
        // catalog/meta/stream 等元数据：网络优先，失败回退缓存
        event.respondWith(networkFirst(event.request, API_CACHE));
        return;
    }

    // manifest.json：影响「添加到主屏」的安装行为，用网络优先确保拿到最新配置（含图标/start_url）
    if (url.origin === self.location.origin && url.pathname === '/manifest.json') {
        event.respondWith(networkFirst(event.request, STATIC_CACHE));
        return;
    }

    // 同源静态资源：SWR（先缓存后台更新）
    if (url.origin === self.location.origin) {
        // 页面导航请求（地址栏访问/刷新）：SWR 命中失败时回退到缓存的入口页，避免离线白屏
        if (event.request.mode === 'navigate') {
            event.respondWith(navigationHandler(event.request));
            return;
        }
        if (/\.(?:css|js)$/i.test(url.pathname)) {
            event.respondWith(networkFirst(event.request, STATIC_CACHE));
            return;
        }
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
        return;
    }

    // 其他（CDN 等）：网络优先回退缓存
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// 导航请求处理：优先网络，离线时回退缓存的入口页，保证 PWA 离线可开机。
// 统一以 /index.html 为缓存键，避免 ?source=pwa 等 query 变体造成缓存膨胀。
async function navigationHandler(request) {
    const cache = await caches.open(STATIC_CACHE);
    try {
        const response = await fetch(request, { redirect: 'follow' });
        if (response.type === 'opaqueredirect') throw new Error('Navigation redirected');
        const safeResponse = stripRedirectMetadata(response);
        if (safeResponse.ok) cache.put('/index.html', safeResponse.clone());
        return safeResponse;
    } catch {
        return stripRedirectMetadata(await cache.match('/index.html')) ||
            stripRedirectMetadata(await cache.match('/')) ||
            new Response('<h1>离线</h1><p>当前无网络，请连网后重试。</p>', {
                status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
    }
}

// 策略：网络优先
async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request, { redirect: 'follow' });
        if (response.type === 'opaqueredirect') throw new Error('Redirect response is not cacheable');
        const safeResponse = stripRedirectMetadata(response);
        if (safeResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, safeResponse.clone());
            // API 缓存做容量上限控制，避免无限增长占满存储
            if (cacheName === API_CACHE) trimCache(cacheName, 150);
        }
        return safeResponse;
    } catch {
        const cached = stripRedirectMetadata(await caches.match(request));
        // 离线兜底返回合法 JSON，避免前端 res.json() 解析崩溃
        return cached || new Response(
            JSON.stringify({ offline: true, message: '当前无网络' }),
            { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
    }
}

// 限制缓存条目数：超过上限时按 FIFO 删除最旧的若干条
async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length <= maxItems) return;
        const removeCount = keys.length - maxItems;
        for (let i = 0; i < removeCount; i++) {
            await cache.delete(keys[i]);
        }
    } catch { /* 清理失败不影响主流程 */ }
}

// 策略：Stale While Revalidate（先返回缓存，后台更新）
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = stripRedirectMetadata(await cache.match(request));

    // 后台更新
    const fetchPromise = fetch(request, { redirect: 'follow' }).then(response => {
        if (response.type === 'opaqueredirect') throw new Error('Redirect response is not cacheable');
        const safeResponse = stripRedirectMetadata(response);
        if (safeResponse.ok) cache.put(request, safeResponse.clone());
        return safeResponse;
    }).catch(() => null);

    if (cached) return cached;
    return (await fetchPromise) || new Response('', { status: 504 });
}

// iOS Safari 不允许 Service Worker 返回带 redirected=true 的 Response。
// 这里用同一 body/status/headers 重新构造响应，去掉重定向元数据。
function stripRedirectMetadata(response) {
    if (!response) return null;
    if (!response?.redirected) return response;
    const headers = new Headers(response.headers);
    headers.delete('set-cookie');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

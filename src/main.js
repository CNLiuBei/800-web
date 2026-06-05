// 应用入口

import { defineRoute, init, transition } from './core/router.js';
import { initTheme } from './services/theme.js';
import { initI18n } from './services/i18n.js';
import { loadCSS } from './core/html.js';
import './components/app-shell.js';

const idle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout });
    else setTimeout(task, 0);
};

const routeModules = new Map();
const warmStyles = [
    'styles/base.css',
    'styles/nav.css',
    'styles/layout.css',
    'styles/poster.css',
    'styles/home.css',
    'styles/detail.css',
    'styles/account.css',
    'styles/vip.css',
];

const warmPages = [
    ['catalog', () => import('./pages/catalog.js')],
    ['detail', () => import('./pages/detail.js')],
    ['favorites', () => import('./pages/favorites.js')],
    ['history', () => import('./pages/history.js')],
    ['account', () => import('./pages/account.js')],
    ['vip', () => import('./pages/vip.js')],
    ['player', () => import('./pages/player.js')],
];

// 初始化
initTheme();
initI18n();
['styles/base.css', 'styles/nav.css', 'styles/layout.css', 'styles/poster.css', 'styles/home.css'].forEach(loadCSS);
idle(async () => {
    const [{ initPwaInstall }, { initNetworkStatus }] = await Promise.all([
        import('./services/pwa-install.js'),
        import('./services/network-status.js'),
    ]);
    initPwaInstall();
    initNetworkStatus();
});

// 清理 PWA 启动来源参数（manifest start_url 带 ?source=pwa），避免分享链接携带无关 query
if (location.search.includes('source=pwa')) {
    try {
        const clean = location.pathname + location.hash;
        history.replaceState(null, '', clean || '/');
    } catch {}
}

// 获取内容容器
const getApp = () => document.getElementById('app');

// 定义路由（具体路由在前，通配在后）
defineRoute('/', async () => {
    const { render } = await loadRouteModule('home', () => import('./pages/home.js'));
    return transition(() => render(getApp()));
});

defineRoute('detail/:type/:id', async (params) => {
    const { render } = await loadRouteModule('detail', () => import('./pages/detail.js'));
    // detail 自行控制过渡时机：先取数据再 transition 渲染，避免「加载中」中间态被 View Transition 捕获导致闪烁
    return render(getApp(), params);
});

defineRoute('play/:type/:id/:videoId?', async (params) => {
    const { render } = await loadRouteModule('player', () => import('./pages/player.js'));
    return render(getApp(), params);
});

defineRoute('favorites', async () => {
    const { render } = await loadRouteModule('favorites', () => import('./pages/favorites.js'));
    return transition(() => render(getApp()));
});

defineRoute('history', async () => {
    const { render } = await loadRouteModule('history', () => import('./pages/history.js'));
    return transition(() => render(getApp()));
});

defineRoute('account', async () => {
    const { render } = await loadRouteModule('account', () => import('./pages/account.js'));
    return transition(() => render(getApp()));
});

defineRoute('account/sessions', async () => {
    const { render } = await loadRouteModule('sessions', () => import('./pages/sessions.js'));
    return transition(() => render(getApp()));
});

defineRoute('vip', async () => {
    const { render } = await loadRouteModule('vip', () => import('./pages/vip.js'));
    return transition(() => render(getApp()));
});

// 分类页（通配 :category 放最后，避免匹配 favorites/history/vip）
defineRoute(':category', async (params) => {
    if (['movie', 'tv', 'anime'].includes(params.category)) {
        const { render } = await loadRouteModule('catalog', () => import('./pages/catalog.js'));
        return render(getApp(), params);
    } else {
        // 404
        const { render } = await loadRouteModule('notfound', () => import('./pages/notfound.js'));
        return transition(() => render(getApp()));
    }
});

// 启动路由
init();
initNavigationWarmup();
idle(warmRouteAssets, 900);

// Service Worker 救援：iOS Safari 曾因旧 SW 返回重定向响应导致整站打不开。
// Web 端先禁用离线 SW，启动后主动注销旧注册，确保所有页面回到浏览器原生网络加载。
if ('serviceWorker' in navigator) idle(() => {
    disableServiceWorkers().catch(() => {});
}, 2000);

async function disableServiceWorkers() {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) return;
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('gy-')).map((key) => caches.delete(key)));
    }
    if (navigator.serviceWorker.controller) location.reload();
}

function getRouteModule(key, loader) {
    if (!routeModules.has(key)) {
        routeModules.set(key, loader().catch((error) => {
            routeModules.delete(key);
            throw error;
        }));
    }
    return routeModules.get(key);
}

async function loadRouteModule(key, loader) {
    const modulePromise = getRouteModule(key, loader);
    let settled = false;
    const loadingTimer = setTimeout(() => {
        if (!settled) showRouteLoading();
    }, 120);
    try {
        return await modulePromise;
    } finally {
        settled = true;
        clearTimeout(loadingTimer);
    }
}

function showRouteLoading() {
    const app = getApp();
    if (!app || app.querySelector('.page-loading, .route-error, .detail-loading')) return;
    app.innerHTML = '<div class="page-loading"><div class="spinner-small"></div><span>加载中...</span></div>';
}

function warmRouteAssets() {
    warmStyles.forEach(loadCSS);
    for (const [key, loader] of warmPages) {
        idle(() => getRouteModule(key, loader).catch(() => {}), 1800);
    }
}

function initNavigationWarmup() {
    const warmFromEvent = (event) => {
        const link = event.target?.closest?.('a[href^="#/"]');
        if (!link) return;
        warmRouteForHash(link.getAttribute('href')).catch(() => {});
    };
    document.addEventListener('pointerover', warmFromEvent, { passive: true });
    document.addEventListener('pointerdown', warmFromEvent, { passive: true });
    document.addEventListener('focusin', warmFromEvent);
}

async function warmRouteForHash(href) {
    const path = href?.slice(1).split('?')[0] || '/';
    const [_, first, second] = path.split('/');
    if (!first) return getRouteModule('home', () => import('./pages/home.js'));
    if (first === 'detail') return getRouteModule('detail', () => import('./pages/detail.js'));
    if (first === 'play') return getRouteModule('player', () => import('./pages/player.js'));
    if (first === 'favorites') return getRouteModule('favorites', () => import('./pages/favorites.js'));
    if (first === 'history') return getRouteModule('history', () => import('./pages/history.js'));
    if (first === 'vip') return getRouteModule('vip', () => import('./pages/vip.js'));
    if (first === 'account' && second === 'sessions') return getRouteModule('sessions', () => import('./pages/sessions.js'));
    if (first === 'account') return getRouteModule('account', () => import('./pages/account.js'));
    if (['movie', 'tv', 'anime'].includes(first)) return getRouteModule('catalog', () => import('./pages/catalog.js'));
    return getRouteModule('notfound', () => import('./pages/notfound.js'));
}

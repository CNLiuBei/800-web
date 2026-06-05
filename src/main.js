// 应用入口

import { defineRoute, init, transition } from './core/router.js';
import { initTheme } from './services/theme.js?v=35';
import { initI18n } from './services/i18n.js';
import { loadCSS } from './core/html.js';
import './components/app-shell.js';

const idle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout });
    else setTimeout(task, 0);
};

const defer = (task, delay = 0) => setTimeout(task, delay);

// 初始化
initTheme();
initI18n();
defer(() => {
    ['styles/base.css', 'styles/nav.css', 'styles/layout.css', 'styles/poster.css'].forEach(loadCSS);
}, 400);
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
    const { render } = await import('./pages/home.js?v=33');
    return transition(() => render(getApp()));
});

defineRoute('detail/:type/:id', async (params) => {
    const { render } = await import('./pages/detail.js');
    // detail 自行控制过渡时机：先取数据再 transition 渲染，避免「加载中」中间态被 View Transition 捕获导致闪烁
    return render(getApp(), params);
});

defineRoute('play/:type/:id/:videoId?', async (params) => {
    const { render } = await import('./pages/player.js');
    return render(getApp(), params);
});

defineRoute('favorites', async () => {
    const { render } = await import('./pages/favorites.js');
    return transition(() => render(getApp()));
});

defineRoute('history', async () => {
    const { render } = await import('./pages/history.js');
    return transition(() => render(getApp()));
});

defineRoute('account', async () => {
    const { render } = await import('./pages/account.js');
    return transition(() => render(getApp()));
});

defineRoute('account/sessions', async () => {
    const { render } = await import('./pages/sessions.js');
    return transition(() => render(getApp()));
});

defineRoute('vip', async () => {
    const { render } = await import('./pages/vip.js');
    return transition(() => render(getApp()));
});

// 分类页（通配 :category 放最后，避免匹配 favorites/history/vip）
defineRoute(':category', async (params) => {
    if (['movie', 'tv', 'anime'].includes(params.category)) {
        const { render } = await import('./pages/catalog.js');
        return render(getApp(), params);
    } else {
        // 404
        const { render } = await import('./pages/notfound.js');
        return transition(() => render(getApp()));
    }
});

// 启动路由
init();

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

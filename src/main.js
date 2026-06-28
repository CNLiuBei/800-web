// 应用入口

import { defineRoute, init, route, transition } from './core/router.js';
import { initTheme } from './services/theme.js';
import { initI18n } from './services/i18n.js';
import { initAuth } from './services/auth.js';
import { initSpatialNavigation } from './services/spatial-navigation.js';
import { initCommunityGrowthTracking } from './services/community-growth.js';
import { loadCSS } from './core/html.js';
import { resetPageMeta } from './core/head.js';
import { prefetchPlayerAssets } from './services/player-module.js';
import { WEB_STATIC_VERSION } from './services/config.js';
import { showSiteNotice } from './services/site-notice.js';
import './components/app-shell.js';
import '@gy/library';

const accountPageModule = () => import(`./pages/account.js?v=${WEB_STATIC_VERSION}`);
const sessionsPageModule = () => import(`./pages/sessions.js?v=${WEB_STATIC_VERSION}`);

const idle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout });
    else setTimeout(task, 0);
};

const PLAYER_PAGE_MODULE = `./pages/player.js?v=${WEB_STATIC_VERSION}`;
const homePageLoader = () => import('./pages/home.js');
const routeModules = new Map();
// idle 预热：仅高频轻量路由；account/player 等大 chunk 靠 hover 预热（warmRouteForHash）
const idleWarmStyles = [
    'styles/layout.css',
    'styles/home.css',
];

const idleWarmPages = [
    ['catalog', () => import('./pages/catalog.js')],
    ['search', () => import('./pages/search.js')],
    ['detail', () => import('./pages/detail.js')],
];

// 初始化
initTheme();
initI18n();
initAuth().catch(() => {});
initSpatialNavigation();
initCommunityGrowthTracking();
['styles/base.css', 'styles/nav.css', 'styles/layout.css', 'styles/poster.css', 'styles/home.css', 'styles/site-notice.css'].forEach(loadCSS);
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

/** 首屏占位：避免 route spinner 与 home skeleton 连续闪两次「加载中」 */
function showHomeBootSkeleton() {
    const app = getApp();
    if (!app || app.querySelector('.home-hero, .page-loading, .route-error')) return;
    app.innerHTML = `
        <div class="home-hero hero-loading" id="home-hero" aria-hidden="true"></div>
        <section class="catalog-section" aria-hidden="true">
            <div class="poster-grid poster-row" style="display:flex;flex-wrap:nowrap;overflow:hidden;padding:1rem 1.5rem;gap:.6rem">
                ${'<div class="poster-item" style="flex:0 0 auto;width:calc(100%/6 - .9rem)"><div class="poster-img-wrap skeleton"></div></div>'.repeat(8)}
            </div>
        </section>
    `;
}

// 定义路由（具体路由在前，通配在后）
defineRoute('/', async () => {
    showHomeBootSkeleton();
    const { render } = await loadRouteModule('home', homePageLoader, { showLoading: false });
    return transition(() => render(getApp()));
});

defineRoute('detail/:type/:id', async (params) => {
    const { render } = await loadRouteModule('detail', () => import('./pages/detail.js'));
    // detail 自行控制过渡时机：先取数据再 transition 渲染，避免「加载中」中间态被 View Transition 捕获导致闪烁
    return render(getApp(), params);
});

defineRoute('play/:type/:id/:videoId?', async (params) => {
    const { render } = await loadRouteModule('player', () => import(PLAYER_PAGE_MODULE));
    return render(getApp(), params);
});

defineRoute('favorites', async () => {
    const { render } = await loadRouteModule('favorites', () => import('./pages/favorites.js'));
    return transition(() => render(getApp()));
});

defineRoute('watch-later', async () => {
    const { render } = await loadRouteModule('watch-later', () => import('./pages/watch-later.js'));
    return transition(() => render(getApp()));
});

defineRoute('subscriptions', async () => {
    const { render } = await loadRouteModule('subscriptions', () => import('./pages/subscriptions.js'));
    return transition(() => render(getApp()));
});

defineRoute('search', async (params) => {
    const { render } = await loadRouteModule('search', () => import('./pages/search.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('rankings', async (params) => {
    const { render } = await loadRouteModule('rankings', () => import('./pages/rankings.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('shorts', async () => {
    const { render } = await loadRouteModule('shorts', () => import('./pages/shorts.js'));
    return transition(() => render(getApp()));
});

defineRoute('live', async (params) => {
    const { render } = await loadRouteModule('live', () => import('./pages/live.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('live/:id', async (params) => {
    const { render } = await loadRouteModule('live-detail', () => import('./pages/live-detail.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('history', async () => {
    const { render } = await loadRouteModule('history', () => import('./pages/history.js'));
    return transition(() => render(getApp()));
});

defineRoute('account-demo', async () => {
    const { render } = await loadRouteModule('account-shell-demo', () => import('./pages/account-shell-demo.js'));
    return transition(() => render(getApp()));
});

defineRoute('account', async () => {
    const { render } = await loadRouteModule('account', accountPageModule);
    return transition(() => render(getApp()));
});

defineRoute('account/sessions', async () => {
    const { render } = await loadRouteModule('sessions', sessionsPageModule);
    return transition(() => render(getApp()));
});

defineRoute('reset-password', async (params) => {
    const { render } = await loadRouteModule('reset-password', () => import('./pages/reset-password.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('creator/:handle', async (params) => {
    const { render } = await loadRouteModule('creator-channel', () => import('./pages/creator-channel.js'));
    return transition(() => render(getApp(), params));
});

defineRoute('vip', async () => {
    const { render } = await loadRouteModule('vip', () => import('./pages/vip.js'));
    return transition(() => render(getApp()));
});

defineRoute('requests', async (params) => {
    const { render } = await loadRouteModule('requests', () => import('./pages/requests.js'));
    return transition(() => render(getApp(), params));
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
route.subscribe(resetPageMeta);
resetPageMeta();
// 默认首页 chunk 与路由初始化并行拉取，缩短首屏空白
getRouteModule('home', homePageLoader).catch(() => {});
init();
initNavigationWarmup();
idle(warmRouteAssets, 900);
if (window.matchMedia?.('(max-width: 980px)').matches) {
    idle(() => getRouteModule('account', accountPageModule).catch(() => {}), 600);
}

// PWA 离线壳：注册保守版 Service Worker，仅缓存应用壳与 GET API 响应。
// SW 内会重建导航响应，避免 iOS Safari 旧版 redirected Response 问题复发。
let refreshingForUpdate = false;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshingForUpdate) return;
        window.location.reload();
    });
}

if ('serviceWorker' in navigator) idle(() => {
    registerServiceWorker().catch(() => {});
}, 2000);

async function registerServiceWorker() {
    const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    registration.update().catch(() => {});
    if (registration.waiting && navigator.serviceWorker.controller) {
        refreshingForUpdate = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                refreshingForUpdate = true;
                registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            }
        });
    });
}

function showUpdateBanner(registration) {
    if (location.hash.startsWith('#/play/')) {
        window.addEventListener('hashchange', () => showUpdateBanner(registration), { once: true });
        return;
    }
    showSiteNotice('', {
        id: 'app-update',
        persistent: true,
        tone: 'info',
        title: '新版本已准备好',
        subtitle: '刷新后即可使用最新功能与修复',
        actions: [
            {
                key: 'reload',
                label: '刷新更新',
                primary: true,
                keepOpen: true,
                onClick: () => {
                    refreshingForUpdate = true;
                    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
                    setTimeout(() => window.location.reload(), 1800);
                },
            },
            {
                key: 'later',
                label: '稍后',
                dismiss: true,
            },
        ],
    });
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

async function loadRouteModule(key, loader, { showLoading = true } = {}) {
    const modulePromise = getRouteModule(key, loader);
    let settled = false;
    let loadingTimer = null;
    if (showLoading) {
        loadingTimer = setTimeout(() => {
            if (!settled) showRouteLoading();
        }, 120);
    }
    try {
        return await modulePromise;
    } finally {
        settled = true;
        if (loadingTimer) clearTimeout(loadingTimer);
    }
}

function showRouteLoading() {
    const app = getApp();
    if (!app || app.querySelector('.page-loading, .route-error, .detail-loading')) return;
    app.innerHTML = '<div class="page-loading"><div class="spinner-small"></div><span>加载中...</span></div>';
}

function warmRouteAssets() {
    idleWarmStyles.forEach(loadCSS);
    for (const [key, loader] of idleWarmPages) {
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
    if (!first) return getRouteModule('home', homePageLoader);
    if (first === 'detail') {
        prefetchPlayerAssets().catch(() => {});
        return getRouteModule('detail', () => import('./pages/detail.js'));
    }
    if (first === 'play') {
        prefetchPlayerAssets().catch(() => {});
        return getRouteModule('player', () => import(PLAYER_PAGE_MODULE));
    }
    if (first === 'favorites') return getRouteModule('favorites', () => import('./pages/favorites.js'));
    if (first === 'watch-later') return getRouteModule('watch-later', () => import('./pages/watch-later.js'));
    if (first === 'subscriptions') return getRouteModule('subscriptions', () => import('./pages/subscriptions.js'));
    if (first === 'rankings') return getRouteModule('rankings', () => import('./pages/rankings.js'));
    if (first === 'shorts') return getRouteModule('shorts', () => import('./pages/shorts.js'));
    if (first === 'live' && second) return getRouteModule('live-detail', () => import('./pages/live-detail.js'));
    if (first === 'live') return getRouteModule('live', () => import('./pages/live.js'));
    if (first === 'history') return getRouteModule('history', () => import('./pages/history.js'));
    if (first === 'vip') return getRouteModule('vip', () => import('./pages/vip.js'));
    if (first === 'requests') return getRouteModule('requests', () => import('./pages/requests.js'));
    if (first === 'account' && second === 'sessions') return getRouteModule('sessions', sessionsPageModule);
    if (first === 'account-demo') return loadRouteModule('account-shell-demo', () => import('./pages/account-shell-demo.js'));
    if (first === 'account') return getRouteModule('account', accountPageModule);
    if (['movie', 'tv', 'anime'].includes(first)) return getRouteModule('catalog', () => import('./pages/catalog.js'));
    return getRouteModule('notfound', () => import('./pages/notfound.js'));
}

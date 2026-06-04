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

// 注册 Service Worker + 更新提示
// 仅在「页面已被某个 SW 控制（即非首次安装），且检测到新 SW 装好进入 waiting」时
// 才提示更新，避免首次访问 / 首次安装时误报“新版本可用”。
if ('serviceWorker' in navigator) idle(() => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        // 新 SW 被发现 → 监听其状态，装好且页面已被旧 SW 控制时才提示
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                // installed + 已有 controller = 存在旧版本，属于真正的更新
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateBanner(newWorker);
                }
            });
        });
    }).catch(() => {});

    // 新 SW 接管控制权后自动刷新一次，加载最新资源
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
    });
}, 2000);

function showUpdateBanner(worker) {
    if (document.getElementById('update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.innerHTML = `
        <span>新版本可用</span>
        <button type="button" data-act="refresh">刷新</button>
        <button type="button" data-act="dismiss">忽略</button>
    `;
    // 刷新：让等待中的新 SW 立即接管，controllerchange 会触发自动 reload
    banner.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        worker?.postMessage({ type: 'SKIP_WAITING' });
        // 兜底：若没有 worker 引用或消息未生效，直接刷新
        if (!worker) location.reload();
    });
    banner.querySelector('[data-act="dismiss"]').addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
}

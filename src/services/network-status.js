// 网络状态提示：断网时显示横幅，恢复时自动消失
// 仅做轻量提示，不拦截操作（缓存数据仍可浏览）

let bannerEl = null;

function showOfflineBanner() {
    if (bannerEl) return;
    bannerEl = document.createElement('div');
    bannerEl.id = 'offline-banner';
    bannerEl.className = 'offline-banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>
        <span>网络已断开，部分内容可能无法加载</span>
    `;
    document.body.appendChild(bannerEl);
}

function hideOfflineBanner() {
    bannerEl?.remove();
    bannerEl = null;
}

// 网络恢复后，若当前停留在路由错误页/空状态，自动重试当前路由
async function retryIfErrorPage() {
    const app = document.getElementById('app');
    if (!app) return;
    if (app.querySelector('.route-error') || app.querySelector('.page-error')) {
        try {
            const { reloadRoute } = await import('../core/router.js');
            reloadRoute();
        } catch {}
    }
}

export function initNetworkStatus() {
    window.addEventListener('offline', showOfflineBanner);
    window.addEventListener('online', () => {
        hideOfflineBanner();
        retryIfErrorPage();
    });
    // 初始即离线则立即提示
    if (navigator.onLine === false) showOfflineBanner();
}

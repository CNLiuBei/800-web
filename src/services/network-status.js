// 网络状态提示：断网时说明可用能力，恢复后自动重试错误页

import { dismissSiteNotice, showSiteNotice } from './site-notice.js';

const OFFLINE_NOTICE_ID = 'network-offline';
let initialized = false;
let dismissedWhileOffline = false;

function showOfflineBanner() {
    if (dismissedWhileOffline) return;
    showSiteNotice('', {
        id: OFFLINE_NOTICE_ID,
        tone: 'offline',
        persistent: true,
        dismissible: true,
        title: '网络已断开',
        subtitle: '可继续浏览已缓存内容；播放、搜索和会员订单可能无法刷新。',
        onDismiss: () => {
            dismissedWhileOffline = true;
        },
        actions: [
            {
                key: 'retry',
                label: '重试当前页',
                primary: true,
                keepOpen: true,
                onClick: () => retryCurrentRoute(),
            },
            {
                key: 'dismiss',
                label: '收起',
                dismiss: true,
                onClick: () => {
                    dismissedWhileOffline = true;
                },
            },
        ],
    });
}

function hideOfflineBanner() {
    dismissSiteNotice(OFFLINE_NOTICE_ID);
}

function showOnlineToast() {
    dismissedWhileOffline = false;
    hideOfflineBanner();
    showSiteNotice('', {
        id: 'network-online',
        tone: 'online',
        duration: 2600,
        title: '网络已恢复',
        subtitle: '正在同步当前页面内容',
    });
}

async function retryCurrentRoute() {
    try {
        const { reloadRoute } = await import('../core/router.js');
        reloadRoute();
    } catch {}
}

// 网络恢复后，若当前停留在路由错误页/页面错误状态，自动重试当前路由
async function retryIfErrorPage() {
    const app = document.getElementById('app');
    if (!app) return;
    if (app.querySelector('.route-error') || app.querySelector('.page-error')) {
        await retryCurrentRoute();
    }
}

export function initNetworkStatus() {
    if (initialized) {
        if (navigator.onLine === false) showOfflineBanner();
        return;
    }
    initialized = true;
    window.addEventListener('online', async () => {
        showOnlineToast();
        await retryIfErrorPage();
    });
    window.addEventListener('offline', () => showOfflineBanner());
    if (navigator.onLine === false) showOfflineBanner();
}

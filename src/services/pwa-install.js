// 添加到主屏幕（PWA 安装）引导
//
// 两条路径：
//   - Android / 桌面 Chrome 等：监听 beforeinstallprompt，拦截默认提示，
//     在合适时机用自定义横幅触发原生安装弹窗（deferredPrompt.prompt()）。
//   - iOS Safari：不支持编程式安装，只能引导用户「分享 → 添加到主屏幕」，
//     用一次性图文提示横幅说明操作。
//
// 抑制策略：已安装（standalone）不提示；用户关闭后一段时间内不再打扰。

const DISMISS_KEY = 'gy_pwa_install_dismissed_at';
const DISMISS_DAYS = 14; // 关闭后多少天内不再提示
const SHOW_DELAY = 4000; // 进入站点多久后再提示，避免打断首屏

let deferredPrompt = null;

// 是否已以独立应用方式运行（已添加到主屏并从主屏打开）
function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true; // iOS Safari
}

function isIOS() {
    const ua = navigator.userAgent || '';
    const iOSDevice = /iphone|ipad|ipod/i.test(ua);
    // iPadOS 13+ 伪装成 Mac，用触摸点数辅助判断
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOS;
}

function isSafari() {
    const ua = navigator.userAgent || '';
    return /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
}

function recentlyDismissed() {
    try {
        const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (!ts) return false;
        return Date.now() - ts < DISMISS_DAYS * 86400000;
    } catch { return false; }
}

function markDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
}

// ===== 供页面主动调用的辅助 API =====

// 是否已作为独立应用运行（已添加到主屏）
export function isInstalled() {
    return isStandalone();
}

// 当前环境是否支持/需要展示「添加到主屏」入口
export function canShowInstallEntry() {
    if (isStandalone()) return false;
    // Android/桌面有 deferredPrompt，或 iOS Safari（手动引导）
    return !!deferredPrompt || (isIOS() && isSafari());
}

// 主动触发安装：Android 直接调原生弹窗；iOS 返回 'ios' 让调用方显示引导
export async function triggerInstall() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        let outcome = 'dismissed';
        try { const r = await deferredPrompt.userChoice; outcome = r.outcome; } catch {}
        deferredPrompt = null;
        return outcome === 'accepted' ? 'installed' : 'dismissed';
    }
    if (isIOS() && isSafari()) return 'ios';
    return 'unsupported';
}

export function initPwaInstall() {
    // 标记 standalone 运行态，供 CSS 做原生化交互（iOS Safari 媒体查询支持不全，用此兜底）
    if (isStandalone()) {
        document.body.classList.add('pwa-standalone');
        return; // 已安装，不再引导
    }

    // Android / Chrome 等：捕获并延迟原生安装提示
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (!recentlyDismissed()) {
            setTimeout(() => showInstallBanner('android'), SHOW_DELAY);
        }
    });

    // 安装完成后清理
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        removeBanner();
        markDismissed();
    });

    // iOS Safari：无 beforeinstallprompt，符合条件则显示引导
    if (isIOS() && isSafari() && !recentlyDismissed()) {
        setTimeout(() => showInstallBanner('ios'), SHOW_DELAY);
    }
}

function removeBanner() {
    document.getElementById('pwa-install-banner')?.remove();
}

function showInstallBanner(platform) {
    if (isStandalone()) return;
    if (document.getElementById('pwa-install-banner')) return;
    // 更新提示优先：避免两个底部横幅重叠
    if (document.getElementById('update-banner')) return;
    // 播放页（全屏播放器）不打断观影
    if (location.hash.startsWith('#/play/')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', '添加到主屏幕');

    if (platform === 'ios') {
        banner.innerHTML = `
            <div class="pwa-install-body">
                <img class="pwa-install-icon" src="/icons/apple-touch-icon.png" alt="800影视" width="44" height="44">
                <div class="pwa-install-text">
                    <div class="pwa-install-title">添加到主屏幕</div>
                    <div class="pwa-install-desc">点击底部 <span class="pwa-ios-share" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>
                    </span> 分享，选择「添加到主屏幕」</div>
                </div>
            </div>
            <button class="pwa-install-close" aria-label="关闭">&times;</button>
        `;
    } else {
        banner.innerHTML = `
            <div class="pwa-install-body">
                <img class="pwa-install-icon" src="/icons/icon-192.png" alt="800影视" width="44" height="44">
                <div class="pwa-install-text">
                    <div class="pwa-install-title">安装 800影视</div>
                    <div class="pwa-install-desc">添加到主屏，全屏沉浸观影，秒开免打扰</div>
                </div>
            </div>
            <div class="pwa-install-actions">
                <button class="pwa-install-btn" id="pwa-install-do">安装</button>
                <button class="pwa-install-close" aria-label="关闭">&times;</button>
            </div>
        `;
    }

    document.body.appendChild(banner);

    banner.querySelector('.pwa-install-close')?.addEventListener('click', () => {
        markDismissed();
        removeBanner();
    });

    if (platform === 'android') {
        banner.querySelector('#pwa-install-do')?.addEventListener('click', async () => {
            if (!deferredPrompt) { removeBanner(); return; }
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch {}
            deferredPrompt = null;
            removeBanner();
            markDismissed();
        });
    }
}

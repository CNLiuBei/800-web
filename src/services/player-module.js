// 按需加载 gy-player — 仅从 CDN manifest 解析最新版本 URL。
//
// 版本控制：
//   - 播放器发布时上传带内容哈希的文件（永久强缓存）
//   - manifest.json（no-cache）指向最新哈希 URL
//   - Web fetch manifest 后动态 import；失败时降级到 CDN 固定路径

import { MEDIA_CDN_ORIGIN, MEDIA_CDN_BASE, SHAKA_PLAYER_URL, getPlayerModuleUrl } from './config.js';

const MANIFEST_KEY = 'static/player/manifest.json';

let playerModulePromise = null;
let playerModuleUrl = '';
let prefetchPromise = null;

/** 从 CDN manifest.json 获取最新播放器 URL，失败时回退到 config 固定 CDN 路径 */
async function fetchLatestPlayerUrl() {
    const manifestUrl = `${MEDIA_CDN_BASE}/${MANIFEST_KEY}`;
    try {
        const res = await fetch(manifestUrl, {
            cache: 'no-store',
            credentials: 'omit',
            signal: AbortSignal.timeout?.(5000),
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.url && typeof data.url === 'string') {
                return data.url;
            }
        }
    } catch {
        // 网络失败时静默降级
    }
    return getPlayerModuleUrl();
}

function primePlayerVendors() {
    if (SHAKA_PLAYER_URL) {
        window.GYP_SHAKA_URL = SHAKA_PLAYER_URL;
        window.GYP_HLS_URL = SHAKA_PLAYER_URL;
    }
}

function ensureCdnPreconnect() {
    if (!MEDIA_CDN_ORIGIN || document.querySelector(`link[data-gy-cdn-preconnect="true"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = MEDIA_CDN_ORIGIN;
    link.crossOrigin = '';
    link.dataset.gyCdnPreconnect = 'true';
    document.head.appendChild(link);
}

function preloadModule(url) {
    if (!url) return;
    const selector = `link[data-gy-preload="module"][href="${cssEscape(url)}"]`;
    if (document.head.querySelector(selector)) return;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = url;
    link.crossOrigin = 'anonymous';
    link.dataset.gyPreload = 'module';
    document.head.appendChild(link);
}

function preloadScript(url) {
    if (!url) return;
    const selector = `link[data-gy-preload="script"][href="${cssEscape(url)}"]`;
    if (document.head.querySelector(selector)) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = url;
    link.dataset.gyPreload = 'script';
    document.head.appendChild(link);
}

function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
}

/**
 * 详情页/播放页预热：提前建连并预加载 CDN 播放器与 Shaka Player。
 */
export function prefetchPlayerAssets() {
    if (prefetchPromise) return prefetchPromise;
    prefetchPromise = fetchLatestPlayerUrl().then((url) => {
        playerModuleUrl = url;
        primePlayerVendors();
        ensureCdnPreconnect();
        preloadScript(SHAKA_PLAYER_URL);
        preloadModule(url);
    }).catch(() => {});
    return prefetchPromise;
}

/**
 * 加载 gy-player 模块（CDN 单例）。
 * 首次调用 fetch manifest 获取最新 URL，后续复用同一 Promise。
 */
export function loadPlayerModule() {
    if (playerModulePromise) return playerModulePromise;
    primePlayerVendors();
    playerModulePromise = prefetchPlayerAssets()
        .then(() => {
            const url = playerModuleUrl || getPlayerModuleUrl();
            return import(/* @vite-ignore */ url);
        });
    return playerModulePromise;
}

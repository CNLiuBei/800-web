// 后端地址统一配置。
//
// 默认同源部署：所有请求走当前域名下的 /api，换域名不需要改代码。
// 跨域联调或前后端分域部署时，可在 index.html 注入：
//   window.GY_CONFIG = { apiOrigin: 'https://api.example.com' }
// 或在本地浏览器设置 localStorage.gy_api_origin。

const runtimeConfig = typeof window !== 'undefined' ? (window.GY_CONFIG || {}) : {};

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function configuredApiOrigin() {
    // 本地开发始终走同源 /api（由 dev-server 代理），避免模块缓存旧 gy_api_origin
    if (isLocalDevHost()) return '';
    const fromRuntime = runtimeConfig.apiOrigin || runtimeConfig.apiBaseUrl || '';
    const fromStorage = (() => {
        try { return localStorage.getItem('gy_api_origin') || ''; } catch { return ''; }
    })();
    return trimTrailingSlash(fromRuntime || fromStorage);
}

function configuredMediaCdn() {
    const fromRuntime = runtimeConfig.mediaCdn || runtimeConfig.r2Cdn || '';
    const fromStorage = (() => {
        try { return localStorage.getItem('gy_media_cdn') || ''; } catch { return ''; }
    })();
    return trimTrailingSlash(fromRuntime || fromStorage || 'https://cdn.guangying.org');
}

/** 模板字符串/拼接时惰性求值，避免 ES 模块缓存旧 API 域名。 */
export function lazyApiString(resolve) {
    const value = () => String(resolve());
    return {
        toString: value,
        valueOf: value,
        [Symbol.toPrimitive]: () => value(),
        replace: (...args) => value().replace(...args),
        startsWith: (...args) => value().startsWith(...args),
        endsWith: (...args) => value().endsWith(...args),
        slice: (...args) => value().slice(...args),
    };
}

function apiV1Base() {
    const origin = configuredApiOrigin();
    return origin ? `${origin}/api/v1` : '/api/v1';
}

function apiBase() {
    const origin = configuredApiOrigin();
    return origin ? `${origin}/api` : '/api';
}

function r2Base() {
    const origin = configuredApiOrigin();
    return origin ? `${origin}/api/r2` : '/api/r2';
}

function tmdbImageBase() {
    const origin = configuredApiOrigin();
    return origin ? `${origin}/api/t/p` : '/api/t/p';
}

export const MEDIA_CDN_BASE = configuredMediaCdn();
export const MEDIA_CDN_ORIGIN = (() => {
    try {
        return new URL(MEDIA_CDN_BASE).origin;
    } catch {
        return 'https://cdn.guangying.org';
    }
})();

/** 发版时 bump 版本；Web 静态资源与 Worker 同源部署（不经 R2）。 */
export const WEB_STATIC_VERSION = (() => {
    if (typeof window !== 'undefined' && window.GY_WEB_STATIC_VERSION) {
        return String(window.GY_WEB_STATIC_VERSION);
    }
    return String(runtimeConfig.webStaticVersion || '1');
})();

function isLocalDevHost() {
    return typeof window !== 'undefined'
        && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
}

export function webStaticUrl(path) {
    const clean = String(path || '').replace(/^\/+/, '');
    if (!clean) return '/';
    return `/${clean}?v=${WEB_STATIC_VERSION}`;
}

/** 播放器默认水印 logo：影片自身缺少 logo 时回退到应用品牌 logo（同源静态资源）。 */
export const DEFAULT_APP_LOGO_URL = webStaticUrl('icons/logo.svg');

/** 播放器 R2 路径。manifest.json 会指向带内容哈希的精确版本 URL。 */
export const PLAYER_R2_KEY = 'static/player/gy-player.js';

/** manifest fetch 失败时的 CDN 降级 URL。 */
export function getPlayerModuleUrl() {
    return `${MEDIA_CDN_BASE}/${PLAYER_R2_KEY}`;
}

/** @deprecated 使用 getPlayerModuleUrl() */
export const PLAYER_MODULE_URL = getPlayerModuleUrl();

/** 与 gy-player 内置 Shaka Player 版本保持一致。 */
export const SHAKA_PLAYER_VERSION = '4.16.37';
export const SHAKA_PLAYER_R2_KEY = 'static/vendor/shaka-player.compiled.js';

/** Shaka Player CDN URL（gy-player 按需加载时使用）。 */
export const SHAKA_PLAYER_URL = `${MEDIA_CDN_BASE}/${SHAKA_PLAYER_R2_KEY}?v=${SHAKA_PLAYER_VERSION}`;

/** @deprecated 使用 SHAKA_PLAYER_URL */
export const HLS_JS_URL = SHAKA_PLAYER_URL;

export const API_V1_BASE = lazyApiString(apiV1Base);
export const API_BASE = lazyApiString(apiBase);
export const R2_BASE = lazyApiString(r2Base);
/** TMDB 兼容层挂载在 /api/v1/3（非根路径 /3） */
export const TMDB_BASE = API_V1_BASE;
/** Worker /api/t/p 代理（CDN 冷数据回退、回源 TMDB 写入 R2） */
export const TMDB_IMAGE_BASE = lazyApiString(tmdbImageBase);

// 二维码渲染服务。默认同源 /api/v1/qr；也可在 index.html 注入 GY_CONFIG.qrImageBase 覆盖。
function configuredQrImageBase() {
    const fromRuntime = runtimeConfig.qrImageBase || runtimeConfig.qrCodeImageBase || '';
    const fromStorage = (() => {
        try { return localStorage.getItem('gy_qr_image_base') || ''; } catch { return ''; }
    })();
    const configured = String(fromRuntime || fromStorage || '').trim();
    if (configured) return configured;
    return `${apiV1Base()}/qr?data=`;
}

export const QR_IMAGE_BASE = configuredQrImageBase();

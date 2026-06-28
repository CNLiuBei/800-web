// TMDB / R2 海报 URL：优先 CDN（tmdb/t/p），冷数据回退 Worker /t/p 拉取并写入 R2。

import { MEDIA_CDN_BASE, TMDB_IMAGE_BASE } from './config.js';

export const TMDB_IMAGE_SIZES = new Set([
    'w45', 'w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'w1280', 'h632', 'original',
]);

const TMDB_IMAGE_CDN_BASE = `${MEDIA_CDN_BASE}/tmdb/t/p`;

/** 从各类存储值提取 TMDB file_path（如 /abc.jpg）或 null */
export function tmdbFilePathFromValue(value) {
    if (!value || typeof value !== 'string') return null;
    let path = value.trim();
    if (!path) return null;

    if (/^https?:\/\//i.test(path)) {
        try {
            const url = new URL(path);
            if (url.hostname === 'image.tmdb.org') {
                const match = url.pathname.match(/\/t\/p\/[^/]+(\/[^?#]+)/);
                return match?.[1] || null;
            }
            const cdnMatch = url.pathname.match(/\/tmdb\/t\/p\/[^/]+(\/[^?#]+)/);
            if (cdnMatch) return cdnMatch[1];
            const workerMatch = url.pathname.match(/\/t\/p\/[^/]+(\/[^?#]+)/);
            if (workerMatch) return workerMatch[1];
        } catch {
            return null;
        }
        return null;
    }

    if (path.startsWith('/api/r2/tmdb/t/p/')) {
        path = path.slice('/api/r2/tmdb/t/p/'.length);
    } else if (path.startsWith('/r2/tmdb/t/p/')) {
        path = path.slice('/r2/tmdb/t/p/'.length);
    } else if (path.startsWith('tmdb/t/p/')) {
        path = path.slice('tmdb/t/p/'.length);
    } else if (path.startsWith('/api/r2/images/') || path.startsWith('/r2/images/') || path.startsWith('images/')) {
        return null;
    } else if (path.startsWith('/api/r2/') || path.startsWith('/r2/')) {
        const key = path.replace(/^\/(?:api\/)?r2\//, '');
        if (key.startsWith('tmdb/t/p/')) {
            path = key.slice('tmdb/t/p/'.length);
        } else {
            return null;
        }
    }

    const sized = path.match(/^([^/]+)(\/.*)$/);
    if (sized && TMDB_IMAGE_SIZES.has(sized[1])) {
        return sized[2].startsWith('/') ? sized[2] : `/${sized[2]}`;
    }
    if (path.startsWith('/')) return path;
    return `/${path}`;
}

function sizedPath(filePath, size = 'w500') {
    const proxySize = TMDB_IMAGE_SIZES.has(size) ? size : 'w500';
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return `/${proxySize}${normalized}`;
}

/** CDN 直连：cdn.guangying.org/tmdb/t/p/{size}/file.jpg */
export function tmdbCdnImageUrl(value, size = 'w500') {
    const filePath = tmdbFilePathFromValue(value);
    if (!filePath) return '';
    return `${TMDB_IMAGE_CDN_BASE}${sizedPath(filePath, size)}`;
}

/** Worker 回退：guangying.org/t/p/{size}/file.jpg（R2 未命中时回源 TMDB） */
export function tmdbWorkerImageUrl(value, size = 'w500') {
    const filePath = tmdbFilePathFromValue(value);
    if (!filePath) return '';
    return `${TMDB_IMAGE_BASE}${sizedPath(filePath, size)}`;
}

/** 页面展示用：默认 CDN */
export function normalizeTmdbImageUrl(value, size = 'w500') {
    if (!value || typeof value !== 'string') return '';
    if (value.startsWith('data:')) return value;
    if (/^https?:\/\//i.test(value)) {
        if (/image\.tmdb\.org/i.test(value)) return tmdbCdnImageUrl(value, size);
        if (value.includes('/tmdb/t/p/') || value.includes('/t/p/')) {
            return tmdbCdnImageUrl(value, size) || value;
        }
        return value;
    }
    return tmdbCdnImageUrl(value, size);
}

/** CDN 404 时换 Worker 同源地址（仅用于预热，不直接作为 img.src） */
export function tmdbImageWorkerFallback(cdnUrl) {
    if (!cdnUrl || typeof cdnUrl !== 'string') return '';
    const marker = '/tmdb/t/p/';
    const idx = cdnUrl.indexOf(marker);
    if (idx < 0) return '';
    return `${TMDB_IMAGE_BASE}/${cdnUrl.slice(idx + marker.length)}`;
}

function primaryTmdbCdnSrc(img) {
    const stored = img?.dataset?.cdnSrc;
    if (stored) return stored;
    const raw = img?.src || img?.getAttribute?.('src') || '';
    if (!raw || raw.startsWith('data:')) return '';
    if (raw.includes('/tmdb/t/p/')) return raw;
    if (raw.includes('/t/p/')) return tmdbCdnImageUrl(raw) || '';
    return tmdbCdnImageUrl(raw) || '';
}

/** 绑定 img：CDN 冷数据 404 时用 Worker 预热 R2，仍从 CDN 加载 */
export function bindTmdbImageFallback(img, onFinalError) {
    if (!img || img.dataset.gyTmdbFallbackBound) return;
    img.dataset.gyTmdbFallbackBound = '1';

    const cdn = primaryTmdbCdnSrc(img);
    if (cdn) {
        img.dataset.cdnSrc = cdn;
        if (img.src !== cdn && (img.src.includes('/api/t/p/') || img.src.includes('/t/p/'))) {
            img.src = cdn;
        }
    }

    img.addEventListener('error', async () => {
        const cdnUrl = img.dataset.cdnSrc || primaryTmdbCdnSrc(img);
        if (!cdnUrl) {
            onFinalError?.(img);
            return;
        }
        img.dataset.cdnSrc = cdnUrl;

        const phase = Number(img.dataset.gyTmdbFallbackPhase || '0');
        if (phase >= 2) {
            onFinalError?.(img);
            return;
        }

        if (phase === 0) {
            img.dataset.gyTmdbFallbackPhase = '1';
            const worker = tmdbImageWorkerFallback(cdnUrl);
            if (worker) {
                try {
                    const resp = await fetch(worker, { credentials: 'omit', redirect: 'follow' });
                    if (resp.ok) {
                        img.src = cdnUrl;
                        return;
                    }
                } catch { /* 预热失败，走最终兜底 */ }
            }
            img.dataset.gyTmdbFallbackPhase = '2';
        }

        onFinalError?.(img);
    }, { once: false });
}

/** 为容器内 TMDB 图片批量绑定 CDN 优先 + Worker 预热 */
export function bindTmdbImagesIn(container, onFinalError) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll(
        'img[src*="/tmdb/t/p/"], img[src*="/api/t/p/"], img[src*="/t/p/"]',
    ).forEach((img) => {
        bindTmdbImageFallback(img, onFinalError);
    });
}

// API 服务层 - 数据请求 + 缓存

import { ADDON_BASE, API_BASE } from './config.js';

const BASE = ADDON_BASE;
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const CACHE_MAX = 200; // 最多缓存 200 条
const REQUEST_TIMEOUT = 15000; // 15 秒超时
const RESPONSE_CACHE = 'gy-api-response-v1';

async function request(path) {
    const url = `${BASE}${path}`;

    // 检查内存缓存
    const cached = cache.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }

    // 带超时的 fetch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
            // SW 离线兜底会返回 503 + {offline:true}，转成更明确的离线错误
            if (res.status === 503) {
                const err = new Error('当前无网络');
                err.offline = true;
                throw err;
            }
            throw new Error(`API Error: ${res.status}`);
        }
        const data = await res.json();

        putMemoryCache(url, data);
        persistResponse(url, data);
        return data;
    } catch (err) {
        clearTimeout(timer);
        if (cached?.data) return cached.data;
        const stale = await readPersistedResponse(url);
        if (stale) return stale;
        throw err;
    }
}

function putMemoryCache(url, data) {
    // 缓存淘汰（LRU 简化版：超过上限删最早的）
    if (cache.size >= CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(url, { data, time: Date.now() });
}

async function persistResponse(url, data) {
    if (!('caches' in window)) return;
    try {
        const store = await caches.open(RESPONSE_CACHE);
        await store.put(url, new Response(JSON.stringify({
            time: Date.now(),
            data,
        }), {
            headers: { 'Content-Type': 'application/json' },
        }));
    } catch {}
}

async function readPersistedResponse(url) {
    if (!('caches' in window)) return null;
    try {
        const store = await caches.open(RESPONSE_CACHE);
        const res = await store.match(url);
        if (!res) return null;
        const payload = await res.json();
        if (!payload?.data) return null;
        putMemoryCache(url, payload.data);
        return payload.data;
    } catch {
        return null;
    }
}

export async function getCatalog(type, catalogId, options = {}) {
    // addon 协议的 extra 参数走路径段 /key=value.json，而非 query string
    const extra = [];
    if (options.search) extra.push(`search=${encodeURIComponent(options.search)}`);
    if (options.skip) extra.push(`skip=${options.skip}`);

    const path = extra.length
        ? `/catalog/${type}/${catalogId}/${extra.join('&')}.json`
        : `/catalog/${type}/${catalogId}.json`;

    const data = await request(path);
    return data.metas || [];
}

export async function getMeta(type, id) {
    const data = await request(`/meta/${type}/${id}.json`);
    return data.meta || null;
}

// 同步读取已缓存的 meta（不发请求）。命中且未过期返回 meta，否则返回 null。
// 用于详情页判断能否跳过「加载中」中间态、直接整页渲染。
export function peekMeta(type, id) {
    const url = `${BASE}/meta/${type}/${id}.json`;
    const cached = cache.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data?.meta || null;
    }
    return null;
}

export async function getStream(type, id) {
    // 取流必须登录：走带鉴权的 /api/me/stream（携带 cookie），后端校验登录+权限后
    // 返回带「用户绑定 token」的播放地址。未登录返回 401。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
        const res = await fetch(`${API_BASE}/me/stream/${type}/${encodeURIComponent(id)}.json`, {
            credentials: 'include',
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 401) {
            const err = new Error('请先登录后观看');
            err.needLogin = true;
            throw err;
        }
        if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            const err = new Error(data.message || '无观看权限');
            err.forbidden = true;
            throw err;
        }
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        return data.streams || [];
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

// 预加载 - 提前请求数据放入缓存
export function preload(type, id) {
    const path = `/meta/${type}/${id}.json`;
    const url = `${BASE}${path}`;
    if (!cache.has(url)) {
        request(path).catch(() => {});
    }
}

// 清除缓存
export function clearCache() {
    cache.clear();
}

// TODO: 下一轮为 Cache API 增加版本迁移与容量裁剪策略。

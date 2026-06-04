// 收藏与历史记录服务
// 本地存储（游客 / 离线）+ 登录后同步到服务端（跨设备）
//
// 数据 id 体系：
//   - 内容用 addon 字符串 id（gy:slug），本地存储与 UI 以此为主键
//   - 服务端用数字 movieId / episodeId（addon 响应已附带），同步时用它
//   两者并存：item 同时带 id（字符串）与 movieId（数字）

import { signal } from '../core/signal.js';
import { user } from './auth.js';
import { effect } from '../core/signal.js';
import { API_BASE, R2_BASE } from './config.js';

const FAVORITES_KEY = 'gy_favorites';
const HISTORY_KEY = 'gy_history';
const MAX_HISTORY = 100;
const API = API_BASE;

// 响应式状态
export const favorites = signal(loadFromStorage(FAVORITES_KEY, []));
export const history = signal(loadFromStorage(HISTORY_KEY, []));

// ===== 收藏 =====
export function addFavorite(item) {
    // item: { id, type, name, poster, year, movieId? }
    const list = favorites.value;
    if (list.some(f => f.id === item.id)) return;
    favorites.value = [{ ...item, addedAt: Date.now() }, ...list];
    saveToStorage(FAVORITES_KEY, favorites.value);
    // 登录则同步服务端（需要数字 movieId）
    if (user.value && item.movieId) {
        serverWatchlist(item.movieId, 'add');
    }
}

export function removeFavorite(id) {
    const item = favorites.value.find(f => f.id === id);
    favorites.value = favorites.value.filter(f => f.id !== id);
    saveToStorage(FAVORITES_KEY, favorites.value);
    if (user.value && item?.movieId) {
        serverWatchlist(item.movieId, 'remove');
    }
}

export function isFavorite(id) {
    return favorites.value.some(f => f.id === id);
}

export function toggleFavorite(item) {
    if (isFavorite(item.id)) {
        removeFavorite(item.id);
        return false;
    }
    addFavorite(item);
    return true;
}

// ===== 历史记录 =====
export function addHistory(item) {
    // item: { id, type, name, poster, year, videoId?, movieId?, episodeId?, progress?, duration? }
    const list = history.value.filter(h => h.id !== item.id);
    const entry = { ...item, watchedAt: Date.now() };
    history.value = [entry, ...list].slice(0, MAX_HISTORY);
    saveToStorage(HISTORY_KEY, history.value);
    // 登录则同步进度到服务端
    if (user.value && item.movieId && item.progress != null) {
        serverHistory(item.movieId, item.episodeId, item.progress, item.duration);
    }
}

export function removeHistory(id) {
    history.value = history.value.filter(h => h.id !== id);
    saveToStorage(HISTORY_KEY, history.value);
}

export function clearHistory() {
    history.value = [];
    saveToStorage(HISTORY_KEY, []);
    if (user.value) serverClearHistory();
}

export function getRecentHistory(count = 10) {
    return history.value.slice(0, count);
}

// ===== 登录后拉取服务端数据并合并到本地 =====
// 在登录成功后调用：先把本地游客数据推送到服务端（避免游客期收藏/进度丢失），
// 再把服务端数据拉回合并（服务端为准，本地补充）。
export async function syncFromServer() {
    if (!user.value) return;
    await pushLocalToServer();
    await Promise.all([pullWatchlist(), pullHistory()]);
}

// 把登录前在本地积累的游客数据推送到服务端（仅推有数字 movieId 的项）
async function pushLocalToServer() {
    // 收藏：本地每一项都尝试加入服务端 watchlist（后端 INSERT OR IGNORE 幂等）
    const favs = favorites.value.filter(f => f.movieId);
    for (const f of favs) {
        await serverWatchlist(f.movieId, 'add');
    }
    // 历史：本地有进度的项推送（后端按 movie/episode 合并）
    const hist = history.value.filter(h => h.movieId && h.progress != null);
    for (const h of hist) {
        await serverHistory(h.movieId, h.episodeId, h.progress, h.duration);
    }
}

async function pullWatchlist() {
    try {
        const data = await apiGet('/me/watchlist');
        const items = (data.items || []).map(it => ({
            id: `gy:${it.slug}`,
            movieId: it.id,
            type: it.type === 'movie' ? 'movie' : 'series',
            name: it.title,
            poster: normalizePoster(it.poster),
            year: it.year,
            addedAt: it.addedAt ? it.addedAt * 1000 : Date.now(),
        }));
        favorites.value = mergeById(items, favorites.value);
        saveToStorage(FAVORITES_KEY, favorites.value);
    } catch { /* 忽略，保留本地 */ }
}

async function pullHistory() {
    try {
        const data = await apiGet('/me/history');
        const items = (data.items || []).map(it => ({
            id: `gy:${it.slug}`,
            movieId: it.movieId,
            episodeId: it.episodeId || null,
            type: it.type === 'movie' ? 'movie' : 'series',
            name: it.title,
            poster: normalizePoster(it.poster || it.backdrop),
            progress: it.progress,
            duration: it.duration,
            watchedAt: it.updatedAt ? it.updatedAt * 1000 : Date.now(),
        }));
        history.value = mergeById(items, history.value).slice(0, MAX_HISTORY);
        saveToStorage(HISTORY_KEY, history.value);
    } catch { /* 忽略 */ }
}

// 服务端为主、本地为辅，按 id 去重合并（服务端项优先）
function mergeById(serverItems, localItems) {
    const seen = new Set(serverItems.map(i => i.id));
    const merged = [...serverItems];
    for (const local of localItems) {
        if (!seen.has(local.id)) merged.push(local);
    }
    return merged;
}

// ===== 服务端写入（带 cookie；公开失败不影响本地体验）=====
async function serverWatchlist(movieId, action) {
    try {
        await apiPost('/me/watchlist', { movieId, action });
    } catch { /* 静默 */ }
}

async function serverHistory(movieId, episodeId, progress, duration) {
    try {
        await apiPost('/me/history', {
            movieId,
            episodeId: episodeId || undefined,
            progress: Math.floor(progress),
            duration: Math.floor(duration || 0),
        });
    } catch { /* 静默 */ }
}

async function serverClearHistory() {
    try {
        await fetch(`${API}/me/history`, { method: 'DELETE', credentials: 'include' });
    } catch { /* 静默 */ }
}

// 登录态变化时自动同步：
//   - 登录（uid 变化）：推送本地游客数据 + 拉取服务端数据合并
//   - 退出（uid 变 null）：清空本地收藏/历史，回到干净游客态，避免下一个用户看到上一个账号的数据
let _lastUserId = null;
effect(() => {
    const u = user.value;
    const uid = u?.id || null;
    if (uid && uid !== _lastUserId) {
        _lastUserId = uid;
        syncFromServer();
    } else if (!uid && _lastUserId) {
        // 从已登录变为退出：清空本地缓存的账号数据
        _lastUserId = null;
        favorites.value = [];
        history.value = [];
        saveToStorage(FAVORITES_KEY, []);
        saveToStorage(HISTORY_KEY, []);
    }
});

// ===== HTTP 工具（用户接口带 cookie）=====
async function apiGet(path) {
    const res = await fetch(`${API}${path}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPost(path, body) {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function normalizePoster(p) {
    if (!p) return '';
    if (p.startsWith('http')) return p;
    return `${R2_BASE}/${p.replace(/^\/api\/r2\//, '')}`;
}

// ===== 本地存储工具 =====
function loadFromStorage(key, fallback) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
    } catch { return fallback; }
}

function saveToStorage(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

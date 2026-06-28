// 求片服务层 —— 对接第一方 /api/v1/movie-requests
//
// 用户：榜单 / 详情 / 我的求片 / 提交 / 投票 / 取消 / 撤回
// 所有写操作带 cookie 凭证，读列表不走缓存以保证投票态实时。

import { API_V1_BASE } from './config.js';

const REQUEST_TIMEOUT = 15000;

async function callApi(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let res;
    try {
        res = await fetch(`${API_V1_BASE}${path}`, {
            method,
            credentials: 'include',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
        const error = new Error(data?.message || `API Error: ${res.status}`);
        error.status = res.status;
        error.reason = data?.reason || null;
        error.movieId = data?.movieId || null;
        throw error;
    }
    return data || {};
}

/** 公开榜单。status: pending|all，sort: votes|latest */
export async function listMovieRequests({ status = 'pending', sort = 'votes', page = 1 } = {}) {
    const params = new URLSearchParams({ status, sort, page: String(page) });
    return callApi(`/movie-requests?${params}`);
}

/** 单条求片详情 */
export async function getMovieRequest(id) {
    return callApi(`/movie-requests/${encodeURIComponent(id)}`);
}

/** 当前用户的求片（所有状态），需登录 */
export async function listMyMovieRequests({ page = 1 } = {}) {
    const params = new URLSearchParams({ page: String(page) });
    return callApi(`/me/movie-requests?${params}`);
}

/** 提交求片，需登录。{ title, year?, mediaType?, tmdbId?, tmdbRef?, note? } */
export async function submitMovieRequest(payload) {
    return callApi('/movie-requests', { method: 'POST', body: payload });
}

/**
 * 解析 TMDB 输入：纯数字、tmdb:movie:N、或 themoviedb.org 链接（可含在一段文本中）。
 * @returns {{ tmdbId: number, mediaType?: 'movie'|'tv' } | null} null 表示无法识别
 */
export function parseTmdbInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const logical = raw.match(/^tmdb:(movie|tv):(\d+)$/i);
    if (logical) {
        const tmdbId = Number(logical[2]);
        return tmdbId > 0 ? { tmdbId, mediaType: logical[1].toLowerCase() } : null;
    }

    const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.|m\.)?themoviedb\.org\/(movie|tv)\/(\d+)/i);
    if (urlMatch) {
        const tmdbId = Number(urlMatch[2]);
        return tmdbId > 0 ? { tmdbId, mediaType: urlMatch[1].toLowerCase() } : null;
    }

    if (/^\d+$/.test(raw)) {
        const tmdbId = Number(raw);
        return tmdbId > 0 ? { tmdbId } : null;
    }

    return null;
}

/** 输入是否像 TMDB 链接或引用 */
export function looksLikeTmdbInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return false;
    return Boolean(parseTmdbInput(raw));
}

/** 想看 +1（幂等），需登录 */
export async function voteMovieRequest(id) {
    return callApi(`/movie-requests/${encodeURIComponent(id)}/vote`, { method: 'POST' });
}

/** 取消想看，需登录 */
export async function unvoteMovieRequest(id) {
    return callApi(`/movie-requests/${encodeURIComponent(id)}/vote`, { method: 'DELETE' });
}

/** 发起人撤回（仅 pending），需登录 */
export async function withdrawMovieRequest(id) {
    return callApi(`/movie-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 状态 → 中文标签 */
export const REQUEST_STATUS_LABEL = {
    pending: '待处理',
    in_progress: '处理中',
    fulfilled: '已收录',
    rejected: '未通过',
};

/** 类型 → 中文标签 */
export function mediaTypeLabel(type) {
    if (type === 'movie') return '电影';
    if (type === 'tv') return '剧集';
    return '';
}

/** 构建带预填参数的求片页 hash 链接 */
export function buildMovieRequestUrl({ title, year, mediaType, tmdbId, tab } = {}) {
    const params = new URLSearchParams();
    if (title) params.set('title', String(title).slice(0, 120));
    if (year) params.set('year', String(year));
    if (mediaType === 'movie' || mediaType === 'tv') params.set('type', mediaType);
    if (tmdbId) params.set('tmdbId', String(tmdbId));
    if (tab) params.set('tab', tab);
    const qs = params.toString();
    return `#/requests${qs ? `?${qs}` : ''}`;
}

/** TMDB 站外搜索链接 */
export function tmdbSearchUrl(title) {
    const q = String(title || '').trim();
    if (!q) return 'https://www.themoviedb.org/search';
    return `https://www.themoviedb.org/search?query=${encodeURIComponent(q)}`;
}

/** TMDB 详情页链接 */
export function tmdbDetailUrl(mediaType, tmdbId) {
    if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) return '';
    return `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
}

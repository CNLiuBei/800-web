// API 服务层 - 数据请求 + 缓存
//
// 数据源：
//   - 第一方 `/api/v1/home`、`/recommendations/home`、`/home/curations` 等
//   - TMDB 兼容 `/api/v1/3/*`（片库 discover/search、详情 append）
// 内容 ID 使用 `tmdb:{media_type}:{id}`；取流走 `GET /me/stream/:type/:id.json`。

import { API_BASE, API_V1_BASE, R2_BASE } from './config.js';
import { normalizeTmdbImageUrl, tmdbCdnImageUrl } from './media-images.js';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const CACHE_MAX = 200; // 最多缓存 200 条
const REQUEST_TIMEOUT = 15000; // 15 秒超时
const RESPONSE_CACHE = 'gy-api-response-v2';

// addon 风格 catalogId → 第一方 type
const CATALOG_TYPE = {
    'guangying-movie': 'movie',
    'guangying-tv': 'tv',
    'guangying-anime': 'anime',
    'creator-public': 'creator',
};

// TMDB 主结构 → 页面使用的逻辑 id。
function toTmdbLogicalId(mediaType, id) {
    return `tmdb:${mediaType}:${id}`;
}

function tmdbPartsFromId(id, fallbackType = 'movie') {
    const value = String(id || '');
    const match = value.match(/^tmdb:(movie|tv):(\d+)(?::(\d+):(\d+))?$/);
    if (!match) return null;
    return {
        mediaType: match[1],
        tmdbId: match[2],
        season: match[3] ? Number(match[3]) : null,
        episode: match[4] ? Number(match[4]) : null,
        pageType: fallbackType === 'series' ? 'tv' : fallbackType === 'movie' ? 'movie' : match[1],
    };
}

function tmdbDetailPath(tmdb) {
    const params = new URLSearchParams({ append_to_response: 'credits,images,external_ids' });
    return `/3/${tmdb.mediaType}/${encodeURIComponent(tmdb.tmdbId)}?${params}`;
}

function creatorIdFromLogicalId(id) {
    return String(id).replace(/^creator:/, '');
}

// 第一方影片卡片 → addon 风格 meta 摘要（列表项）
function cardToMeta(row, fallbackType) {
    const mediaType = row.media_type || (row.title ? 'movie' : row.name ? 'tv' : row.type === 'movie' ? 'movie' : 'tv');
    const type = mediaType === 'movie' ? 'movie' : 'series';
    const tmdbId = row.id || row.tmdbId || row.tmdb_id;
    const title = row.title || row.name || row.original_title || row.original_name || '未命名内容';
    return {
        id: toTmdbLogicalId(mediaType, tmdbId),
        movieId: row.guangying?.movie_id || row.movieId || row.id,
        tmdbId,
        type: fallbackType || type,
        name: title,
        poster: normalizeTmdbImageUrl(row.poster_path || row.poster, 'w500', row),
        background: normalizeTmdbImageUrl(row.backdrop_path || row.backdrop, 'original', row),
        logo: normalizeAssetUrl(row.logo),
        year: yearFromTmdbDate(row.release_date || row.first_air_date) || row.year || '',
        imdbRating: row.vote_average != null ? String(row.vote_average) : row.rating != null ? String(row.rating) : '',
        viewCount: row.viewCount ?? row.view_count ?? 0,
        description: row.overview || row.tagline || row.plot || '',
        ranking: row.ranking || null,
    };
}

function creatorCardToMeta(row) {
    return {
        id: `creator:${row.id}`,
        type: 'creator',
        name: row.title || '创作者视频',
        poster: '',
        background: '',
        logo: '',
        year: row.publishedAt ? new Date(row.publishedAt).getFullYear() : '',
        imdbRating: '',
        description: row.description || row.channel?.displayName || '创作者投稿',
        channel: row.channel || null,
        analyticsVideoId: row.analyticsVideoId || `gy:creator:${row.id}`,
        subtitle: row.channel?.displayName ? `@${row.channel.handle || row.channel.displayName}` : '创作者投稿',
        creatorPlayback: row.playback || null,
    };
}

function normalizeAssetUrl(value) {
    if (!value || typeof value !== 'string') return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
    if (value.startsWith('/api/r2/') || value.startsWith('/r2/') || value.startsWith('tmdb/t/p/')) {
        return tmdbCdnImageUrl(value) || '';
    }
    if (value.startsWith('videos/') || value.startsWith('subtitles/')) return `${R2_BASE}/${value}`;
    return value;
}

function tmdbLogoPath(data) {
    const logos = data?.images?.logos;
    if (!Array.isArray(logos) || !logos.length) return '';
    const zh = logos.find((item) => item?.iso_639_1 === 'zh');
    const en = logos.find((item) => item?.iso_639_1 === 'en');
    return (zh || en || logos[0])?.file_path || '';
}

function yearFromTmdbDate(value) {
    return typeof value === 'string' && /^\d{4}/.test(value) ? value.slice(0, 4) : '';
}

function parseSeasonEpisodeFromSourceUrl(url) {
    const raw = String(url || '');
    let match = raw.match(/\/S(\d{1,2})\/E(\d{1,2})\//i);
    if (match) {
        return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
    }
    match = raw.match(/\/season\/(\d{1,2})\/episode\/(\d{1,2})(?:\/|$)/i);
    if (match) {
        return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
    }
    return null;
}

function sourceMatchesEpisode(source, season, episode) {
    if (source?.season_number != null && source?.episode_number != null) {
        return Number(source.season_number) === Number(season)
            && Number(source.episode_number) === Number(episode);
    }
    const parsed = parseSeasonEpisodeFromSourceUrl(source?.url);
    return parsed != null
        && parsed.season === Number(season)
        && parsed.episode === Number(episode);
}

function episodeHasPlayableSource(ep, sources) {
    if ((ep.guangying?.play_sources || []).length > 0) return true;
    const season = Number(ep.season_number ?? ep.season);
    const episode = Number(ep.episode_number ?? ep.episode);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) {
        return false;
    }
    const episodeId = Number(ep.guangying?.episode_id);
    if (Number.isFinite(episodeId) && episodeId > 0) {
        if (sources.some((source) => Number(source.episode_id) === episodeId)) return true;
    }
    return sources.some((source) => sourceMatchesEpisode(source, season, episode));
}

function sourceToPreviewSource(source, videos = []) {
    const rawUrl = String(source?.url || '');
    const path = r2PathFromUrl(rawUrl);
    if (!path || (!path.startsWith('videos/') && !path.startsWith('tmdb/'))) return null;
    const episodeId = source.episodeId == null && source.episode_id == null ? null : Number(source.episodeId ?? source.episode_id);
    let video = episodeId ? videos.find((item) => Number(item.episodeId) === episodeId) : null;
    if (!video && source.season_number != null && source.episode_number != null) {
        video = videos.find((item) => Number(item.season) === Number(source.season_number)
            && Number(item.episode) === Number(source.episode_number));
    }
    if (!video) {
        const parsed = parseSeasonEpisodeFromSourceUrl(rawUrl);
        if (parsed) {
            video = videos.find((item) => Number(item.season) === parsed.season
                && Number(item.episode) === parsed.episode);
        }
    }
    return {
        path,
        dirPrefix: path.replace(/\/[^/]+$/, ''),
        videoId: video?.id || '',
        episodeId,
        title: source.label || source.quality || '试看',
        label: source.label || '',
        quality: source.quality || '',
    };
}

function normalizeExternalResources(value) {
    const list = Array.isArray(value) ? value : [];
    return list
        .map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            const kind = normalizeResourceKind(item.kind || item.type || item.resourceType);
            const url = String(item.url || item.link || item.magnet || '').trim();
            if (!kind || !url) return null;
            return {
                id: String(item.id || `${kind}-${index}`),
                kind,
                title: String(item.title || item.name || (kind === 'magnet' ? '磁力资源' : '网盘资源')),
                sourceName: String(item.sourceName || item.source || item.site || '已审核来源'),
                url,
                quality: item.quality ? String(item.quality) : '',
                size: item.size ? String(item.size) : '',
                fileCount: Number.isFinite(Number(item.fileCount || item.file_count)) ? Number(item.fileCount || item.file_count) : null,
                updatedAt: item.updatedAt || item.updated_at || '',
                verified: item.verified !== false,
            };
        })
        .filter(Boolean);
}

function normalizeResourceKind(value) {
    const kind = String(value || '').toLowerCase();
    if (['cloud', 'cloud_drive', 'drive', 'pan', 'netdisk'].includes(kind)) return 'cloud_drive';
    if (['magnet', 'bt'].includes(kind)) return 'magnet';
    return '';
}

function r2PathFromUrl(value) {
    if (!value || typeof value !== 'string') return '';
    return value
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/api\/r2\//, '')
        .replace(/^\/r2\//, '')
        .replace(/^\/+/, '');
}

function isTmdbDetailPath(path) {
    const base = String(path || '').split('?')[0];
    return /^\/3\/(movie|tv)\/\d+$/.test(base);
}

function tmdbDetailHasPlaySources(data) {
    const sources = data?.guangying?.play_sources;
    return Array.isArray(sources) && sources.length > 0;
}

function shouldCacheTmdbDetail(path, data) {
    if (!isTmdbDetailPath(path)) return true;
    return tmdbDetailHasPlaySources(data);
}

async function request(path, options = {}) {
    const urls = requestUrls(path);
    const url = urls[0];

    // 检查内存缓存
    const cached = cache.get(url);
    if (!options.force && cached && Date.now() - cached.time < CACHE_TTL) {
        if (shouldCacheTmdbDetail(path, cached.data)) return cached.data;
        cache.delete(url);
    }

    // 带超时的 fetch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const { res, resolvedUrl } = await fetchWithVersionFallback(urls, controller.signal);
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

        if (shouldCacheTmdbDetail(path, data)) {
            putMemoryCache(url, data);
            if (resolvedUrl !== url) putMemoryCache(resolvedUrl, data);
            persistResponse(url, data);
            if (resolvedUrl !== url) persistResponse(resolvedUrl, data);
        } else {
            cache.delete(url);
            if (resolvedUrl !== url) cache.delete(resolvedUrl);
            evictPersistedResponse(url);
            if (resolvedUrl !== url) evictPersistedResponse(resolvedUrl);
        }
        return data;
    } catch (err) {
        clearTimeout(timer);
        if (cached?.data && shouldCacheTmdbDetail(path, cached.data)) return cached.data;
        const stale = await readPersistedResponse(url, path);
        if (stale) return stale;
        throw err;
    }
}

function requestUrls(path) {
    if (isTmdbPath(path)) return [`${API_V1_BASE}${path}`];
    return [`${API_V1_BASE}${path}`];
}

function isTmdbPath(path) {
    return typeof path === 'string' && (path.startsWith('/3/') || path === '/3');
}

async function fetchWithVersionFallback(urls, signal) {
    let firstResponse = null;
    for (const url of urls) {
        const res = await fetch(url, { signal });
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) {
            return { res, resolvedUrl: url };
        }
    }
    return { res: firstResponse, resolvedUrl: urls[0] };
}

async function requestJsonNoCache(path, options = {}) {
    const urls = requestUrls(path)
    let lastError = null
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: options.method || 'GET',
                credentials: 'include',
                headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
                body: options.body ? JSON.stringify(options.body) : undefined,
            })
            const text = await res.text()
            let data = null
            try { data = text ? JSON.parse(text) : null } catch { data = null }
            if (!res.ok) {
                const error = new Error(data?.message || `API Error: ${res.status}`)
                error.status = res.status
                if (res.status === 404 && url !== urls[urls.length - 1]) {
                    lastError = error
                    continue
                }
                throw error
            }
            return data || {}
        } catch (error) {
            lastError = error
            if (error?.status !== 404) throw error
        }
    }
    throw lastError || new Error('API Error')
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

async function evictPersistedResponse(url) {
    if (!('caches' in window)) return;
    try {
        const store = await caches.open(RESPONSE_CACHE);
        await store.delete(url);
    } catch {}
}

async function readPersistedResponse(url, path = '') {
    if (!('caches' in window)) return null;
    try {
        const store = await caches.open(RESPONSE_CACHE);
        const res = await store.match(url);
        if (!res) return null;
        const payload = await res.json();
        if (!payload?.data) return null;
        if (!shouldCacheTmdbDetail(path, payload.data)) {
            await store.delete(url);
            return null;
        }
        putMemoryCache(url, payload.data);
        return payload.data;
    } catch {
        return null;
    }
}

export async function getCatalog(type, catalogId, options = {}) {
    const apiType = CATALOG_TYPE[catalogId] || 'movie';
    if (apiType === 'creator') {
        const params = new URLSearchParams({ limit: String(options.limit || 20) });
        if (options.contentType) params.set('contentType', options.contentType);
        if (options.search) params.set('q', options.search);
        const data = await request(`/creator/public/videos?${params}`, { force: options.force });
        return (data.items || []).map(creatorCardToMeta);
    }

    // 搜索和发现都走 TMDB 兼容接口；分页 skip→page（每页 20，与原 addon 一致）
    let data;
    if (options.search) {
        const page = options.skip ? Math.floor(Number(options.skip) / 20) + 1 : 1;
        const params = new URLSearchParams({
            query: options.search,
            page: String(page),
        });
        if (options.sort === 'rating') params.set('sort', 'rating');
        if (options.year) params.set('year', options.year);
        if (options.region) params.set('region', options.region);
        if (apiType === 'anime') params.set('with_genres', '16');
        const searchType = apiType === 'movie' ? 'movie' : 'tv';
        data = await request(`/3/search/${searchType}?${params}`, { force: options.force });
        return catalogResponse(data, type, options);
    }

    const page = options.skip ? Math.floor(Number(options.skip) / 20) + 1 : 1;
    const params = new URLSearchParams({
        page: String(page),
    });
    if (options.sort === 'rating') params.set('sort_by', 'vote_average.desc');
    if (options.year) params.set('year', options.year);
    if (options.region) params.set('region', options.region);
    if (apiType === 'anime') params.set('with_genres', '16');
    const discoverType = apiType === 'movie' ? 'movie' : 'tv';
    data = await request(`/3/discover/${discoverType}?${params}`, { force: options.force });
    return catalogResponse(data, type, options);
}

function catalogResponse(data, type, options = {}) {
    const items = (data.results || data.items || []).map((row) => cardToMeta(row, type));
    if (!options.withExplanation) return items;
    return {
        ...data,
        items,
        explanation: data.explanation || null,
    };
}

export async function getUnifiedSearch(options = {}) {
    const type = String(options.type || 'all');
    const params = new URLSearchParams({
        query: String(options.search || options.q || '').trim(),
        page: String(Math.max(1, Number(options.page || 1))),
    });
    if (options.year) {
        if (type === 'tv' || type === 'anime') params.set('first_air_date_year', String(options.year));
        else params.set('year', String(options.year));
    }
    if (options.region) params.set('region', String(options.region));
    const searchType = type === 'movie' ? 'movie' : type === 'tv' || type === 'anime' ? 'tv' : 'multi';
    const data = await request(`/3/search/${searchType}?${params}`, { force: options.force });
    const groups = tmdbSearchGroups(data.results || [], type);
    return {
        q: params.get('query') || '',
        type,
        page: data.page || Number(params.get('page')) || 1,
        pageSize: 20,
        total: data.total_results || groups.reduce((sum, group) => sum + group.items.length, 0),
        totalPages: data.total_pages || 0,
        groups,
        strategy: { id: 'tmdb-search-v3', sources: [`/3/search/${searchType}`] },
    };
}

function tmdbSearchGroups(results, requestedType) {
    const groups = [
        { key: 'movie', title: '电影', itemType: 'movie', items: [] },
        { key: 'tv', title: '剧集', itemType: 'series', items: [] },
        { key: 'anime', title: '动漫', itemType: 'series', items: [] },
    ];
    for (const row of results) {
        const mediaType = row.media_type || (row.title ? 'movie' : 'tv');
        if (mediaType !== 'movie' && mediaType !== 'tv') continue;
        const item = cardToMeta(row, mediaType === 'movie' ? 'movie' : 'series');
        if (mediaType === 'movie') {
            if (requestedType === 'all' || requestedType === 'movie') groups[0].items.push({ ...item, _group: 'movie' });
            continue;
        }
        const isAnime = Array.isArray(row.genre_ids) && row.genre_ids.includes(16);
        if (isAnime && (requestedType === 'all' || requestedType === 'anime')) groups[2].items.push({ ...item, _group: 'anime' });
        if (!isAnime && (requestedType === 'all' || requestedType === 'tv')) groups[1].items.push({ ...item, _group: 'tv' });
    }
    return groups;
}

export async function getMeta(type, id, options = {}) {
    if (type === 'creator' || String(id).startsWith('creator:')) {
        const data = await request(`/creator/public/videos/${encodeURIComponent(creatorIdFromLogicalId(id))}`, { force: options.force });
        return creatorDetailToMeta(data?.video);
    }
    const tmdb = tmdbPartsFromId(id, type);
    if (tmdb) {
        const data = await request(tmdbDetailPath(tmdb), { force: options.force });
        return adaptTmdbDetailToMeta(data, type);
    }
    throw new Error('invalid tmdb id');
}

export async function searchMagnets(query, options = {}) {
    const q = String(query || '').trim();
    if (!q) return { query: '', items: [], hasMore: false };
    const params = new URLSearchParams({ q });
    const limit = Math.min(80, Math.max(1, Number(options.limit || 40) || 40));
    params.set('limit', String(limit));
    if (options.offset) params.set('offset', String(Math.max(0, Number(options.offset) || 0)));
    if (options.year) params.set('year', String(options.year));
    if (options.type) params.set('type', String(options.type));
    if (options.alt) params.set('alt', String(options.alt));
    if (options.imdb) params.set('imdb', String(options.imdb));
    return request(`/magnets/search?${params}`, { force: options.force });
}

function unifiedSearchItemToMeta(item) {
    if (item.kind === 'creator' || item.type === 'creator') {
        return {
            id: item.id || `creator:${item.sourceId}`,
            type: 'creator',
            name: item.name || item.title || '创作者视频',
            poster: normalizeAssetUrl(item.poster),
            background: normalizeAssetUrl(item.poster),
            year: item.year || '',
            imdbRating: '',
            description: item.description || item.subtitle || '创作者投稿',
            subtitle: item.subtitle || item.channel?.displayName || '创作者投稿',
            channel: item.channel || null,
            analyticsVideoId: item.analyticsVideoId || '',
            href: item.href || '',
        };
    }
    return {
        id: item.id,
        movieId: item.sourceId,
        type: item.type || (item.kind === 'movie' ? 'movie' : 'series'),
        name: item.name || item.title || '未命名内容',
        poster: normalizeAssetUrl(item.poster),
        background: normalizeAssetUrl(item.background),
        logo: normalizeAssetUrl(item.logo),
        year: item.year || '',
        imdbRating: item.imdbRating || '',
        description: item.description || item.subtitle || '',
        subtitle: item.subtitle || item.year || '',
        href: item.href || '',
    };
}

export async function getCreatorChannel(handle, options = {}) {
    const safeHandle = String(handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (!safeHandle) throw new Error('invalid creator handle');
    const data = await request(`/creator/public/channels/${encodeURIComponent(safeHandle)}`, { force: options.force });
    return {
        channel: data.channel || null,
        videos: (data.videos || []).map(creatorCardToMeta),
    };
}

export async function followCreatorChannel(handle, action = 'follow') {
    const safeHandle = String(handle || '').replace(/^@+/, '').trim().toLowerCase();
    if (!safeHandle) throw new Error('invalid creator handle');
    return requestJsonNoCache(`/creator/public/channels/${encodeURIComponent(safeHandle)}/follow`, {
        method: 'POST',
        body: { action: action === 'unfollow' ? 'unfollow' : 'follow' },
    });
}

export async function getCreatorSubscriptions(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', String(options.cursor));
    let data = null;
    try {
        data = await requestJsonNoCache(`/me/creator-subscriptions${params.toString() ? `?${params}` : ''}`);
    } catch (error) {
        if (options.silentUnauthorized && error?.status === 401) {
            return { items: [], nextCursor: null, unauthorized: true };
        }
        throw error;
    }
    return {
        items: (data.items || []).map(creatorCardToMeta),
        nextCursor: data.nextCursor || null,
    };
}

export async function getShortsFeed(options = {}) {
    const params = new URLSearchParams({
        limit: String(Math.min(30, Math.max(1, Number(options.limit || 12)))),
    });
    if (options.cursor) params.set('cursor', String(options.cursor));
    const data = await request(`/shorts/feed?${params}`, { force: options.force });
    return {
        ...data,
        items: (data.items || []).map((row) => ({
            ...creatorCardToMeta(row),
            contentType: row.contentType || 'short',
            playback: row.playback || null,
            recommendation: row.recommendation || null,
            publishedAt: row.publishedAt || row.updatedAt || null,
        })),
    };
}

function homeApiRowToMeta(row) {
    if (!row || typeof row !== 'object') return null;
    const mediaType = row.media_type || (row.type === 'movie' ? 'movie' : 'tv');
    const pageType = row.type === 'movie' ? 'movie' : row.type === 'anime' ? 'series' : 'series';
    return cardToMeta({
        ...row,
        id: row.id ?? row.tmdbId ?? row.tmdb_id,
        poster_path: row.poster_path ?? row.poster,
        backdrop_path: row.backdrop_path ?? row.backdrop,
        title: row.title ?? row.name,
        name: row.name ?? row.title,
        release_date: row.release_date,
        first_air_date: row.first_air_date,
        overview: row.overview ?? row.plot,
        vote_average: row.vote_average ?? row.rating,
        view_count: row.viewCount ?? row.view_count,
        guangying: row.guangying,
    }, pageType);
}

export async function getHome(options = {}) {
    const data = await request('/home', { force: options.force });
    return {
        hero: (data.hero || []).map(homeApiRowToMeta).filter(Boolean),
        top10: (data.top10 || []).map(homeApiRowToMeta).filter(Boolean),
        rows: (data.rows || []).map((section) => ({
            title: section.title,
            subtitle: section.subtitle,
            more: section.more,
            items: (section.items || []).map(homeApiRowToMeta).filter(Boolean),
        })),
    };
}

export async function getHomeRecommendations(options = {}) {
    const limit = Math.min(30, Math.max(1, Number(options.limit || 14)));
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.experimentVariant) params.set('experimentVariant', String(options.experimentVariant));
    const data = await requestJsonNoCache(`/recommendations/home?${params}`);
    const items = (data.items || []).map((row) => ({
        ...homeApiRowToMeta(row),
        recommendation: row.recommendation || null,
        subtitle: row.recommendation?.reason || row.subtitle || '',
    })).filter(Boolean);
    return {
        ...data,
        items,
    };
}

export async function getHomeCurations(options = {}) {
    const params = new URLSearchParams({
        slot: String(options.slot || 'hero'),
        limit: String(Math.min(20, Math.max(1, Number(options.limit || 5)))),
    });
    const data = await request(`/home/curations?${params}`, { force: options.force });
    return {
        ...data,
        items: (data.items || []).map((item) => ({
            id: item.targetId || item.id,
            type: item.targetType === 'series' ? 'series' : item.targetType === 'creator' ? 'creator' : 'movie',
            name: item.title || '精选内容',
            poster: normalizeAssetUrl(item.image),
            background: normalizeAssetUrl(item.image),
            logo: normalizeAssetUrl(item.logo),
            description: item.description || item.subtitle || '',
            subtitle: item.subtitle || '平台精选',
            href: item.href || '',
            curation: item,
        })),
    };
}

export async function getRankings(options = {}) {
    const limit = Math.min(20, Math.max(1, Number(options.limit || 20)));
    const requestedType = String(options.type || 'all');
    const lists = await tmdbRankingLists(requestedType, limit, options.force);
    return {
        type: requestedType,
        limit,
        lists,
    };
}

async function tmdbRankingLists(requestedType, limit, force) {
    const mediaTypes = requestedType === 'movie'
        ? ['movie']
        : requestedType === 'tv' || requestedType === 'anime'
            ? ['tv']
            : ['movie', 'tv'];
    const listDefs = [
        { id: 'hot', title: '热门播放', subtitle: '按 TMDB popularity 排序', sortBy: 'popularity.desc' },
        { id: 'rating', title: '高分内容', subtitle: '按 TMDB vote_average 排序', sortBy: 'vote_average.desc' },
        { id: 'latest', title: '最新上架', subtitle: '按 TMDB 上映/首播日期排序', sortBy: 'date.desc' },
    ];
    return Promise.all(listDefs.map(async (def) => {
        const rows = (await Promise.all(mediaTypes.map((mediaType) => tmdbDiscoverRows(mediaType, def.sortBy, force))))
            .flat()
            .filter((row) => requestedType !== 'anime' || (Array.isArray(row.genre_ids) && row.genre_ids.includes(16)))
            .slice(0, limit);
        return {
            id: def.id,
            title: def.title,
            subtitle: def.subtitle,
            items: rows.map((row, index) => ({
                ...cardToMeta(row),
                ranking: tmdbRankingReason(def.id, index, row),
            })),
        };
    }));
}

async function tmdbDiscoverRows(mediaType, sortBy, force) {
    const tmdbSortBy = sortBy === 'date.desc'
        ? mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'
        : sortBy;
    const params = new URLSearchParams({
        page: '1',
        sort_by: tmdbSortBy,
    });
    const data = await request(`/3/discover/${mediaType}?${params}`, { force });
    return data.results || [];
}

function tmdbRankingReason(kind, index, row) {
    const rank = index + 1;
    if (kind === 'rating') return { rank, reason: row.vote_average ? `评分 ${Number(row.vote_average).toFixed(1)}` : '高分内容' };
    if (kind === 'latest') return { rank, reason: row.release_date || row.first_air_date || '最新上架' };
    return { rank, reason: row.popularity ? `热度 ${Math.round(Number(row.popularity))}` : '热门播放' };
}

export async function listPublicCreatorLiveSessions(options = {}) {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    const data = await request(`/creator/public/live${params.toString() ? `?${params}` : ''}`, { force: options.force });
    return {
        items: data.items || [],
    };
}

export async function getPublicCreatorLiveSession(id, options = {}) {
    const safeId = String(id || '').trim()
    if (!safeId) throw new Error('invalid live session id')
    const data = options.force === false
        ? await request(`/creator/public/live/${encodeURIComponent(safeId)}`, { force: false })
        : await requestJsonNoCache(`/creator/public/live/${encodeURIComponent(safeId)}`);
    return {
        session: data.session || null,
    };
}

export async function getPublicCreatorLiveInteractions(id, { limit = 30 } = {}) {
    const safeId = String(id || '').trim()
    if (!safeId) throw new Error('invalid live session id')
    const params = new URLSearchParams({ limit: String(limit) })
    return requestJsonNoCache(`/creator/public/live/${encodeURIComponent(safeId)}/interactions?${params}`)
}

export async function sendPublicCreatorLiveMessage(id, content) {
    return requestJsonNoCache(`/creator/public/live/${encodeURIComponent(String(id || ''))}/chat`, {
        method: 'POST',
        body: { content },
    })
}

export async function reactPublicCreatorLive(id, action) {
    return requestJsonNoCache(`/creator/public/live/${encodeURIComponent(String(id || ''))}/reaction`, {
        method: 'POST',
        body: { action },
    })
}

export async function reportPublicCreatorLive(id, reason = '') {
    return requestJsonNoCache(`/creator/public/live/${encodeURIComponent(String(id || ''))}/report`, {
        method: 'POST',
        body: { reason },
    })
}

export async function heartbeatPublicCreatorLive(id, viewerId) {
    return requestJsonNoCache(`/creator/public/live/${encodeURIComponent(String(id || ''))}/presence`, {
        method: 'POST',
        body: { viewerId },
    })
}

export async function moderateCreatorLiveMessage(messageId, action) {
    return requestJsonNoCache(`/creator/live/messages/${encodeURIComponent(String(messageId || ''))}/moderate`, {
        method: 'POST',
        body: { action },
    })
}

export async function muteCreatorLiveMessageAuthor(messageId, { durationSeconds = 600, reason = '' } = {}) {
    return requestJsonNoCache(`/creator/live/messages/${encodeURIComponent(String(messageId || ''))}/mute`, {
        method: 'POST',
        body: { durationSeconds, reason },
    })
}

export async function banCreatorLiveMessageAuthor(messageId, { reason = '' } = {}) {
    return requestJsonNoCache(`/creator/live/messages/${encodeURIComponent(String(messageId || ''))}/ban`, {
        method: 'POST',
        body: { reason },
    })
}

// 同步读取已缓存的 meta（不发请求）。命中且未过期返回 meta，否则返回 null。
// 用于详情页判断能否跳过「加载中」中间态、直接整页渲染。
export function peekMeta(type, id) {
    if (type === 'creator' || String(id).startsWith('creator:')) return null;
    const tmdb = tmdbPartsFromId(id, type);
    if (tmdb) {
        const path = tmdbDetailPath(tmdb);
        const url = requestUrls(path)[0];
        const cached = cache.get(url);
        if (cached && Date.now() - cached.time < CACHE_TTL && shouldCacheTmdbDetail(path, cached.data)) {
            return adaptTmdbDetailToMeta(cached.data, type);
        }
        return null;
    }
    return null;
}

export async function getCachedMeta(type, id) {
    if (type === 'creator' || String(id).startsWith('creator:')) return null;
    const tmdb = tmdbPartsFromId(id, type);
    if (tmdb) {
        const path = tmdbDetailPath(tmdb);
        const paths = requestUrls(path);
        for (const url of paths) {
            const cached = cache.get(url);
            if (cached?.data && shouldCacheTmdbDetail(path, cached.data)) {
                return adaptTmdbDetailToMeta(cached.data, type);
            }
            const persisted = await readPersistedResponse(url, path);
            if (persisted) return adaptTmdbDetailToMeta(persisted, type);
        }
        return null;
    }
    return null;
}

function adaptTmdbDetailToMeta(data, fallbackType) {
    if (!data?.id) return null;
    const mediaType = data.title ? 'movie' : 'tv';
    const type = mediaType === 'movie' ? 'movie' : 'series';
    const sources = data.guangying?.play_sources || [];
    const episodes = data.guangying?.episodes || [];
    const resources = normalizeExternalResources(
        data.guangying?.resources || data.guangying?.external_resources || data.external_resources
    );
    const videos = episodes.map((ep) => ({
        id: `tmdb:tv:${data.id}:${ep.season_number}:${ep.episode_number}`,
        episodeId: ep.guangying?.episode_id ?? null,
        title: ep.name || `第${ep.episode_number}集`,
        season: ep.season_number,
        episode: ep.episode_number,
        durationSeconds: Number(ep.runtime) > 0 ? Number(ep.runtime) * 60 : 0,
        available: episodeHasPlayableSource(ep, sources),
        released: ep.air_date || undefined,
    }));
    const previewSources = sources
        .map((source) => sourceToPreviewSource(source, videos))
        .filter(Boolean);
    const credits = data.credits || {};
    return {
        id: toTmdbLogicalId(mediaType, data.id),
        movieId: data.guangying?.movie_id || data.id,
        slug: data.guangying?.slug || '',
        tmdbId: data.id,
        mediaType,
        type: fallbackType || type,
        name: data.title || data.name || data.original_title || data.original_name || '未命名内容',
        originalName: data.original_title || data.original_name || '',
        imdbId: data.external_ids?.imdb_id || '',
        poster: normalizeTmdbImageUrl(data.poster_path, 'w500'),
        background: normalizeTmdbImageUrl(data.backdrop_path, 'original'),
        logo: normalizeTmdbImageUrl(tmdbLogoPath(data), 'w500'),
        description: data.overview || data.tagline || '',
        year: yearFromTmdbDate(data.release_date || data.first_air_date),
        runtime: data.runtime ? `${data.runtime} 分钟` : Array.isArray(data.episode_run_time) && data.episode_run_time[0] ? `${data.episode_run_time[0]} 分钟` : '',
        imdbRating: data.vote_average != null ? String(data.vote_average) : '',
        genres: (data.genres || []).map((genre) => genre.name).filter(Boolean),
        director: (credits.crew || []).filter((item) => item.job === 'Director').map((item) => item.name).filter(Boolean),
        cast: (credits.cast || [])
            .filter((item) => item?.name)
            .slice(0, 20)
            .map((item) => ({
                name: item.name,
                profile: normalizeTmdbImageUrl(item.profile_path, 'w185'),
            })),
        videos: mediaType !== 'movie' ? videos : [],
        previewSources,
        hasPlaySources: sources.length > 0,
        resources,
        similar: [],
    };
}

function creatorDetailToMeta(video) {
    if (!video) return null;
    return {
        id: `creator:${video.id}`,
        analyticsVideoId: video.analyticsVideoId || `gy:creator:${video.id}`,
        type: 'creator',
        name: video.title || '创作者视频',
        poster: '',
        background: '',
        logo: '',
        description: video.description || video.channel?.bio || '',
        year: video.publishedAt ? new Date(video.publishedAt).getFullYear() : '',
        runtime: '',
        imdbRating: '',
        genres: ['创作者', creatorContentTypeText(video.contentType)].filter(Boolean),
        director: video.channel?.displayName ? [video.channel.displayName] : [],
        cast: [],
        chapters: Array.isArray(video.chapters) ? video.chapters : [],
        videos: [],
        previewSources: [],
        similar: [],
        channel: video.channel || null,
        creatorPlayback: video.playback || null,
    };
}

function creatorContentTypeText(type) {
    return {
        video: '长视频',
        short: '短视频',
        series: '剧集',
        live: '直播',
    }[type] || '视频';
}

export async function recordMovieView(slug) {
    const safe = String(slug || '').trim();
    if (!safe) return null;
    try {
        const res = await fetch(`${API_V1_BASE}/movies/${encodeURIComponent(safe)}/view`, { method: 'POST' });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
    } catch {
        return null;
    }
}

export async function getPlaybackPreview(source) {
    if (!source?.path || !source?.dirPrefix) throw new Error('invalid preview source');
    const res = await fetch(`${API_V1_BASE}/playback-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: source.dirPrefix }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.message || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    const data = await res.json();
    return {
        url: `${R2_BASE}/${source.path}?token=${encodeURIComponent(data.token)}`,
        title: source.title || source.label || source.quality || '试看',
        label: source.label || '试看',
        quality: source.quality || 'Preview',
        preview: true,
        limitSeconds: Number(data.limitSeconds) || 0,
        expiresIn: Number(data.expiresIn) || 0,
    };
}

export async function getPlaybackHealth({ videoId, movieId, tmdbId, mediaType, sourceLabel } = {}) {
    const params = new URLSearchParams();
    if (videoId) params.set('videoId', String(videoId));
    if (movieId) params.set('movieId', String(movieId));
    if (tmdbId) params.set('tmdbId', String(tmdbId));
    if (mediaType) params.set('mediaType', String(mediaType));
    if (sourceLabel) params.set('sourceLabel', String(sourceLabel).slice(0, 120));
    if (!params.toString()) return null;

    const res = await fetch(`${API_V1_BASE}/playback/health?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.ok || !data.advice) return null;
    return data;
}

const streamPrefetch = new Map();
const STREAM_PREFETCH_TTL_MS = 2 * 60 * 1000;

function streamPrefetchKey(type, id) {
    return `${type}:${id}`;
}

/** 详情页 idle 预热：提前拉取带 token 的播放地址，点击播放时可省 1 次 API 往返 */
export function prefetchStream(type, id) {
    const key = streamPrefetchKey(type, id);
    const existing = streamPrefetch.get(key);
    if (existing?.promise) return existing.promise;

    const entry = {};
    const promise = fetchStream(type, id)
        .then((streams) => {
            entry.streams = streams;
            entry.at = Date.now();
            return streams;
        })
        .catch((err) => {
            streamPrefetch.delete(key);
            throw err;
        });
    entry.promise = promise;
    streamPrefetch.set(key, entry);
    return promise;
}

async function fetchStream(type, id) {
    if (type === 'creator' || String(id).startsWith('creator:')) {
        const meta = await getMeta('creator', id);
        const source = meta?.creatorPlayback;
        if (!source?.url) return [];
        return [{
            url: source.url,
            title: meta.name || '创作者视频',
            name: meta.name || '创作者视频',
            type: source.type || 'mp4',
            quality: source.quality || 'Creator',
        }];
    }
    // 取流必须登录：走带鉴权的 /api/me/stream（携带 cookie），后端校验登录+权限后
    // 返回带「用户绑定 token」的播放地址。未登录返回 401。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
        const streamPath = `/me/stream/${type}/${encodeURIComponent(id)}.json`;
        const { res } = await fetchCredentialedWithVersionFallback(requestUrls(streamPath), controller.signal);
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

export async function getStream(type, id) {
    const key = streamPrefetchKey(type, id);
    const cached = streamPrefetch.get(key);
    if (cached?.streams && cached.at && Date.now() - cached.at < STREAM_PREFETCH_TTL_MS) {
        return cached.streams;
    }
    if (cached?.promise) {
        try {
            return await cached.promise;
        } catch {
            // 预取失败则走正常请求
        }
    }
    const streams = await fetchStream(type, id);
    streamPrefetch.set(key, {
        promise: Promise.resolve(streams),
        streams,
        at: Date.now(),
    });
    return streams;
}

async function fetchCredentialedWithVersionFallback(urls, signal) {
    let firstResponse = null;
    for (const url of urls) {
        const res = await fetch(url, { credentials: 'include', signal });
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) {
            return { res, resolvedUrl: url };
        }
    }
    return { res: firstResponse, resolvedUrl: urls[0] };
}

// 预加载 - 提前请求数据放入缓存
export function preload(type, id) {
    if (type === 'creator' || String(id).startsWith('creator:')) {
        request(`/creator/public/videos/${encodeURIComponent(creatorIdFromLogicalId(id))}`).catch(() => {});
        return;
    }
    const tmdb = tmdbPartsFromId(id, type);
    if (tmdb) {
        const path = tmdbDetailPath(tmdb);
        const url = requestUrls(path)[0];
        if (!cache.has(url)) {
            request(path).catch(() => {});
        }
        return;
    }
}

// 清除缓存
export function clearCache() {
    cache.clear();
}

export async function clearPersistentCache() {
    clearCache();
    if (!('caches' in window)) return false;
    try {
        return await caches.delete(RESPONSE_CACHE);
    } catch {
        return false;
    }
}

// TODO: 下一轮为 Cache API 增加版本迁移与容量裁剪策略。

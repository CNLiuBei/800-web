// 收藏与历史记录服务
// 本地存储（游客 / 离线）+ 登录后同步到服务端（跨设备）
//
// 数据 id 体系：
//   - 内容以 TMDB 逻辑 id 为主：tmdb:{movie|tv}:{id}
//   - 分集播放进度使用 tmdb:tv:{id}:{season}:{episode}
//   - 数字 movieId / episodeId 仅作为 guangying 扩展兼容字段保留

import { signal } from '../core/signal.js';
import { librarySyncState } from './library-sync-state.js';
import { user } from './auth.js';
import { effect } from '../core/signal.js';
import { API_V1_BASE, R2_BASE } from './config.js';
import { normalizeTmdbImageUrl } from './media-images.js';
import {
    RESUME_MIN_SECONDS, RESUME_END_GUARD_SECONDS, COMPLETION_PERCENT,
    HISTORY_SYNC_THROTTLE_MS,
    clampPercent, computeResumePercent, resolveResumeDuration,
    historyPercent, isCompletedHistoryItem, isResumableHistoryItem,
    shouldSyncHistoryProgress,
    seriesWatchStatusLabel,
} from './playback-progress.js';

const FAVORITES_KEY = 'gy_favorites';
const HISTORY_KEY = 'gy_history';
const WATCH_LATER_KEY = 'gy_watch_later';
const MAX_HISTORY = 100;
const MAX_WATCH_LATER = 200;
// 续播阈值常量统一来自 playback-progress.js（单一事实源）
let syncPromise = null;

// 响应式状态
const initialHistory = normalizeHistoryList(loadFromStorage(HISTORY_KEY, []));
const initialFavorites = normalizeStoredMediaList(loadFromStorage(FAVORITES_KEY, []));
const initialWatchLater = normalizeStoredMediaList(loadFromStorage(WATCH_LATER_KEY, []));
export const history = signal(initialHistory);
export const favorites = signal(initialFavorites);
export const watchLater = signal(initialWatchLater);
export { librarySyncState };
saveToStorage(HISTORY_KEY, initialHistory);
saveToStorage(FAVORITES_KEY, initialFavorites);
saveToStorage(WATCH_LATER_KEY, initialWatchLater);

// ===== 收藏 =====
export function addFavorite(item) {
    // item: { id, type, name, poster, year, movieId? }
    const list = favorites.value;
    if (list.some(f => f.id === item.id)) return;
    favorites.value = [{ ...item, addedAt: Date.now() }, ...list];
    saveToStorage(FAVORITES_KEY, favorites.value);
    if (user.value && hasServerIdentity(item)) serverWatchlist(item, 'add');
}

export function removeFavorite(id) {
    const item = favorites.value.find(f => f.id === id);
    favorites.value = favorites.value.filter(f => f.id !== id);
    saveToStorage(FAVORITES_KEY, favorites.value);
    if (user.value && hasServerIdentity(item)) serverWatchlist(item, 'remove');
}

export function restoreFavorite(item) {
    if (!item?.id || favorites.value.some(f => f.id === item.id)) return false;
    favorites.value = [{ ...item, addedAt: item.addedAt || Date.now() }, ...favorites.value];
    saveToStorage(FAVORITES_KEY, favorites.value);
    if (user.value && hasServerIdentity(item)) serverWatchlist(item, 'add');
    return true;
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

// ===== 稍后看 =====
export function addWatchLater(item) {
    const list = watchLater.value;
    if (list.some(w => w.id === item.id)) return false;
    watchLater.value = [{ ...item, addedAt: Date.now() }, ...list].slice(0, MAX_WATCH_LATER);
    saveToStorage(WATCH_LATER_KEY, watchLater.value);
    if (user.value && hasServerIdentity(item)) serverWatchLater(item, 'add');
    return true;
}

export function removeWatchLater(id) {
    const item = watchLater.value.find(w => w.id === id);
    watchLater.value = watchLater.value.filter(w => w.id !== id);
    saveToStorage(WATCH_LATER_KEY, watchLater.value);
    if (user.value && hasServerIdentity(item)) serverWatchLater(item, 'remove');
}

export function restoreWatchLater(item) {
    if (!item?.id || watchLater.value.some(w => w.id === item.id)) return false;
    watchLater.value = [{ ...item, addedAt: item.addedAt || Date.now() }, ...watchLater.value].slice(0, MAX_WATCH_LATER);
    saveToStorage(WATCH_LATER_KEY, watchLater.value);
    if (user.value && hasServerIdentity(item)) serverWatchLater(item, 'add');
    return true;
}

export function isWatchLater(id) {
    return watchLater.value.some(w => w.id === id);
}

export function toggleWatchLater(item) {
    if (isWatchLater(item.id)) {
        removeWatchLater(item.id);
        return false;
    }
    return addWatchLater(item);
}

// ===== 历史记录 =====
export function addHistory(item) {
    // item: { id, type, name, poster, year, videoId?, movieId?, episodeId?, progress?, duration? }
    const key = historyItemKey(item);
    const existing = history.value.find(h => historyItemKey(h) === key);
    const list = history.value.filter(h => historyItemKey(h) !== key);
    const incoming = { ...item, playbackKey: key, watchedAt: Date.now() };
    const entry = existing ? mergeHistoryEntries(existing, incoming) : incoming;
    entry.watchedAt = Date.now();
    history.value = normalizeHistoryList([entry, ...list]).slice(0, MAX_HISTORY);
    saveToStorage(HISTORY_KEY, history.value);
    if (user.value && hasServerIdentity(entry) && shouldSyncHistoryProgress(entry)) serverHistory(entry);
}

export function removeHistory(id) {
    const removeByPlaybackKey = typeof id === 'string' && /^(video|movie|content):/.test(id);
    const item = history.value.find(h => removeByPlaybackKey ? historyItemKey(h) === id : h.id === id);
    history.value = history.value.filter(h => removeByPlaybackKey ? historyItemKey(h) !== id : h.id !== id);
    saveToStorage(HISTORY_KEY, history.value);
    if (user.value && item) serverRemoveHistory(item);
}

export function restoreHistoryItem(item) {
    if (!item?.id) return false;
    const key = historyItemKey(item);
    if (history.value.some(h => historyItemKey(h) === key)) return false;
    const entry = { ...item, playbackKey: key, watchedAt: item.watchedAt || Date.now() };
    history.value = normalizeHistoryList([entry, ...history.value]).slice(0, MAX_HISTORY);
    saveToStorage(HISTORY_KEY, history.value);
    if (user.value && hasServerIdentity(entry) && shouldSyncHistoryProgress(entry)) serverHistory(entry);
    return true;
}

export function clearHistory() {
    history.value = [];
    saveToStorage(HISTORY_KEY, []);
    if (user.value) serverClearHistory();
}

export function getRecentHistory(count = 10) {
    return normalizeHistoryList(history.value).slice(0, count);
}

/** 已观看（看完）记录，最近优先；对标大厂「已观看」清单 */
export function getWatchedHistory(count = 30) {
    return normalizeHistoryList(history.value)
        .filter(isCompletedHistoryItem)
        .slice(0, count);
}

/** 继续观看分组键：同一部剧/电影只保留一条（取最近观看的那一集） */
export function continueWatchGroupKey(item = {}) {
    const fromVideo = tmdbPartsFromId(item.videoId);
    if (fromVideo?.mediaType === 'tv' && fromVideo.tmdbId) {
        return `series:tmdb:tv:${fromVideo.tmdbId}`;
    }
    const fromId = tmdbPartsFromId(item.id);
    if (fromId?.mediaType === 'tv' && fromId.tmdbId) {
        return `series:tmdb:tv:${fromId.tmdbId}`;
    }
    const mediaType = item.mediaType || item.media_type;
    const tmdbId = item.tmdbId || item.tmdb_id;
    if ((mediaType === 'tv' || item.type === 'series') && tmdbId) {
        return `series:tmdb:tv:${tmdbId}`;
    }
    if (typeof item.id === 'string' && item.id.startsWith('tmdb:tv:')) {
        const [, , seriesId] = item.id.split(':');
        if (seriesId) return `series:tmdb:tv:${seriesId}`;
    }
    const movieId = Number(item.movieId);
    if ((mediaType === 'tv' || item.type === 'series') && Number.isInteger(movieId) && movieId > 0) {
        return `series:movie:${movieId}`;
    }
    if (fromId?.mediaType === 'movie' && fromId.tmdbId) {
        return `movie:tmdb:movie:${fromId.tmdbId}`;
    }
    if ((mediaType === 'movie' || item.type === 'movie') && tmdbId) {
        return `movie:tmdb:movie:${tmdbId}`;
    }
    if (Number.isInteger(movieId) && movieId > 0) {
        return `movie:movie:${movieId}`;
    }
    if (item.id) return `content:${item.id}`;
    return historyItemKey(item);
}

function continueItemRichness(item = {}) {
    let score = 0;
    if (item.subtitle || item.episodeLabel || item.episodeTitle) score += 2;
    if (item.videoId) score += 1;
    if (item.episodeId) score += 1;
    return score;
}

function shouldReplaceContinueItem(prev, next) {
    if (!prev) return true;
    const prevTime = Number(prev.watchedAt || 0);
    const nextTime = Number(next.watchedAt || 0);
    if (nextTime !== prevTime) return nextTime > prevTime;
    const prevScore = continueItemRichness(prev);
    const nextScore = continueItemRichness(next);
    if (nextScore !== prevScore) return nextScore > prevScore;
    return Number(next.progress || 0) > Number(prev.progress || 0);
}

export function dedupeContinueHistoryItems(items = []) {
    const byGroup = new Map();
    for (const item of items) {
        if (!item) continue;
        const groupKey = continueWatchGroupKey(item);
        const prev = byGroup.get(groupKey);
        if (shouldReplaceContinueItem(prev, item)) {
            byGroup.set(groupKey, item);
        }
    }
    return [...byGroup.values()].sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
}

function isContinueHistoryItem(item) {
    return isResumableHistoryItem(item);
}

/** 首页「继续看与追更」：未完成且同一剧只保留最近一条 */
export function getContinueHistory(count = 10) {
    return dedupeContinueHistoryItems(
        normalizeHistoryList(history.value).filter(isContinueHistoryItem),
    ).slice(0, count);
}

function episodeHistoryKey(entry = {}) {
    if (entry.videoId) return historyItemKey(entry);
    const season = Number(entry.seasonNumber ?? entry.season_number);
    const ep = Number(entry.episodeNumber ?? entry.episode_number);
    if (Number.isInteger(season) && Number.isInteger(ep)) return `se:${season}:${ep}`;
    if (entry.episodeId != null && entry.episodeId !== '') return `ep:${entry.episodeId}`;
    return historyItemKey(entry);
}

function isSeriesGroupKey(groupKey = '') {
    return String(groupKey).startsWith('series:');
}

/**
 * 聚合同一部剧/电影的观看进度（区分「已看 N 集」与「已全部看完」）
 * @param {object} anchorItem 锚点条目（继续观看/海报项）
 * @param {{totalEpisodes?:number}} [options] 已知总集数时可判定「全部看完」
 */
export function getSeriesWatchSummary(anchorItem = {}, options = {}) {
    const groupKey = continueWatchGroupKey(anchorItem);
    const isSeries = isSeriesGroupKey(groupKey) || anchorItem.type === 'series';
    const totalEpisodes = Number(options.totalEpisodes) || 0;
    const entries = normalizeHistoryList(history.value).filter(
        (item) => continueWatchGroupKey(item) === groupKey,
    );

    if (!entries.length) {
        return {
            status: 'unwatched',
            isSeries,
            groupKey,
            completedCount: 0,
            watchingCount: 0,
            trackedEpisodeCount: 0,
            totalEpisodes,
            resumePercent: 0,
            activeEpisode: null,
            latestCompletedEpisode: null,
        };
    }

    const byEpisode = new Map();
    for (const entry of entries) {
        const key = isSeries ? episodeHistoryKey(entry) : groupKey;
        const prev = byEpisode.get(key);
        byEpisode.set(key, prev ? mergeHistoryEntries(prev, entry) : entry);
    }

    const episodes = [...byEpisode.values()];
    const completed = episodes.filter(isCompletedHistoryItem);
    const watching = episodes.filter(isResumableHistoryItem);
    const completedCount = completed.length;
    const watchingCount = watching.length;
    const activeEpisode = watching.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0))[0] || null;
    const latestCompletedEpisode = completed.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0))[0] || null;
    const resumePercent = activeEpisode ? Math.round(historyPercent(activeEpisode)) : 0;

    let status = 'unwatched';
    if (!isSeries) {
        if (completedCount > 0) status = 'completed';
        else if (watchingCount > 0) status = 'watching';
    } else if (watchingCount > 0) {
        status = 'watching';
    } else if (totalEpisodes > 0 && completedCount >= totalEpisodes) {
        status = 'completed';
    } else if (completedCount > 0) {
        status = 'partial';
    }

    return {
        status,
        isSeries,
        groupKey,
        completedCount,
        watchingCount,
        trackedEpisodeCount: episodes.length,
        totalEpisodes,
        resumePercent,
        activeEpisode,
        latestCompletedEpisode,
    };
}

/** 海报/首页卡片：按整部聚合的播放状态（电影 / 剧集） */
export function getSeriesPlaybackBadge(anchorItem = {}, options = {}) {
    const summary = getSeriesWatchSummary(anchorItem, options);
    const label = seriesWatchStatusLabel(summary);
    if (!label) return null;

    if (summary.status === 'watching' && summary.activeEpisode) {
        const entry = summary.activeEpisode;
        return {
            kind: 'watching',
            label,
            percent: summary.resumePercent,
            progress: Number(entry.progress) || 0,
            videoId: entry.videoId || anchorItem.videoId || '',
            entry,
            summary,
        };
    }

    if (summary.status === 'completed') {
        const entry = summary.latestCompletedEpisode || summary.activeEpisode;
        return {
            kind: 'completed',
            label,
            videoId: entry?.videoId || anchorItem.videoId || '',
            entry,
            summary,
        };
    }

    if (summary.status === 'partial') {
        return {
            kind: 'partial',
            label,
            videoId: summary.latestCompletedEpisode?.videoId || anchorItem.videoId || '',
            entry: summary.latestCompletedEpisode,
            summary,
        };
    }

    return null;
}

// resolveResumeDuration / computeResumePercent 复用 playback-progress.js，对外保持原导出
export { resolveResumeDuration, computeResumePercent };

export function getResumePercent(resume, fallbackDurationSeconds = 0) {
    if (!resume) return 0;
    const progress = Number(resume.progress) || 0;
    const duration = resolveResumeDuration(resume, fallbackDurationSeconds);
    const stored = resume.percent ?? resume.entry?.percent;
    return computeResumePercent(progress, duration, stored);
}

export function getResumeProgress({ id, videoId, movieId, episodeId, tmdbId, mediaType, seasonNumber, episodeNumber } = {}) {
    const params = { id, videoId, movieId, episodeId, tmdbId, mediaType, seasonNumber, episodeNumber };
    const entry = findResumeEntry(params);
    if (!entry) return null;
    if (isEpisodePlaybackQuery(params) && !historyEntryMatchesEpisode(entry, params)) return null;

    const progress = Number(entry.progress);
    const duration = Number(entry.duration) || 0;
    if (!Number.isFinite(progress) || progress < RESUME_MIN_SECONDS) return null;
    if (duration > 0 && duration - progress < RESUME_END_GUARD_SECONDS) return null;

    const percent = computeResumePercent(progress, duration, entry.percent);
    if (percent >= COMPLETION_PERCENT) return null;

    return {
        progress,
        duration,
        percent,
        entry,
    };
}

/** 海报/选集播放状态：续播中、已看完，未观看返回 null */
export function getPlaybackBadge(params = {}) {
    const entry = findResumeEntry(params);
    if (!entry) return null;
    if (isEpisodePlaybackQuery(params) && !historyEntryMatchesEpisode(entry, params)) return null;
    if (isCompletedHistoryItem(entry)) {
        return {
            kind: 'completed',
            label: '已看完',
            videoId: entry.videoId || params.videoId || '',
            entry,
        };
    }
    const resume = getResumeProgress(params);
    if (!resume) return null;
    const percent = Math.round(resume.percent);
    return {
        kind: 'watching',
        label: `续播中 ${percent}%`,
        percent,
        progress: resume.progress,
        videoId: entry.videoId || params.videoId || '',
        entry,
    };
}

function isEpisodePlaybackQuery({ videoId, episodeId, seasonNumber, episodeNumber, mediaType } = {}) {
    if (videoId) return true;
    if (episodeId != null && Number.isFinite(Number(episodeId))) return true;
    const season = Number(seasonNumber);
    const episode = Number(episodeNumber);
    const scopedType = mediaType === 'tv' || mediaType === 'series';
    return scopedType && Number.isInteger(season) && Number.isInteger(episode);
}

function historyEntryMatchesEpisode(entry, { videoId, episodeId, seasonNumber, episodeNumber, tmdbId, mediaType } = {}) {
    if (!entry) return false;
    if (videoId && entry.videoId === videoId) return true;

    const season = Number(seasonNumber);
    const episode = Number(episodeNumber);
    const tid = Number(tmdbId);
    const mt = mediaType === 'movie' || mediaType === 'tv' ? mediaType : '';
    if (mt === 'tv' && Number.isInteger(tid) && Number.isInteger(season) && Number.isInteger(episode)) {
        const syntheticVideoId = `tmdb:tv:${tid}:${season}:${episode}`;
        if (entry.videoId === syntheticVideoId) return true;
    }

    const numericEpisodeId = episodeId == null ? null : Number(episodeId);
    if (numericEpisodeId != null && Number.isFinite(numericEpisodeId) && Number(entry.episodeId) === numericEpisodeId) {
        if (Number.isInteger(tid) && tid > 0) {
            return Number(entry.tmdbId || entry.tmdb_id) === tid;
        }
        const numericMovieId = Number(entry.movieId);
        return Number.isInteger(numericMovieId) && numericMovieId > 0;
    }

    if (Number.isInteger(season) && Number.isInteger(episode)) {
        const entrySeason = Number(entry.seasonNumber ?? entry.season_number);
        const entryEpisode = Number(entry.episodeNumber ?? entry.episode_number);
        if (entrySeason !== season || entryEpisode !== episode) return false;
        if (Number.isInteger(tid) && tid > 0) {
            return Number(entry.tmdbId || entry.tmdb_id) === tid;
        }
        return true;
    }

    return false;
}

function findResumeEntry({ id, videoId, movieId, episodeId, tmdbId, mediaType, seasonNumber, episodeNumber } = {}) {
    const items = [...history.value].sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    const numericMovieId = Number(movieId);
    const numericEpisodeId = episodeId == null ? null : Number(episodeId);
    const numericTmdbId = Number(tmdbId);
    const normalizedMediaType = mediaType === 'movie' || mediaType === 'tv' ? mediaType : '';
    const numericSeason = Number(seasonNumber);
    const numericEpisode = Number(episodeNumber);
    const tmdbContentId = normalizedMediaType && Number.isInteger(numericTmdbId) && numericTmdbId > 0
        ? `tmdb:${normalizedMediaType}:${numericTmdbId}`
        : '';
    const tmdbVideoId = normalizedMediaType === 'tv'
        && Number.isInteger(numericTmdbId)
        && Number.isInteger(numericSeason)
        && Number.isInteger(numericEpisode)
        ? `tmdb:tv:${numericTmdbId}:${numericSeason}:${numericEpisode}`
        : '';
    const key = historyItemKey({
        id: id || tmdbContentId,
        videoId: videoId || tmdbVideoId,
        movieId,
        episodeId,
    });

    const byKey = items.find((item) => historyItemKey(item) === key);
    if (byKey) return byKey;

    if (videoId) {
        const byVideo = items.find((item) => item.videoId === videoId);
        if (byVideo) return byVideo;
    }
    if (tmdbVideoId) {
        const byTmdbVideo = items.find((item) => item.videoId === tmdbVideoId);
        if (byTmdbVideo) return byTmdbVideo;
    }
    if (Number.isInteger(numericMovieId) && numericEpisodeId != null && Number.isInteger(numericEpisodeId)) {
        const byEpisode = items.find((item) => Number(item.movieId) === numericMovieId && Number(item.episodeId) === numericEpisodeId);
        if (byEpisode) return byEpisode;
    }
    if (normalizedMediaType && Number.isInteger(numericTmdbId)
        && Number.isInteger(numericSeason) && Number.isInteger(numericEpisode)) {
        const byTmdbEpisode = items.find((item) => {
            if (Number(item.tmdbId || item.tmdb_id) !== numericTmdbId) return false;
            if ((item.mediaType || item.media_type) !== normalizedMediaType) return false;
            return Number(item.seasonNumber ?? item.season_number) === numericSeason
                && Number(item.episodeNumber ?? item.episode_number) === numericEpisode;
        });
        if (byTmdbEpisode) return byTmdbEpisode;
    }

    const episodeScoped = isEpisodePlaybackQuery({
        videoId, episodeId, seasonNumber, episodeNumber, mediaType: normalizedMediaType || mediaType,
    });
    if (episodeScoped) return null;

    if (tmdbContentId) {
        const byTmdbContent = items.find((item) => item.id === tmdbContentId && !item.videoId);
        if (byTmdbContent) return byTmdbContent;
    }
    if (id) {
        const byContent = items.find((item) => item.id === id && !item.videoId);
        if (byContent) return byContent;
    }
    if (Number.isInteger(numericMovieId) && numericEpisodeId == null) {
        return items.find((item) => Number(item.movieId) === numericMovieId && !item.episodeId) || null;
    }
    return null;
}

function historyItemKey(item = {}) {
    const storedKey = item.playbackKey ? String(item.playbackKey) : '';
    if (item.videoId) return `video:${item.videoId}`;
    if (storedKey.startsWith('video:')) return storedKey;
    if (tmdbPartsFromId(item.id)) return `content:${item.id}`;
    if (storedKey.startsWith('content:tmdb:')) return storedKey;
    const movieId = Number(item.movieId);
    if (Number.isInteger(movieId) && movieId > 0) return `movie:${movieId}:episode:${item.episodeId || 0}`;
    if (storedKey.startsWith('movie:')) return storedKey;
    if (item.id) return `content:${item.id}`;
    if (storedKey) return storedKey;
    return 'content:';
}

// ===== 登录后拉取服务端数据并合并到本地 =====
// 在登录成功后调用：先把本地游客数据推送到服务端（避免游客期收藏/进度丢失），
// 再把服务端数据拉回合并（服务端为准，本地补充）。
export async function syncFromServer() {
    if (!user.value) return;
    if (syncPromise) return syncPromise;
    librarySyncState.value = 'syncing';
    syncPromise = doSyncFromServer()
        .then(() => {
            librarySyncState.value = 'done';
        })
        .catch(() => {
            librarySyncState.value = 'error';
        })
        .finally(() => {
            syncPromise = null;
        });
    return syncPromise;
}

/** 后台触发片库同步（登录成功后立即返回 UI，同步在后台完成） */
export function scheduleLibrarySync() {
    void syncFromServer();
}

async function doSyncFromServer() {
    const usedBatch = await pushLocalToServerBatch();
    const pulled = await pullLibraryBundle();
    if (usedBatch && pulled) return;
    if (!usedBatch) await pushLocalToServer();
    if (!pulled) await Promise.all([pullWatchlist(), pullWatchLater(), pullHistory()]);
}

async function pushLocalToServerBatch() {
    const watchlist = favorites.value.filter(hasServerIdentity).map((item) => serverIdentityPayload(item));
    const watchLaterItems = watchLater.value.filter(hasServerIdentity).map((item) => serverIdentityPayload(item));
    const historyItems = history.value
        .filter((item) => hasServerIdentity(item) && shouldSyncHistoryProgress(item))
        .map((item) => ({
            ...serverIdentityPayload(item),
            progress: Math.floor(item.progress),
            duration: Math.floor(item.duration || 0),
            ...(Number(item.percent) > 0 ? { percent: Math.floor(item.percent) } : {}),
        }));
    if (!watchlist.length && !watchLaterItems.length && !historyItems.length) return true;
    try {
        await apiPost('/me/library-sync', { watchlist, watchLater: watchLaterItems, history: historyItems });
        return true;
    } catch {
        return false;
    }
}

function mapWatchlistItems(items = []) {
    return items.map((it) => ({
        id: tmdbItemId(it),
        movieId: it.guangying?.movie_id || it.movieId,
        tmdbId: it.tmdbId || it.tmdb_id,
        mediaType: it.mediaType || it.media_type,
        type: (it.media_type || it.mediaType) === 'movie' ? 'movie' : 'series',
        name: it.display_title || it.title || it.name,
        poster: normalizePoster(it.poster_path || it.guangying?.poster),
        year: it.year,
        addedAt: it.addedAt ? it.addedAt * 1000 : Date.now(),
    }));
}

async function pullLibraryBundle() {
    try {
        const data = await apiGet('/me/library?resumeLimit=30&skipCache=1');
        if (data?.watchlist?.items) {
            favorites.value = mergeById(mapWatchlistItems(data.watchlist.items), favorites.value);
            saveToStorage(FAVORITES_KEY, favorites.value);
        }
        if (data?.watchLater?.items) {
            watchLater.value = mergeById(mapWatchlistItems(data.watchLater.items), watchLater.value).slice(0, MAX_WATCH_LATER);
            saveToStorage(WATCH_LATER_KEY, watchLater.value);
        }
        const resumeItems = await Promise.resolve(mapHistoryItems(data?.resume?.items || []));
        const historyItems = mapHistoryItems(data?.history?.items || []);
        history.value = mergeByHistoryKey([...resumeItems, ...historyItems], history.value).slice(0, MAX_HISTORY);
        saveToStorage(HISTORY_KEY, history.value);
        return true;
    } catch {
        return false;
    }
}

function mapHistoryItems(items = []) {
    return items.map((it) => {
        const item = {
            id: tmdbItemId(it),
            serverHistoryId: it.serverHistoryId || it.id,
            movieId: it.guangying?.movie_id || it.movieId,
            episodeId: it.guangying?.episode_id || it.episodeId || null,
            tmdbId: it.tmdbId || it.tmdb_id,
            mediaType: it.mediaType || it.media_type,
            videoId: it.videoId || videoIdFromHistoryItem(it),
            type: (it.media_type || it.mediaType) === 'movie' ? 'movie' : 'series',
            name: it.display_title || it.title || it.name,
            episodeTitle: it.episode_title || it.epTitle || '',
            episodeLabel: episodeLabelFromHistoryItem(it),
            subtitle: episodeLabelFromHistoryItem(it),
            poster: normalizePoster(it.poster_path || it.backdrop_path || it.guangying?.poster || it.guangying?.backdrop),
            progress: it.resume?.progress ?? it.progress,
            duration: it.resume?.duration ?? it.duration,
            percent: it.resume?.percent,
            watchedAt: it.updatedAt ? it.updatedAt * 1000 : Date.now(),
        };
        return { ...item, playbackKey: historyItemKey(item) };
    });
}

export async function syncMovieHistory(movieId) {
    if (!user.value || !movieId) return false;
    try {
        const payload = serverIdentityPayload(typeof movieId === 'object' ? movieId : { movieId });
        const query = payload.tmdbId && payload.mediaType
            ? `tmdbId=${encodeURIComponent(payload.tmdbId)}&mediaType=${encodeURIComponent(payload.mediaType)}`
            : `movieId=${encodeURIComponent(movieId)}`;
        const items = await fetchHistoryItems(`/me/history?${query}`);
        history.value = mergeByHistoryKey(items, history.value).slice(0, MAX_HISTORY);
        saveToStorage(HISTORY_KEY, history.value);
        return true;
    } catch {
        return false;
    }
}

// 把登录前在本地积累的游客数据推送到服务端（优先推 TMDB 身份）
async function pushLocalToServer() {
    const favs = favorites.value.filter(hasServerIdentity);
    for (const f of favs) {
        await serverWatchlist(f, 'add');
    }
    const laterItems = watchLater.value.filter(hasServerIdentity);
    for (const item of laterItems) {
        await serverWatchLater(item, 'add');
    }
    const hist = history.value.filter(h => hasServerIdentity(h) && shouldSyncHistoryProgress(h));
    for (const h of hist) {
        await postHistory(h);
    }
}

async function pullWatchLater() {
    try {
        const data = await apiGet('/me/watch-later');
        watchLater.value = mergeById(mapWatchlistItems(data.items || []), watchLater.value).slice(0, MAX_WATCH_LATER);
        saveToStorage(WATCH_LATER_KEY, watchLater.value);
    } catch { /* 忽略，保留本地 */ }
}

async function pullWatchlist() {
    try {
        const data = await apiGet('/me/watchlist');
        favorites.value = mergeById(mapWatchlistItems(data.items || []), favorites.value);
        saveToStorage(FAVORITES_KEY, favorites.value);
    } catch { /* 忽略，保留本地 */ }
}

async function pullHistory() {
    try {
        const [resumeItems, historyItems] = await Promise.all([
            fetchHistoryItems('/me/resume?limit=30').catch(() => []),
            fetchHistoryItems('/me/history').catch(() => []),
        ]);
        history.value = mergeByHistoryKey([...resumeItems, ...historyItems], history.value).slice(0, MAX_HISTORY);
        saveToStorage(HISTORY_KEY, history.value);
    } catch { /* 忽略 */ }
}

async function fetchHistoryItems(path) {
    const data = await apiGet(path);
    return mapHistoryItems(data.items || []);
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

function mergeByHistoryKey(serverItems, localItems) {
    return normalizeHistoryList([...serverItems, ...localItems]);
}

function mergeHistoryEntries(prev, next) {
    const key = historyItemKey(prev);
    const prevTime = Number(prev.watchedAt || 0);
    const nextTime = Number(next.watchedAt || 0);
    const prevProgress = Number(prev.progress) || 0;
    const nextProgress = Number(next.progress) || 0;
    const primary = nextTime >= prevTime ? next : prev;
    const secondary = primary === next ? prev : next;
    const merged = { ...secondary, ...primary, playbackKey: key, watchedAt: Math.max(prevTime, nextTime) };

    const prevDone = isCompletedHistoryItem(prev);
    const nextDone = isCompletedHistoryItem(next);
    if (prevDone || nextDone) {
        const rewatchInProgress = prevDone
            && !nextDone
            && nextProgress >= RESUME_MIN_SECONDS
            && nextTime >= prevTime;
        if (rewatchInProgress) {
            return {
                ...merged,
                progress: nextProgress,
                duration: Number(next.duration) || merged.duration || 0,
                percent: next.percent != null ? next.percent : merged.percent,
                watchedAt: Math.max(prevTime, nextTime),
            };
        }
        const done = (nextDone && nextTime >= prevTime) || !prevDone ? next : prev;
        return {
            ...merged,
            progress: Number(done.progress) || 0,
            duration: Number(done.duration) || merged.duration || 0,
            percent: Number(done.percent) || 100,
            watchedAt: Math.max(prevTime, nextTime),
        };
    }

    const bestProgress = Math.max(prevProgress, nextProgress);
    if (bestProgress > 0) {
        merged.progress = bestProgress;
        const source = prevProgress >= nextProgress ? prev : next;
        if (Number(source.duration) > 0) merged.duration = source.duration;
        if (source.percent != null) merged.percent = source.percent;
    } else {
        merged.progress = 0;
    }
    return merged;
}

function normalizeHistoryList(items = []) {
    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        if (!item) continue;
        const key = historyItemKey(item);
        const normalized = normalizeStoredMediaItem({ ...item, playbackKey: key });
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, normalized);
            continue;
        }
        byKey.set(key, mergeHistoryEntries(prev, normalized));
    }
    return [...byKey.values()].sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
}

function normalizeStoredMediaList(items = []) {
    return (Array.isArray(items) ? items : []).map(normalizeStoredMediaItem).filter(Boolean);
}

function normalizeStoredMediaItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
        ...item,
        poster: repairStoredPoster(item.poster),
        background: repairStoredPoster(item.background),
    };
}

// ===== 服务端写入（带 cookie；公开失败不影响本地体验）=====
const pendingWatchlistOps = new Map();
const pendingWatchLaterOps = new Map();
let watchlistSyncTimer = null;
let watchLaterSyncTimer = null;
const LIBRARY_LIST_SYNC_MS = 400;

function watchlistSyncKey(item) {
    const payload = serverIdentityPayload(item);
    if (payload.tmdbId && payload.mediaType) {
        return ['tmdb', payload.tmdbId, payload.mediaType].join(':');
    }
    return ['movie', payload.movieId, payload.episodeId ?? ''].join(':');
}

function watchLaterSyncKey(item) {
    return watchlistSyncKey(item);
}

async function serverWatchlist(item, action) {
    pendingWatchlistOps.set(watchlistSyncKey(item), { item, action });
    scheduleWatchlistSync();
}

async function serverWatchLater(item, action) {
    pendingWatchLaterOps.set(watchLaterSyncKey(item), { item, action });
    scheduleWatchLaterSync();
}

function scheduleWatchlistSync() {
    if (watchlistSyncTimer) return;
    watchlistSyncTimer = setTimeout(() => {
        watchlistSyncTimer = null;
        flushWatchlistSync();
    }, LIBRARY_LIST_SYNC_MS);
}

function scheduleWatchLaterSync() {
    if (watchLaterSyncTimer) return;
    watchLaterSyncTimer = setTimeout(() => {
        watchLaterSyncTimer = null;
        flushWatchLaterSync();
    }, LIBRARY_LIST_SYNC_MS);
}

async function flushWatchlistSync() {
    if (watchlistSyncTimer) {
        clearTimeout(watchlistSyncTimer);
        watchlistSyncTimer = null;
    }
    const ops = [...pendingWatchlistOps.values()];
    pendingWatchlistOps.clear();
    for (const { item, action } of ops) {
        try {
            await apiPost('/me/watchlist', { ...serverIdentityPayload(item), action });
        } catch { /* 静默 */ }
    }
}

async function flushWatchLaterSync() {
    if (watchLaterSyncTimer) {
        clearTimeout(watchLaterSyncTimer);
        watchLaterSyncTimer = null;
    }
    const ops = [...pendingWatchLaterOps.values()];
    pendingWatchLaterOps.clear();
    for (const { item, action } of ops) {
        try {
            await apiPost('/me/watch-later', { ...serverIdentityPayload(item), action });
        } catch { /* 静默 */ }
    }
}

// ===== 进度上报节流（对标大厂心跳：窗口内只保留最新一次，降低写入频率）=====
const pendingHistorySync = new Map();
let historySyncTimer = null;
let lastHistorySyncAt = 0;

function historySyncKey(item) {
    // 与本地 historyItemKey 对齐，避免同一部剧多集在 pending 队列里互相覆盖
    return historyItemKey(item);
}

function serverHistory(item) {
    pendingHistorySync.set(historySyncKey(item), item);
    scheduleHistorySync();
}

function scheduleHistorySync() {
    if (historySyncTimer) return;
    const delay = Math.max(0, HISTORY_SYNC_THROTTLE_MS - (Date.now() - lastHistorySyncAt));
    historySyncTimer = setTimeout(() => {
        historySyncTimer = null;
        flushHistorySync();
    }, delay);
}

/** 立即上报所有挂起进度；keepalive 用于页面卸载/切后台时兜底，避免请求被取消 */
export function flushHistorySync({ keepalive = false } = {}) {
    if (historySyncTimer) {
        clearTimeout(historySyncTimer);
        historySyncTimer = null;
    }
    if (!user.value || pendingHistorySync.size === 0) return;
    lastHistorySyncAt = Date.now();
    const items = [...pendingHistorySync.values()];
    pendingHistorySync.clear();
    for (const item of items) postHistory(item, { keepalive });
}

function postHistory(item, options = {}) {
    const progress = Math.floor(Number(item.progress) || 0);
    const duration = Math.floor(Number(item.duration) || 0);
    const percent = Math.floor(Number(item.percent) || 0);
    return apiPost('/me/history', {
        ...serverIdentityPayload(item),
        progress,
        duration,
        ...(percent > 0 ? { percent } : {}),
    }, options).catch(() => {});
}

async function serverClearHistory() {
    try {
        await apiFetch('/me/history', { method: 'DELETE' });
    } catch { /* 静默 */ }
}

async function serverRemoveHistory(item) {
    const historyId = Number(item.serverHistoryId);
    if (!Number.isInteger(historyId) || historyId < 1) return;
    try {
        await apiFetch(`/me/history/${historyId}`, { method: 'DELETE' });
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
        scheduleLibrarySync();
    } else if (!uid && _lastUserId) {
        flushHistorySync({ keepalive: true });
        _lastUserId = null;
        librarySyncState.value = 'idle';
        favorites.value = [];
        history.value = [];
        watchLater.value = [];
        saveToStorage(FAVORITES_KEY, []);
        saveToStorage(HISTORY_KEY, []);
        saveToStorage(WATCH_LATER_KEY, []);
    }
});

// ===== HTTP 工具（用户接口带 cookie）=====
async function apiGet(path) {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPost(path, body, extraOptions = {}) {
    const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...extraOptions,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function apiUrls(path) {
    return [`${API_V1_BASE}${path}`];
}

async function apiFetch(path, options = {}) {
    const urls = apiUrls(path);
    let firstResponse = null;
    for (const url of urls) {
        const res = await fetch(url, {
            credentials: 'include',
            ...options,
        });
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) return res;
    }
    return firstResponse;
}

function normalizePoster(p, row = null) {
    void row;
    if (!p) return '';
    return normalizeTmdbImageUrl(p, 'w500');
}

function repairStoredPoster(value) {
    if (!value || typeof value !== 'string') return value || '';
    return normalizeTmdbImageUrl(value, 'w500') || value;
}

function tmdbPartsFromId(value) {
    const match = String(value || '').match(/^tmdb:(movie|tv):(\d+)(?::(\d+):(\d+))?$/);
    if (!match) return null;
    return {
        mediaType: match[1],
        tmdbId: Number(match[2]),
        seasonNumber: match[3] ? Number(match[3]) : null,
        episodeNumber: match[4] ? Number(match[4]) : null,
    };
}

function tmdbItemId(item = {}) {
    if (typeof item.id === 'string' && item.id.startsWith('tmdb:')) return item.id;
    const mediaType = item.mediaType || item.media_type;
    const tmdbId = item.tmdbId || item.tmdb_id;
    if ((mediaType === 'movie' || mediaType === 'tv') && tmdbId) return `tmdb:${mediaType}:${tmdbId}`;
    return item.slug ? `gy:${item.slug}` : String(item.id || '');
}

function serverIdentityPayload(item = {}) {
    const fromVideo = tmdbPartsFromId(item.videoId);
    const fromId = tmdbPartsFromId(item.id);
    const tmdb = fromVideo || fromId;
    if (tmdb?.tmdbId) {
        return {
            tmdbId: tmdb.tmdbId,
            mediaType: tmdb.mediaType,
            ...(tmdb.seasonNumber != null ? { seasonNumber: tmdb.seasonNumber } : {}),
            ...(tmdb.episodeNumber != null ? { episodeNumber: tmdb.episodeNumber } : {}),
        };
    }
    const itemTmdbId = item.tmdbId || item.tmdb_id;
    const itemMediaType = item.mediaType || item.media_type;
    if (itemTmdbId && itemMediaType) {
        return {
            tmdbId: itemTmdbId,
            mediaType: itemMediaType,
            ...(item.seasonNumber != null ? { seasonNumber: item.seasonNumber } : {}),
            ...(item.episodeNumber != null ? { episodeNumber: item.episodeNumber } : {}),
        };
    }
    return {
        movieId: item.movieId,
        episodeId: item.episodeId || undefined,
    };
}

function hasServerIdentity(item = {}) {
    const payload = serverIdentityPayload(item);
    return Boolean((payload.tmdbId && payload.mediaType) || payload.movieId);
}

function videoIdFromHistoryItem(item) {
    if (item?.videoId) return item.videoId;
    const mediaType = item.mediaType || item.media_type;
    const tmdbId = item.tmdbId || item.tmdb_id;
    const season = Number(item.season_number || item.epSeason);
    const episode = Number(item.episode_number || item.epEpisode);
    if (mediaType === 'tv' && tmdbId && Number.isInteger(season) && Number.isInteger(episode)) {
        return `tmdb:tv:${tmdbId}:${season}:${episode}`;
    }
    if (!item?.episodeId) return null;
    if (!Number.isInteger(season) || !Number.isInteger(episode)) return null;
    return `gy:${item.slug}:${season}:${episode}`;
}

function episodeLabelFromHistoryItem(item) {
    const season = Number(item.season_number || item.epSeason);
    const episode = Number(item.episode_number || item.epEpisode);
    if (!item?.episodeId && (!Number.isInteger(season) || !Number.isInteger(episode))) return '';
    const code = [
        Number.isInteger(season) ? `S${season}` : '',
        Number.isInteger(episode) ? `E${episode}` : '',
    ].join('');
    return [code, item.episode_title || item.epTitle].filter(Boolean).join(' · ');
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

export { mergeHistoryEntries };

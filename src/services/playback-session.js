// 全屏 / 内嵌播放共用会话层：取流加载、多源 recovery、错误事件与 codec 探测。
// gy-player 仍负责 UI；本模块负责 Web 侧业务胶水。

import { getStream } from './api.js';
import { getResumeProgress } from './library.js';
import { mapSubtitles } from './subtitle-preference.js';
import { API_V1_BASE } from './config.js';

export function formatPlaybackClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function normalizePlaybackProgress(currentTime, duration, percent) {
    const time = Math.max(0, Number(currentTime) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    const pct = Number.isFinite(percent) ? percent : (dur > 0 ? (time / dur) * 100 : 0);
    return { currentTime: time, duration: dur, percent: Math.min(100, Math.max(0, pct)) };
}

export function usesSafariNativeHls() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(ua);
}

/** 播放地址追加 compat=ios，让 API 过滤 master 中 Safari 不兼容的变体 */
export function withSafariStreamCompat(url) {
    if (!url || !usesSafariNativeHls()) return url;
    if (/[?&]compat=ios(?:&|$)/i.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}compat=ios`;
}

function hlsCodecUnsupportedInBrowser(codecList) {
    if (usesSafariNativeHls()) return null;
    const codecs = String(codecList || '').toLowerCase().split(',').map((part) => part.trim());
    const blocked = ['ec-3', 'eac3', 'eac-3', 'ac-3', 'ac3'];
    for (const codec of codecs) {
        if (blocked.some((token) => codec.includes(token))) return codec;
    }
    return null;
}

export function dolbyCodecPlaybackMessage(codec) {
    const label = codec ? `（${codec}）` : '';
    return `本片音轨为杜比环绕声${label}，Chrome / Firefox 无法解码。请使用 Safari 观看，或等待片源重新编码为 AAC。`;
}

export async function probeStreamCodecSupport(streamUrl) {
    if (!streamUrl || usesSafariNativeHls()) return { ok: true };
    try {
        const res = await fetch(streamUrl, { credentials: 'include' });
        if (!res.ok) return { ok: true };
        const text = await res.text();
        for (const match of text.matchAll(/CODECS="([^"]+)"/gi)) {
            const blocked = hlsCodecUnsupportedInBrowser(match[1]);
            if (blocked) return { ok: false, codec: blocked };
        }
        return { ok: true };
    } catch {
        return { ok: true };
    }
}

export function streamSourcesForPlayer(list = []) {
    return list.map((source) => ({
        url: source.url,
        label: source.title || source.label || source.quality || '播放源',
        quality: source.quality || source.title || source.label || '',
        subtitles: mapSubtitles(source.subtitles),
    }));
}

export function sourcePreferenceValue(source) {
    return String(source?.quality || source?.title || source?.label || '').trim().toLowerCase();
}

export function buildEpisodeTitle(metaTitle, episode, videos = []) {
    const title = metaTitle || '';
    if (!episode?.id || videos.length === 0) return title;
    const v = videos.find((x) => x.id === episode.id) || episode;
    if (!v) return title;
    const parts = [title];
    let code = '';
    if (v.season != null) code += `S${v.season}`;
    if (v.episode != null) code += `E${v.episode}`;
    if (code) parts.push(code);
    if (v.title) parts.push(v.title);
    return parts.join(' · ');
}

/**
 * @param {object} config
 * @param {() => HTMLElement|null} config.getPlayer
 * @param {() => object|null} config.getMeta
 * @param {string} config.type
 * @param {string} config.id
 * @param {string} [config.streamId]
 * @param {'inline'|'fullscreen'} config.layout
 * @param {() => boolean} [config.getPreviewMode]
 * @param {object} [config.hooks]
 */
export function createPlaybackHost(config) {
    const {
        getPlayer,
        getMeta,
        type,
        id,
        streamId: initialStreamId = id,
        layout,
        getPreviewMode = () => false,
        hooks = {},
    } = config;

    const state = {
        recoveryInFlight: false,
        terminalErrorVisible: false,
        failedSourceUrls: new Set(),
        currentStreams: [],
        currentStreamUrl: '',
        currentVid: null,
        lastProgress: { currentTime: 0, duration: 0, percent: 0 },
        lastPlaybackError: null,
        loadGeneration: 0,
    };

    let streamId = initialStreamId;

    const videos = () => getMeta()?.videos || [];
    const episodeFor = (vid) => {
        if (!vid || videos().length === 0) return null;
        return videos().find((x) => x.id === vid) || null;
    };
    const episodeIdFor = (vid) => episodeFor(vid)?.episodeId ?? null;
    const titleFor = (vid) => buildEpisodeTitle(getMeta()?.name || '', { id: vid }, videos());

    const resumeFor = (vid) => {
        const meta = getMeta();
        if (!meta) return null;
        const episode = episodeFor(vid);
        return getResumeProgress({
            id,
            videoId: vid || null,
            movieId: meta.movieId,
            tmdbId: meta.tmdbId,
            mediaType: meta.mediaType || (type === 'movie' ? 'movie' : 'tv'),
            episodeId: episodeIdFor(vid),
            seasonNumber: episode?.season,
            episodeNumber: episode?.episode,
        });
    };

    function nextAvailableSource(options = {}) {
        const candidates = state.currentStreams.filter((stream) => stream?.url && stream.url !== state.currentStreamUrl);
        return candidates.find((stream) => !state.failedSourceUrls.has(stream.url)) ||
            (options.allowTried ? candidates[0] || null : null);
    }

    function preferredPlaybackSource(label) {
        const normalized = sourcePreferenceValue({ label });
        if (!normalized) return null;
        return state.currentStreams.find((stream) => (
            stream?.url &&
            stream.url !== state.currentStreamUrl &&
            !state.failedSourceUrls.has(stream.url) &&
            sourcePreferenceValue(stream) === normalized
        )) || state.currentStreams.find((stream) => (
            stream?.url &&
            stream.url !== state.currentStreamUrl &&
            sourcePreferenceValue(stream) === normalized
        )) || null;
    }

    function playerErrorActions(options = {}) {
        if (typeof hooks.playerErrorActions === 'function') {
            return hooks.playerErrorActions(options, { nextAvailableSource, state });
        }
        const hasFallback = !!nextAvailableSource({ allowTried: true });
        if (hasFallback && !options.vip) {
            return [
                { id: 'next-source', label: '切换备用源' },
                { id: 'retry-current-source', label: '重试当前源', variant: 'secondary' },
            ];
        }
        const primary = options.vip
            ? { id: 'vip', label: '查看会员权益' }
            : { id: 'retry-current-source', label: '重试当前源' };
        return [primary, { id: 'reload-stream', label: '重新获取地址', variant: 'secondary' }];
    }

    function showTerminalPlaybackError() {
        state.terminalErrorVisible = true;
        state.recoveryInFlight = false;
        const player = getPlayer();
        player?.showErrorActions?.('当前播放源不可用，已尝试所有备用源', playerErrorActions());
        hooks.onTerminalError?.();
    }

    async function loadInto(stream, vid, streamList = state.currentStreams, options = {}) {
        const player = getPlayer();
        if (!player || !stream?.url) return false;

        const gen = ++state.loadGeneration;
        const keepLock = options.keepRecoveryLock === true;

        if (!keepLock) {
            state.recoveryInFlight = false;
        }
        if (!options.keepFailedSources) {
            state.failedSourceUrls.clear();
        }
        if (!options.recovery) {
            state.terminalErrorVisible = false;
        }

        state.currentStreams = streamList;
        state.currentStreamUrl = stream.url;
        state.currentVid = vid;

        const playbackUrl = withSafariStreamCompat(stream.url);

        const previousProgress = state.lastProgress;
        const resume = resumeFor(vid);
        const startTime = typeof options.startTime === 'number' ? options.startTime : resume?.progress;
        state.lastProgress = {
            currentTime: startTime || 0,
            duration: options.recovery ? previousProgress.duration : 0,
            percent: options.recovery ? previousProgress.percent : 0,
        };

        if (typeof hooks.beforeLoad === 'function') {
            hooks.beforeLoad({ stream, vid, streamList, options, state });
        }

        const codecSupport = await probeStreamCodecSupport(playbackUrl);
        if (!codecSupport.ok) {
            if (keepLock) state.recoveryInFlight = false;
            player.hideBootLoading?.();
            player.showErrorActions?.(
                dolbyCodecPlaybackMessage(codecSupport.codec),
                playerErrorActions(),
            );
            hooks.onCodecBlocked?.(codecSupport, { vid, stream });
            return false;
        }

        const loadOpts = typeof hooks.buildLoadStreamOptions === 'function'
            ? hooks.buildLoadStreamOptions({ stream, vid, streamList, options, startTime, resume })
            : {
                title: titleFor(vid),
                videoId: vid || id,
                poster: getMeta()?.background || getMeta()?.poster || '',
                subtitles: mapSubtitles(stream.subtitles),
                sources: streamSourcesForPlayer(streamList),
                sourceUrl: stream.url,
                errorActions: playerErrorActions(),
                startTime,
                disableStorage: true,
                playAfterLoad: options.playAfterLoad,
                layout,
                danmaku: getPreviewMode() ? false : {
                    videoId: getMeta()?.analyticsVideoId || vid || id,
                    apiBase: API_V1_BASE,
                },
            };

        try {
            await player.loadStream(playbackUrl, loadOpts);
        } catch (err) {
            if (keepLock) state.recoveryInFlight = false;
            throw err;
        }

        if (gen !== state.loadGeneration) {
            if (keepLock) state.recoveryInFlight = false;
            return false;
        }

        if (keepLock) state.recoveryInFlight = false;

        if (typeof hooks.afterLoad === 'function') {
            hooks.afterLoad({ stream, vid, streamList, options, startTime, resume, state });
        }
        return true;
    }

    function recoverFromPlaybackError(detail) {
        if (detail?.fatal === false || state.recoveryInFlight || state.terminalErrorVisible) return;
        if (state.currentStreamUrl) state.failedSourceUrls.add(state.currentStreamUrl);
        const fallback = nextAvailableSource();
        if (!fallback) {
            showTerminalPlaybackError();
            return;
        }
        const player = getPlayer();
        state.recoveryInFlight = true;
        const label = fallback.quality || fallback.title || fallback.label || '备用播放源';
        player?.showHint?.(`播放异常，正在尝试 ${label}`);
        setTimeout(() => {
            void loadInto(fallback, state.currentVid, state.currentStreams, {
                startTime: state.lastProgress.currentTime,
                playAfterLoad: true,
                recovery: true,
                keepFailedSources: true,
                keepRecoveryLock: true,
            });
        }, 800);
    }

    async function retryCurrentPlayback() {
        if (state.recoveryInFlight) return;
        const player = getPlayer();
        state.recoveryInFlight = true;
        state.terminalErrorVisible = false;
        player?.hideErrorActions?.();
        player?.showHintHold?.('正在重新获取播放地址');
        try {
            const refreshed = await getStream(type, state.currentVid || streamId);
            if (!refreshed || refreshed.length === 0) {
                throw new Error('no_streams');
            }
            state.failedSourceUrls.clear();
            state.currentStreams = refreshed;
            const candidate = refreshed.find((s) => s?.url === state.currentStreamUrl) || refreshed[0];
            await loadInto(candidate, state.currentVid, refreshed, {
                startTime: state.lastProgress.currentTime,
                playAfterLoad: true,
                recovery: true,
                keepRecoveryLock: true,
            });
        } catch (err) {
            state.recoveryInFlight = false;
            hooks.onReloadStreamFailed?.(err, playerErrorActions);
        } finally {
            player?.hideHint?.();
        }
    }

    function retryCurrentSource() {
        if (state.recoveryInFlight) return;
        const player = getPlayer();
        const current = state.currentStreams.find((s) => s?.url === state.currentStreamUrl) || state.currentStreams[0];
        if (!current?.url) {
            player?.showErrorActions?.('当前播放源不存在，请重新获取播放地址', playerErrorActions());
            return;
        }
        state.recoveryInFlight = true;
        state.terminalErrorVisible = false;
        state.failedSourceUrls.delete(current.url);
        player?.hideErrorActions?.();
        player?.showHintHold?.('正在重试当前播放源');
        void loadInto(current, state.currentVid, state.currentStreams, {
            startTime: state.lastProgress.currentTime,
            playAfterLoad: true,
            recovery: true,
            recoveryMessage: '已重试当前播放源',
            keepFailedSources: true,
            keepRecoveryLock: true,
        });
        setTimeout(() => player?.hideHint?.(), 600);
    }

    function switchToNextSource(options = {}) {
        if (state.recoveryInFlight) return;
        const player = getPlayer();
        const fallback = preferredPlaybackSource(options.preferredLabel) || nextAvailableSource({ allowTried: true });
        if (!fallback) {
            player?.showErrorActions?.('没有可切换的备用播放源', playerErrorActions());
            return;
        }
        if (state.currentStreamUrl) state.failedSourceUrls.add(state.currentStreamUrl);
        state.recoveryInFlight = true;
        state.terminalErrorVisible = false;
        player?.hideErrorActions?.();
        const label = fallback.quality || fallback.title || fallback.label || '备用播放源';
        player?.showHintHold?.(`正在切换到 ${label}`);
        setTimeout(async () => {
            await loadInto(fallback, state.currentVid, state.currentStreams, {
                startTime: state.lastProgress.currentTime,
                playAfterLoad: true,
                recovery: true,
                keepFailedSources: true,
                keepRecoveryLock: true,
            });
            player?.hideHint?.();
        }, 300);
    }

    function handleErrorAction(actionId) {
        if (actionId === 'reload-stream') {
            void retryCurrentPlayback();
        } else if (actionId === 'retry-current-source') {
            retryCurrentSource();
        } else if (actionId === 'next-source') {
            switchToNextSource();
        } else if (typeof hooks.onErrorAction === 'function') {
            hooks.onErrorAction(actionId);
        }
    }

    function bindPlayerEvents(player) {
        player.addEventListener('error', (e) => {
            const detail = e.detail || {};
            state.lastPlaybackError = detail;
            if (detail.fatal !== false) {
                hooks.reportPlaybackError?.(detail);
            }
            recoverFromPlaybackError(detail);
        });
        player.addEventListener('erroraction', (e) => {
            handleErrorAction(e.detail?.id);
        });
        player.addEventListener('sourcechange', (e) => {
            const detail = e.detail || {};
            state.recoveryInFlight = false;
            state.terminalErrorVisible = false;
            if (detail.sourceUrl) {
                state.currentStreamUrl = detail.sourceUrl;
                state.failedSourceUrls.delete(detail.sourceUrl);
            }
            hooks.onSourceChange?.(detail);
        });
    }

    return {
        state,
        streamIdRef: { get: () => streamId, set: (v) => { streamId = v; } },
        titleFor,
        resumeFor,
        episodeFor,
        episodeIdFor,
        loadInto,
        bindPlayerEvents,
        recoverFromPlaybackError,
        retryCurrentPlayback,
        retryCurrentSource,
        switchToNextSource,
        nextAvailableSource,
        playerErrorActions,
        showTerminalPlaybackError,
    };
}

/** recoveryInFlight / keepRecoveryLock 决策（单测用） */
export function shouldClearRecoveryOnLoadStart(options = {}) {
    return options.keepRecoveryLock !== true;
}

export function shouldClearRecoveryAfterLoad(options = {}) {
    return options.keepRecoveryLock === true;
}

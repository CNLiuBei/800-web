// 详情页内嵌播放：hero 区域挂载 gy-player，与全屏页共用 playback-session。

import { getStream, getPlaybackPreview } from './api.js';
import { user, waitForAuthReady } from './auth.js';
import { addHistory, flushHistorySync } from './library.js';
import { historyProgressPayload } from './playback-progress.js';
import { reportPlaybackEvent } from './playback-analytics.js';
import { API_V1_BASE, DEFAULT_APP_LOGO_URL } from './config.js';
import { loadPlayerModule } from './player-module.js';
import { applyGyPlayerUiOverrides } from './player-ui-overrides.js';
import {
    createPlaybackHost,
    formatPlaybackClock,
    normalizePlaybackProgress,
    sourcePreferenceValue,
} from './playback-session.js';
import { showSiteNotice } from './site-notice.js';

async function loadPreviewStream(meta, videoId) {
    const source = selectPreviewSource(meta, videoId);
    if (!source) return null;
    try {
        return await getPlaybackPreview(source);
    } catch {
        return null;
    }
}

function selectPreviewSource(meta, videoId) {
    const sources = meta?.previewSources || [];
    if (!sources.length) return null;
    if (videoId) {
        return sources.find((source) => source.videoId === videoId) || null;
    }
    const movieSource = sources.find((source) => !source.episodeId);
    if (movieSource) return movieSource;
    const firstAvailable = (meta?.videos || []).find((video) => video.available);
    return sources.find((source) => source.videoId === firstAvailable?.id) || sources[0] || null;
}

export function createDetailInlinePlayer() {
    let player = null;
    let host = null;
    let cleanedUp = false;
    let meta = null;
    let type = null;
    let id = null;
    let mountEl = null;
    let pageEl = null;
    let previewMode = false;
    let onEpisodeChange = null;
    let onStop = null;
    let onPageHide = null;
    let onVisibilityChange = null;

    const videos = () => meta?.videos || [];

    const libraryPayload = () => ({
        id,
        type,
        name: meta?.name || '',
        poster: meta?.poster,
        year: meta?.year,
        movieId: meta?.movieId,
        tmdbId: meta?.tmdbId,
        mediaType: meta?.mediaType || (type === 'movie' ? 'movie' : 'tv'),
    });

    const historyPayload = (vid = host?.state.currentVid, extra = {}) => {
        const episode = host?.episodeFor(vid);
        return {
            ...libraryPayload(),
            videoId: vid || null,
            episodeId: host?.episodeIdFor(vid),
            seasonNumber: episode?.season,
            episodeNumber: episode?.episode,
            ...extra,
        };
    };

    const playbackAnalyticsPayload = (vid = host?.state.currentVid, extra = {}) => ({
        videoId: meta?.analyticsVideoId || vid || id,
        movieId: meta?.movieId,
        tmdbId: meta?.tmdbId,
        mediaType: meta?.mediaType || (type === 'movie' ? 'movie' : 'tv'),
        episodeId: host?.episodeIdFor(vid),
        ...extra,
    });

    const flushPlaybackProgress = () => {
        if (!meta || previewMode || !player || !host) return;
        const video = player.video;
        const videoTime = Number.isFinite(video?.currentTime) ? video.currentTime : host.state.lastProgress.currentTime;
        const videoDuration = Number.isFinite(video?.duration) ? video.duration : host.state.lastProgress.duration;
        if (!videoTime && !videoDuration) return;
        const progress = normalizePlaybackProgress(
            videoTime,
            videoDuration,
            videoDuration > 0 ? (videoTime / videoDuration) * 100 : host.state.lastProgress.percent,
        );
        host.state.lastProgress = progress;
        addHistory(historyPayload(host.state.currentVid, historyProgressPayload(
            progress.currentTime,
            progress.duration,
            progress.percent,
        )));
    };

    const updateEpisodeButtons = (vid) => {
        if (!player) return;
        const list = videos();
        if (list.length === 0 || !vid) {
            player.showPrevButton(false);
            player.showNextButton(false);
            return;
        }
        const idx = list.findIndex((v) => v.id === vid);
        player.showPrevButton(idx > 0);
        player.showNextButton(idx >= 0 && idx < list.length - 1);
    };

    const initHost = (streamId) => {
        host = createPlaybackHost({
            getPlayer: () => player,
            getMeta: () => meta,
            type,
            id,
            streamId,
            layout: 'inline',
            getPreviewMode: () => previewMode,
            hooks: {
                afterLoad: ({ stream, vid, options, startTime, resume }) => {
                    if (options.recovery) {
                        const label = stream.quality || stream.title || stream.label || '备用播放源';
                        setTimeout(() => player.showHint?.(options.recoveryMessage || `已切换到 ${label}`), 500);
                    } else if (resume?.progress && startTime > 0) {
                        setTimeout(() => player.showHint?.(`已从 ${formatPlaybackClock(resume.progress)} 继续播放`), 500);
                    }
                    reportPlaybackEvent('start', playbackAnalyticsPayload(vid, {
                        sourceLabel: stream.quality || stream.title || stream.label || '',
                        recovery: options.recovery === true,
                    }));
                    updateEpisodeButtons(vid);
                    player.setCurrentEpisode?.(vid);
                    if (meta && !previewMode) addHistory(historyPayload(vid));
                    onEpisodeChange?.(vid);
                },
                reportPlaybackError: (detail) => {
                    reportPlaybackEvent('error', playbackAnalyticsPayload(host.state.currentVid, {
                        position: host.state.lastProgress.currentTime,
                        duration: host.state.lastProgress.duration,
                        percent: host.state.lastProgress.percent,
                        errorCode: detail.code || detail.type || 'player_error',
                        errorMessage: detail.message || detail.reason || '',
                    }));
                },
                onReloadStreamFailed: (err) => {
                    const message = err?.needLogin
                        ? '登录状态已失效，请重新登录后观看'
                        : err?.forbidden
                            ? (err.message || '当前账号暂无观看权限')
                            : '重新获取播放地址失败，请稍后再试';
                    player.showErrorActions?.(message, host.playerErrorActions({ login: err?.needLogin, vip: err?.forbidden }));
                },
            },
        });
    };

    const preferredInitialStream = (list = []) => {
        try {
            const raw = localStorage.getItem('gyp_quality_pref');
            const pref = raw ? JSON.parse(raw) : null;
            if (pref?.kind === 'source') {
                const wanted = String(pref.value || '').trim().toLowerCase();
                if (wanted) {
                    return list.find((source) => sourcePreferenceValue(source) === wanted) || list[0];
                }
            }
        } catch {
            // ignore
        }
        return list[0];
    };

    const loadInto = async (stream, vid, streamList, options = {}) => {
        const ok = await host.loadInto(stream, vid, streamList, { playAfterLoad: true, ...options });
        if (ok !== false && player?.video?.paused) {
            try {
                await player.play?.();
            } catch {
                // Safari 可能在异步链后丢失 user activation，保留播放器内播放按钮
            }
        }
        return ok;
    };

    const adjacentEpisode = (dir) => {
        const list = videos();
        const currentVid = host?.state.currentVid;
        if (list.length === 0 || !currentVid) return null;
        const idx = list.findIndex((v) => v.id === currentVid);
        return idx >= 0 ? list[idx + dir] || null : null;
    };

    const playEpisodeById = async (vid) => {
        if (!vid || vid === host?.state.currentVid) return true;
        flushPlaybackProgress();
        flushHistorySync({ keepalive: true });
        if (!user.value) {
            showSiteNotice('请先登录后再观看');
            return false;
        }
        try {
            const nextStreams = await getStream(type, vid);
            if (!nextStreams?.length) {
                showSiteNotice('该集暂无播放源', { tone: 'error' });
                return false;
            }
            previewMode = false;
            await loadInto(preferredInitialStream(nextStreams), vid, nextStreams);
            return true;
        } catch (err) {
            if (err?.forbidden) {
                showSiteNotice(err.message || '无观看权限', { tone: 'error' });
            } else if (err?.needLogin) {
                showSiteNotice('请先登录后再观看');
            } else {
                showSiteNotice('切换剧集失败，请重试', { tone: 'error' });
            }
            return false;
        }
    };

    const switchEpisode = async (dir) => {
        const target = adjacentEpisode(dir);
        if (!target) return;
        await playEpisodeById(target.id);
    };

    const bindLifecycleFlush = () => {
        unbindLifecycleFlush();
        onPageHide = () => {
            flushPlaybackProgress();
            flushHistorySync({ keepalive: true });
        };
        onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                flushPlaybackProgress();
                flushHistorySync({ keepalive: true });
            }
        };
        window.addEventListener('pagehide', onPageHide);
        document.addEventListener('visibilitychange', onVisibilityChange);
    };

    const unbindLifecycleFlush = () => {
        if (onPageHide) {
            window.removeEventListener('pagehide', onPageHide);
            onPageHide = null;
        }
        if (onVisibilityChange) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            onVisibilityChange = null;
        }
    };

    const bindPlayerEvents = () => {
        if (!player || !host) return;
        bindLifecycleFlush();
        host.bindPlayerEvents(player);
        player.addEventListener('danmaku-login', async () => {
            const { openAuthModal } = await import('./auth-modal-loader.js');
            openAuthModal('login');
        });
        player.addEventListener('next', () => switchEpisode(1));
        player.addEventListener('prev', () => switchEpisode(-1));
        player.addEventListener('selectepisode', (e) => playEpisodeById(e.detail.id));
        player.addEventListener('back', () => stop());
        player.addEventListener('ended', () => {
            reportPlaybackEvent('complete', playbackAnalyticsPayload(host.state.currentVid, {
                position: host.state.lastProgress.duration || host.state.lastProgress.currentTime,
                duration: host.state.lastProgress.duration,
                percent: 100,
            }));
            if (meta && !previewMode) {
                addHistory(historyPayload(host.state.currentVid, {
                    progress: 0,
                    duration: host.state.lastProgress.duration,
                    percent: 100,
                }));
                flushHistorySync({ keepalive: true });
            }
            const next = adjacentEpisode(1);
            if (next) playEpisodeById(next.id);
        });
        player.addEventListener('progress', (e) => {
            const { currentTime, duration, percent } = e.detail || {};
            const progress = normalizePlaybackProgress(currentTime, duration, percent);
            host.state.lastProgress = progress;
            if (meta && !previewMode) {
                addHistory(historyPayload(host.state.currentVid, historyProgressPayload(
                    progress.currentTime,
                    progress.duration,
                    progress.percent,
                )));
            }
        });
    };

    const destroyPlayer = () => {
        cleanedUp = true;
        flushPlaybackProgress();
        flushHistorySync({ keepalive: true });
        unbindLifecycleFlush();
        if (player) {
            try {
                player.destroy();
            } catch {
                // ignore
            }
            try {
                player.remove();
            } catch {
                // ignore
            }
            player = null;
        }
        host = null;
        if (mountEl) mountEl.innerHTML = '';
        cleanedUp = false;
    };

    const setPlayingUi = (active) => {
        pageEl?.classList.toggle('is-inline-playing', active);
        pageEl?.classList.toggle('is-inline-loading', false);
        const mount = pageEl?.querySelector('#detail-player-mount');
        if (mount) mount.hidden = !active;
        const heroContent = pageEl?.querySelector('#detail-hero-content');
        if (heroContent) heroContent.hidden = active;
    };

    async function play({
        container,
        type: contentType,
        id: contentId,
        videoId,
        meta: contentMeta,
        onEpisodeChange: episodeChange,
        onStop: stopCallback,
    }) {
        mountEl = container.querySelector('#detail-player-shell');
        pageEl = container.querySelector('.detail-page');
        if (!mountEl || !pageEl) return false;

        type = contentType;
        id = contentId;
        meta = contentMeta;
        onEpisodeChange = episodeChange;
        onStop = stopCallback;
        previewMode = false;

        await waitForAuthReady();
        if (!user.value) {
            const err = new Error('请先登录后再观看');
            err.needLogin = true;
            throw err;
        }

        pageEl.classList.add('is-inline-loading');
        setPlayingUi(true);
        mountEl.innerHTML = '<div class="detail-player-loading"><div class="spinner-small"></div><span>正在准备播放…</span></div>';

        try {
            const streamId = videoId || id;
            const [streams] = await Promise.all([
                getStream(type, streamId),
                loadPlayerModule(),
            ]);
            if (!streams?.length) {
                setPlayingUi(false);
                return false;
            }

            destroyPlayer();
            player = document.createElement('gy-player');
            player.className = 'detail-inline-gy-player';
            mountEl.innerHTML = '';
            mountEl.appendChild(player);
            applyGyPlayerUiOverrides(player);
            player.setDanmakuApiBase?.(API_V1_BASE);
            player.setLogo(meta?.logo || DEFAULT_APP_LOGO_URL);

            initHost(streamId);

            const list = videos();
            if (list.length > 0) {
                player.setEpisodes(list, videoId || null);
            }

            bindPlayerEvents();
            await loadInto(
                preferredInitialStream(streams),
                videoId || streamId,
                streams,
            );
            pageEl.classList.remove('is-inline-loading');
            mountEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return true;
        } catch (err) {
            setPlayingUi(false);
            destroyPlayer();
            throw err;
        }
    }

    function stop() {
        flushPlaybackProgress();
        flushHistorySync({ keepalive: true });
        setPlayingUi(false);
        destroyPlayer();
        onStop?.();
    }

    function getCurrentVideoId() {
        return host?.state.currentVid || null;
    }

    function isPlaying() {
        return Boolean(player);
    }

    return { play, stop, playEpisodeById, getCurrentVideoId, isPlaying, loadPreviewStream, selectPreviewSource };
}

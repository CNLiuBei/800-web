// 播放页 — 接入独立 gy-player 播放器
// 职责：取流、剧集联动（上/下一集、自动连播）、把进度写回观看历史
// 弹幕由 gy-player 内置（loadStream opts.danmaku），web 仅传 videoId / apiBase

import { getMeta, getPlaybackHealth, getPlaybackPreview, getRankings, getStream } from '../services/api.js';
import { addHistory, flushHistorySync, isFavorite, isWatchLater, toggleFavorite, toggleWatchLater } from '../services/library.js';
import { reportPlaybackEvent } from '../services/playback-analytics.js';
import { getAdDecision, reportAdEvent } from '../services/ad-analytics.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';
import { hasVipAccess, requiresVip } from '../services/vip.js';
import { user, waitForAuthReady } from '../services/auth.js';
import { fetchPlaybackPermission, reportWatchTime } from '../services/permissions.js';
import { buildCommunityShareUrl, communityShareText, recordCommunityShare } from '../services/community-growth.js';
import { API_V1_BASE, DEFAULT_APP_LOGO_URL } from '../services/config.js';
import { loadPlayerModule } from '../services/player-module.js';
import { applyGyPlayerUiOverrides } from '../services/player-ui-overrides.js';
import { historyProgressPayload } from '../services/playback-progress.js';
import {
    createPlaybackHost,
    formatPlaybackClock,
    sourcePreferenceValue,
} from '../services/playback-session.js';
import { showSiteNotice } from '../services/site-notice.js';

const PLAYER_ONBOARDING_KEY = 'gy_player_onboarding_seen_v1';
const BUFFERING_HINT_DELAY_MS = 2600;
const BUFFERING_RECOVERY_DELAY_MS = 9000;
const SEEK_BUFFERING_GRACE_MS = 15000;

export async function render(container, params) {
    const { type, id, videoId } = params;
    const queryStartTime = parseStartTime(params?.query?.get?.('t') ?? params?.query?.get?.('start'));
    const streamId = videoId || id;

    container.innerHTML = '';

    await waitForAuthReady();
    const metaPromise = getMeta(type, id).catch(() => null);

    if (!user.value) {
        const meta = await metaPromise;
        renderPlayerGate(container, {
            icon: 'user',
            title: '登录后即可观看',
            hint: meta?.name
                ? `《${meta.name}》需要登录后才能播放，登录后进度与会员权益将同步到账号。`
                : '请先登录后再观看，登录后可同步观看历史、播放进度和会员权益。',
            primaryId: 'player-login',
            primaryText: '登录 / 注册',
            secondaryHref: `#/detail/${type}/${id}`,
            secondaryText: '返回详情',
        });
        container.querySelector('#player-login')?.addEventListener('click', () => {
            openPlayerLogin();
        });
        openPlayerLogin();
        return;
    }

    const streamPromise = getStream(type, streamId)
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error }));
    const playerModulePromise = loadPlayerModule()
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }));

    let player = null;
    const dismissEarlyPlayer = () => {
        if (!player) return;
        try {
            player.destroy();
        } finally {
            player.remove();
        }
        player = null;
    };

    const playerModuleResult = await playerModulePromise;
    if (!playerModuleResult.ok) {
        renderPlayerLoadError(container, {
            title: '播放器加载失败',
            hint: '播放器资源暂时不可用，可能是网络中断或缓存异常。请重新加载播放器，或返回详情页稍后再试。',
            type,
            id,
        });
        return;
    }

    player = document.createElement('gy-player');
    player.style.cssText = 'position:fixed;inset:0;z-index:300;';
    document.body.appendChild(player);
    applyGyPlayerUiOverrides(player);
    player.setDanmakuApiBase?.(API_V1_BASE);
    player.addEventListener('danmaku-login', () => openPlayerLogin());
    player.setLogo(DEFAULT_APP_LOGO_URL);
    player.showBootLoading?.();

    const [meta, streamResult] = await Promise.all([metaPromise, streamPromise]);
    player.setLogo(meta?.logo || DEFAULT_APP_LOGO_URL);

    // 播放源接口需登录/权限。独立处理以便给出明确下一步。
    let streams;
    let previewMode = false;
    let previewLimitSeconds = 0;
    if (streamResult.ok) {
        streams = streamResult.value;
    } else {
        const err = streamResult.error;
        // 未登录：提示并引导登录
        if (err?.needLogin) {
            dismissEarlyPlayer();
            if (user.value) {
                renderPlayerLoadError(container, {
                    title: '播放地址获取失败',
                    hint: '登录状态可能已过期，请重试或返回详情页重新进入播放。',
                    type,
                    id,
                });
                return;
            }
            renderPlayerGate(container, {
                icon: 'user',
                title: '登录后即可观看',
                hint: meta?.name ? `登录后继续播放《${meta.name}》，观看历史和进度会同步到账号。` : '登录后可同步观看历史、播放进度和会员权益。',
                primaryId: 'player-login',
                primaryText: '登录 / 注册',
                secondaryHref: `#/detail/${type}/${id}`,
                secondaryText: '返回详情',
            });
            container.querySelector('#player-login')?.addEventListener('click', () => {
                openPlayerLogin();
            });
            openPlayerLogin();
            return;
        } else if (err?.forbidden) {
            // 无权限（如时长用尽）：提示
            dismissEarlyPlayer();
            renderPlayerGate(container, {
                icon: 'alert',
                title: err.message || '暂无观看权限',
                hint: meta?.name ? `当前账号暂时无法播放《${meta.name}》。开通或续费 VIP 后可继续观看。` : '开通或续费 VIP 后可继续观看会员内容。',
                primaryHref: buildVipReturnHref(type, id, videoId || null, meta?.name || ''),
                primaryText: '查看 VIP 权益',
                secondaryHref: `#/detail/${type}/${id}`,
                secondaryText: '返回详情',
            });
            return;
        } else {
            dismissEarlyPlayer();
            renderPlayerLoadError(container, {
                title: '播放地址获取失败',
                hint: '可能是网络波动、播放签名过期或源站暂时不可用。你可以重新获取播放地址，或先返回详情页。',
                type,
                id,
            });
            return;
        }
    }

    if (!streams || streams.length === 0) {
        dismissEarlyPlayer();
        const { t } = await import('../services/i18n.js');
        renderPlayerGate(container, {
            icon: 'video-off',
            title: t('player.no_source'),
            hint: meta?.name ? `《${meta.name}》当前没有可用播放源，稍后可重新获取。` : '当前内容没有可用播放源，稍后可重新获取。',
            primaryId: 'player-retry-source',
            primaryText: '重新获取播放源',
            secondaryHref: `#/detail/${type}/${id}`,
            secondaryText: '返回详情',
        });
        bindPlayerRetry(container);
        return;
    }

    const title = meta?.name || '';
    const videos = meta?.videos || [];

    // 当前播放的剧集索引（电影无 videos 时为 -1）
    let currentVid = videoId || null;
    let host = null;
    let reportedMilestones = new Set();
    let reportedAdImpressions = new Set();
    let activeAdDecision = null;
    let lastProgressFlushAt = 0;
    let lastWatchReportVideoTime = 0;
    let pendingWatchSeconds = 0;
    let cleanedUp = false;
    let autoNextTimer = null;
    let autoNextRemain = 0;
    let autoNextOverlay = null;
    let previewEndedOverlay = null;
    let resumeOverlay = null;
    let resumeOverlayTimer = null;
    let shortcutHelpButton = null;
    let shortcutHelpOverlay = null;
    let shortcutHelpReturnFocus = null;
    let playbackHealthButton = null;
    let playbackHealthOverlay = null;
    let playbackHealthTimer = null;
    let playbackHealthAdvice = null;
    let playbackHealthFetchInFlight = false;
    let onboardingOverlay = null;
    let onboardingTimer = null;
    let chapterOverlay = null;
    let playbackStartupAt = 0;
    let firstFrameReported = false;
    let bufferingStartedAt = 0;
    let bufferingHintTimer = null;
    let bufferingRecoveryTimer = null;
    let longStallCount = 0;
    let userSeekingUntil = 0;

    mountShortcutHelpButton();
    mountPlaybackHealthButton();

    const formatClock = formatPlaybackClock;

    host = createPlaybackHost({
        getPlayer: () => player,
        getMeta: () => meta,
        type,
        id,
        streamId,
        layout: 'fullscreen',
        getPreviewMode: () => previewMode,
        hooks: {
            beforeLoad: ({ options }) => {
                clearResumeOverlay();
                resetPlaybackTiming(options);
                reportedMilestones = new Set();
            },
            afterLoad: ({ stream, vid, options, startTime, resume }) => {
                currentVid = vid;
                if (options.recovery) {
                    const label = stream.quality || stream.title || stream.label || '备用播放源';
                    setTimeout(() => player.showHint?.(options.recoveryMessage || `已切换到 ${label}`), 500);
                } else if (resume?.progress && !options.resetResume && startTime > 0) {
                    setTimeout(() => player.showHint?.(`已从 ${formatPlaybackClock(resume.progress)} 继续播放`), 500);
                    showResumeOverlay({ resume, stream, vid, streamList: host.state.currentStreams });
                }
                reportPlaybackEvent('start', playbackAnalyticsPayload(vid, {
                    sourceLabel: stream.quality || stream.title || stream.label || '',
                    recovery: options.recovery === true,
                }));
                reportCreatorAdImpression(vid);
                updateEpisodeButtons(vid);
                player.setCurrentEpisode(vid);
                if (meta && !previewMode) {
                    const item = historyPayload(vid);
                    if (options.resetResume) {
                        item.progress = 0;
                        item.duration = resume?.duration || 0;
                        item.percent = 0;
                    }
                    addHistory(item);
                }
            },
            onCodecBlocked: (codecSupport, { vid, stream }) => {
                reportPlaybackEvent('error', playbackAnalyticsPayload(vid, {
                    errorCode: 'unsupported_audio_codec',
                    errorMessage: codecSupport.codec || 'ec-3',
                    sourceLabel: stream.quality || stream.title || stream.label || '',
                }));
            },
            playerErrorActions: (options) => playerErrorActions(options),
            onTerminalError: () => showPlaybackHealthOverlay({ mode: 'terminal' }),
            onSourceChange: (detail) => {
                updatePlaybackHealthOverlay();
                reportPlaybackEvent('quality_change', playbackAnalyticsPayload(currentVid, {
                    position: host.state.lastProgress.currentTime,
                    duration: host.state.lastProgress.duration,
                    percent: host.state.lastProgress.percent,
                    sourceLabel: detail.quality || detail.source?.quality || detail.source?.label || '',
                }));
            },
            reportPlaybackError: (detail) => {
                reportPlaybackEvent('error', playbackAnalyticsPayload(currentVid, {
                    position: host.state.lastProgress.currentTime,
                    duration: host.state.lastProgress.duration,
                    percent: host.state.lastProgress.percent,
                    errorCode: detail.code || detail.type || 'player_error',
                    errorMessage: detail.message || detail.reason || '',
                    sourceLabel: activeSourceLabel(),
                }));
            },
            onReloadStreamFailed: (err) => {
                const message = err?.needLogin
                    ? '登录状态已失效，请重新登录后观看'
                    : err?.forbidden
                        ? (err.message || '当前账号暂无观看权限')
                        : '重新获取播放地址失败，请稍后再试';
                player.showErrorActions?.(message, playerErrorActions({ login: err?.needLogin, vip: err?.forbidden }));
            },
            onErrorAction: (actionId) => {
                if (actionId === 'copy-diagnostics') {
                    copyPlaybackDiagnostics();
                } else if (actionId === 'detail') {
                    location.hash = `#/detail/${type}/${id}`;
                } else if (actionId === 'vip') {
                    location.hash = buildVipReturnHref(type, id, currentVid, meta?.name || title || '', '');
                } else if (actionId === 'login') {
                    openPlayerLogin();
                }
            },
        },
    });

    const titleFor = (vid) => host.titleFor(vid);
    const episodeIdFor = (vid) => host.episodeIdFor(vid);
    const episodeFor = (vid) => host.episodeFor(vid);
    const resumeFor = (vid) => host.resumeFor(vid);

    const preferredInitialStream = (list = []) => {
        const pref = getPlayerQualityPreference();
        if (!pref || pref.kind !== 'source') return list[0];
        const wanted = String(pref.value || '').trim().toLowerCase();
        if (!wanted) return list[0];
        return list.find((source) => sourcePreferenceValue(source) === wanted) || list[0];
    };

    const loadInto = async (stream, vid, streamList = streams, options = {}) => {
        currentVid = vid;
        return host.loadInto(stream, vid, streamList, options);
    };

    const retryCurrentPlayback = () => host.retryCurrentPlayback();
    const retryCurrentSource = () => host.retryCurrentSource();
    const switchToNextSource = (options = {}) => host.switchToNextSource(options);
    const nextAvailableSource = (options = {}) => host.nextAvailableSource(options);
    const showTerminalPlaybackError = () => host.showTerminalPlaybackError();

    const playbackAnalyticsPayload = (vid = currentVid, extra = {}) => ({
        videoId: meta?.analyticsVideoId || vid || id,
        movieId: meta?.movieId,
        tmdbId: meta?.tmdbId,
        mediaType: meta?.mediaType || (type === 'movie' ? 'movie' : 'tv'),
        episodeId: episodeIdFor(vid),
        ...extra,
    });

    const mediaIdentityPayload = (extra = {}) => ({
        contentId: id,
        movieId: meta?.movieId,
        tmdbId: meta?.tmdbId,
        mediaType: meta?.mediaType || (type === 'movie' ? 'movie' : 'tv'),
        contentType: type,
        ...extra,
    });

    const libraryPayload = () => ({
        id,
        type,
        name: meta?.name || title,
        poster: meta?.poster,
        year: meta?.year,
        movieId: meta?.movieId,
        tmdbId: meta?.tmdbId,
        mediaType: meta?.mediaType || (type === 'movie' ? 'movie' : 'tv'),
    });

    const historyPayload = (vid = currentVid, extra = {}) => {
        const episode = episodeFor(vid);
        return {
            ...libraryPayload(),
            videoId: vid || null,
            episodeId: episodeIdFor(vid),
            seasonNumber: episode?.season,
            episodeNumber: episode?.episode,
            ...extra,
        };
    };

    const creatorAdAnalyticsPayload = (vid = currentVid, extra = {}) => {
        const videoId = meta?.analyticsVideoId || vid || id;
        if (!isCreatorVideoId(videoId)) return null;
        if (!activeAdDecision?.campaignId || !activeAdDecision?.adDecisionId || !activeAdDecision?.impressionToken) return null;
        return {
            videoId,
            placement: 'pre_roll',
            campaignId: activeAdDecision.campaignId,
            adDecisionId: activeAdDecision?.adDecisionId,
            impressionToken: activeAdDecision?.impressionToken,
            ...extra,
        };
    };

    // 根据当前集刷新上一集/下一集按钮显隐
    const updateEpisodeButtons = (vid) => {
        if (videos.length === 0 || !vid) {
            player.showPrevButton(false);
            player.showNextButton(false);
            return;
        }
        const idx = videos.findIndex((v) => v.id === vid);
        player.showPrevButton(idx > 0);
        player.showNextButton(idx >= 0 && idx < videos.length - 1);
    };

    const adjacentEpisode = (dir) => {
        if (videos.length === 0 || !currentVid) return null;
        const idx = videos.findIndex((v) => v.id === currentVid);
        return idx >= 0 ? videos[idx + dir] || null : null;
    };

    // 切换到相邻集（dir: +1 下一集 / -1 上一集）
    const switchEpisode = async (dir) => {
        clearAutoNextOverlay();
        const target = adjacentEpisode(dir);
        if (!target) return;
        await playEpisodeById(target.id);
    };

    // 按 id 直接切集（选集面板用）
    const playEpisodeById = async (vid) => {
        clearAutoNextOverlay();
        if (vid === currentVid) return;
        flushPlaybackProgress({ force: true });
        flushHistorySync({ keepalive: true });
        try {
            const nextStreams = await getStream(type, vid);
            if (nextStreams && nextStreams.length > 0) {
                currentVid = vid;
                activeAdDecision = await loadCreatorAdDecision(vid);
                await loadInto(preferredInitialStream(nextStreams), vid, nextStreams);
                history.replaceState(null, '', `#/play/${type}/${id}/${vid}`);
            } else {
                showSiteNotice('该集暂无播放源', { tone: 'error' });
            }
        } catch (err) {
            // 切集时 session 可能已过期：提示用户，需要时引导重新登录
            if (err?.needLogin) {
                showSiteNotice('登录已过期，请重新登录');
                const { openAuthModal } = await import('../services/auth-modal-loader.js');
                const modal = await openAuthModal('login');
                modal?.addEventListener('authenticated', () => {
                    showSiteNotice('登录成功，正在继续切换剧集', { tone: 'success' });
                    playEpisodeById(vid);
                }, { once: true });
            } else if (err?.forbidden) {
                showSiteNotice(err.message || '无观看权限', { tone: 'error' });
            } else {
                showSiteNotice('切换剧集失败，请重试', { tone: 'error' });
            }
        }
    };

    // 首次加载
    if (user.value) fetchPlaybackPermission().catch(() => {});
    activeAdDecision = await loadCreatorAdDecision(currentVid);
    await loadInto(preferredInitialStream(streams), currentVid, streams, queryStartTime > 0
        ? { startTime: queryStartTime, resetResume: true, playAfterLoad: true }
        : { playAfterLoad: true });
    player.setTitle?.(titleFor(currentVid));
    chapterOverlay = mountChapterOverlay(meta?.chapters);
    if (previewMode) {
        const text = previewLimitSeconds > 0
            ? `正在试看，可观看 ${Math.floor(previewLimitSeconds / 60) || 1} 分钟`
            : '正在试看';
        setTimeout(() => player.showHint?.(text), 700);
    }

    // 把剧集列表交给播放器（启用内置选集面板），并监听选集事件
    if (videos.length > 0) {
        player.setEpisodes(videos, currentVid);
        player.addEventListener('selectepisode', (e) => playEpisodeById(e.detail.id));
    }

    // 事件联动
    player.addEventListener('next', () => switchEpisode(1));
    player.addEventListener('prev', () => switchEpisode(-1));
    player.addEventListener('ended', () => {
        reportPlaybackEvent('complete', playbackAnalyticsPayload(currentVid, {
            position: host.state.lastProgress.duration || host.state.lastProgress.currentTime,
            duration: host.state.lastProgress.duration,
            percent: 100,
        }));
        reportCreatorAdCompletion(currentVid);
        if (meta && !previewMode) {
            addHistory(historyPayload(currentVid, {
                progress: 0, duration: host.state.lastProgress.duration, percent: 100,
            }));
            flushHistorySync({ keepalive: true });
        }
        scheduleAutoNext();
    });
    player.addEventListener('back', () => goBackToDetail());
    host.bindPlayerEvents(player);

    // 进度写回观看历史（节流由播放器内部处理，默认每 5 秒）
    player.addEventListener('progress', (e) => {
        const { currentTime, duration, percent } = e.detail;
        const progress = normalizeProgress(currentTime, duration, percent);
        host.state.lastProgress = progress;
        if (meta && !previewMode) {
            addHistory(historyPayload(currentVid, historyProgressPayload(
                progress.currentTime,
                progress.duration,
                progress.percent,
            )));
        }
        reportProgressMilestone(progress.currentTime, progress.duration, progress.percent);
        enforcePreviewLimit(progress.currentTime);
    });

    const onPageHide = () => {
        flushWatchTimeReport(true);
        flushPlaybackProgress({ force: true });
        flushHistorySync({ keepalive: true });
    };
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            flushWatchTimeReport(true);
            flushPlaybackProgress({ force: true });
            flushHistorySync({ keepalive: true });
        }
    };
    const onOnline = () => {
        if (host.state.recoveryInFlight) return;
        if (host.state.terminalErrorVisible || bufferingStartedAt) {
            player.showHint?.('网络已恢复，正在重新获取播放地址');
            retryCurrentPlayback();
        }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    const onPlayerKeydown = (event) => handlePlayerShortcut(event);
    window.addEventListener('keydown', onPlayerKeydown);
    const video = player.video;
    const onVideoWaiting = () => startBufferingWatch('waiting');
    const onVideoStalled = () => startBufferingWatch('stalled');
    const onVideoRecovered = () => finishBufferingWatch();
    const onVideoSeeking = () => {
        userSeekingUntil = performance.now() + SEEK_BUFFERING_GRACE_MS;
    };
    const onVideoSeeked = () => {
        userSeekingUntil = performance.now() + 4000;
    };
    video?.addEventListener('seeking', onVideoSeeking);
    video?.addEventListener('seeked', onVideoSeeked);
    video?.addEventListener('waiting', onVideoWaiting);
    video?.addEventListener('stalled', onVideoStalled);
    video?.addEventListener('playing', onVideoRecovered);
    video?.addEventListener('canplay', onVideoRecovered);
    video?.addEventListener('loadeddata', onVideoRecovered);

    function reportProgressMilestone(currentTime, duration, percent) {
        const milestones = [25, 50, 75, 90];
        const milestone = milestones.find((value) => percent >= value && !reportedMilestones.has(value));
        if (!milestone) return;
        reportedMilestones.add(milestone);
        reportPlaybackEvent('progress', playbackAnalyticsPayload(currentVid, {
            position: currentTime,
            duration,
            percent: milestone,
        }));
    }

    async function flushWatchTimeReport(force = false) {
        if (!user.value || previewMode || pendingWatchSeconds <= 0) return;
        if (!force && pendingWatchSeconds < 30) return;
        const chunk = pendingWatchSeconds;
        pendingWatchSeconds = 0;
        try {
            await reportWatchTime(chunk);
        } catch (err) {
            pendingWatchSeconds = chunk;
            if (err?.exceeded) {
                player.showErrorActions?.('今日观看时长已用完', playerErrorActions({ vip: true }));
            }
        }
    }

    function flushPlaybackProgress(options = {}) {
        if (cleanedUp && !options.force) return;
        const now = Date.now();
        if (!options.force && now - lastProgressFlushAt < 5000) return;
        lastProgressFlushAt = now;

        const video = player.video;
        const videoTime = Number.isFinite(video?.currentTime) ? video.currentTime : host.state.lastProgress.currentTime;
        const videoDuration = Number.isFinite(video?.duration) ? video.duration : host.state.lastProgress.duration;
        if (!videoTime && !videoDuration) return;
        const progress = normalizeProgress(
            videoTime,
            videoDuration,
            videoDuration > 0 ? (videoTime / videoDuration) * 100 : host.state.lastProgress.percent
        );
        host.state.lastProgress = progress;

        if (user.value && !previewMode) {
            const playedSeconds = Math.floor(videoTime);
            if (playedSeconds > lastWatchReportVideoTime) {
                const delta = playedSeconds - lastWatchReportVideoTime;
                if (delta > 0 && delta <= 120) {
                    lastWatchReportVideoTime = playedSeconds;
                    pendingWatchSeconds += delta;
                    flushWatchTimeReport(options.force);
                }
            }
        }

        if (meta && !previewMode) {
            addHistory(historyPayload(currentVid, historyProgressPayload(
                progress.currentTime,
                progress.duration,
                progress.percent,
            )));
        }
        reportPlaybackEvent('progress', playbackAnalyticsPayload(currentVid, {
            position: progress.currentTime,
            duration: progress.duration,
            percent: progress.percent,
        }));
    }

    function normalizeProgress(currentTime, duration, percent) {
        const next = {
            currentTime: Number(currentTime) || 0,
            duration: Number(duration) || host.state.lastProgress.duration || 0,
            percent: Number(percent) || 0,
        };
        if (next.currentTime <= 0 && next.percent <= 0 && host.state.lastProgress.currentTime > 10) {
            return {
                currentTime: host.state.lastProgress.currentTime,
                duration: next.duration || host.state.lastProgress.duration,
                percent: host.state.lastProgress.percent,
            };
        }
        if (!next.percent && next.duration > 0 && next.currentTime > 0) {
            next.percent = Math.min(100, Math.max(0, (next.currentTime / next.duration) * 100));
        }
        return next;
    }

    function reportCreatorAdImpression(vid) {
        if (previewMode) return;
        const payload = creatorAdAnalyticsPayload(vid);
        if (!payload) return;
        const key = `${payload.videoId}:pre_roll`;
        if (reportedAdImpressions.has(key)) return;
        reportedAdImpressions.add(key);
        reportAdEvent('impression', payload);
    }

    function reportCreatorAdCompletion(vid) {
        if (previewMode) return;
        const payload = creatorAdAnalyticsPayload(vid);
        if (!payload) return;
        reportAdEvent('complete', payload);
    }

    async function loadCreatorAdDecision(vid) {
        const videoId = meta?.analyticsVideoId || vid || id;
        if (!isCreatorVideoId(videoId) || previewMode) return null;
        return getAdDecision({
            videoId,
            placement: 'pre_roll',
        }).catch(() => null);
    }

    function resetPlaybackTiming(options = {}) {
        clearBufferingWatch();
        playbackStartupAt = performance.now();
        firstFrameReported = false;
        bufferingStartedAt = 0;
        if (!options.recovery) longStallCount = 0;
    }

    function startBufferingWatch(reason = 'waiting') {
        if (cleanedUp || previewMode) return;
        const currentVideo = player.video;
        if (!currentVideo || currentVideo.ended || host.state.terminalErrorVisible) return;
        if (!bufferingStartedAt) bufferingStartedAt = performance.now();
        clearTimeout(bufferingHintTimer);
        clearTimeout(bufferingRecoveryTimer);
        const seeking = performance.now() < userSeekingUntil;
        const hintDelay = seeking ? BUFFERING_RECOVERY_DELAY_MS : BUFFERING_HINT_DELAY_MS;
        const recoveryDelay = seeking ? BUFFERING_RECOVERY_DELAY_MS * 2 : BUFFERING_RECOVERY_DELAY_MS;
        bufferingHintTimer = setTimeout(() => {
            if (!isStillBuffering()) return;
            if (navigator.onLine === false) {
                player.showHintHold?.('网络断开，恢复后自动重连');
                return;
            }
            player.showHintHold?.(seeking ? '正在定位到拖动位置…' : '缓冲时间偏长，正在守住当前进度');
        }, hintDelay);
        bufferingRecoveryTimer = setTimeout(() => handleLongBufferingStall(reason), recoveryDelay);
    }

    function finishBufferingWatch() {
        if (cleanedUp) return;
        reportFirstFrameIfNeeded();
        const stalledFor = bufferingStartedAt ? performance.now() - bufferingStartedAt : 0;
        clearBufferingWatch();
        if (stalledFor >= BUFFERING_HINT_DELAY_MS && !host.state.terminalErrorVisible) {
            player.showHint?.('播放已恢复');
        }
    }

    function clearBufferingWatch() {
        clearTimeout(bufferingHintTimer);
        clearTimeout(bufferingRecoveryTimer);
        bufferingHintTimer = null;
        bufferingRecoveryTimer = null;
        bufferingStartedAt = 0;
    }

    function reportFirstFrameIfNeeded() {
        if (firstFrameReported || !playbackStartupAt) return;
        const startupMs = Math.round(performance.now() - playbackStartupAt);
        if (!Number.isFinite(startupMs) || startupMs <= 0) return;
        firstFrameReported = true;
        reportPlaybackEvent('progress', playbackAnalyticsPayload(currentVid, {
            position: host.state.lastProgress.currentTime,
            duration: host.state.lastProgress.duration,
            percent: host.state.lastProgress.percent,
            sourceLabel: `first_frame:${startupMs}ms`,
        }));
    }

    function isStillBuffering() {
        const currentVideo = player.video;
        if (!currentVideo || currentVideo.ended) return false;
        // retryStreaming 恢复期间 video 可能短暂 paused，缓冲监控仍应继续
        if (currentVideo.paused) {
            return bufferingStartedAt > 0;
        }
        return currentVideo.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || navigator.onLine === false;
    }

    function handleLongBufferingStall(reason) {
        if (!isStillBuffering() || host.state.recoveryInFlight || host.state.terminalErrorVisible) return;
        if (performance.now() < userSeekingUntil) return;
        longStallCount += 1;
        const stalledSeconds = Math.round((performance.now() - bufferingStartedAt) / 1000);
        const offline = navigator.onLine === false;
        host.state.lastPlaybackError = {
            code: offline ? 'offline_buffering' : 'buffering_stall',
            message: offline ? 'network offline during playback' : `buffering for ${stalledSeconds}s`,
            reason,
        };
        reportPlaybackEvent('error', playbackAnalyticsPayload(currentVid, {
            position: host.state.lastProgress.currentTime,
            duration: host.state.lastProgress.duration,
            percent: host.state.lastProgress.percent,
            errorCode: host.state.lastPlaybackError.code,
            errorMessage: `${host.state.lastPlaybackError.message}; source=${activeSourceLabel() || 'unknown'}`,
            sourceLabel: activeSourceLabel(),
        }));
        requestPlaybackHealthAdvice({ mode: 'buffering', refreshOverlay: true });
        if (offline) return;

        player.hideHint?.();
        if (longStallCount === 1) {
            player.showHint?.('缓冲过久，正在重试当前源');
            retryCurrentSource();
            return;
        }
        const fallback = nextAvailableSource({ allowTried: true });
        if (fallback) {
            player.showHint?.('缓冲仍未恢复，正在切换备用源');
            switchToNextSource();
            return;
        }
        player.showHint?.('缓冲仍未恢复，正在重新获取播放地址');
        retryCurrentPlayback();
    }

    function enforcePreviewLimit(currentTime) {
        if (!previewMode || !previewLimitSeconds || currentTime < previewLimitSeconds) return;
        previewMode = false;
        player.pause?.();
        showPreviewEndedOverlay();
        player.showErrorActions?.('试看已结束，登录或开通 VIP 后继续观看', [
            { id: 'login', label: '登录继续' },
            { id: 'vip', label: '查看 VIP 权益', variant: 'secondary' },
            { id: 'detail', label: '返回详情', variant: 'secondary' },
        ]);
    }

    function showPreviewEndedOverlay() {
        if (previewEndedOverlay) return;
        const watchedText = previewLimitSeconds > 0 ? `${Math.floor(previewLimitSeconds / 60) || 1} 分钟` : '一段试看';
        const vipHref = buildVipReturnHref(type, id, currentVid, meta?.name || title || '', 'preview_end');
        previewEndedOverlay = document.createElement('div');
        previewEndedOverlay.className = 'player-preview-ended-overlay';
        previewEndedOverlay.innerHTML = `
            ${playerPreviewEndedStyle()}
            <div class="player-preview-ended-card" role="dialog" aria-live="polite" aria-label="试看已结束">
                <div class="player-preview-ended-kicker">试看已结束</div>
                <h2>${escapeHtml(meta?.name || title || '当前内容')}</h2>
                <p>你已经看了 ${escapeHtml(watchedText)}。登录或开通后会回到当前播放位置，并同步观看历史、收藏和多设备权益。</p>
                <div class="player-preview-value">
                    <span><strong>续播</strong><small>回到当前内容</small></span>
                    <span><strong>同步</strong><small>跨设备进度</small></span>
                    <span><strong>高清</strong><small>解锁播放权益</small></span>
                </div>
                <div class="player-preview-ended-actions">
                    <button class="player-preview-login" type="button">登录继续</button>
                    <a class="player-preview-vip" href="${escapeHtml(vipHref)}">查看 VIP 权益</a>
                    <a class="player-preview-detail" href="#/detail/${escapeHtml(type)}/${escapeHtml(id)}">返回详情</a>
                </div>
            </div>
        `;
        document.body.appendChild(previewEndedOverlay);
        reportEngagementEvent('decision_impression', mediaIdentityPayload({
            source: 'preview_end',
            targetId: 'gy:vip-offer',
            value: previewLimitSeconds || 0,
            label: 'preview ended conversion panel',
        }));
        previewEndedOverlay.querySelector('.player-preview-login')?.addEventListener('click', () => {
            reportPreviewEndedClick('login');
            clearPreviewEndedOverlay();
            openPlayerLogin();
        });
        previewEndedOverlay.querySelector('.player-preview-vip')?.addEventListener('click', () => {
            reportPreviewEndedClick('vip');
            clearPreviewEndedOverlay();
        });
        previewEndedOverlay.querySelector('.player-preview-detail')?.addEventListener('click', () => {
            reportPreviewEndedClick('detail');
            clearPreviewEndedOverlay();
        });
    }

    function reportPreviewEndedClick(target) {
        reportEngagementEvent('decision_click', mediaIdentityPayload({
            source: 'preview_end',
            targetId: `preview:${metricToken(target)}`,
            actionState: 'open',
            value: previewLimitSeconds || 0,
            label: `preview ended ${target}`,
        }));
    }

    function clearPreviewEndedOverlay() {
        previewEndedOverlay?.remove();
        previewEndedOverlay = null;
    }

    function playerPreviewEndedStyle() {
        return `
            <style>
                .player-preview-ended-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 304;
                    display: grid;
                    place-items: center;
                    padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
                    background: rgba(0,0,0,0.52);
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                }
                .player-preview-ended-card {
                    width: min(31rem, 100%);
                    max-height: calc(100vh - 2rem);
                    max-height: calc(100dvh - 2rem);
                    overflow-y: auto;
                    padding: 1.05rem;
                    border: 1px solid rgba(255,255,255,0.14);
                    border-radius: 0.7rem;
                    background: rgba(20,20,22,0.88);
                    box-shadow: 0 24px 70px rgba(0,0,0,0.5);
                    backdrop-filter: blur(22px) saturate(150%);
                    -webkit-backdrop-filter: blur(22px) saturate(150%);
                }
                .player-preview-ended-kicker {
                    color: #ff9f0a;
                    font-size: 0.76rem;
                    font-weight: 850;
                    margin-bottom: 0.35rem;
                }
                .player-preview-ended-card h2 {
                    margin: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 1.12rem;
                    line-height: 1.25;
                    font-weight: 850;
                }
                .player-preview-ended-card p {
                    margin: 0.55rem 0 0;
                    color: rgba(255,255,255,0.68);
                    font-size: 0.84rem;
                    line-height: 1.55;
                }
                .player-preview-value {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 0.5rem;
                    margin-top: 0.9rem;
                }
                .player-preview-value span {
                    min-width: 0;
                    display: grid;
                    gap: 0.1rem;
                    padding: 0.62rem;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 0.55rem;
                    background: rgba(255,255,255,0.07);
                }
                .player-preview-value strong,
                .player-preview-value small {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .player-preview-value strong {
                    font-size: 0.82rem;
                    font-weight: 850;
                }
                .player-preview-value small {
                    color: rgba(255,255,255,0.58);
                    font-size: 0.7rem;
                    font-weight: 700;
                }
                .player-preview-ended-actions {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 0.55rem;
                    margin-top: 0.95rem;
                }
                .player-preview-ended-actions button,
                .player-preview-ended-actions a {
                    min-height: 2.45rem;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 0.8rem;
                    border-radius: 999px;
                    border: 1px solid rgba(255,255,255,0.14);
                    background: rgba(255,255,255,0.08);
                    color: #fff;
                    text-decoration: none;
                    cursor: pointer;
                    font-size: 0.8rem;
                    font-weight: 800;
                }
                .player-preview-login,
                .player-preview-vip {
                    border-color: transparent !important;
                    background: #fff !important;
                    color: #000 !important;
                }
                .player-preview-vip {
                    background: #ff9f0a !important;
                    color: #120a00 !important;
                }
                @media (max-width: 640px) {
                    .player-preview-ended-card h2 {
                        white-space: normal;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    }
                    .player-preview-ended-card {
                        max-height: calc(100vh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-preview-value,
                    .player-preview-ended-actions {
                        grid-template-columns: 1fr;
                    }
                    .player-preview-ended-actions button,
                    .player-preview-ended-actions a {
                        min-height: 2.75rem;
                    }
                }
                @media (max-height: 420px) and (orientation: landscape) {
                    .player-preview-ended-overlay {
                        place-items: start center;
                        padding-top: max(0.6rem, env(safe-area-inset-top, 0px));
                        padding-bottom: max(0.6rem, env(safe-area-inset-bottom, 0px));
                    }
                    .player-preview-ended-card {
                        padding: 0.8rem;
                        max-height: calc(100vh - 1.2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 1.2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-preview-ended-card p {
                        line-height: 1.45;
                    }
                    .player-preview-value {
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                        margin-top: 0.65rem;
                    }
                    .player-preview-ended-actions {
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                        margin-top: 0.65rem;
                    }
                    .player-preview-ended-actions button,
                    .player-preview-ended-actions a {
                        min-height: 2.45rem;
                    }
                }
                @media (max-width: 560px) and (max-height: 420px) {
                    .player-preview-value,
                    .player-preview-ended-actions {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        `;
    }

    function handlePlayerShortcut(event) {
        const key = event.key;
        const code = event.code;
        const lower = String(key || '').toLowerCase();
        if (shortcutHelpOverlay && lower === 'escape') {
            event.preventDefault();
            event.stopPropagation();
            clearShortcutHelpOverlay();
            return;
        }
        if (shouldIgnorePlayerShortcut(event)) return;
        const actions = {
            ' ': () => {
                player.togglePlay?.();
                player.showHint?.(player.video?.paused ? '已暂停' : '继续播放');
            },
            spacebar: () => {
                player.togglePlay?.();
                player.showHint?.(player.video?.paused ? '已暂停' : '继续播放');
            },
            k: () => {
                player.togglePlay?.();
                player.showHint?.(player.video?.paused ? '已暂停' : '继续播放');
            },
            arrowleft: () => player.seekBy?.(-10),
            j: () => player.seekBy?.(-10),
            arrowright: () => player.seekBy?.(10),
            l: () => player.seekBy?.(10),
            m: () => {
                player.toggleMute?.();
                player.showHint?.(player.video?.muted ? '已静音' : '已取消静音');
            },
            f: () => player.toggleFullscreen?.(),
            ',': () => adjustPlaybackRate(-0.25),
            '<': () => adjustPlaybackRate(-0.25),
            '.': () => adjustPlaybackRate(0.25),
            '>': () => adjustPlaybackRate(0.25),
            '?': () => showShortcutHelpOverlay(),
        };
        const action = actions[lower] || (code === 'Space' ? actions[' '] : null);
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        action();
    }

    function shouldIgnorePlayerShortcut(event) {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
        const target = event.target;
        const tag = String(target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return true;
        if (target?.closest?.('input, textarea, select, [contenteditable="true"], .gyp-menu, .gyp-ep-panel, .player-next-overlay, .player-resume-overlay, .player-shortcuts-overlay')) return true;
        return !document.body.contains(player);
    }

    function adjustPlaybackRate(delta) {
        const current = Number(player.video?.playbackRate) || 1;
        const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 4) / 4));
        player.setRate?.(next);
        player.showHint?.(`速度 ${next}x`);
    }

    function mountShortcutHelpButton() {
        shortcutHelpButton = document.createElement('button');
        shortcutHelpButton.className = 'player-shortcuts-button';
        shortcutHelpButton.type = 'button';
        shortcutHelpButton.setAttribute('aria-label', '查看播放器快捷键');
        shortcutHelpButton.innerHTML = `${shortcutHelpStyle()}<span aria-hidden="true">?</span>`;
        shortcutHelpButton.addEventListener('click', () => showShortcutHelpOverlay());
        document.body.appendChild(shortcutHelpButton);
    }

    function showShortcutHelpOverlay() {
        clearShortcutHelpOverlay();
        shortcutHelpReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        shortcutHelpOverlay = document.createElement('div');
        shortcutHelpOverlay.className = 'player-shortcuts-overlay';
        shortcutHelpOverlay.innerHTML = `
            <div class="player-shortcuts-backdrop" data-close="1"></div>
            <section class="player-shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby="player-shortcuts-title">
                <div class="player-shortcuts-head">
                    <div>
                        <div class="player-shortcuts-kicker">播放控制</div>
                        <h2 id="player-shortcuts-title">快捷键</h2>
                    </div>
                    <button class="player-shortcuts-close" type="button" aria-label="关闭快捷键帮助">×</button>
                </div>
                <div class="player-shortcuts-grid">
                    ${shortcutHelpItem(['Space', 'K'], '播放 / 暂停')}
                    ${shortcutHelpItem(['J', '←'], '后退 10 秒')}
                    ${shortcutHelpItem(['L', '→'], '前进 10 秒')}
                    ${shortcutHelpItem(['M'], '静音 / 取消静音')}
                    ${shortcutHelpItem(['F'], '全屏')}
                    ${shortcutHelpItem([',', '<'], '降低倍速')}
                    ${shortcutHelpItem(['.', '>'], '提高倍速')}
                    ${shortcutHelpItem(['?'], '打开此帮助')}
                    ${shortcutHelpItem(['Esc'], '关闭帮助')}
                </div>
            </section>
        `;
        shortcutHelpOverlay.addEventListener('click', (event) => {
            if (event.target?.dataset?.close || event.target?.closest?.('.player-shortcuts-close')) {
                clearShortcutHelpOverlay();
            }
        });
        shortcutHelpOverlay.addEventListener('keydown', trapShortcutHelpFocus);
        document.body.appendChild(shortcutHelpOverlay);
        shortcutHelpOverlay.querySelector('.player-shortcuts-close')?.focus({ preventScroll: true });
    }

    function trapShortcutHelpFocus(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            clearShortcutHelpOverlay();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = shortcutHelpFocusableElements();
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function shortcutHelpFocusableElements() {
        if (!shortcutHelpOverlay) return [];
        return [...shortcutHelpOverlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
    }

    function shortcutHelpItem(keys, label) {
        return `
            <div class="player-shortcuts-item">
                <div class="player-shortcuts-keys">${keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join('')}</div>
                <div class="player-shortcuts-label">${escapeHtml(label)}</div>
            </div>
        `;
    }

    function clearShortcutHelpOverlay() {
        shortcutHelpOverlay?.remove();
        shortcutHelpOverlay = null;
        const target = shortcutHelpReturnFocus?.isConnected
            ? shortcutHelpReturnFocus
            : shortcutHelpButton;
        shortcutHelpReturnFocus = null;
        target?.focus?.({ preventScroll: true });
    }

    function clearShortcutHelpButton() {
        shortcutHelpButton?.remove();
        shortcutHelpButton = null;
    }

    function schedulePlayerOnboarding() {
        rememberPlayerOnboarding();
    }

    function showPlayerOnboarding() {
        onboardingOverlay = document.createElement('div');
        onboardingOverlay.className = 'player-onboarding';
        onboardingOverlay.innerHTML = `
            ${playerOnboardingStyle()}
            <section class="player-onboarding-card" role="status" aria-live="polite">
                <div class="player-onboarding-copy">
                    <div class="player-onboarding-title">播放小提示</div>
                    <div class="player-onboarding-text">空格暂停，左右键快退/快进 10 秒，右下角可切换清晰度、字幕和倍速。</div>
                </div>
                <button class="player-onboarding-help" type="button">快捷键</button>
                <button class="player-onboarding-close" type="button" aria-label="关闭播放提示">知道了</button>
            </section>
        `;
        onboardingOverlay.querySelector('.player-onboarding-help')?.addEventListener('click', () => {
            rememberPlayerOnboarding();
            clearPlayerOnboarding();
            showShortcutHelpOverlay();
        });
        onboardingOverlay.querySelector('.player-onboarding-close')?.addEventListener('click', () => {
            rememberPlayerOnboarding();
            clearPlayerOnboarding();
        });
        document.body.appendChild(onboardingOverlay);
        onboardingTimer = setTimeout(clearPlayerOnboarding, 9000);
    }

    function hasSeenPlayerOnboarding() {
        try {
            return localStorage.getItem(PLAYER_ONBOARDING_KEY) === '1';
        } catch {
            return true;
        }
    }

    function rememberPlayerOnboarding() {
        try {
            localStorage.setItem(PLAYER_ONBOARDING_KEY, '1');
        } catch {}
    }

    function clearPlayerOnboarding() {
        if (onboardingTimer) {
            clearTimeout(onboardingTimer);
            onboardingTimer = null;
        }
        onboardingOverlay?.remove();
        onboardingOverlay = null;
    }

    function playerOnboardingStyle() {
        return `
            <style>
                .player-onboarding {
                    position: fixed;
                    left: calc(1rem + env(safe-area-inset-left, 0px));
                    bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
                    z-index: 303;
                    width: min(31rem, calc(100vw - 2rem));
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    pointer-events: none;
                }
                .player-onboarding-card {
                    min-height: 3.35rem;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto auto;
                    align-items: center;
                    gap: 0.65rem;
                    padding: 0.72rem 0.78rem 0.72rem 0.95rem;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 0.7rem;
                    background: rgba(18,18,20,0.82);
                    box-shadow: 0 18px 50px rgba(0,0,0,0.38);
                    backdrop-filter: blur(20px) saturate(150%);
                    -webkit-backdrop-filter: blur(20px) saturate(150%);
                    pointer-events: auto;
                }
                .player-onboarding-copy {
                    min-width: 0;
                }
                .player-onboarding-title {
                    font-size: 0.86rem;
                    line-height: 1.25;
                    font-weight: 800;
                }
                .player-onboarding-text {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    margin-top: 0.16rem;
                    color: rgba(255,255,255,0.66);
                    font-size: 0.74rem;
                    line-height: 1.35;
                }
                .player-onboarding-help,
                .player-onboarding-close {
                    flex: 0 0 auto;
                    min-height: 2.1rem;
                    border: 0;
                    border-radius: 999px;
                    cursor: pointer;
                    font-size: 0.78rem;
                    font-weight: 760;
                    white-space: nowrap;
                }
                .player-onboarding-help {
                    padding: 0 0.82rem;
                    background: #fff;
                    color: #000;
                }
                .player-onboarding-close {
                    padding: 0 0.78rem;
                    background: rgba(255,255,255,0.1);
                    color: rgba(255,255,255,0.78);
                }
                .player-onboarding-close:hover,
                .player-onboarding-close:focus-visible {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                @media (max-width: 640px) {
                    .player-onboarding {
                        left: 1rem;
                        right: 1rem;
                        bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
                        width: auto;
                    }
                    .player-onboarding-card {
                        grid-template-columns: minmax(0, 1fr) auto;
                    }
                    .player-onboarding-text {
                        white-space: normal;
                    }
                    .player-onboarding-help {
                        grid-column: 1 / -1;
                        width: 100%;
                    }
                    .player-onboarding-close {
                        grid-column: 2;
                        grid-row: 1;
                    }
                }
            </style>
        `;
    }

    function shortcutHelpStyle() {
        return `
            <style>
                .player-health-button {
                    position: fixed;
                    top: calc(3.45rem + env(safe-area-inset-top, 0px));
                    right: calc(0.95rem + env(safe-area-inset-right, 0px));
                    z-index: 304;
                    min-width: 3.45rem;
                    height: 2.25rem;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 0.72rem;
                    border: 1px solid rgba(255,255,255,0.14);
                    border-radius: 999px;
                    background: rgba(18,18,20,0.58);
                    color: rgba(255,255,255,0.84);
                    font: 800 0.78rem/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    box-shadow: 0 10px 28px rgba(0,0,0,0.24);
                    backdrop-filter: blur(18px) saturate(150%);
                    -webkit-backdrop-filter: blur(18px) saturate(150%);
                    cursor: pointer;
                }
                .player-health-button:hover,
                .player-health-button:focus-visible {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                .player-health-overlay {
                    position: fixed;
                    top: calc(5.95rem + env(safe-area-inset-top, 0px));
                    right: calc(0.95rem + env(safe-area-inset-right, 0px));
                    z-index: 306;
                    width: min(25rem, calc(100vw - 2rem));
                    max-height: calc(100vh - 7rem - env(safe-area-inset-top, 0px));
                    max-height: calc(100dvh - 7rem - env(safe-area-inset-top, 0px));
                    overflow-y: auto;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                }
                .player-health-card {
                    padding: 0.95rem;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 0.78rem;
                    background: rgba(18,18,20,0.9);
                    box-shadow: 0 22px 70px rgba(0,0,0,0.48);
                    backdrop-filter: blur(24px) saturate(155%);
                    -webkit-backdrop-filter: blur(24px) saturate(155%);
                    min-width: 0;
                }
                .player-health-card.ok { border-color: rgba(48,209,88,0.28); }
                .player-health-card.warn { border-color: rgba(255,159,10,0.34); }
                .player-health-card.danger { border-color: rgba(255,69,58,0.42); }
                .player-health-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 0.85rem;
                    margin-bottom: 0.75rem;
                }
                .player-health-kicker {
                    color: rgba(255,255,255,0.52);
                    font-size: 0.7rem;
                    font-weight: 850;
                }
                .player-health-title {
                    margin-top: 0.12rem;
                    min-width: 0;
                    font-size: 0.98rem;
                    line-height: 1.28;
                    font-weight: 850;
                }
                .player-health-close {
                    flex: 0 0 auto;
                    width: 2rem;
                    height: 2rem;
                    border: 0;
                    border-radius: 999px;
                    background: rgba(255,255,255,0.09);
                    color: rgba(255,255,255,0.72);
                    font-size: 1.16rem;
                    line-height: 1;
                    cursor: pointer;
                }
                .player-health-close:hover,
                .player-health-close:focus-visible {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                .player-health-current {
                    min-width: 0;
                    display: grid;
                    gap: 0.2rem;
                    padding: 0.68rem 0.75rem;
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 0.58rem;
                    background: rgba(255,255,255,0.055);
                }
                .player-health-current span,
                .player-health-metric span {
                    color: rgba(255,255,255,0.52);
                    font-size: 0.72rem;
                    font-weight: 780;
                }
                .player-health-current strong {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 0.88rem;
                }
                .player-health-grid {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 0.5rem;
                    margin-top: 0.6rem;
                }
                .player-health-metric {
                    min-width: 0;
                    display: grid;
                    gap: 0.16rem;
                    padding: 0.52rem;
                    border-radius: 0.5rem;
                    background: rgba(255,255,255,0.055);
                }
                .player-health-metric strong {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 0.82rem;
                }
                .player-health-hint {
                    margin-top: 0.68rem;
                    color: rgba(255,255,255,0.64);
                    font-size: 0.78rem;
                    line-height: 1.5;
                    overflow-wrap: anywhere;
                }
                .player-health-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.45rem;
                    margin-top: 0.78rem;
                }
                .player-health-actions button {
                    min-height: 2.1rem;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 0.75rem;
                    border: 1px solid rgba(255,255,255,0.14);
                    border-radius: 999px;
                    background: rgba(255,255,255,0.08);
                    color: #fff;
                    font-size: 0.76rem;
                    font-weight: 780;
                    cursor: pointer;
                }
                .player-health-actions button:first-child {
                    border-color: transparent;
                    background: #fff;
                    color: #000;
                }
                .player-health-actions button:hover,
                .player-health-actions button:focus-visible {
                    border-color: rgba(255,255,255,0.24);
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                .player-shortcuts-button {
                    position: fixed;
                    top: calc(0.9rem + env(safe-area-inset-top, 0px));
                    right: calc(0.95rem + env(safe-area-inset-right, 0px));
                    z-index: 304;
                    width: 2.25rem;
                    height: 2.25rem;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid rgba(255,255,255,0.14);
                    border-radius: 999px;
                    background: rgba(18,18,20,0.58);
                    color: rgba(255,255,255,0.84);
                    font: 800 0.92rem/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    box-shadow: 0 10px 28px rgba(0,0,0,0.24);
                    backdrop-filter: blur(18px) saturate(150%);
                    -webkit-backdrop-filter: blur(18px) saturate(150%);
                    cursor: pointer;
                }
                .player-shortcuts-button:hover,
                .player-shortcuts-button:focus-visible {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                .player-shortcuts-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 305;
                    display: grid;
                    place-items: center;
                    padding: max(1rem, env(safe-area-inset-top, 0px)) 1rem max(1rem, env(safe-area-inset-bottom, 0px));
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                }
                .player-shortcuts-backdrop {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.58);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                }
                .player-shortcuts-panel {
                    position: relative;
                    width: min(31rem, 100%);
                    max-height: min(34rem, calc(100vh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
                    max-height: min(34rem, calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
                    overflow: auto;
                    padding: 1rem;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 0.85rem;
                    background: rgba(20,20,22,0.9);
                    box-shadow: 0 24px 80px rgba(0,0,0,0.48);
                    backdrop-filter: blur(24px) saturate(155%);
                    -webkit-backdrop-filter: blur(24px) saturate(155%);
                }
                .player-shortcuts-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 1rem;
                    margin-bottom: 0.9rem;
                }
                .player-shortcuts-kicker {
                    color: rgba(255,255,255,0.5);
                    font-size: 0.72rem;
                    font-weight: 800;
                }
                .player-shortcuts-head h2 {
                    margin: 0.12rem 0 0;
                    font-size: 1.18rem;
                    line-height: 1.2;
                }
                .player-shortcuts-close {
                    flex: 0 0 auto;
                    width: 2.2rem;
                    height: 2.2rem;
                    border: 0;
                    border-radius: 999px;
                    background: rgba(255,255,255,0.1);
                    color: rgba(255,255,255,0.78);
                    font-size: 1.25rem;
                    cursor: pointer;
                }
                .player-shortcuts-close:hover,
                .player-shortcuts-close:focus-visible {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                    outline: none;
                }
                .player-shortcuts-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 0.5rem;
                }
                .player-shortcuts-item {
                    min-height: 3.15rem;
                    display: grid;
                    align-content: center;
                    gap: 0.35rem;
                    padding: 0.72rem;
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 0.55rem;
                    background: rgba(255,255,255,0.055);
                }
                .player-shortcuts-keys {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.26rem;
                }
                .player-shortcuts-keys kbd {
                    min-width: 1.7rem;
                    padding: 0.18rem 0.45rem;
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 0.35rem;
                    background: rgba(255,255,255,0.09);
                    color: #fff;
                    font: 800 0.75rem/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    text-align: center;
                }
                .player-shortcuts-label {
                    color: rgba(255,255,255,0.72);
                    font-size: 0.82rem;
                    line-height: 1.35;
                }
                @media (max-width: 640px) {
                    .player-shortcuts-button {
                        top: calc(0.75rem + env(safe-area-inset-top, 0px));
                        right: calc(0.75rem + env(safe-area-inset-right, 0px));
                    }
                    .player-health-button {
                        top: calc(3.2rem + env(safe-area-inset-top, 0px));
                        right: calc(0.75rem + env(safe-area-inset-right, 0px));
                    }
                    .player-health-overlay {
                        top: calc(5.6rem + env(safe-area-inset-top, 0px));
                        left: 0.75rem;
                        right: 0.75rem;
                        width: auto;
                        max-height: calc(100vh - 6.5rem - env(safe-area-inset-top, 0px));
                        max-height: calc(100dvh - 6.5rem - env(safe-area-inset-top, 0px));
                    }
                    .player-health-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .player-health-actions {
                        display: grid;
                        grid-template-columns: 1fr;
                    }
                    .player-health-actions button {
                        min-height: 2.75rem;
                    }
                    .player-shortcuts-grid {
                        grid-template-columns: 1fr;
                    }
                }
                @media (max-height: 420px) and (orientation: landscape) {
                    .player-shortcuts-button {
                        top: calc(0.55rem + env(safe-area-inset-top, 0px));
                        right: calc(0.6rem + env(safe-area-inset-right, 0px));
                        width: 2rem;
                        height: 2rem;
                    }
                    .player-health-button {
                        top: calc(2.85rem + env(safe-area-inset-top, 0px));
                        right: calc(0.6rem + env(safe-area-inset-right, 0px));
                        min-width: 3rem;
                        height: 2rem;
                    }
                    .player-health-overlay {
                        top: calc(5.05rem + env(safe-area-inset-top, 0px));
                        right: calc(0.6rem + env(safe-area-inset-right, 0px));
                        left: auto;
                        width: min(22rem, calc(100vw - 1.2rem));
                        max-height: calc(100vh - 5.65rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 5.65rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-health-card,
                    .player-shortcuts-panel {
                        padding: 0.75rem;
                    }
                    .player-health-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .player-health-actions {
                        display: grid;
                        grid-template-columns: 1fr;
                    }
                    .player-health-actions button {
                        min-height: 2.35rem;
                    }
                    .player-shortcuts-overlay {
                        place-items: start center;
                        padding-top: max(0.55rem, env(safe-area-inset-top, 0px));
                        padding-bottom: max(0.55rem, env(safe-area-inset-bottom, 0px));
                    }
                    .player-shortcuts-panel {
                        max-height: calc(100vh - 1.1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 1.1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-shortcuts-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .player-shortcuts-item {
                        min-height: 2.75rem;
                        padding: 0.55rem;
                    }
                }
                @media (max-width: 380px) {
                    .player-health-grid {
                        grid-template-columns: 1fr;
                    }
                    .player-shortcuts-overlay {
                        padding-left: 0.75rem;
                        padding-right: 0.75rem;
                    }
                }
            </style>
        `;
    }

    function goBackToDetail() {
        clearAutoNextOverlay();
        flushPlaybackProgress({ force: true });
        flushHistorySync({ keepalive: true });
        location.hash = `#/detail/${type}/${id}`;
    }

    function playerErrorActions(options = {}) {
        if (options.login) {
            return [
                { id: 'login', label: '登录继续' },
                { id: 'reload-stream', label: '重新获取地址', variant: 'secondary' },
                { id: 'copy-diagnostics', label: '复制诊断', variant: 'secondary' },
            ];
        }
        const hasFallback = !!nextAvailableSource({ allowTried: true });
        if (hasFallback && !options.vip) {
            return [
                { id: 'next-source', label: '切换备用源' },
                { id: 'reload-stream', label: '重新获取地址', variant: 'secondary' },
                { id: 'copy-diagnostics', label: '复制诊断', variant: 'secondary' },
            ];
        }
        const primary = options.vip
            ? { id: 'vip', label: '查看会员权益' }
            : { id: 'retry-current-source', label: '重试当前源' };
        return [
            primary,
            { id: 'reload-stream', label: '重新获取地址', variant: 'secondary' },
            { id: 'copy-diagnostics', label: '复制诊断', variant: 'secondary' },
        ];
    }

    async function copyPlaybackDiagnostics() {
        const text = buildPlaybackDiagnostics();
        const ok = await copyText(text);
        showSiteNotice(ok ? '播放诊断已复制' : '复制失败，请手动截图当前错误', { tone: ok ? 'success' : 'error' });
    }

    function getPlayerQualityPreference() {
        try {
            const raw = localStorage.getItem('gyp_quality_pref');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function preferredPlaybackSource(label) {
        const normalized = sourcePreferenceValue({ label });
        if (!normalized) return null;
        return host.state.currentStreams.find((stream) => (
            stream?.url &&
            stream.url !== host.state.currentStreamUrl &&
            !host.state.failedSourceUrls.has(stream.url) &&
            sourcePreferenceValue(stream) === normalized
        )) || host.state.currentStreams.find((stream) => (
            stream?.url &&
            stream.url !== host.state.currentStreamUrl &&
            sourcePreferenceValue(stream) === normalized
        )) || null;
    }

    function buildPlaybackDiagnostics() {
        const activeSource = host.state.currentStreams.find((stream) => stream?.url === host.state.currentStreamUrl) || {};
        const error = host.state.lastPlaybackError || {};
        const lines = [
            '光影播放诊断',
            `时间：${new Date().toISOString()}`,
            `页面：${location.href}`,
            `内容：${meta?.name || id}`,
            `类型：${type}`,
            `内容ID：${id}`,
            `视频ID：${currentVid || streamId}`,
            `片源：${activeSource.quality || activeSource.title || activeSource.label || '未知'}`,
            `片源数量：${host.state.currentStreams.length}`,
            `已尝试备用源：${host.state.failedSourceUrls.size}`,
            `长缓冲次数：${longStallCount}`,
            `进度：${formatClock(host.state.lastProgress.currentTime)} / ${formatClock(host.state.lastProgress.duration)}`,
            `readyState：${player.video?.readyState ?? '未知'}`,
            `networkState：${player.video?.networkState ?? '未知'}`,
            `倍速：${player.video?.playbackRate || 1}x`,
            `在线状态：${navigator.onLine === false ? '离线' : '在线'}`,
            `错误代码：${error.code || error.type || 'player_error'}`,
            `错误信息：${error.message || error.reason || '无'}`,
            `浏览器：${navigator.userAgent}`,
        ];
        return lines.join('\n');
    }

    function activeSourceLabel() {
        const activeSource = host.state.currentStreams.find((stream) => stream?.url === host.state.currentStreamUrl) || host.state.currentStreams[0] || {};
        return activeSource.quality || activeSource.title || activeSource.label || '';
    }

    function activeSource() {
        return host.state.currentStreams.find((stream) => stream?.url === host.state.currentStreamUrl) || host.state.currentStreams[0] || {};
    }

    function mountPlaybackHealthButton() {
        playbackHealthButton = document.createElement('button');
        playbackHealthButton.className = 'player-health-button';
        playbackHealthButton.type = 'button';
        playbackHealthButton.setAttribute('aria-label', '查看播放线路状态');
        playbackHealthButton.innerHTML = '<span aria-hidden="true">线路</span>';
        playbackHealthButton.addEventListener('click', () => {
            requestPlaybackHealthAdvice({ refreshOverlay: true });
            showPlaybackHealthOverlay({ mode: 'manual' });
        });
        document.body.appendChild(playbackHealthButton);
    }

    function schedulePlaybackHealthIntro() {
        clearTimeout(playbackHealthTimer);
        playbackHealthTimer = null;
    }

    function showPlaybackHealthOverlay(options = {}) {
        clearPlaybackHealthOverlay();
        playbackHealthOverlay = document.createElement('div');
        playbackHealthOverlay.className = 'player-health-overlay';
        playbackHealthOverlay.innerHTML = playerHealthOverlayHTML(options.mode || 'manual');
        bindPlaybackHealthActions();
        document.body.appendChild(playbackHealthOverlay);
        if (options.autoClose) {
            playbackHealthTimer = setTimeout(clearPlaybackHealthOverlay, options.mode === 'terminal' ? 12000 : 7000);
        }
    }

    function updatePlaybackHealthOverlay() {
        if (!playbackHealthOverlay) return;
        playbackHealthOverlay.innerHTML = playerHealthOverlayHTML('manual');
        bindPlaybackHealthActions();
    }

    async function requestPlaybackHealthAdvice(options = {}) {
        if (previewMode || playbackHealthFetchInFlight) return null;
        const videoId = meta?.analyticsVideoId || currentVid || id;
        const movieId = meta?.movieId;
        const tmdbId = meta?.tmdbId;
        const mediaType = meta?.mediaType || (type === 'movie' ? 'movie' : 'tv');
        if (!videoId && !movieId && !tmdbId) return null;
        playbackHealthFetchInFlight = true;
        try {
            const health = await getPlaybackHealth({
                videoId,
                movieId,
                tmdbId,
                mediaType,
                sourceLabel: activeSourceLabel(),
            });
            if (health?.advice) {
                playbackHealthAdvice = health;
                if (options.refreshOverlay && playbackHealthOverlay) {
                    playbackHealthOverlay.innerHTML = playerHealthOverlayHTML(options.mode || 'manual');
                    bindPlaybackHealthActions();
                }
            }
            return health;
        } catch {
            return null;
        } finally {
            playbackHealthFetchInFlight = false;
        }
    }

    function bindPlaybackHealthActions() {
        if (!playbackHealthOverlay) return;
        playbackHealthOverlay.querySelector('.player-health-close')?.addEventListener('click', clearPlaybackHealthOverlay);
        playbackHealthOverlay.querySelector('.player-health-copy')?.addEventListener('click', copyPlaybackDiagnostics);
        playbackHealthOverlay.querySelector('.player-health-next')?.addEventListener('click', () => {
            clearPlaybackHealthOverlay();
            switchToNextSource({ preferredLabel: playbackHealthAdvice?.recommendedSourceLabel });
        });
        playbackHealthOverlay.querySelector('.player-health-reload')?.addEventListener('click', () => {
            clearPlaybackHealthOverlay();
            retryCurrentPlayback();
        });
    }

    function clearPlaybackHealthOverlay() {
        if (playbackHealthTimer) {
            clearTimeout(playbackHealthTimer);
            playbackHealthTimer = null;
        }
        playbackHealthOverlay?.remove();
        playbackHealthOverlay = null;
    }

    function clearPlaybackHealthButton() {
        playbackHealthButton?.remove();
        playbackHealthButton = null;
    }

    function playerHealthOverlayHTML(mode) {
        const source = activeSource();
        const label = source.quality || source.title || source.label || '当前播放源';
        const subtitles = source.subtitles?.length || 0;
        const resume = resumeFor(currentVid);
        const fallback = preferredPlaybackSource(playbackHealthAdvice?.recommendedSourceLabel) || nextAvailableSource({ allowTried: true });
        const status = playbackHealthStatus(mode);
        const failedCount = host.state.failedSourceUrls.size;
        const advice = playbackHealthAdvice?.advice;
        const signal = playbackHealthAdvice?.signals;
        const recommendedSourceLabel = playbackHealthAdvice?.recommendedSourceLabel;
        const signalHint = signal?.confidence && signal.confidence !== 'low'
            ? `后端近 6 小时信号：错误率 ${signal.errorRate || 0}% · 卡顿 ${signal.bufferingStalls || 0} 次`
            : '后端健康信号样本较少，本地会继续自动恢复。';
        return `
            <section class="player-health-card ${status.tone}" role="status" aria-live="polite">
                <div class="player-health-head">
                    <div>
                        <div class="player-health-kicker">播放线路</div>
                        <div class="player-health-title">${escapeHtml(status.title)}</div>
                    </div>
                    <button class="player-health-close" type="button" aria-label="关闭线路状态">×</button>
                </div>
                <div class="player-health-current">
                    <span>当前</span>
                    <strong>${escapeHtml(label)}</strong>
                </div>
                <div class="player-health-grid">
                    ${playerHealthMetric('备用源', `${Math.max(0, host.state.currentStreams.length - 1)} 条`)}
                    ${playerHealthMetric('字幕', subtitles ? `${subtitles} 条` : '无')}
                    ${playerHealthMetric('已尝试', `${failedCount} 条`)}
                    ${playerHealthMetric('卡顿', longStallCount ? `${longStallCount} 次` : '无')}
                </div>
                <div class="player-health-hint">${escapeHtml(status.hint)}</div>
                ${advice ? `
                    <div class="player-health-hint">
                        <strong>${escapeHtml(advice.title || '播放健康建议')}</strong><br>
                        ${escapeHtml(advice.hint || signalHint)}
                        ${recommendedSourceLabel ? `<br>建议线路：${escapeHtml(recommendedSourceLabel)}` : ''}
                    </div>
                ` : `<div class="player-health-hint">${escapeHtml(signalHint)}</div>`}
                <div class="player-health-actions">
                    ${fallback ? '<button class="player-health-next" type="button">切换备用源</button>' : ''}
                    <button class="player-health-reload" type="button">重新获取地址</button>
                    <button class="player-health-copy" type="button">复制诊断</button>
                </div>
            </section>
        `;
    }

    function playbackHealthStatus(mode) {
        if (mode === 'error') {
            return { tone: 'warn', title: '检测到播放异常，正在自动恢复', hint: '系统会优先切到未尝试的备用源，并保留当前播放进度。' };
        }
        if (mode === 'terminal') {
            return { tone: 'danger', title: '所有备用源都不可用', hint: '可以重新获取签名地址，或复制诊断信息交给管理员排查。' };
        }
        if (mode === 'retry') {
            return { tone: 'warn', title: '正在重试当前播放源', hint: '如果签名过期或网络刚恢复，重试通常可以继续播放。' };
        }
        if (mode === 'buffering') {
            return { tone: 'warn', title: '缓冲时间偏长，正在监控恢复', hint: '如果持续卡住，系统会先重试当前源，再切换备用源并保留进度。' };
        }
        if (mode === 'offline') {
            return { tone: 'warn', title: '网络已断开，等待自动重连', hint: '网络恢复后会重新获取播放地址，并从当前进度继续播放。' };
        }
        if (mode === 'switching' || mode === 'recovery') {
            return { tone: 'ok', title: '正在切换线路并恢复进度', hint: '切源后会从当前进度继续播放，并记录本次切换用于后台分析。' };
        }
        if (mode === 'resume') {
            return { tone: 'ok', title: '已启用断点续播', hint: '播放进度会继续写入本地历史，登录后也会同步到账号。' };
        }
        if (mode === 'ready') {
            return { tone: 'ok', title: '已准备好备用线路', hint: '遇到卡顿或失败时，可从这里手动切换线路或重新获取地址。' };
        }
        return { tone: 'neutral', title: '当前播放状态', hint: '这里汇总当前线路、字幕、续播点和错误恢复状态。' };
    }

    function playerHealthMetric(label, value) {
        return `
            <div class="player-health-metric">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
            </div>
        `;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return fallbackCopyText(text);
        }
    }

    function fallbackCopyText(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(textarea);
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        textarea.remove();
        return ok;
    }

    function scheduleAutoNext() {
        clearResumeOverlay();
        clearAutoNextOverlay();
        const next = adjacentEpisode(1);
        if (!next) {
            showPlaybackEndedOverlay();
            return;
        }
        autoNextRemain = 5;
        autoNextOverlay = document.createElement('div');
        autoNextOverlay.className = 'player-next-overlay';
        autoNextOverlay.innerHTML = `
            ${playerNextOverlayStyle()}
            <div class="player-next-card" role="dialog" aria-live="polite" aria-label="自动播放下一集">
                <div class="player-next-kicker"><span id="player-next-seconds">5</span> 秒后自动播放</div>
                <div class="player-next-title">
                    ${episodeCode(next) ? `<span>${episodeCode(next)}</span>` : ''}
                    <strong>${escapeHtml(next.title || `第${next.episode}集`)}</strong>
                </div>
                <div class="player-next-progress"><span></span></div>
                <div class="player-next-actions">
                    <button class="player-next-now" type="button">立即播放</button>
                    <button class="player-next-cancel" type="button">留在本集</button>
                    <a class="player-next-detail" href="#/detail/${type}/${id}">返回详情</a>
                </div>
            </div>
        `;
        document.body.appendChild(autoNextOverlay);

        autoNextOverlay.querySelector('.player-next-now')?.addEventListener('click', () => {
            clearAutoNextOverlay();
            playEpisodeById(next.id);
        });
        autoNextOverlay.querySelector('.player-next-cancel')?.addEventListener('click', () => {
            clearAutoNextOverlay();
            player.showHint?.('已取消自动连播');
        });
        autoNextOverlay.querySelector('.player-next-detail')?.addEventListener('click', () => {
            clearAutoNextOverlay();
        });

        const secondsEl = autoNextOverlay.querySelector('#player-next-seconds');
        autoNextTimer = setInterval(() => {
            autoNextRemain -= 1;
            if (secondsEl) secondsEl.textContent = String(Math.max(0, autoNextRemain));
            if (autoNextRemain <= 0) {
                clearAutoNextOverlay();
                playEpisodeById(next.id);
            }
        }, 1000);
    }

    async function showPlaybackEndedOverlay() {
        autoNextOverlay = document.createElement('div');
        autoNextOverlay.className = 'player-next-overlay player-end-overlay';
        autoNextOverlay.innerHTML = `
            ${playerNextOverlayStyle()}
            <div class="player-next-card player-end-card" role="dialog" aria-live="polite" aria-label="播放已结束">
                <div class="player-next-kicker">播放已结束</div>
                <div class="player-end-title">${escapeHtml(meta?.name || title || '当前内容')}</div>
                <div class="player-end-insight">
                    <strong>${escapeHtml(playbackEndInsight().title)}</strong>
                    <span>${escapeHtml(playbackEndInsight().hint)}</span>
                </div>
                ${playbackEndMomentumHTML()}
                <div class="player-end-actions">
                    <button class="player-next-now player-end-replay" type="button">重新播放</button>
                    <button class="player-next-cancel player-end-favorite ${isFavorite(id) ? 'active' : ''}" type="button">${isFavorite(id) ? '已收藏' : '收藏'}</button>
                    <button class="player-next-cancel player-end-later ${isWatchLater(id) ? 'active' : ''}" type="button">${isWatchLater(id) ? '已在稍后看' : '稍后看'}</button>
                    <button class="player-next-cancel player-end-share" type="button">分享给朋友</button>
                    <a class="player-next-cancel player-end-discuss" href="#/detail/${type}/${id}">去讨论</a>
                    ${showPlaybackEndVipCta() ? `<a class="player-next-now player-end-vip" href="${escapeHtml(buildVipReturnHref(type, id, currentVid, meta?.name || title || ''))}">解锁会员权益</a>` : ''}
                    <a class="player-next-detail" href="#/detail/${type}/${id}">返回详情</a>
                </div>
                <div class="player-end-recommend">
                    <div class="player-end-recommend-head">接着看</div>
                    <div class="player-end-recommend-body" id="player-end-recommend-body">
                        <div class="player-end-loading">正在寻找推荐内容</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(autoNextOverlay);
        reportEngagementEvent('decision_impression', mediaIdentityPayload({
            source: 'playback_end',
            targetId: 'gy:player-end-actions',
            value: showPlaybackEndVipCta() ? 5 : 4,
            label: 'playback end action panel',
        }));

        autoNextOverlay.querySelector('.player-end-replay')?.addEventListener('click', () => {
            clearAutoNextOverlay();
            reportEngagementEvent('play_click', mediaIdentityPayload({
                source: 'playback_end',
                targetId: currentVid || id,
                label: 'replay from playback end',
            }));
            const current = host.state.currentStreams.find((stream) => stream?.url === host.state.currentStreamUrl) || host.state.currentStreams[0];
            if (current) {
                void loadInto(current, currentVid, host.state.currentStreams, { startTime: 0, playAfterLoad: true });
            }
        });
        autoNextOverlay.querySelector('.player-end-favorite')?.addEventListener('click', (event) => {
            const added = toggleFavorite(libraryPayload());
            event.currentTarget.textContent = added ? '已收藏' : '收藏';
            event.currentTarget.classList.toggle('active', added);
            showSiteNotice(added ? '已加入收藏' : '已取消收藏', { tone: 'success' });
            reportEngagementEvent('favorite', mediaIdentityPayload({
                source: 'playback_end',
                actionState: added ? 'on' : 'off',
                label: 'favorite from playback end',
            }));
        });
        autoNextOverlay.querySelector('.player-end-later')?.addEventListener('click', (event) => {
            const added = toggleWatchLater(libraryPayload());
            event.currentTarget.textContent = added ? '已在稍后看' : '稍后看';
            event.currentTarget.classList.toggle('active', added);
            showSiteNotice(added ? '已加入稍后看' : '已移出稍后看', { tone: 'success' });
            reportEngagementEvent('watch_later', mediaIdentityPayload({
                source: 'playback_end',
                actionState: added ? 'on' : 'off',
                label: 'watch later from playback end',
            }));
        });
        autoNextOverlay.querySelector('.player-end-share')?.addEventListener('click', async () => {
            const shareBtn = autoNextOverlay.querySelector('.player-end-share');
            if (!shareBtn || shareBtn.disabled) return;
            const originalText = shareBtn.textContent;
            shareBtn.disabled = true;
            shareBtn.textContent = '正在复制';
            const shareUrl = buildCommunityShareUrl(`#/detail/${type}/${id}`, meta || {});
            const shareText = `${communityShareText({ title: meta?.name || title || '这部片', description: meta?.description || '' })}\n${shareUrl}`;
            const ok = await copyText(shareText);
            if (ok) {
                recordCommunityShare('player_end_copy', mediaIdentityPayload({
                    shareUrl,
                }));
            }
            showSiteNotice(ok ? '分享文案已复制' : '复制失败，请稍后再试', { tone: ok ? 'success' : 'error' });
            shareBtn.textContent = ok ? '已复制' : '分享给朋友';
            setTimeout(() => {
                if (!shareBtn.isConnected) return;
                shareBtn.textContent = originalText || '分享给朋友';
                shareBtn.disabled = false;
            }, 1400);
        });
        autoNextOverlay.querySelector('.player-end-discuss')?.addEventListener('click', () => {
            reportEngagementEvent('discussion', mediaIdentityPayload({
                source: 'playback_end',
                actionState: 'open',
                label: 'discussion from playback end',
            }));
            clearAutoNextOverlay();
        });
        autoNextOverlay.querySelector('.player-end-vip')?.addEventListener('click', () => {
            reportEngagementEvent('decision_click', mediaIdentityPayload({
                source: 'playback_end',
                targetId: 'gy:vip-offer',
                value: 1,
                label: 'vip from playback end',
            }));
            clearAutoNextOverlay();
        });
        autoNextOverlay.querySelector('.player-next-detail')?.addEventListener('click', () => {
            clearAutoNextOverlay();
        });

        const body = autoNextOverlay.querySelector('#player-end-recommend-body');
        try {
            const items = await playbackEndRecommendations();
            if (!body || !autoNextOverlay?.contains(body)) return;
            if (!items.length) {
                body.innerHTML = `<a class="player-end-empty" href="#/detail/${type}/${id}">暂无推荐，回到详情页继续探索</a>`;
                return;
            }
            body.innerHTML = items.slice(0, 3).map(renderPlaybackEndRecommendation).join('');
            body.querySelectorAll('a').forEach((link) => {
                link.addEventListener('click', () => {
                    reportEngagementEvent('similar_click', mediaIdentityPayload({
                        source: 'playback_end',
                        targetId: metricToken(link.dataset.targetId || ''),
                        targetType: link.dataset.targetType || undefined,
                        label: link.textContent?.replace(/\s+/g, ' ').trim() || 'playback end recommendation',
                    }));
                    clearAutoNextOverlay();
                });
            });
        } catch {
            if (body && autoNextOverlay?.contains(body)) {
                body.innerHTML = `<a class="player-end-empty" href="#/${catalogRouteForPlayback(type, meta)}">推荐加载失败，去片库看看</a>`;
            }
        }
    }

    function playbackEndMomentumHTML() {
        const chips = playbackEndMomentumChips();
        if (!chips.length) return '';
        return `
            <div class="player-end-momentum" aria-label="完播价值">
                ${chips.map((chip) => `
                    <span class="player-end-momentum-chip" data-tone="${escapeHtml(chip.tone || 'neutral')}">
                        <strong>${escapeHtml(chip.value)}</strong>
                        <small>${escapeHtml(chip.label)}</small>
                    </span>
                `).join('')}
            </div>
        `;
    }

    function playbackEndMomentumChips() {
        const chips = [];
        const percent = Math.round(Number(host.state.lastProgress.percent || 0));
        if (percent >= 80) chips.push({ value: '完播', label: '偏好更明确', tone: 'success' });
        else if (percent > 0) chips.push({ value: `${percent}%`, label: '观看进度', tone: 'neutral' });
        if (isFavorite(id)) chips.push({ value: '已收藏', label: '回访线索', tone: 'save' });
        if (isWatchLater(id)) chips.push({ value: '稍后看', label: '下次入口', tone: 'save' });
        if (!hasVipAccess() && (percent >= 80 || isFavorite(id) || isWatchLater(id))) chips.push({ value: '高意愿', label: '适合转化', tone: 'vip' });
        if (hasVipAccess()) chips.push({ value: 'VIP', label: '权益消费中', tone: 'vip' });
        chips.push({ value: '讨论', label: '社区沉淀', tone: 'social' });
        return chips.slice(0, 4);
    }

    function playbackEndInsight() {
        if (showPlaybackEndVipCta()) {
            return {
                title: '高意愿节点',
                hint: '刚看完时最适合收藏、分享或解锁高清多端权益。',
            };
        }
        if (!isFavorite(id) && !isWatchLater(id)) {
            return {
                title: '把这次观看沉淀下来',
                hint: '收藏或稍后看会让下次回访更快，也能改善推荐。',
            };
        }
        return {
            title: '继续保持观看节奏',
            hint: '从推荐内容接着看，或者把这部内容分享给朋友一起讨论。',
        };
    }

    function showPlaybackEndVipCta() {
        return !hasVipAccess() && (requiresVip(meta) || host.state.lastProgress.percent >= 80 || isFavorite(id) || isWatchLater(id));
    }

    async function playbackEndRecommendations() {
        const currentId = String(id || meta?.id || '');
        const seen = new Set([currentId]);
        const fromSimilar = (meta?.similar || [])
            .filter((item) => {
                const itemId = String(item.id || '');
                if (!itemId || seen.has(itemId)) return false;
                seen.add(itemId);
                return true;
            });
        if (fromSimilar.length) return fromSimilar;

        const data = await getRankings({ type: rankingTypeForPlayback(type, meta), limit: 12 });
        const rows = [];
        for (const list of data.lists || []) {
            for (const item of list.items || []) {
                const itemId = String(item.id || '');
                if (!itemId || seen.has(itemId)) continue;
                seen.add(itemId);
                rows.push(item);
            }
        }
        return rows;
    }

    function renderPlaybackEndRecommendation(item) {
        const itemType = item.type === 'movie' ? 'movie' : 'series';
        const metaLine = [
            item.year || '',
            item.imdbRating ? `评分 ${item.imdbRating}` : '',
        ].filter(Boolean).join(' · ') || (itemType === 'movie' ? '电影' : '剧集');
        return `
            <a class="player-end-item" href="#/detail/${itemType}/${escapeHtml(item.id)}" data-target-id="${escapeHtml(item.id || '')}" data-target-type="${escapeHtml(itemType)}">
                ${item.poster ? `<img src="${escapeHtml(item.poster)}" alt="">` : '<span class="player-end-poster-empty"></span>'}
                <span>
                    <strong>${escapeHtml(item.name || '未命名内容')}</strong>
                    <small>${escapeHtml(metaLine)}</small>
                </span>
            </a>
        `;
    }

    function rankingTypeForPlayback(pageType, pageMeta) {
        if (pageType === 'anime' || pageMeta?.type === 'anime') return 'anime';
        if (pageType === 'movie' || pageMeta?.type === 'movie') return 'movie';
        return 'tv';
    }

    function catalogRouteForPlayback(pageType, pageMeta) {
        if (pageType === 'anime' || pageMeta?.type === 'anime') return 'anime';
        if (pageType === 'movie' || pageMeta?.type === 'movie') return 'movie';
        return 'tv';
    }

    function metricToken(value) {
        const token = String(value || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
        return token || 'unknown';
    }

    function playerNextOverlayStyle() {
        return `
            <style>
                .player-next-overlay {
                    position: fixed;
                    right: calc(1.25rem + env(safe-area-inset-right, 0px));
                    bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
                    z-index: 301;
                    width: min(24rem, calc(100vw - 2rem));
                    max-height: calc(100vh - 7rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    max-height: calc(100dvh - 7rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    overflow-y: auto;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    overscroll-behavior: contain;
                }
                .player-next-card {
                    padding: 1rem;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 0.6rem;
                    background: rgba(20,20,22,0.82);
                    box-shadow: 0 18px 50px rgba(0,0,0,0.45);
                    backdrop-filter: blur(20px) saturate(150%);
                    -webkit-backdrop-filter: blur(20px) saturate(150%);
                    min-width: 0;
                }
                .player-next-kicker {
                    color: rgba(255,255,255,0.62);
                    font-size: 0.74rem;
                    font-weight: 750;
                    margin-bottom: 0.35rem;
                }
                .player-next-title {
                    display: flex;
                    align-items: baseline;
                    gap: 0.45rem;
                    min-width: 0;
                    font-size: 0.98rem;
                    line-height: 1.35;
                    font-weight: 750;
                }
                .player-next-title span {
                    flex: 0 0 auto;
                    color: rgba(255,255,255,0.58);
                    font-size: 0.8rem;
                }
                .player-next-title strong {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .player-next-progress {
                    height: 3px;
                    overflow: hidden;
                    border-radius: 999px;
                    margin: 0.8rem 0 0.85rem;
                    background: rgba(255,255,255,0.18);
                }
                .player-next-progress span {
                    display: block;
                    height: 100%;
                    width: 100%;
                    border-radius: inherit;
                    background: #fff;
                    transform-origin: left center;
                    animation: player-next-countdown 5s linear forwards;
                }
                @keyframes player-next-countdown {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
                .player-next-actions,
                .player-end-actions {
                    display: flex;
                    gap: 0.5rem;
                    flex-wrap: wrap;
                }
                .player-end-actions {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
                .player-next-actions button,
                .player-next-actions a,
                .player-end-actions button,
                .player-end-actions a {
                    min-width: 0;
                    min-height: 2.25rem;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 0.85rem;
                    border-radius: 999px;
                    font-size: 0.8rem;
                    font-weight: 750;
                    text-decoration: none;
                    cursor: pointer;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .player-next-now {
                    border: none;
                    background: #fff;
                    color: #000;
                }
                .player-next-cancel,
                .player-next-detail {
                    border: 1px solid rgba(255,255,255,0.16);
                    background: rgba(255,255,255,0.08);
                    color: #fff;
                }
                .player-end-favorite.active,
                .player-end-later.active {
                    border-color: rgba(48,209,88,0.38);
                    background: rgba(48,209,88,0.14);
                    color: #30d158;
                }
                .player-end-share {
                    border-color: rgba(10,132,255,0.28);
                    background: rgba(10,132,255,0.12);
                }
                .player-end-discuss {
                    border-color: rgba(48,209,88,0.28);
                    background: rgba(48,209,88,0.1);
                }
                .player-end-vip {
                    background: #ff9f0a;
                    color: #120a00;
                }
                .player-end-card {
                    padding: 1.05rem;
                }
                .player-end-title {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    margin-bottom: 0.8rem;
                    font-size: 1.05rem;
                    font-weight: 800;
                }
                .player-end-insight {
                    display: grid;
                    gap: 0.18rem;
                    margin: -0.2rem 0 0.85rem;
                    padding: 0.68rem 0.75rem;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 0.55rem;
                    background: rgba(255,255,255,0.07);
                }
                .player-end-insight strong,
                .player-end-insight span {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .player-end-insight strong {
                    color: #30d158;
                    font-size: 0.8rem;
                    font-weight: 850;
                }
                .player-end-insight span {
                    color: rgba(255,255,255,0.66);
                    font-size: 0.74rem;
                    line-height: 1.35;
                }
                .player-end-momentum {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 0.45rem;
                    margin: -0.2rem 0 0.85rem;
                }
                .player-end-momentum-chip {
                    min-width: 0;
                    min-height: 2.55rem;
                    display: grid;
                    align-content: center;
                    gap: 0.08rem;
                    padding: 0.42rem 0.55rem;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 0.5rem;
                    background: rgba(255,255,255,0.06);
                }
                .player-end-momentum-chip[data-tone="success"],
                .player-end-momentum-chip[data-tone="social"] {
                    border-color: rgba(48,209,88,0.28);
                    background: rgba(48,209,88,0.1);
                }
                .player-end-momentum-chip[data-tone="save"] {
                    border-color: rgba(10,132,255,0.28);
                    background: rgba(10,132,255,0.1);
                }
                .player-end-momentum-chip[data-tone="vip"] {
                    border-color: rgba(255,159,10,0.36);
                    background: rgba(255,159,10,0.13);
                }
                .player-end-momentum-chip strong,
                .player-end-momentum-chip small {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    line-height: 1.2;
                }
                .player-end-momentum-chip strong {
                    color: #fff;
                    font-size: 0.8rem;
                    font-weight: 850;
                }
                .player-end-momentum-chip small {
                    color: rgba(255,255,255,0.58);
                    font-size: 0.7rem;
                    font-weight: 700;
                }
                .player-end-recommend {
                    margin-top: 0.95rem;
                    padding-top: 0.85rem;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .player-end-recommend-head {
                    margin-bottom: 0.55rem;
                    color: rgba(255,255,255,0.64);
                    font-size: 0.76rem;
                    font-weight: 800;
                }
                .player-end-recommend-body {
                    display: grid;
                    gap: 0.45rem;
                    min-width: 0;
                }
                .player-end-loading,
                .player-end-empty {
                    min-height: 2.4rem;
                    display: flex;
                    align-items: center;
                    color: rgba(255,255,255,0.66);
                    font-size: 0.82rem;
                    text-decoration: none;
                }
                .player-end-item {
                    min-width: 0;
                    display: grid;
                    grid-template-columns: 2.4rem minmax(0, 1fr);
                    align-items: center;
                    gap: 0.6rem;
                    padding: 0.42rem;
                    border-radius: 0.5rem;
                    color: #fff;
                    text-decoration: none;
                }
                .player-end-item:hover {
                    background: rgba(255,255,255,0.08);
                }
                .player-end-item img,
                .player-end-poster-empty {
                    width: 2.4rem;
                    height: 3.45rem;
                    border-radius: 0.35rem;
                    object-fit: cover;
                    background: rgba(255,255,255,0.12);
                }
                .player-end-item strong,
                .player-end-item small {
                    display: block;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .player-end-item strong {
                    font-size: 0.84rem;
                }
                .player-end-item small {
                    margin-top: 0.15rem;
                    color: rgba(255,255,255,0.58);
                    font-size: 0.72rem;
                }
                @media (max-width: 640px) {
                    .player-next-overlay {
                        left: 1rem;
                        right: 1rem;
                        bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
                        width: auto;
                        max-height: calc(100vh - 6.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 6.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-next-actions,
                    .player-end-actions {
                        display: grid;
                        grid-template-columns: 1fr;
                    }
                    .player-next-actions button,
                    .player-next-actions a,
                    .player-end-actions button,
                    .player-end-actions a {
                        min-height: 2.75rem;
                    }
                    .player-end-insight strong,
                    .player-end-insight span {
                        white-space: normal;
                    }
                    .player-end-momentum {
                        grid-template-columns: 1fr;
                    }
                    .player-end-title,
                    .player-next-title strong,
                    .player-end-momentum-chip strong,
                    .player-end-momentum-chip small,
                    .player-end-item strong,
                    .player-end-item small {
                        white-space: normal;
                    }
                    .player-next-detail {
                        grid-column: 1 / -1;
                    }
                }
                @media (max-height: 420px) and (orientation: landscape) {
                    .player-next-overlay {
                        left: auto;
                        right: calc(0.75rem + env(safe-area-inset-right, 0px));
                        bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
                        width: min(23rem, calc(100vw - 1.5rem));
                        max-height: calc(100vh - 1.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                        max-height: calc(100dvh - 1.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
                    }
                    .player-next-card,
                    .player-end-card {
                        padding: 0.78rem;
                    }
                    .player-next-actions,
                    .player-end-actions {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .player-next-actions button,
                    .player-next-actions a,
                    .player-end-actions button,
                    .player-end-actions a {
                        min-height: 2.35rem;
                        padding: 0 0.62rem;
                    }
                    .player-end-title,
                    .player-next-title strong,
                    .player-end-insight strong,
                    .player-end-insight span,
                    .player-end-momentum-chip strong,
                    .player-end-momentum-chip small,
                    .player-end-item strong,
                    .player-end-item small {
                        white-space: normal;
                    }
                    .player-end-momentum {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }
                    .player-end-recommend {
                        margin-top: 0.7rem;
                        padding-top: 0.65rem;
                    }
                }
                @media (max-width: 560px) and (max-height: 420px) {
                    .player-next-overlay {
                        left: 0.75rem;
                    }
                    .player-next-actions,
                    .player-end-actions,
                    .player-end-momentum {
                        grid-template-columns: 1fr;
                    }
                }
                @media (max-width: 380px) {
                    .player-next-overlay {
                        left: 0.75rem;
                        right: 0.75rem;
                    }
                    .player-end-actions {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        `;
    }

    function clearAutoNextOverlay() {
        if (autoNextTimer) {
            clearInterval(autoNextTimer);
            autoNextTimer = null;
        }
        autoNextRemain = 0;
        autoNextOverlay?.remove();
        autoNextOverlay = null;
    }

    function showResumeOverlay({ resume, stream, vid, streamList }) {
        if (!resume?.progress || previewMode) return;
        clearResumeOverlay();
        resumeOverlay = document.createElement('div');
        resumeOverlay.className = 'player-resume-overlay';
        resumeOverlay.innerHTML = `
            ${playerResumeOverlayStyle()}
            <div class="player-resume-card" role="status" aria-live="polite">
                <div class="player-resume-copy">
                    <div class="player-resume-title">已从 ${escapeHtml(formatClock(resume.progress))} 继续播放</div>
                    <div class="player-resume-subtitle">${escapeHtml(titleFor(vid) || meta?.name || '当前内容')}</div>
                </div>
                <button class="player-resume-restart" type="button">从头播放</button>
                <button class="player-resume-close" type="button" aria-label="关闭断点续播提示">×</button>
            </div>
        `;
        document.body.appendChild(resumeOverlay);

        resumeOverlay.querySelector('.player-resume-restart')?.addEventListener('click', () => {
            clearResumeOverlay();
            host.state.lastProgress = { currentTime: 0, duration: resume.duration || 0, percent: 0 };
            void loadInto(stream, vid, streamList, { startTime: 0, playAfterLoad: true, resetResume: true });
            player.showHint?.('已从头播放');
        });
        resumeOverlay.querySelector('.player-resume-close')?.addEventListener('click', () => {
            clearResumeOverlay();
        });
        resumeOverlayTimer = setTimeout(clearResumeOverlay, 9000);
    }

    function clearResumeOverlay() {
        if (resumeOverlayTimer) {
            clearTimeout(resumeOverlayTimer);
            resumeOverlayTimer = null;
        }
        resumeOverlay?.remove();
        resumeOverlay = null;
    }

    function mountChapterOverlay(chapters = []) {
        const safeChapters = Array.isArray(chapters)
            ? chapters
                .map((chapter) => ({
                    title: String(chapter?.title || '').trim(),
                    startSeconds: Math.max(0, Math.floor(Number(chapter?.startSeconds || 0))),
                }))
                .filter((chapter) => chapter.title)
                .slice(0, 50)
            : [];
        if (!safeChapters.length) return null;
        const wrap = document.createElement('div');
        wrap.className = 'player-chapter-overlay';
        wrap.innerHTML = `
            <button class="player-chapter-toggle" type="button" aria-expanded="false">章节</button>
            <div class="player-chapter-panel hidden" role="menu" aria-label="播放章节">
                ${safeChapters.map((chapter) => `
                    <button class="player-chapter-item" type="button" data-start="${chapter.startSeconds}" role="menuitem">
                        <span>${escapeHtml(formatClock(chapter.startSeconds))}</span>
                        <strong>${escapeHtml(chapter.title)}</strong>
                    </button>
                `).join('')}
            </div>
            <style>
                .player-chapter-overlay {
                    position: fixed;
                    left: max(1rem, env(safe-area-inset-left));
                    bottom: max(5.2rem, calc(env(safe-area-inset-bottom) + 5.2rem));
                    z-index: 340;
                    color: #fff;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                .player-chapter-toggle {
                    border: 1px solid rgba(255,255,255,.18);
                    border-radius: 999px;
                    padding: .55rem .9rem;
                    background: rgba(10,12,18,.66);
                    color: #fff;
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                }
                .player-chapter-panel {
                    display: grid;
                    gap: .45rem;
                    width: min(20rem, calc(100vw - 2rem));
                    max-height: min(18rem, 52vh);
                    overflow: auto;
                    margin-bottom: .6rem;
                    padding: .55rem;
                    border: 1px solid rgba(255,255,255,.14);
                    border-radius: 1rem;
                    background: rgba(9,11,18,.78);
                    box-shadow: 0 18px 40px rgba(0,0,0,.35);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                }
                .player-chapter-panel.hidden { display: none; }
                .player-chapter-item {
                    display: flex;
                    align-items: center;
                    gap: .7rem;
                    width: 100%;
                    border: 0;
                    border-radius: .75rem;
                    padding: .65rem .7rem;
                    background: transparent;
                    color: #fff;
                    text-align: left;
                }
                .player-chapter-item:hover,
                .player-chapter-item:focus-visible { background: rgba(255,255,255,.12); outline: none; }
                .player-chapter-item span { opacity: .66; font-variant-numeric: tabular-nums; }
                .player-chapter-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                @media (max-width: 640px) {
                    .player-chapter-overlay { bottom: max(4.7rem, calc(env(safe-area-inset-bottom) + 4.7rem)); }
                    .player-chapter-panel { max-height: 42vh; }
                }
            </style>
        `;
        const toggle = wrap.querySelector('.player-chapter-toggle');
        const panel = wrap.querySelector('.player-chapter-panel');
        toggle?.addEventListener('click', () => {
            const expanded = panel?.classList.toggle('hidden') === false;
            toggle.setAttribute('aria-expanded', String(expanded));
        });
        wrap.querySelectorAll('.player-chapter-item').forEach((button) => {
            button.addEventListener('click', () => {
                const startSeconds = Number(button.dataset.start) || 0;
                player.seek?.(startSeconds);
                player.showHint?.(`已跳到 ${formatClock(startSeconds)}`);
                panel?.classList.add('hidden');
                toggle?.setAttribute('aria-expanded', 'false');
            });
        });
        document.body.appendChild(wrap);
        return wrap;
    }

    function playerResumeOverlayStyle() {
        return `
            <style>
                .player-resume-overlay {
                    position: fixed;
                    left: 50%;
                    bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
                    z-index: 302;
                    width: min(34rem, calc(100vw - 2rem));
                    max-height: calc(100vh - 6.5rem - env(safe-area-inset-bottom, 0px));
                    max-height: calc(100dvh - 6.5rem - env(safe-area-inset-bottom, 0px));
                    overflow-y: auto;
                    transform: translateX(-50%);
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                    pointer-events: none;
                }
                .player-resume-card {
                    min-height: 3.25rem;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto auto;
                    align-items: center;
                    gap: 0.7rem;
                    padding: 0.68rem 0.72rem 0.68rem 0.95rem;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 0.65rem;
                    background: rgba(18,18,20,0.84);
                    box-shadow: 0 18px 50px rgba(0,0,0,0.42);
                    backdrop-filter: blur(20px) saturate(150%);
                    -webkit-backdrop-filter: blur(20px) saturate(150%);
                    pointer-events: auto;
                }
                .player-resume-copy {
                    min-width: 0;
                }
                .player-resume-title {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 0.88rem;
                    font-weight: 800;
                    line-height: 1.25;
                }
                .player-resume-subtitle {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    margin-top: 0.14rem;
                    color: rgba(255,255,255,0.58);
                    font-size: 0.73rem;
                }
                .player-resume-restart,
                .player-resume-close {
                    border: 0;
                    border-radius: 999px;
                    cursor: pointer;
                    font-weight: 760;
                }
                .player-resume-restart {
                    min-height: 2.1rem;
                    padding: 0 0.82rem;
                    background: #fff;
                    color: #000;
                    font-size: 0.78rem;
                    white-space: nowrap;
                }
                .player-resume-close {
                    width: 2.1rem;
                    height: 2.1rem;
                    background: rgba(255,255,255,0.1);
                    color: rgba(255,255,255,0.78);
                    font-size: 1.2rem;
                    line-height: 1;
                }
                .player-resume-close:hover {
                    background: rgba(255,255,255,0.16);
                    color: #fff;
                }
                @media (max-width: 640px) {
                    .player-resume-overlay {
                        bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
                    }
                    .player-resume-card {
                        grid-template-columns: minmax(0, 1fr) auto;
                    }
                    .player-resume-title,
                    .player-resume-subtitle {
                        white-space: normal;
                    }
                    .player-resume-restart {
                        grid-row: 2;
                        grid-column: 1 / -1;
                        width: 100%;
                    }
                    .player-resume-close {
                        grid-column: 2;
                        grid-row: 1;
                    }
                }
                @media (max-width: 380px) {
                    .player-resume-overlay {
                        width: calc(100vw - 1.5rem);
                    }
                }
            </style>
        `;
    }

    function episodeCode(video) {
        if (!video) return '';
        const parts = [];
        if (video.season != null) parts.push(`S${video.season}`);
        if (video.episode != null) parts.push(`E${video.episode}`);
        return parts.join('');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        })[ch]);
    }

    function parseStartTime(value) {
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    }

    // 离开播放页时清理：销毁引擎 + 移除全屏覆盖层元素
    return () => {
        cleanedUp = true;
        flushPlaybackProgress({ force: true });
        flushHistorySync({ keepalive: true });
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('keydown', onPlayerKeydown);
        video?.removeEventListener('seeking', onVideoSeeking);
        video?.removeEventListener('seeked', onVideoSeeked);
        video?.removeEventListener('waiting', onVideoWaiting);
        video?.removeEventListener('stalled', onVideoStalled);
        video?.removeEventListener('playing', onVideoRecovered);
        video?.removeEventListener('canplay', onVideoRecovered);
        video?.removeEventListener('loadeddata', onVideoRecovered);
        clearBufferingWatch();
        clearAutoNextOverlay();
        clearPreviewEndedOverlay();
        clearResumeOverlay();
        clearPlayerOnboarding();
        clearShortcutHelpOverlay();
        clearShortcutHelpButton();
        clearPlaybackHealthOverlay();
        clearPlaybackHealthButton();
        chapterOverlay?.remove();
        chapterOverlay = null;
        try {
            player.destroy();
        } finally {
            player.remove();
        }
    };
}

function buildVipReturnHref(type, id, videoId = '', title = '', source = 'player') {
    const suffix = videoId ? `/${videoId}` : '';
    const returnTo = `#/play/${type}/${id}${suffix}`;
    const params = new URLSearchParams({ return: returnTo });
    if (title) params.set('title', title);
    if (source) params.set('source', source);
    return `#/vip?${params}`;
}

function renderPlayerLoadError(container, { title, hint, type, id }) {
    renderPlayerGate(container, {
        icon: 'clock-alert',
        title,
        hint,
        primaryId: 'player-retry-source',
        primaryText: '重新获取播放地址',
        secondaryHref: `#/detail/${type}/${id}`,
        secondaryText: '返回详情',
    });
    bindPlayerRetry(container);
}

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

function renderPlayerGate(container, options) {
    const primary = options.primaryHref
        ? `<a href="${escapeHtml(options.primaryHref)}" class="empty-cta">${escapeHtml(options.primaryText)}</a>`
        : `<button class="empty-cta" id="${escapeHtml(options.primaryId)}" type="button">${escapeHtml(options.primaryText)}</button>`;
    const secondary = options.secondaryHref
        ? `<a href="${escapeHtml(options.secondaryHref)}" class="empty-cta" style="background:transparent;border:1px solid var(--border);color:var(--fg);">${escapeHtml(options.secondaryText || '返回')}</a>`
        : '';
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">${playerGateIcon(options.icon)}</div>
            <div class="empty-title">${escapeHtml(options.title)}</div>
            ${options.hint ? `<div class="page-error-hint">${escapeHtml(options.hint)}</div>` : ''}
            <div class="player-gate-actions">
                ${primary}
                ${secondary}
            </div>
        </div>
    `;
}

function playerGateIcon(name) {
    const icons = {
        user: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        alert: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
        'video-off': '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10 8 6 4-6 4V8Z"/><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="3" y1="5" x2="21" y2="19"/></svg>',
        'clock-alert': '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M12 16h.01"/></svg>',
    };
    return icons[name] || icons.alert;
}

async function openPlayerLogin() {
    const { openAuthModal } = await import('../services/auth-modal-loader.js');
    const modal = await openAuthModal('login');
    modal?.addEventListener('authenticated', async () => {
        const { reloadRoute } = await import('../core/router.js');
        reloadRoute();
    }, { once: true });
}

function bindPlayerRetry(container) {
    container.querySelector('#player-retry-source')?.addEventListener('click', async () => {
        const button = container.querySelector('#player-retry-source');
        if (button) {
            button.disabled = true;
            button.textContent = '正在重试...';
        }
        const { reloadRoute } = await import('../core/router.js');
        reloadRoute();
    });
}

function isCreatorVideoId(value) {
    return typeof value === 'string' && (value.startsWith('gy:creator:') || value.startsWith('creator:'));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[ch]);
}

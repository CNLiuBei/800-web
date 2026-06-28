// 详情页 —— Stremio 风格：全屏背景 + 左下信息 + 右侧剧集面板

import { COMPLETION_PERCENT } from '../services/playback-progress.js';
import { getCachedMeta, getMeta, getRankings, peekMeta, prefetchStream, recordMovieView, searchMagnets } from '../services/api.js';
import { navigate, transition } from '../core/router.js';
import { esc, loadCSS } from '../core/html.js';
import { showSiteNotice } from '../services/site-notice.js';
import { setPageMeta } from '../core/head.js';
import { t } from '../services/i18n.js';
import { API_BASE, API_V1_BASE } from '../services/config.js';
import { getPlaybackBadge, getResumePercent, getResumeProgress, history as watchHistory, isFavorite, isWatchLater, resolveResumeDuration, syncMovieHistory, toggleFavorite, toggleWatchLater } from '../services/library.js';
import { user, loading, initAuth, waitForAuthReady, isAuthenticated } from '../services/auth.js';
import { hasVipAccess, requiresVip } from '../services/vip.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';
import { buildCommunityShareUrl, communityShareText, dismissReferralLandingContext, getReferralLandingContext, markReferralLandingAccepted, recordCommunityShare } from '../services/community-growth.js';
import { buildMovieRequestUrl } from '../services/requests.js';
import { dIcons } from './detail-icons.js';
import { createDetailInlinePlayer } from '../services/detail-inline-player.js';
import { prefetchPlayerAssets } from '../services/player-module.js';
import { bindTmdbImageFallback, bindTmdbImagesIn } from '../services/media-images.js';
import '../components/content-rating.js';
import '../components/poster-grid.js';

// 播放前登录守卫：未登录则弹登录框并返回 false，已登录返回 true
async function ensureLogin(hint = '请先登录后再观看') {
    if (user.value) return true;
    if (loading.value) {
        initAuth().catch(() => {});
        await waitForAuthReady();
        if (user.value) return true;
    }
    if (hint) showSiteNotice(hint);
    const { openAuthModal } = await import('../services/auth-modal-loader.js');
    const modal = (await openAuthModal('login')) || document.querySelector('auth-modal');
    return waitForAuthModal(modal);
}

function waitForAuthModal(modal) {
    if (!modal) return Promise.resolve(false);
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            modal.removeEventListener('authenticated', onAuthenticated);
            modal.removeEventListener('closed', onClosed);
            resolve(ok);
        };
        const onAuthenticated = () => finish(true);
        const onClosed = (event) => finish(event.detail?.reason === 'authenticated' || Boolean(user.value));
        modal.addEventListener('authenticated', onAuthenticated, { once: true });
        modal.addEventListener('closed', onClosed, { once: true });
    });
}

const EP_SEG_SIZE = 60; // 剧集分段容量（超过则分段，扛千集）
const NO_SOURCE_POLL_MS = 25_000;
const NO_SOURCE_POLL_FIRST_MS = 5_000;
const NO_SOURCE_POLL_MAX = 48; // 约 20 分钟

function applyMetaSourceUpdate(meta, fresh) {
    if (!meta || !fresh) return false;
    meta.hasPlaySources = fresh.hasPlaySources;
    meta.previewSources = fresh.previewSources;
    if (Array.isArray(fresh.videos) && Array.isArray(meta.videos)) {
        const byId = new Map(fresh.videos.map((video) => [video.id, video]));
        meta.videos.forEach((video) => {
            const next = byId.get(video.id);
            if (next) video.available = next.available;
        });
    }
    return hasPlayableSource(fresh);
}

function bindNoSourcePolling(container, type, id, meta, { startDetailPlayback, getEpisodeController }) {
    if (type === 'creator' || String(id).startsWith('creator:')) return () => {};
    if (hasPlayableSource(meta) || hasPreviewSource(meta, '')) return () => {};

    let timer = 0;
    let polls = 0;
    let inFlight = false;
    let stopped = false;
    let firstPoll = true;

    const stop = () => {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = 0;
        }
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    const onVisibilityChange = () => {
        if (document.hidden) {
            if (timer) {
                clearTimeout(timer);
                timer = 0;
            }
            return;
        }
        if (!stopped && !timer && !inFlight) schedule();
    };

    const schedule = () => {
        if (stopped || document.hidden) return;
        const delay = firstPoll ? NO_SOURCE_POLL_FIRST_MS : NO_SOURCE_POLL_MS;
        firstPoll = false;
        timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
        timer = 0;
        if (stopped || !container.isConnected || !container.querySelector('.detail-page')) {
            stop();
            return;
        }
        if (polls >= NO_SOURCE_POLL_MAX) {
            stop();
            return;
        }
        polls += 1;
        if (inFlight) {
            schedule();
            return;
        }
        inFlight = true;
        let found = false;
        try {
            const fresh = await getMeta(type, id, { force: true }).catch(() => null);
            if (fresh && applyMetaSourceUpdate(meta, fresh)) found = true;
        } finally {
            inFlight = false;
            if (found) {
                refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback);
                getEpisodeController()?.refreshEpisodes?.();
                showSiteNotice('播放源已就绪', { tone: 'success' });
                prefetchPlayerAssets().catch(() => {});
                stop();
                return;
            }
            schedule();
        }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule();
    return stop;
}

export async function render(container, params) {
    const { type, id } = params;
    loadCSS('styles/detail.css');

    // 命中预取/持久缓存则可跳过加载态直接整页渲染。
    const cached = peekMeta(type, id) || await getCachedMeta(type, id);

    // 内容请求与登录态无依赖：未命中缓存时立即发起 getMeta，让它与认证就绪、
    // View Transition 加载态动画并行，避免「先等认证往返、再等内容」的串行瀑布。
    const metaPromise = cached ? Promise.resolve(cached) : getMeta(type, id).catch(() => null);

    // 未命中缓存：先在一次 View Transition 内切到详情页加载态，给出即时反馈，
    // 避免「点击后卡在旧页 / 被滚到顶部、几秒后才进详情」的假死观感。
    if (!cached) {
        await transition(() => {
            container.innerHTML = '<div class="detail-loading"><div class="spinner-small"></div></div>';
        });
    }

    // 等认证就绪（与上面提前发起的内容请求并行），再取内容结果（命中缓存时瞬时返回）
    await waitForAuthReady();
    const meta = await metaPromise;
    if (!meta) {
        await transition(() => { container.innerHTML = '<div class="page-empty">' + t('detail.notfound') + '</div>'; });
        return;
    }

    const hasEpisodes = meta.videos && meta.videos.length > 0;
    const faved = isFavorite(id);
    const later = isWatchLater(id);
    const primaryPlayback = getPrimaryPlaybackAction(meta, id);
    if (!primaryPlayback.disabled) {
        const idle = (task) => {
            if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout: 1800 });
            else setTimeout(task, 0);
        };
        idle(() => {
            prefetchPlayerAssets().catch(() => {});
            if (user.value) {
                prefetchStream(type, primaryPlayback.videoId || id).catch(() => {});
            }
        });
    }
    const pageDescription = detailDescription(meta);
    setPageMeta({
        title: `${meta.name} - 800影视`,
        description: pageDescription,
        url: window.location.href,
        image: shareImageUrl(meta.background || meta.poster || ''),
        type: 'video.movie',
        structuredData: detailStructuredData(meta, type, id, pageDescription),
    });

    // 命中缓存：一次 View Transition 内从旧页直接整体渲染详情，平滑无中间态。
    // 未命中：上面已切到加载态，这里直接替换内容（同一详情页内，不再触发整页过渡，避免二次闪烁）。
    const renderDetail = () => {
        const primaryPlaybackAction = getPrimaryPlaybackAction(meta, id);
        container.innerHTML = `
        <div class="detail-page ${hasEpisodes ? 'has-episodes' : ''}">
            <!-- 全屏背景 -->
            <div class="detail-bg">
                ${meta.background ? `<img src="${esc(meta.background)}" alt="" loading="eager" decoding="async">` : ''}
            </div>

            <!-- 移动端返回按钮（PWA 独立模式无浏览器返回键时可用）-->
            <button class="detail-back" id="detail-back" aria-label="返回">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>

            <!-- 沉浸首屏：左下信息 + 右侧剧集面板 -->
            <div class="detail-stage">
                <section class="detail-hero">
                    <div class="detail-player-mount" id="detail-player-mount" hidden>
                        <div class="detail-player-shell" id="detail-player-shell"></div>
                    </div>
                    <div class="detail-hero-content" id="detail-hero-content">
                    ${meta.logo ? `<img class="detail-logo" src="${esc(meta.logo)}" alt="${esc(meta.name)}">` : `<h1 class="detail-title">${esc(meta.name)}</h1>`}
                    <div class="detail-meta">
                        ${meta.year ? `<span>${esc(String(meta.year))}</span>` : ''}
                        ${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}
                        ${meta.imdbRating ? `<span class="detail-rating">${dIcons.star} ${esc(String(meta.imdbRating))}</span>` : ''}
                        ${ratingTarget(meta, type) ? `<span class="detail-community-rating hidden" id="detail-community-rating" aria-live="polite"></span>` : ''}
                    </div>
                    ${meta.genres ? `<div class="detail-genres">${meta.genres.slice(0, 6).map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>` : ''}
                    ${meta.description ? `<p class="detail-desc">${esc(meta.description)}</p>` : ''}
                    ${renderReferralNudge(meta, { type, id })}
                    <div class="detail-actions">
                        ${primaryPlaybackAction ? renderPrimaryPlaybackButton(primaryPlaybackAction) : ''}
                        ${renderRequestMovieButton(meta, type, primaryPlaybackAction?.disabled && !hasPreviewSource(meta, ''))}
                        <button class="icon-btn fav-btn ${faved ? 'active' : ''}" id="fav-btn" aria-pressed="${faved}">
                            <span class="fav-icon">${faved ? dIcons.heartFilled : dIcons.heart}</span>
                            <span class="fav-label">${faved ? '已收藏' : '收藏'}</span>
                        </button>
                        <button class="icon-btn later-btn ${later ? 'active' : ''}" id="watch-later-btn" aria-pressed="${later}">
                            <span class="later-icon">${dIcons.clock}</span>
                            <span class="later-label">${later ? '已加入' : '稍后看'}</span>
                        </button>
                        <button class="icon-btn discussion-btn" id="discussion-btn" type="button">${dIcons.comment}<span>讨论</span></button>
                        <button class="icon-btn share-btn" id="share-btn">${dIcons.share}<span>分享</span></button>
                    </div>
                    </div>
                </section>

                ${hasEpisodes ? `<aside class="detail-side">${renderEpisodes(meta.videos)}</aside>` : ''}
            </div>

            <!-- 下方滚动区：演员 / 资料 / 评论 -->
            <div class="detail-below">
                ${renderCast(meta.cast)}
                ${renderChapters(meta, type, id)}
                ${renderInfo(meta)}
                ${ratingTarget(meta, type) ? `<content-rating ${ratingAttributes(meta, type)}></content-rating>` : ''}
                ${renderSimilar(meta, type, id)}
                <div class="detail-comments-anchor"></div>
            </div>
        </div>
    `; };

    // 命中缓存：整页 View Transition；未命中：已在加载态详情页内，直接替换内容
    if (cached) await transition(renderDetail);
    else renderDetail();
    reportDetailEngagement('detail_view', meta, type, id, { source: cached ? 'cache' : 'network' });
    reportDecisionImpression(meta, type, id, primaryPlayback);
    if (meta?.slug) recordMovieView(meta.slug);

    // 背景图淡入（CDN 404 回退 Worker；最终失败也标记 loaded，避免卡透明导致背景空白）
    const bgImg = container.querySelector('.detail-bg img');
    if (bgImg) {
        const markBgLoaded = () => bgImg.classList.add('loaded');
        if (bgImg.complete && bgImg.naturalWidth > 0) markBgLoaded();
        else bgImg.addEventListener('load', markBgLoaded, { once: true });
        bindTmdbImageFallback(bgImg, markBgLoaded);
    }
    // 详情 logo：CDN 404 回退 Worker；最终失败则隐藏，避免破图
    const detailLogo = container.querySelector('.detail-logo');
    if (detailLogo) {
        bindTmdbImageFallback(detailLogo, () => { detailLogo.style.display = 'none'; });
    }
    bindTmdbImagesIn(container.querySelector('.cast-grid'), (img) => {
        img.closest('.cast-avatar')?.classList.remove('has-photo');
        img.remove();
    });

    // 返回按钮：有上一页则返回，否则回首页（兜底防止 PWA 独立模式卡死）
    container.querySelector('#detail-back')?.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigate('#/');
    });

    // 收藏
    const favBtn = container.querySelector('#fav-btn');
    favBtn.addEventListener('click', () => {
        const added = toggleFavorite(libraryItemPayload(meta, type, id));
        favBtn.classList.toggle('active', added);
        favBtn.setAttribute('aria-pressed', added);
        favBtn.querySelector('.fav-icon').innerHTML = added ? dIcons.heartFilled : dIcons.heart;
        favBtn.querySelector('.fav-label').textContent = added ? '已收藏' : '收藏';
        showSiteNotice(added ? '已加入收藏' : '已取消收藏', added ? { action: { label: '查看收藏', href: '#/favorites' } } : undefined);
        reportDetailEngagement('favorite', meta, type, id, { actionState: added ? 'on' : 'off' });
        refreshDecisionPanel(container, type, id, meta);
    });

    const laterBtn = container.querySelector('#watch-later-btn');
    laterBtn?.addEventListener('click', () => {
        const added = toggleWatchLater(libraryItemPayload(meta, type, id));
        laterBtn.classList.toggle('active', added);
        laterBtn.setAttribute('aria-pressed', added);
        laterBtn.querySelector('.later-label').textContent = added ? '已加入' : '稍后看';
        showSiteNotice(added ? '已加入稍后看' : '已移出稍后看', added ? { action: { label: '查看片单', href: '#/watch-later' } } : undefined);
        reportDetailEngagement('watch_later', meta, type, id, { actionState: added ? 'on' : 'off' });
        refreshDecisionPanel(container, type, id, meta);
    });

    // 分享
    container.querySelector('#share-btn').addEventListener('click', (event) => {
        reportDetailEngagement('share', meta, type, id, { actionState: 'open' });
        const shareUrl = buildCommunityShareUrl(`#/detail/${type}/${id}`, meta);
        openShareSheet({
            title: meta.name,
            text: pageDescription,
            url: shareUrl,
            image: shareImageUrl(meta.background || meta.poster || ''),
            communityText: communityShareText({ title: meta.name, description: pageDescription }),
            contentId: id,
            ...mediaIdentity(meta, type),
            contentType: type,
        }, { returnFocus: event.currentTarget });
    });

    const inlinePlayer = createDetailInlinePlayer();
    let episodeController = null;

    const startDetailPlayback = async (videoId) => {
        try {
            const ok = await inlinePlayer.play({
                container,
                type,
                id,
                videoId: videoId || undefined,
                meta,
                onEpisodeChange: (vid) => {
                    episodeController?.setActiveVideoId?.(vid);
                    refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback);
                    episodeController?.refreshHistory?.();
                },
                onStop: () => {
                    episodeController?.setActiveVideoId?.(null);
                    refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback);
                    episodeController?.refreshHistory?.();
                },
            });
            if (ok) episodeController?.setActiveVideoId?.(videoId || inlinePlayer.getCurrentVideoId());
            else showSiteNotice('暂无播放源');
            return ok;
        } catch (err) {
            if (err?.forbidden) showSiteNotice(err.message || '暂无观看权限', { tone: 'error' });
            else if (err?.needLogin) {
                showSiteNotice('请先登录后再观看');
                const { openAuthModal } = await import('../services/auth-modal-loader.js');
                openAuthModal('login');
            }
            else showSiteNotice('播放失败，请稍后重试', { tone: 'error' });
            return false;
        }
    };

    bindPrimaryPlayback(container, type, id, meta, startDetailPlayback);
    bindReferralNudge(container, meta, type, id);
    bindDecisionNextStep(container, meta, type, id);
    bindSimilarEngagement(container, meta, type, id);
    bindInfoTabs(container, meta);
    if (ratingTarget(meta, type)) {
        hydrateCommunityRating(container, meta, type);
        container.addEventListener('content-rating-change', (event) => {
            updateCommunityRatingPill(container, event.detail);
        });
    }

    // 剧集：季切换 + 分段 + 搜索 + 点击播放
    if (hasEpisodes) episodeController = bindEpisodes(container, type, id, meta, () => refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback), startDetailPlayback, inlinePlayer);

    const cleanupFns = bindDetailProgressRefresh(container, type, id, meta, episodeController, startDetailPlayback);
    cleanupFns.push(() => episodeController?.cleanup?.());
    cleanupFns.push(() => inlinePlayer.stop());
    cleanupFns.push(bindNoSourcePolling(container, type, id, meta, {
        startDetailPlayback,
        getEpisodeController: () => episodeController,
    }));

    // 评论区：滚动到附近再加载
    const similarGrid = container.querySelector('#detail-similar-grid');
    const fallbackGrid = container.querySelector('#detail-fallback-grid');
    if (similarGrid) {
        similarGrid.render(meta.similar || [], meta.similar?.[0]?.type || type, { layout: 'row' });
    } else if (fallbackGrid) {
        fallbackGrid.showSkeleton(10, { layout: 'row' });
        hydrateFallbackSimilar(container, meta, type, id);
    }
    const loadComments = lazyLoadComments(container, id);
    bindDiscussionJump(container, loadComments, meta, type, id);

    return () => {
        cleanupFns.forEach((cleanup) => cleanup?.());
    };
}

function renderReferralNudge(meta, { type, id } = {}) {
    const context = getReferralLandingContext();
    if (!context || context.dismissedAt) return '';
    const currentHash = `#/detail/${type}/${id}`;
    const isSharedTarget = String(context.hash || '').startsWith(currentHash) || String(context.contentId || '') === String(id || '');
    const accepted = Number(context.acceptedAt || 0) > 0;
    const title = isSharedTarget ? '朋友分享了这部内容' : '来自朋友的观影邀请';
    const hint = accepted
        ? '邀请已记录，继续播放、收藏或评论会让推荐更贴近你的兴趣。'
        : (isSharedTarget ? '先试看或收藏，觉得合适再继续追。' : '你也可以先看当前内容，稍后回到朋友分享的片单。');
    return `
        <div class="detail-referral-nudge" id="detail-referral-nudge">
            <div>
                <span>社区邀请</span>
                <strong>${esc(title)}</strong>
                <small>${esc(hint)}</small>
            </div>
            <div class="detail-referral-actions">
                <button type="button" class="detail-referral-accept" data-referral-accept="detail_referral">${accepted ? '继续行动' : '接受邀请'}</button>
                <button type="button" class="detail-referral-dismiss" aria-label="关闭邀请提示">稍后</button>
            </div>
        </div>
    `;
}

function bindReferralNudge(container, meta, type, id) {
    const nudge = container.querySelector('#detail-referral-nudge');
    if (!nudge) return;
    nudge.querySelector('.detail-referral-accept')?.addEventListener('click', async (event) => {
        markReferralLandingAccepted(event.currentTarget?.dataset?.referralAccept || 'detail_referral');
        const primary = container.querySelector('#primary-play');
        if (primary) {
            primary.focus({ preventScroll: true });
            primary.classList.add('is-pulsing');
            setTimeout(() => primary.classList.remove('is-pulsing'), 900);
            return;
        }
        const added = toggleWatchLater(libraryItemPayload(meta, type, id));
        showSiteNotice(added ? '已加入稍后看' : '邀请已记录', added ? { action: { label: '查看片单', href: '#/watch-later' } } : undefined);
        refreshDecisionPanel(container, type, id, meta);
    });
    nudge.querySelector('.detail-referral-dismiss')?.addEventListener('click', () => {
        dismissReferralLandingContext('detail_referral');
        nudge.remove();
    });
}

function renderPrimaryPlaybackButton(action) {
    if (action.disabled) {
        return `
            <button class="play-btn detail-primary-play is-unavailable" id="primary-play" type="button" disabled aria-disabled="true" data-video-id="">
                <span class="primary-play-copy">
                    <span class="primary-play-label">${esc(action.label)}</span>
                    ${action.hint ? `<span class="primary-play-hint">${esc(action.hint)}</span>` : ''}
                </span>
            </button>
        `;
    }
    return `
        <button class="play-btn detail-primary-play ${action.resume ? 'is-resume' : ''} ${action.preview ? 'is-preview' : ''}" id="primary-play" data-video-id="${esc(action.videoId || '')}">
            ${dIcons.play}
            <span class="primary-play-copy">
                <span class="primary-play-label">${esc(action.label)}</span>
                ${action.hint ? `<span class="primary-play-hint">${esc(action.hint)}</span>` : ''}
            </span>
        </button>
    `;
}

function renderRequestMovieButton(meta, type, show) {
    if (!show || !meta?.name) return '';
    const mediaType = meta.mediaType || (type === 'movie' ? 'movie' : 'tv');
    const href = buildMovieRequestUrl({
        title: meta.name,
        year: meta.year || undefined,
        mediaType: mediaType === 'movie' || mediaType === 'tv' ? mediaType : undefined,
        tmdbId: meta.tmdbId || undefined,
    });
    return `
        <a class="icon-btn request-btn" id="request-movie-btn" href="${esc(href)}">
            ${dIcons.request}
            <span>求片</span>
        </a>
    `;
}

function renderDecisionPanel() {
    return '';
}

function detailDecisionNextStep(meta, { id, type, primaryPlayback, faved, later } = {}) {
    if (hasVipAccess()) return null;
    const resume = bestDetailResume(meta, id);
    const rating = Number(meta?.imdbRating || 0);
    const episodeCount = Array.isArray(meta?.videos) ? meta.videos.length : 0;
    const highIntentScore =
        (requiresVip(meta) ? 48 : 0) +
        (resume ? 30 : 0) +
        (later ? 24 : 0) +
        (faved ? 22 : 0) +
        (rating >= 8 ? 12 : 0) +
        (episodeCount >= 8 ? 10 : 0);
    if (highIntentScore < 34) return null;

    const returnTo = playbackReturnHash(type, id, primaryPlayback);
    const params = new URLSearchParams({
        return: returnTo,
        title: String(meta?.name || '').slice(0, 80),
    });
    const label = requiresVip(meta)
        ? '开通后继续观看'
        : resume
            ? '开通后保留进度'
            : '解锁更完整体验';
    const hint = requiresVip(meta)
        ? '权益确认后自动回到播放'
        : later || faved
            ? '把收藏意愿转成稳定观看'
            : '高清、多端和连续追看';
    return {
        href: `#/vip?${params.toString()}`,
        label,
        hint,
        tone: 'vip',
        source: requiresVip(meta) ? 'vip_required' : resume ? 'resume_intent' : later ? 'watch_later_intent' : faved ? 'favorite_intent' : 'high_score_intent',
    };
}

function playbackReturnHash(type, id, action) {
    const safeType = type === 'movie' || type === 'creator' ? type : 'series';
    const suffix = action?.videoId ? `/${action.videoId}` : '';
    return `#/play/${safeType}/${id || ''}${suffix}`;
}

function detailDecisionSignals(meta, { id, primaryPlayback, faved, later } = {}) {
    const signals = [];
    const resume = bestDetailResume(meta, id);
    if (resume) {
        signals.push({
            value: `${Math.round(resume.percent || 0)}%`,
            label: resume.duration ? `已看 · 剩余约 ${formatDuration(Math.max(0, resume.duration - resume.progress))}` : '已看进度',
            tone: 'resume',
        });
    } else if (primaryPlayback?.preview && !isAuthenticated()) {
        signals.push({ value: '试看', label: '无需登录先判断值不值得看', tone: 'preview' });
    }

    const episodeStats = episodeDecisionStats(meta);
    if (episodeStats) signals.push(episodeStats);

    const rating = Number(meta?.imdbRating || 0);
    if (Number.isFinite(rating) && rating > 0) {
        signals.push({
            value: rating.toFixed(rating >= 10 ? 0 : 1),
            label: rating >= 8 ? '高分内容' : '内容评分',
            tone: rating >= 8 ? 'strong' : '',
        });
    }

    const commitment = commitmentSignal(meta);
    if (commitment) signals.push(commitment);

    if (later) {
        signals.push({ value: '已在片单', label: '可以稍后继续决策', tone: 'saved' });
    } else if (faved) {
        signals.push({ value: '已收藏', label: '后续更容易回到这里', tone: 'saved' });
    } else if (meta?.genres?.length) {
        signals.push({
            value: genreDecisionValue(meta.genres),
            label: '题材标签',
            tone: 'genre',
        });
    }

    return signals.slice(0, 5);
}

function bestDetailResume(meta, id) {
    if (meta?.videos?.length) {
        const episode = bestEpisodeResume(meta, id);
        if (!episode?.resume) return null;
        const fallbackDuration = episode.video?.durationSeconds || 0;
        return {
            progress: Number(episode.resume.progress || 0),
            duration: resolveResumeDuration(episode.resume, fallbackDuration),
            percent: getResumePercent(episode.resume, fallbackDuration),
        };
    }
    const resume = getResumeProgress({ id, ...resumeIdentity(meta, meta?.type || (meta?.videos?.length ? 'series' : 'movie')) });
    if (!resume) return null;
    return {
        progress: Number(resume.progress || 0),
        duration: Number(resume.duration || 0),
        percent: Number(resume.percent || 0),
    };
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.max(1, Math.round((total % 3600) / 60));
    if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`;
    if (hours > 0) return `${hours} 小时`;
    return `${minutes} 分钟`;
}

function episodeDecisionStats(meta) {
    const videos = meta?.videos || [];
    if (!videos.length) return null;
    const seasons = new Set(videos.map((video) => video.season || 1));
    const available = videos.filter((video) => video.available).length;
    const value = seasons.size > 1 ? `${seasons.size} 季` : `${videos.length} 集`;
    const label = available > 0
        ? `${videos.length} 集 · ${available} 集可播`
        : `${videos.length} 集 · 等待片源`;
    return { value, label, tone: available > 0 ? 'strong' : '' };
}

function commitmentSignal(meta) {
    const videos = meta?.videos || [];
    if (videos.length > 0) {
        if (videos.length <= 6) return { value: '短剧集', label: '更容易一口气看完' };
        if (videos.length >= 24) return { value: '长线追看', label: '适合收藏后持续观看' };
        return { value: '中等篇幅', label: '适合分几次看完' };
    }
    const minutes = runtimeMinutes(meta?.runtime);
    if (!minutes) return null;
    if (minutes <= 90) return { value: `${minutes} 分钟`, label: '低时间成本' };
    if (minutes <= 140) return { value: `${minutes} 分钟`, label: '标准电影时长' };
    return { value: `${minutes} 分钟`, label: '长片，适合稍后完整观看' };
}

function runtimeMinutes(runtime) {
    const minutes = Number(String(runtime || '').match(/\d+/)?.[0]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function genreDecisionValue(genres) {
    const list = (genres || []).slice(0, 2).map((genre) => String(genre || '').trim()).filter(Boolean);
    if (!list.length) return '';
    const chinese = list.filter((genre) => /[\u4e00-\u9fff]/.test(genre));
    const picked = chinese.length ? chinese : list;
    const value = picked.slice(0, 2).join(' / ');
    if (value.length <= 18) return value;
    const compact = picked[0] || list[0];
    return compact.length > 16 ? `${compact.slice(0, 15)}…` : compact;
}

function bindPrimaryPlayback(container, type, id, meta, startDetailPlayback) {
    container.querySelector('#primary-play')?.addEventListener('click', async () => {
        const action = getPrimaryPlaybackAction(meta, id);
        if (!action || action.disabled) return;
        if (!action.preview && !await ensureLogin()) return;
        reportDetailEngagement('play_click', meta, type, id, {
            source: action.resume ? 'resume' : action.preview ? 'preview' : 'primary',
            targetId: action.videoId || id,
            value: action.resume ? 1 : 0,
            label: action.label,
        });
        await startDetailPlayback(action.videoId || null);
    });
}

function bindDecisionNextStep(container, meta, type, id) {
    container.querySelector('.detail-decision-next')?.addEventListener('click', (event) => {
        const source = event.currentTarget?.dataset?.decisionSource || 'detail_decision';
        reportDetailEngagement('decision_click', meta, type, id, {
            source,
            targetId: 'gy:vip-offer',
            value: 1,
            label: event.currentTarget?.textContent || 'detail decision',
        });
    });
}

function bindSimilarEngagement(container, meta, type, id) {
    container.querySelector('#detail-similar-section')?.addEventListener('click', (event) => {
        const item = event.target.closest?.('.poster-item');
        if (!item) return;
        reportDetailEngagement('similar_click', meta, type, id, {
            targetId: item.dataset.id || '',
            targetType: item.dataset.type || '',
            source: 'detail_similar',
        });
    });
}

function reportDetailEngagement(eventType, meta, type, id, extra = {}) {
    reportEngagementEvent(eventType, {
        contentId: id || meta?.id,
        ...mediaIdentity(meta, type),
        contentType: type || meta?.type,
        ...extra,
    });
}

function mediaIdentity(meta, type) {
    const mediaType = meta?.mediaType || (type === 'movie' ? 'movie' : 'tv');
    return {
        tmdbId: meta?.tmdbId,
        mediaType,
        movieId: meta?.movieId,
    };
}

function resumeIdentity(meta, type, video = null) {
    return {
        ...mediaIdentity(meta, type),
        ...(video ? {
            seasonNumber: video.season,
            episodeNumber: video.episode,
        } : {}),
    };
}

function libraryItemPayload(meta, type, id) {
    return {
        id,
        type,
        name: meta?.name,
        poster: meta?.poster,
        year: meta?.year,
        ...mediaIdentity(meta, type),
    };
}

function reportDecisionImpression(meta, type, id, primaryPlayback) {
    const context = {
        id,
        type,
        primaryPlayback,
        faved: isFavorite(id),
        later: isWatchLater(id),
    };
    const signals = detailDecisionSignals(meta, context);
    const next = detailDecisionNextStep(meta, context);
    if (!signals.length && !next) return;
    reportDetailEngagement('decision_impression', meta, type, id, {
        value: signals.length + (next ? 1 : 0),
        label: [...signals.map((signal) => signal.value), next?.source].filter(Boolean).join(' | '),
    });
}

function refreshDecisionPanel(container, type, id, meta) {
    const html = renderDecisionPanel(meta, {
        id,
        type,
        primaryPlayback: getPrimaryPlaybackAction(meta, id),
        faved: isFavorite(id),
        later: isWatchLater(id),
    });
    const existing = container.querySelector('.detail-decision-panel');
    if (existing) {
        if (html) existing.outerHTML = html;
        else existing.remove();
    } else if (html) {
        container.querySelector('.detail-actions')?.insertAdjacentHTML('beforebegin', html);
    }
    bindDecisionNextStep(container, meta, type, id);
}

function refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback) {
    if (!container.querySelector('.detail-page')) return;
    const action = getPrimaryPlaybackAction(meta, id);
    const existing = container.querySelector('#primary-play');
    if (!action) {
        existing?.remove();
        refreshDecisionPanel(container, type, id, meta);
        return;
    }
    if (!existing) {
        const actions = container.querySelector('.detail-actions');
        actions?.insertAdjacentHTML('afterbegin', renderPrimaryPlaybackButton(action));
        bindPrimaryPlayback(container, type, id, meta, startDetailPlayback);
        refreshDecisionPanel(container, type, id, meta);
        return;
    }
    if (!!action.disabled !== existing.disabled) {
        existing.outerHTML = renderPrimaryPlaybackButton(action);
        bindPrimaryPlayback(container, type, id, meta, startDetailPlayback);
        refreshRequestMovieButton(container, meta, type, action);
        refreshDecisionPanel(container, type, id, meta);
        return;
    }
    existing.classList.toggle('is-resume', action.resume);
    existing.classList.toggle('is-preview', action.preview);
    existing.classList.toggle('is-unavailable', !!action.disabled);
    existing.disabled = !!action.disabled;
    existing.dataset.videoId = action.videoId || '';
    existing.querySelector('.primary-play-label').textContent = action.label;
    const hint = existing.querySelector('.primary-play-hint');
    if (hint) {
        hint.textContent = action.hint || '';
        hint.classList.toggle('hidden', !action.hint);
    } else if (action.hint) {
        existing.querySelector('.primary-play-copy')?.insertAdjacentHTML('beforeend', `<span class="primary-play-hint">${esc(action.hint)}</span>`);
    }
    refreshRequestMovieButton(container, meta, type, action);
    refreshDecisionPanel(container, type, id, meta);
}

function refreshRequestMovieButton(container, meta, type, action) {
    const show = !!(action?.disabled && !hasPreviewSource(meta, ''));
    const existing = container.querySelector('#request-movie-btn');
    if (!show) {
        existing?.remove();
        return;
    }
    const html = renderRequestMovieButton(meta, type, true);
    if (existing) {
        existing.outerHTML = html;
        return;
    }
    container.querySelector('#primary-play')?.insertAdjacentHTML('afterend', html);
}

function bindDetailProgressRefresh(container, type, id, meta, episodeController, startDetailPlayback) {
    const cleanupFns = [];
    let raf = 0;
    let syncInFlight = false;

    const refresh = () => {
        if (!container.isConnected || !container.querySelector('.detail-page')) return;
        refreshPrimaryPlayback(container, type, id, meta, startDetailPlayback);
        episodeController?.refreshHistory?.();
        episodeController?.refreshEpisodes?.();
    };

    const scheduleRefresh = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refresh);
    };

    const syncAndRefresh = async () => {
        if (!user.value || (!meta?.tmdbId && !meta?.movieId) || syncInFlight) {
            scheduleRefresh();
            return;
        }
        syncInFlight = true;
        try {
            await syncMovieHistory(libraryItemPayload(meta, type, id));
        } finally {
            syncInFlight = false;
            scheduleRefresh();
        }
    };

    cleanupFns.push(watchHistory.subscribe(scheduleRefresh));
    if (user.subscribe) {
        cleanupFns.push(user.subscribe(scheduleRefresh));
    }
    if (loading.subscribe) {
        cleanupFns.push(loading.subscribe(scheduleRefresh));
    }

    scheduleRefresh();

    const onPageShow = () => syncAndRefresh();
    const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') syncAndRefresh();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    cleanupFns.push(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener('pageshow', onPageShow);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    });

    return cleanupFns;
}

function getPrimaryPlaybackAction(meta, id) {
    const unavailable = {
        videoId: '',
        label: '暂无片源',
        hint: '当前暂无可用播放资源',
        resume: false,
        preview: false,
        disabled: true,
    };
    const videos = meta?.videos || [];
    if (videos.length > 0) {
        const resume = bestEpisodeResume(meta, id);
        if (resume) {
            const playable = hasPlayableSource(meta, resume.video);
            const pct = resolveEpisodeResumePercent(resume.resume, resume.video);
            const progressHint = pct > 0
                ? `${pct}%`
                : (Number(resume.resume.progress || 0) > 0 ? formatClock(resume.resume.progress) : '');
            return playable ? {
                videoId: resume.video.id,
                label: `继续 ${episodeCode(resume.video) || '观看'}`,
                hint: `${resume.video.title || `第${resume.video.episode}集`}${progressHint ? ` · ${progressHint}` : ''}`,
                resume: true,
                preview: false,
                disabled: false,
            } : {
                ...unavailable,
                videoId: resume.video.id,
                hint: `${resume.video.title || `第${resume.video.episode}集`} · 暂不可播`,
            };
        }
        const first = videos.find((video) => hasPlayableSource(meta, video));
        if (!first) {
            return {
                ...unavailable,
                videoId: videos[0]?.id || '',
            };
        }
        const preview = shouldShowPreview(meta, first.id);
        return {
            videoId: first.id,
            label: preview ? `试看 ${episodeCode(first) || '第1集'}` : `播放 ${episodeCode(first) || '第1集'}`,
            hint: preview ? `${first.title || ''}${first.title ? ' · ' : ''}无需登录先试看` : (first.title || ''),
            resume: false,
            preview,
            disabled: false,
        };
    }

    if (!hasPlayableSource(meta)) return unavailable;

    const resume = getResumeProgress({ id, ...resumeIdentity(meta, meta?.type || (meta?.videos?.length ? 'series' : 'movie')) });
    if (resume) {
        return {
            videoId: '',
            label: `继续播放 ${formatClock(resume.progress)}`,
            hint: resume.duration ? `续播中 ${Math.round(resume.percent || 0)}%` : '',
            resume: true,
            preview: false,
            disabled: false,
        };
    }
    const preview = shouldShowPreview(meta, '');
    return {
        videoId: '',
        label: preview ? '试看' : t('detail.play'),
        hint: preview ? '无需登录先试看，登录后同步进度' : '',
        resume: false,
        preview,
        disabled: false,
    };
}

function shouldShowPreview(meta, videoId = '') {
    if (loading.value || isAuthenticated()) return false;
    return hasPreviewSource(meta, videoId);
}

function hasPreviewSource(meta, videoId = '') {
    const sources = meta?.previewSources || [];
    if (!sources.length) return false;
    if (videoId) return sources.some((source) => source.videoId === videoId);
    return sources.some((source) => !source.episodeId) || sources.length > 0;
}

function hasPlayableSource(meta, video = null) {
    if (video) return !!video.available || hasPreviewSource(meta, video.id);
    return !!meta?.hasPlaySources || hasPreviewSource(meta, '');
}

function findEpisodeVideo(meta, videoId) {
    return (meta?.videos || []).find((video) => video.id === videoId) || null;
}

function bestEpisodeResume(meta, id) {
    const resumes = (meta?.videos || [])
        .map((video) => ({
            video,
            resume: getResumeProgress({ id, videoId: video.id, ...resumeIdentity(meta, 'series', video), episodeId: video.episodeId }),
        }))
        .filter((item) => item.resume);
    if (!resumes.length) return null;
    return resumes.sort((a, b) => Number(b.resume.entry?.watchedAt || 0) - Number(a.resume.entry?.watchedAt || 0))[0];
}

function episodeCode(video) {
    if (!video) return '';
    const parts = [];
    if (video.season != null) parts.push(`S${video.season}`);
    if (video.episode != null) parts.push(`E${video.episode}`);
    return parts.join('');
}

// 右侧剧集面板骨架（季导航 + 搜索 + 分段容器 + 列表容器）
// 实际集号内容由 bindEpisodes 按「当前季当前段」填充，扛十几季几千集而 DOM 受控
function renderEpisodes(videos) {
    const seasons = {};
    videos.forEach(v => {
        const s = v.season || 1;
        (seasons[s] ||= []).push(v);
    });
    const seasonKeys = Object.keys(seasons).sort((a, b) => a - b);
    const multiSeason = seasonKeys.length > 1;

    return `
        <div class="side-head">
            <div class="season-nav">
                <button class="season-arrow" data-dir="-1" aria-label="上一季" ${multiSeason ? '' : 'disabled'}>${dIcons.chevronLeft || '‹'}</button>
                <button class="season-current" id="season-current" ${multiSeason ? '' : 'disabled'}>
                    <span class="season-label">${t('detail.season', { n: seasonKeys[0] })}</span>
                    ${multiSeason ? `<span class="season-caret">${dIcons.chevronDown || '⌄'}</span>` : ''}
                </button>
                <button class="season-arrow" data-dir="1" aria-label="下一季" ${multiSeason ? '' : 'disabled'}>${dIcons.chevronRight || '›'}</button>
            </div>
            <div class="side-search">
                <input type="search" class="side-search-input" placeholder="搜索剧集" aria-label="搜索剧集">
                <span class="side-search-icon">${dIcons.search || ''}</span>
                <button class="side-search-clear hidden" type="button" aria-label="清除剧集搜索">×</button>
            </div>
            <div class="episode-search-summary" id="episode-search-summary" role="status" aria-live="polite"></div>
            <!-- 季下拉菜单（多季时）-->
            <div class="season-dropdown hidden" id="season-dropdown" role="listbox">
                ${seasonKeys.map(s => `<button class="season-option ${s === seasonKeys[0] ? 'active' : ''}" data-season="${s}" role="option">${t('detail.season', { n: s })}</button>`).join('')}
            </div>
        </div>
        <div class="episode-cue hidden" id="episode-cue"></div>
        <div class="episodes-segments hidden" role="tablist"></div>
        <div class="episodes-list" id="episodes-list"></div>
    `;
}

// 下方：演员
function castDisplayName(entry) {
    if (typeof entry === 'string') return entry;
    return entry?.name || '';
}

function renderCast(cast) {
    if (!cast || cast.length === 0) return '';
    const list = cast.slice(0, 12);
    return `
        <section class="detail-cast-section">
            <h2 class="detail-section-title">演员</h2>
            <div class="cast-grid">
                ${list.map((entry) => {
                    const name = castDisplayName(entry);
                    const n = esc(name);
                    const initial = esc((name || '?').trim().charAt(0).toUpperCase());
                    const profile = typeof entry === 'object' && entry?.profile ? esc(entry.profile) : '';
                    return `
                        <div class="cast-card" title="${n}">
                            <div class="cast-avatar${profile ? ' has-photo' : ''}">
                                <span class="cast-initial" aria-hidden="true">${initial}</span>
                                ${profile ? `<img src="${profile}" alt="${n}" loading="lazy" decoding="async">` : ''}
                            </div>
                            <div class="cast-name">${n}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderChapters(meta, type, id) {
    const chapters = Array.isArray(meta?.chapters) ? meta.chapters : [];
    if (!chapters.length) return '';
    const base = `#/play/${type}/${id}`;
    return `
        <section class="detail-info-section detail-chapters-section">
            <h2 class="detail-section-title">章节</h2>
            <div class="detail-chapters-list">
                ${chapters.slice(0, 50).map((chapter) => {
                    const startSeconds = Math.max(0, Math.floor(Number(chapter.startSeconds || 0)));
                    return `
                        <a class="detail-chapter-link" href="${esc(`${base}?t=${startSeconds}`)}">
                            <span>${esc(formatClock(startSeconds))}</span>
                            <strong>${esc(chapter.title || '未命名章节')}</strong>
                        </a>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function buildInfoRows(meta) {
    const rows = [];
    if (meta.type === 'creator' && meta.channel?.handle) {
        rows.push(['频道', `<a href="#/creator/${esc(meta.channel.handle)}">@${esc(meta.channel.handle)}</a>`]);
    }
    if (meta.director?.length) rows.push(['导演', meta.director.map(esc).join('、')]);
    if (meta.cast?.length) rows.push(['主演', meta.cast.slice(0, 8).map((entry) => esc(castDisplayName(entry))).join('、')]);
    if (meta.genres?.length) rows.push(['类型', meta.genres.map(esc).join('、')]);
    if (meta.year) rows.push(['年份', esc(String(meta.year))]);
    if (meta.runtime) rows.push(['时长', esc(meta.runtime)]);
    if (meta.imdbRating) rows.push(['评分', esc(String(meta.imdbRating))]);
    return rows;
}

function renderResourceMeta(resource, { showSource = true } = {}) {
    const parts = [];
    if (showSource && resource.sourceName) parts.push(resource.sourceName);
    if (resource.quality) parts.push(resource.quality);
    if (resource.size) parts.push(resource.size);
    if (resource.fileCount != null) parts.push(`${resource.fileCount} 个文件`);
    return parts.map(esc).join(' · ');
}

function magnetCacheStorageKey(meta) {
    const type = meta?.type || meta?.mediaType || 'media';
    const id = meta?.movieId || meta?.id || meta?.imdbId || meta?.name || '';
    return `gy:magnet:${type}:${id}`;
}

function readMagnetSessionCache(meta) {
    try {
        const raw = sessionStorage.getItem(magnetCacheStorageKey(meta));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.items)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeMagnetSessionCache(meta, payload) {
    try {
        if (!payload?.items?.length) return;
        sessionStorage.setItem(magnetCacheStorageKey(meta), JSON.stringify({
            items: payload.items,
            cachedAt: Date.now(),
        }));
    } catch {}
}

function magnetSearchOptions(meta) {
    const alt = new Set();
    const primary = String(meta?.name || '').trim();
    const original = String(meta?.originalName || '').trim();
    if (original && original !== primary) alt.add(original);
    return {
        year: meta?.year || '',
        type: meta?.type || meta?.mediaType || '',
        alt: [...alt].join(','),
        imdb: meta?.imdbId || '',
        limit: meta?.type === 'series' ? 60 : 30,
    };
}

const CHINESE_DIGIT_MAP = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseNumeral(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text);
    if (text === '十') return 10;
    if (text.startsWith('十')) return 10 + (CHINESE_DIGIT_MAP[text.slice(1)] ?? 0);
    if (text.endsWith('十')) return (CHINESE_DIGIT_MAP[text.slice(0, -1)] ?? 0) * 10;
    if (text.includes('十')) {
        const [left, right] = text.split('十');
        const tens = left ? (CHINESE_DIGIT_MAP[left] ?? 0) : 1;
        const ones = right ? (CHINESE_DIGIT_MAP[right] ?? 0) : 0;
        return tens * 10 + ones;
    }
    return CHINESE_DIGIT_MAP[text] ?? null;
}

function magnetDisplayTitle(resource) {
    if (resource?.displayTitle) return String(resource.displayTitle);
    let value = String(resource?.title || '').trim();
    for (let pass = 0; pass < 4; pass += 1) {
        const next = value
            .replace(/^【[^】]*(?:发布|首发|收录|分享|整理|提供|高清)[^】]*】\s*/u, '')
            .replace(/^【[^】]*www\.[^】]*】\s*/iu, '')
            .replace(/^\[[^\]]*(?:发布|publish|www\.)[^\]]*\]\s*/iu, '')
            .replace(/^(?:www\.)?[A-Za-z0-9.-]+\.(?:com|net|org|tv|cc|me)\s*[-·|｜]\s*/iu, '');
        if (next === value) break;
        value = next;
    }
    return value.trim() || String(resource?.title || '').trim();
}

function magnetInfohash(url) {
    const match = String(url || '').match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : '';
}

function mergeMagnetResources(staticMagnets, fetchedMagnets) {
    const merged = [];
    const seen = new Set();
    [...staticMagnets, ...fetchedMagnets].forEach((item) => {
        if (!item?.url) return;
        const key = magnetInfohash(item.url) || item.url;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
    });
    return merged;
}

function magnetEpisodeRangeKey(item) {
    if (item?.episodeRange) {
        const [startRaw, endRaw] = String(item.episodeRange).split('-');
        const start = Number(startRaw) || 0;
        const end = Number(endRaw ?? startRaw) || start;
        if (start > 0) return { start, end };
    }
    const title = String(item?.title || '');
    const bracketRange = title.match(/[\[【]\s*第(\d{1,2})\s*-\s*(\d{1,2})\s*集\s*[\]】]/);
    if (bracketRange) {
        return { start: Number(bracketRange[1]), end: Number(bracketRange[2]) };
    }
    const rangeEpisode = title.match(/第(\d{1,2})\s*-\s*(\d{1,2})集/);
    if (rangeEpisode) {
        return { start: Number(rangeEpisode[1]), end: Number(rangeEpisode[2]) };
    }
    return null;
}

function magnetEpisodeNumber(item) {
    const title = String(item?.title || '');
    const seasonEpisode = title.match(/\bS(\d{1,2})\s*[eE](\d{1,3})\b/);
    if (seasonEpisode) return Number(seasonEpisode[2]);

    const bracketSingle = title.match(/[\[【]\s*第(\d{1,2})集\s*[\]】]/);
    if (bracketSingle) return Number(bracketSingle[1]);

    const range = magnetEpisodeRangeKey(item);
    if (range && (item?.tier === 'batch' || item?.tier === 'complete')) {
        return range.start;
    }

    const dotEpisode = title.match(/\.第(\d{1,2})集/);
    if (dotEpisode) return Number(dotEpisode[1]);

    const chineseEpisode = title.match(/第(\d{1,2})集/);
    if (chineseEpisode) return Number(chineseEpisode[1]);

    const looseEpisode = title.match(/(?:^|[\s._\[\]-])E(?:p)?\.?\s*(\d{1,3})\b/i);
    if (looseEpisode) return Number(looseEpisode[1]);
    return 9999;
}

function compareMagnetEpisodeOrder(left, right) {
    const leftPack = left?.tier === 'batch' || left?.tier === 'complete';
    const rightPack = right?.tier === 'batch' || right?.tier === 'complete';
    if (leftPack && rightPack) {
        const leftRange = magnetEpisodeRangeKey(left) || { start: 9999, end: 9999 };
        const rightRange = magnetEpisodeRangeKey(right) || { start: 9999, end: 9999 };
        const startDelta = leftRange.start - rightRange.start;
        if (startDelta !== 0) return startDelta;
        return leftRange.end - rightRange.end;
    }
    return magnetEpisodeNumber(left) - magnetEpisodeNumber(right);
}

function magnetEpisodeLabel(item) {
    const title = String(item?.title || '');
    const seasonEpisode = title.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
    if (seasonEpisode) return `S${seasonEpisode[1]}E${seasonEpisode[2]}`;
    const bracketSingle = title.match(/[\[【]\s*第(\d{1,2})集\s*[\]】]/);
    if (bracketSingle) return `第${bracketSingle[1]}集`;
    const chineseEpisode = title.match(/第(\d{1,3})集/);
    if (chineseEpisode) return `第${chineseEpisode[1]}集`;
    return '';
}

function magnetResolutionRank(item) {
    const order = { '4K': 5, '2K': 4, '1080p': 3, '720p': 2, '480p': 1 };
    return order[magnetResolution(item)] || 0;
}

const MAGNET_QUALITY_ORDER = ['4K', '2K', '1080p', '720p', '480p', '其他'];
const MAGNET_TIER_ORDER = ['complete', 'batch', 'single', 'movie'];

function magnetResolutionDisplayLabel(resolution) {
    if (resolution === '1080p') return '1K';
    if (resolution === '4K') return '4K';
    if (resolution === '2K') return '2K';
    if (resolution === '720p') return '720p';
    if (resolution === '480p') return '480p';
    return '其他';
}

function magnetTierSectionLabel(tier) {
    if (tier === 'complete') return '全集';
    if (tier === 'batch') return '多集';
    if (tier === 'single') return '单集';
    if (tier === 'movie') return '整部';
    return '其他';
}

function sortMagnetItemsWithinTier(items) {
    return [...items].sort((left, right) => {
        const episodeDelta = compareMagnetEpisodeOrder(left, right);
        if (episodeDelta !== 0) return episodeDelta;
        const seederDelta = (Number(right.seeders) || 0) - (Number(left.seeders) || 0);
        if (seederDelta !== 0) return seederDelta;
        return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
    });
}

function groupMagnetResourcesByQualityAndTier(items) {
    const qualityMap = new Map();
    items.forEach((item) => {
        const resolution = magnetResolution(item) || '其他';
        const qualityKey = MAGNET_QUALITY_ORDER.includes(resolution) ? resolution : '其他';
        if (!qualityMap.has(qualityKey)) qualityMap.set(qualityKey, new Map());
        const tierMap = qualityMap.get(qualityKey);
        const tier = MAGNET_TIER_ORDER.includes(item?.tier) ? item.tier : 'movie';
        if (!tierMap.has(tier)) tierMap.set(tier, []);
        tierMap.get(tier).push(item);
    });

    return MAGNET_QUALITY_ORDER
        .filter((quality) => qualityMap.has(quality))
        .map((quality) => ({
            kind: 'quality',
            title: magnetResolutionDisplayLabel(quality),
            quality,
            sections: MAGNET_TIER_ORDER
                .filter((tier) => qualityMap.get(quality)?.has(tier))
                .map((tier) => ({
                    kind: 'tier',
                    title: magnetTierSectionLabel(tier),
                    tier,
                    items: sortMagnetItemsWithinTier(qualityMap.get(quality).get(tier)),
                })),
        }));
}

function magnetTierRank(item) {
    const order = { complete: 3, batch: 2, single: 1, movie: 0 };
    return order[item?.tier] ?? 0;
}

function sortResourceItems(items) {
    return [...items].sort((left, right) => {
        const tierDelta = magnetTierRank(right) - magnetTierRank(left);
        if (tierDelta !== 0) return tierDelta;
        const resolutionDelta = magnetResolutionRank(right) - magnetResolutionRank(left);
        if (resolutionDelta !== 0) return resolutionDelta;
        const episodeDelta = compareMagnetEpisodeOrder(left, right);
        if (episodeDelta !== 0) return episodeDelta;
        const seederDelta = (Number(right.seeders) || 0) - (Number(left.seeders) || 0);
        if (seederDelta !== 0) return seederDelta;
        return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
    });
}

function magnetSeasonNumber(item) {
    if (item?.season) return Number(item.season);
    const label = magnetSeasonLabel(item);
    if (!label) return 0;
    const match = label.match(/第(\d+)季/);
    return match ? Number(match[1]) : 0;
}

function formatSeasonTabLabel(seasonNumber) {
    return `S${String(seasonNumber).padStart(2, '0')}`;
}

function magnetTierLabel(item, { grouped = false } = {}) {
    if (item?.tier === 'complete') return grouped ? '' : '全集';
    if (item?.tier === 'batch') return grouped ? (item.episodeRange || '') : (item.episodeRange ? `多集 ${item.episodeRange}` : '多集');
    if (item?.tier === 'single') return magnetEpisodeLabel(item) || '';
    if (item?.tier === 'movie') return magnetResolution(item) || '整部';
    return '';
}

function magnetTierTagClass(item) {
    if (item?.tier === 'complete') return 'is-complete';
    if (item?.tier === 'batch') return 'is-batch';
    if (item?.tier === 'single') return 'is-episode';
    return 'is-quality';
}

function magnetLinkClass(item) {
    if (item?.tier === 'complete' || item?.tier === 'batch') return 'is-pack';
    return '';
}

function parseResourceSizeBytes(sizeLabel) {
    const match = String(sizeLabel || '').trim().match(/^([\d.]+)\s*(KB|MB|GB|TB)$/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return 0;
    const unit = match[2].toUpperCase();
    const multipliers = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return amount * (multipliers[unit] || 1);
}

function countResourceEpisodes(item) {
    if (item?.episodeRange) {
        const [startRaw, endRaw] = String(item.episodeRange).split('-');
        const start = Number(startRaw) || 0;
        const end = Number(endRaw ?? startRaw) || start;
        if (start > 0 && end >= start) return end - start + 1;
    }
    if (item?.tier === 'single') return 1;
    const fileCount = Number(item?.fileCount) || 0;
    if (fileCount >= 2) return Math.max(fileCount - 1, 1);
    return 1;
}

function inferMagnetResolutionFromSize(sizeBytes, item = {}) {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
    const episodes = countResourceEpisodes(item);
    const perEpisodeGb = sizeBytes / episodes / (1024 ** 3);
    if (item?.tier === 'movie') {
        if (perEpisodeGb >= 10) return '4K';
        if (perEpisodeGb >= 4) return '1080p';
        if (perEpisodeGb >= 1.5) return '720p';
        if (perEpisodeGb >= 0.5) return '480p';
        return '';
    }
    if (perEpisodeGb >= 8) return '4K';
    if (perEpisodeGb >= 2.5) return '1080p';
    if (perEpisodeGb >= 0.9) return '720p';
    if (perEpisodeGb >= 0.3) return '480p';
    return '';
}

function matchMagnetResolutionFromTitle(title) {
    const value = String(title || '');
    if (!value.trim()) return '';

    if (/\b2160p\b|\b4k\b|\buhd\b|杜比视界|dolby.?vision/i.test(value)) return '4K';
    if (/蓝光4k|蓝光\s*4k|超高清/i.test(value)) return '4K';

    if (/\b1080p\b|\b1080i\b|\bfhd\b|\b1k\b|全高清|2k版|2k画质|2k资源/i.test(value)) return '1080p';
    if (/\bbluray\b|\bblu-ray\b|\bbd\b(?![\w-])|\bbdip\b/i.test(value) && !/\b4k\b/i.test(value)) return '1080p';
    if (/\bweb-?dl\b|\bwebrip\b|\bhdtv\b/i.test(value) && !/\b720p\b|\b480p\b/i.test(value)) return '1080p';
    if (/高清版|高码版|[\[【]高清[\]】]|\.高清\.|高码(?!率)/i.test(value)) return '1080p';

    if (/\b1440p\b/i.test(value)) return '2K';
    if (/\b2k\b/i.test(value)) return '2K';

    if (/\b720p\b|\bsd\b|标清/i.test(value)) return '720p';
    if (/\bhd\b/i.test(value) && !/\bfhd\b|\buhd\b/i.test(value)) return '720p';

    if (/\b480p\b|\b576p\b/i.test(value)) return '480p';
    if (/\bhevc\b|\bx265\b|\bh265\b/i.test(value) && /\.(mkv|mp4|avi|ts|m2ts|wmv|mov|flv|mpg|mpeg|rmvb|webm)\b/i.test(value)) {
        return '1080p';
    }
    return '';
}

function magnetResolution(item) {
    if (item?.resolution) return item.resolution;
    const title = String(item?.title || '');
    const fromTitle = matchMagnetResolutionFromTitle(title);
    if (fromTitle) return fromTitle;
    return inferMagnetResolutionFromSize(parseResourceSizeBytes(item?.size), item) || '';
}

function magnetSeasonLabel(item) {
    if (item?.season) return `第${Number(item.season)}季`;
    const title = String(item?.title || '');
    const chineseNumeral = title.match(/第([一二三四五六七八九十零两]+)季/);
    if (chineseNumeral) {
        const season = parseChineseNumeral(chineseNumeral[1]);
        if (season) return `第${season}季`;
    }
    const seasonEpisode = title.match(/\bS(\d{1,2})\s*E\d+/i);
    if (seasonEpisode) return `第${Number(seasonEpisode[1])}季`;
    const chineseSeason = title.match(/第(\d{1,2})季/);
    if (chineseSeason) return `第${Number(chineseSeason[1])}季`;
    const seasonOnly = title.match(/\bS(\d{1,2})\b(?!E)/i);
    if (seasonOnly) return `第${Number(seasonOnly[1])}季`;
    const seasonWord = title.match(/\bSeason\s*(\d{1,2})\b/i);
    if (seasonWord) return `第${Number(seasonWord[1])}季`;
    const romanMap = [['Ⅹ', 10], ['Ⅸ', 9], ['Ⅷ', 8], ['Ⅶ', 7], ['Ⅵ', 6], ['Ⅴ', 5], ['Ⅳ', 4], ['Ⅲ', 3], ['Ⅱ', 2], ['Ⅰ', 1]];
    for (const [symbol, season] of romanMap) {
        if (title.includes(symbol)) return `第${season}季`;
    }
    const nameSeason = title.match(/(?:Coming|Lai)\s*[(\[]?\s*(\d{1,2})(?:[\s\]\)]|$)/i);
    if (nameSeason && Number(nameSeason[1]) <= 20) return `第${Number(nameSeason[1])}季`;
    return '';
}

function groupMagnetResourcesBySeason(items) {
    const seasonMap = new Map();
    items.forEach((item) => {
        const seasonNumber = magnetSeasonNumber(item);
        if (!seasonMap.has(seasonNumber)) seasonMap.set(seasonNumber, []);
        seasonMap.get(seasonNumber).push(item);
    });

    return [...seasonMap.entries()]
        .sort(([left], [right]) => {
            if (left === 0) return 1;
            if (right === 0) return -1;
            return left - right;
        })
        .map(([seasonNumber, list]) => ({
            kind: 'season',
            season: seasonNumber,
            title: seasonNumber > 0 ? formatSeasonTabLabel(seasonNumber) : '其他',
            items: list,
            qualityGroups: groupMagnetResourcesByQualityAndTier(list),
        }));
}

function groupMagnetResources(items, { series = false } = {}) {
    if (series) {
        return groupMagnetResourcesBySeason(items);
    }
    return groupMagnetResourcesByQualityAndTier(items);
}

function groupCloudResources(items) {
    const buckets = new Map();
    items.forEach((item) => {
        const source = String(item.sourceName || '其他来源').trim() || '其他来源';
        if (!buckets.has(source)) buckets.set(source, []);
        buckets.get(source).push(item);
    });
    return [...buckets.entries()].map(([title, list]) => ({
        title,
        items: sortResourceItems(list),
    }));
}

function renderMagnetQualityGroups(qualityGroups, renderItem) {
    if (!qualityGroups?.length) {
        return '<p class="detail-info-empty">暂无资源</p>';
    }
    return `
        <div class="detail-magnet-quality-groups">
            ${qualityGroups.map((qualityGroup) => {
                const itemCount = qualityGroup.sections.reduce(
                    (sum, section) => sum + section.items.length,
                    0,
                );
                return `
                <section class="detail-magnet-quality-group is-collapsed">
                    <div class="detail-magnet-quality-head">
                        <h4 class="detail-magnet-quality-title">${esc(qualityGroup.title)}</h4>
                        <button
                            type="button"
                            class="detail-magnet-quality-toggle"
                            aria-expanded="false"
                            aria-label="展开 ${esc(qualityGroup.title)} 资源"
                        >
                            <span class="detail-magnet-quality-count">${itemCount}</span>
                            <span class="detail-magnet-quality-chevron" aria-hidden="true"></span>
                        </button>
                    </div>
                    <div class="detail-magnet-quality-body" hidden>
                        ${qualityGroup.sections.map((section) => `
                            <div class="detail-magnet-tier-section">
                                <div class="detail-magnet-tier-head">
                                    <span class="detail-magnet-tier-title">${esc(section.title)}</span>
                                    <span class="detail-magnet-tier-count">${section.items.length}</span>
                                </div>
                                <div class="detail-resource-list">${section.items.map(renderItem).join('')}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            `;
            }).join('')}
        </div>
    `;
}

function renderMagnetQualityLayout(groups, renderItem, { summary = '' } = {}) {
    if (!groups.length) return '';
    return `
        ${summary ? `<p class="detail-resource-summary">${esc(summary)}</p>` : ''}
        ${renderMagnetQualityGroups(groups, renderItem)}
    `;
}

function renderMagnetSeasonGroups(groups, renderItem, { summary = '' } = {}) {
    if (!groups.length) return '';
    const rootId = `magnet-season-${Math.random().toString(36).slice(2, 9)}`;
    return `
        ${summary ? `<p class="detail-resource-summary">${esc(summary)}</p>` : ''}
        <div class="detail-magnet-seasons" data-magnet-seasons="${rootId}">
            <div class="detail-magnet-season-tabs" role="tablist" aria-label="按季筛选磁力资源">
                ${groups.map((group, index) => `
                    <button
                        type="button"
                        class="detail-magnet-season-tab${index === 0 ? ' is-active' : ''}"
                        role="tab"
                        aria-selected="${index === 0 ? 'true' : 'false'}"
                        data-season-tab="${esc(group.title)}"
                    >
                        ${esc(group.title)}
                        <span class="detail-magnet-season-count">${group.items.length}</span>
                    </button>
                `).join('')}
            </div>
            ${groups.map((group, index) => `
                <section
                    class="detail-magnet-season-panel${index === 0 ? ' is-active' : ''}"
                    role="tabpanel"
                    data-season-panel="${esc(group.title)}"
                    ${index === 0 ? '' : 'hidden'}
                >
                    ${renderMagnetQualityGroups(group.qualityGroups, renderItem)}
                </section>
            `).join('')}
        </div>
    `;
}

function renderResourceGroups(groups, renderItem, { summary = '' } = {}) {
    if (!groups.length) return '';
    return `
        ${summary ? `<p class="detail-resource-summary">${esc(summary)}</p>` : ''}
        <div class="detail-resource-groups">
            ${groups.map((group, index) => {
                const collapsible = group.items.length > 4;
                const expanded = group.title.includes('完整全集') || group.title.includes('完整合集') || !collapsible || index === 0;
                return `
                    <section class="detail-resource-group${collapsible ? ' is-collapsible' : ''}${expanded ? ' is-expanded' : ''}">
                        <button type="button" class="detail-resource-group-head detail-resource-group-toggle" aria-expanded="${expanded ? 'true' : 'false'}">
                            <span class="detail-resource-group-title">${esc(group.title)}</span>
                            <span class="detail-resource-group-meta">
                                <span class="detail-resource-group-count">${group.items.length}</span>
                                ${collapsible ? '<span class="detail-resource-group-chevron" aria-hidden="true"></span>' : ''}
                            </span>
                        </button>
                        <div class="detail-resource-list">${group.items.map(renderItem).join('')}</div>
                    </section>
                `;
            }).join('')}
        </div>
    `;
}

function bindResourceGroups(root) {
    root?.querySelectorAll('.detail-resource-group.is-collapsible').forEach((group) => {
        const toggle = group.querySelector('.detail-resource-group-toggle');
        if (!toggle || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', () => {
            const expanded = group.classList.toggle('is-expanded');
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
    });
}

function bindMagnetSeasonTabs(root) {
    root?.querySelectorAll('[data-magnet-seasons]').forEach((wrap) => {
        const tabs = [...wrap.querySelectorAll('[data-season-tab]')];
        const panels = [...wrap.querySelectorAll('[data-season-panel]')];
        tabs.forEach((tab) => {
            if (tab.dataset.bound === '1') return;
            tab.dataset.bound = '1';
            tab.addEventListener('click', () => {
                const target = tab.dataset.seasonTab || '';
                tabs.forEach((node) => {
                    const active = node.dataset.seasonTab === target;
                    node.classList.toggle('is-active', active);
                    node.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                panels.forEach((panel) => {
                    const active = panel.dataset.seasonPanel === target;
                    panel.classList.toggle('is-active', active);
                    panel.hidden = !active;
                });
            });
        });
    });
}

function bindMagnetQualityGroups(root) {
    root?.querySelectorAll('.detail-magnet-quality-group').forEach((group) => {
        const toggle = group.querySelector('.detail-magnet-quality-toggle');
        if (!toggle || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';
        const title = group.querySelector('.detail-magnet-quality-title')?.textContent?.trim() || '资源';
        toggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const expanded = group.classList.toggle('is-expanded');
            group.classList.toggle('is-collapsed', !expanded);
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            toggle.setAttribute('aria-label', expanded ? `收起 ${title} 资源` : `展开 ${title} 资源`);
            const body = group.querySelector('.detail-magnet-quality-body');
            if (body) body.hidden = !expanded;
        });
    });
}

function bindResourceListInteractions(root) {
    bindResourceGroups(root);
    bindMagnetSeasonTabs(root);
    bindMagnetQualityGroups(root);
    bindResourceCopyButtons(root);
}

function renderResourceSummary(items, groups) {
    if (!items.length) return '';
    const seasonTitles = groups.filter((group) => group.kind === 'season').map((group) => group.title);
    if (seasonTitles.length) {
        return `共 ${items.length} 个资源 · ${seasonTitles.join('｜')}`;
    }
    return `共 ${items.length} 个资源，分为 ${groups.length} 类`;
}

function renderResourceItem(resource, { kind, grouped = false } = {}) {
    const metaLine = renderResourceMeta(resource, { showSource: kind !== 'magnet' });
    const tierLabel = kind === 'magnet' ? magnetTierLabel(resource, { grouped }) : '';
    const url = String(resource?.url || '').trim();
    const openAttrs = kind === 'magnet'
        ? 'rel="noopener noreferrer nofollow"'
        : 'target="_blank" rel="noopener noreferrer nofollow"';
    const downloadAttrs = kind === 'magnet'
        ? 'rel="noopener noreferrer nofollow"'
        : 'target="_blank" rel="noopener noreferrer nofollow"';
    return `
        <article class="detail-resource-item ${kind === 'magnet' ? magnetLinkClass(resource) : ''}">
            <a class="detail-resource-link" href="${esc(url)}" ${openAttrs}>
                <div class="detail-resource-main">
                    <div class="detail-resource-title-row">
                        ${tierLabel ? `<span class="detail-resource-tag ${magnetTierTagClass(resource)}">${esc(tierLabel)}</span>` : ''}
                        <strong>${esc(magnetDisplayTitle(resource))}</strong>
                    </div>
                    ${metaLine ? `<span class="detail-resource-meta">${metaLine}</span>` : ''}
                </div>
            </a>
            ${url ? `
                <div class="detail-resource-actions">
                    <button type="button" class="detail-resource-action" data-resource-copy="${esc(url)}" aria-label="复制链接">复制</button>
                    <a class="detail-resource-action is-download" href="${esc(url)}" ${downloadAttrs} aria-label="下载资源">下载</a>
                </div>
            ` : ''}
        </article>
    `;
}

function bindResourceCopyButtons(root) {
    root?.querySelectorAll('[data-resource-copy]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const url = button.dataset.resourceCopy || '';
            if (!url) return;
            const ok = await copyText(url);
            showSiteNotice(ok ? '链接已复制' : '复制失败', { tone: ok ? 'success' : 'error' });
            const original = button.textContent;
            button.textContent = ok ? '已复制' : '失败';
            button.classList.toggle('is-success', ok);
            button.classList.toggle('is-error', !ok);
            window.setTimeout(() => {
                button.textContent = original;
                button.classList.remove('is-success', 'is-error');
            }, 1600);
        });
    });
}

function renderResourceList(items, emptyLabel, { kind, series } = {}) {
    if (!items.length) {
        return `<p class="detail-info-empty">${esc(emptyLabel)}</p>`;
    }
    const renderItem = (resource) => renderResourceItem(resource, { kind, grouped: kind === 'magnet' });
    if (kind === 'magnet') {
        const groups = groupMagnetResources(items, { series });
        const summary = renderResourceSummary(items, groups);
        if (series && groups.length && groups[0].kind === 'season') {
            return renderMagnetSeasonGroups(groups, renderItem, { summary });
        }
        if (groups.length && groups[0].kind === 'quality') {
            return renderMagnetQualityLayout(groups, renderItem, { summary });
        }
        return renderResourceGroups(groups, renderItem, { summary });
    }
    if (kind === 'cloud_drive') {
        const groups = groupCloudResources(items);
        return renderResourceGroups(groups, renderItem, {
            summary: renderResourceSummary(items, groups),
        });
    }
    return `<div class="detail-resource-list">${items.map(renderItem).join('')}</div>`;
}

// 再下方：影视资料 / 网盘资源 / 磁力链接
function renderInfo(meta) {
    const rows = buildInfoRows(meta);
    const resources = Array.isArray(meta.resources) ? meta.resources : [];
    const cloudDrives = resources.filter((item) => item.kind === 'cloud_drive');
    const staticMagnets = resources.filter((item) => item.kind === 'magnet');
    const canSearchMagnets = meta.type !== 'creator' && Boolean(meta.name?.trim());
    if (!rows.length && !cloudDrives.length && !staticMagnets.length && !canSearchMagnets) return '';
    const magnetCount = staticMagnets.length || (canSearchMagnets ? null : 0);
    return `
        <section class="detail-info-section" id="detail-info-panel">
            <div class="detail-info-tabs" role="tablist" aria-label="影视资料与资源">
                <button type="button" class="detail-info-tab is-active" role="tab" id="detail-info-tab-info" aria-selected="true" aria-controls="detail-info-pane-info" data-tab="info">影视资料</button>
                <button type="button" class="detail-info-tab" role="tab" id="detail-info-tab-cloud" aria-selected="false" aria-controls="detail-info-pane-cloud" data-tab="cloud">
                    网盘资源${cloudDrives.length ? `<span class="detail-info-tab-count">${cloudDrives.length}</span>` : ''}
                </button>
                <button type="button" class="detail-info-tab" role="tab" id="detail-info-tab-magnet" aria-selected="false" aria-controls="detail-info-pane-magnet" data-tab="magnet" data-search-query="${canSearchMagnets ? esc(meta.name) : ''}">
                    磁力链接${magnetCount ? `<span class="detail-info-tab-count" id="detail-magnet-count">${magnetCount}</span>` : ''}
                </button>
            </div>
            <div class="detail-info-panels">
                <div class="detail-info-pane is-active" role="tabpanel" id="detail-info-pane-info" aria-labelledby="detail-info-tab-info" data-pane="info">
                    ${rows.length
                        ? `<dl class="info-list">${rows.map(([k, v]) => `<div class="info-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
                        : '<p class="detail-info-empty">暂无影视资料</p>'}
                </div>
                <div class="detail-info-pane" role="tabpanel" id="detail-info-pane-cloud" aria-labelledby="detail-info-tab-cloud" data-pane="cloud" hidden>
                    ${renderResourceList(cloudDrives, '暂无网盘资源', { kind: 'cloud_drive' })}
                </div>
                <div class="detail-info-pane" role="tabpanel" id="detail-info-pane-magnet" aria-labelledby="detail-info-tab-magnet" data-pane="magnet" hidden>
                    <div id="detail-magnet-body">
                        ${staticMagnets.length
                            ? renderResourceList(staticMagnets, '暂无磁力链接', { kind: 'magnet', series: meta.type === 'series' })
                            : (canSearchMagnets
                                ? '<div class="detail-info-status" id="detail-magnet-status"><div class="spinner-small"></div><span>正在搜索磁力链接…</span></div>'
                                : '<p class="detail-info-empty">暂无磁力链接</p>')}
                    </div>
                </div>
            </div>
        </section>
    `;
}

function updateMagnetTabCount(container, count) {
    const tab = container.querySelector('#detail-info-tab-magnet');
    if (!tab || count <= 0) return;
    let badge = tab.querySelector('#detail-magnet-count');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'detail-magnet-count';
        badge.className = 'detail-info-tab-count';
        tab.appendChild(badge);
    }
    badge.textContent = String(count);
}

function bindInfoTabs(container, meta) {
    const panel = container.querySelector('#detail-info-panel');
    if (!panel) return;
    const tabs = [...panel.querySelectorAll('.detail-info-tab')];
    const panes = [...panel.querySelectorAll('.detail-info-pane')];
    if (!tabs.length || !panes.length) return;

    const resources = Array.isArray(meta.resources) ? meta.resources : [];
    const staticMagnets = resources.filter((item) => item.kind === 'magnet');
    const canSearchMagnets = meta.type !== 'creator' && Boolean(meta.name?.trim());
    let magnetLoaded = false;
    let magnetLoading = false;

    const renderMagnetResults = (items, emptyLabel = '未找到相关磁力链接') => {
        const body = container.querySelector('#detail-magnet-body');
        if (!body) return;
        const merged = mergeMagnetResources(staticMagnets, items);
        body.innerHTML = renderResourceList(merged, emptyLabel, { kind: 'magnet', series: meta.type === 'series' });
        bindResourceListInteractions(body);
        updateMagnetTabCount(container, merged.length);
        magnetLoaded = true;
    };

    const loadMagnets = async ({ background = false } = {}) => {
        if (!canSearchMagnets || magnetLoading) return;
        if (magnetLoaded && !background) return;

        const body = container.querySelector('#detail-magnet-body');
        const cached = readMagnetSessionCache(meta);
        if (cached?.items?.length && body && !magnetLoaded) {
            renderMagnetResults(cached.items);
        } else if (body && !staticMagnets.length && !magnetLoaded && !background) {
            body.innerHTML = '<div class="detail-info-status" id="detail-magnet-status"><div class="spinner-small"></div><span>正在搜索磁力链接…</span></div>';
        }

        magnetLoading = true;
        try {
            const data = await searchMagnets(meta.name, magnetSearchOptions(meta));
            const fetched = Array.isArray(data.items) ? data.items : [];
            writeMagnetSessionCache(meta, data);
            renderMagnetResults(fetched);
        } catch {
            if (!magnetLoaded && body) {
                body.innerHTML = staticMagnets.length
                    ? renderResourceList(staticMagnets, '暂无磁力链接', { kind: 'magnet', series: meta.type === 'series' })
                    : '<p class="detail-info-empty">磁力搜索暂时不可用，请稍后再试</p>';
                bindResourceListInteractions(body);
            }
        } finally {
            magnetLoading = false;
        }
    };

    const activate = (name) => {
        tabs.forEach((tab) => {
            const active = tab.dataset.tab === name;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panes.forEach((pane) => {
            const active = pane.dataset.pane === name;
            pane.classList.toggle('is-active', active);
            pane.hidden = !active;
        });
        if (name === 'magnet') loadMagnets();
    };

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => activate(tab.dataset.tab || 'info'));
    });

    if (canSearchMagnets) {
        loadMagnets({ background: true });
    } else if (staticMagnets.length) {
        bindResourceListInteractions(container.querySelector('#detail-magnet-body'));
    }
    bindResourceGroups(container.querySelector('#detail-info-pane-cloud'));
}

function renderSimilar(meta, type, id) {
    const items = meta?.similar || [];
    const hasSimilar = items.length > 0;
    const catalogRoute = catalogRouteForDetail(type, meta);
    return `
        <section class="catalog-section detail-similar-section" id="detail-similar-section">
            <div class="detail-section-head continue-head">
                <div class="detail-section-copy">
                    <h2 class="section-title detail-section-title">${hasSimilar ? '相似内容' : '更多推荐'}</h2>
                    <p class="detail-section-subtitle" id="detail-recommend-status">${hasSimilar ? '按类型与题材为你继续推荐' : '正在查找同类热门…'}</p>
                </div>
                <a class="continue-all detail-recommend-more" href="#/${esc(catalogRoute)}">浏览更多</a>
            </div>
            <poster-grid id="${hasSimilar ? 'detail-similar-grid' : 'detail-fallback-grid'}"></poster-grid>
            <div class="detail-recommend-empty-panel hidden" id="detail-recommend-empty" role="status"></div>
        </section>
    `;
}

async function hydrateFallbackSimilar(container, meta, type, id) {
    const grid = container.querySelector('#detail-fallback-grid');
    const status = container.querySelector('#detail-recommend-status');
    const emptyPanel = container.querySelector('#detail-recommend-empty');
    if (!grid) return;

    const showEmpty = (message, actionHtml = '') => {
        grid.classList.add('hidden');
        if (status) status.textContent = message;
        if (!emptyPanel) return;
        emptyPanel.classList.remove('hidden');
        emptyPanel.innerHTML = actionHtml;
    };

    try {
        const rankingType = rankingTypeForDetail(type, meta);
        const data = await getRankings({ type: rankingType, limit: 16 });
        const currentId = String(id || meta?.id || '');
        const items = [];
        const seen = new Set([currentId]);
        for (const list of data.lists || []) {
            for (const item of list.items || []) {
                const itemId = String(item.id || '');
                if (!itemId || seen.has(itemId)) continue;
                seen.add(itemId);
                items.push(item);
            }
        }
        if (!items.length) {
            showEmpty('暂无推荐内容', `<a class="detail-recommend-empty-link" href="#/${esc(catalogRouteForDetail(type, meta))}">去片库看看</a>`);
            return;
        }
        grid.classList.remove('hidden');
        emptyPanel?.classList.add('hidden');
        if (status) status.textContent = '同类热门，左右滑动查看更多';
        grid.render(items.slice(0, 12), items[0]?.type || type, { layout: 'row' });
    } catch {
        grid.classList.add('hidden');
        showEmpty('推荐加载失败', '<button class="retry-btn secondary" id="detail-recommend-retry" type="button">重试</button>');
        emptyPanel?.querySelector('#detail-recommend-retry')?.addEventListener('click', () => {
            grid.classList.remove('hidden');
            emptyPanel?.classList.add('hidden');
            grid.showSkeleton(10, { layout: 'row' });
            if (status) status.textContent = '正在查找同类热门…';
            hydrateFallbackSimilar(container, meta, type, id);
        }, { once: true });
    }
}

function rankingTypeForDetail(type, meta) {
    if (type === 'anime' || meta?.type === 'anime') return 'anime';
    if (type === 'movie' || meta?.type === 'movie') return 'movie';
    return 'tv';
}

function catalogRouteForDetail(type, meta) {
    if (type === 'anime' || meta?.type === 'anime') return 'anime';
    if (type === 'movie' || meta?.type === 'movie') return 'movie';
    return 'tv';
}

function detailDescription(meta) {
    const parts = [
        meta.year,
        meta.runtime,
        meta.imdbRating ? `评分 ${meta.imdbRating}` : '',
        meta.genres?.slice(0, 3).join(' / '),
    ].filter(Boolean);
    const prefix = parts.length ? `${parts.join(' · ')}。` : '';
    const text = `${prefix}${meta.description || `在线观看${meta.name}`}`;
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function detailStructuredData(meta, type, id, description) {
    const isSeries = type !== 'movie' || (meta.videos?.length || 0) > 0;
    const image = shareImageUrl(meta.background || meta.poster || '');
    const data = {
        '@context': 'https://schema.org',
        '@type': isSeries ? 'TVSeries' : 'Movie',
        name: meta.name,
        description,
        url: new URL(`#/detail/${type}/${id}`, location.href).href,
        image: image || undefined,
        datePublished: meta.year ? `${meta.year}` : undefined,
        genre: meta.genres?.length ? meta.genres.slice(0, 8) : undefined,
        director: meta.director?.length ? meta.director.slice(0, 4).map((name) => ({ '@type': 'Person', name })) : undefined,
        actor: meta.cast?.length ? meta.cast.slice(0, 8).map((entry) => ({ '@type': 'Person', name: castDisplayName(entry) })) : undefined,
        aggregateRating: ratingStructuredData(meta.imdbRating),
        potentialAction: {
            '@type': 'WatchAction',
            target: new URL(`#/play/${type}/${id}`, location.href).href,
        },
    };
    if (isSeries && meta.videos?.length) {
        data.numberOfEpisodes = meta.videos.length;
        data.containsSeason = seasonsStructuredData(meta.videos, type, id);
    } else {
        data.duration = durationStructuredData(meta.runtime);
    }
    return stripUndefined(data);
}

function ratingStructuredData(value) {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating <= 0) return undefined;
    return {
        '@type': 'AggregateRating',
        ratingValue: Math.min(10, Math.max(0, rating)),
        bestRating: 10,
        worstRating: 0,
    };
}

function seasonsStructuredData(videos = [], type, id) {
    const bySeason = new Map();
    videos.forEach((video) => {
        const season = video.season || 1;
        if (!bySeason.has(season)) bySeason.set(season, []);
        bySeason.get(season).push(video);
    });
    return [...bySeason.entries()].map(([season, rows]) => stripUndefined({
        '@type': 'TVSeason',
        seasonNumber: Number(season),
        numberOfEpisodes: rows.length,
        episode: rows.slice(0, 12).map((video) => stripUndefined({
            '@type': 'TVEpisode',
            name: video.title || `第${video.episode}集`,
            episodeNumber: video.episode,
            datePublished: video.released || undefined,
            url: new URL(`#/play/${type}/${id}/${video.id}`, location.href).href,
        })),
    }));
}

function durationStructuredData(runtime) {
    const minutes = Number(String(runtime || '').match(/\d+/)?.[0]);
    if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
    return `PT${minutes}M`;
}

function stripUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function shareImageUrl(value) {
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/api/')) return `${API_BASE.replace(/\/api$/, '')}${value}`;
    return value;
}

async function hydrateCommunityRating(container, meta, type) {
    const pill = container.querySelector('#detail-community-rating');
    if (!pill) return;
    const query = ratingQuery(meta, type);
    if (!query) return;
    try {
        const res = await fetchRating(`/ratings?${query}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        updateCommunityRatingPill(container, await res.json());
    } catch {
        pill.classList.add('hidden');
    }
}

function ratingTarget(meta, type) {
    const mediaType = meta?.mediaType || (type === 'movie' ? 'movie' : 'tv');
    if (meta?.tmdbId && (mediaType === 'movie' || mediaType === 'tv')) return { tmdbId: meta.tmdbId, mediaType };
    if (meta?.movieId) return { movieId: meta.movieId };
    return null;
}

function ratingQuery(meta, type) {
    const target = ratingTarget(meta, type);
    if (!target) return '';
    const params = new URLSearchParams();
    if (target.tmdbId) {
        params.set('tmdbId', String(target.tmdbId));
        params.set('mediaType', target.mediaType);
    } else if (target.movieId) {
        params.set('movieId', String(target.movieId));
    }
    return params.toString();
}

function ratingAttributes(meta, type) {
    const target = ratingTarget(meta, type);
    if (!target) return '';
    const attrs = [];
    if (target.tmdbId) {
        attrs.push(`tmdb-id="${esc(String(target.tmdbId))}"`);
        attrs.push(`media-type="${esc(target.mediaType)}"`);
    }
    if (meta?.movieId) attrs.push(`movie-id="${esc(String(meta.movieId))}"`);
    return attrs.join(' ');
}

function updateCommunityRatingPill(container, rating = {}) {
    const pill = container.querySelector('#detail-community-rating');
    if (!pill) return;
    const average = Number(rating.average || 0);
    const count = Number(rating.count || 0);
    if (!average || !count) {
        pill.classList.add('hidden');
        pill.textContent = '';
        return;
    }
    pill.innerHTML = `${dIcons.star} 社区 ${esc(average.toFixed(1))} <span>${esc(formatCount(count))}人</span>`;
    pill.classList.remove('hidden');
}

function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
    return String(count);
}

async function fetchRating(path) {
    const urls = [`${API_V1_BASE}${path}`];
    let firstResponse = null;
    for (const url of urls) {
        const res = await fetch(url, { credentials: 'include' });
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) return res;
    }
    return firstResponse;
}

async function openShareSheet(share, options = {}) {
    if (navigator.share) {
        try {
            await navigator.share({ title: share.title, text: share.text, url: share.url });
            reportShareOutcome(share, 'native', 'success');
            return;
        } catch (err) {
            if (err?.name === 'AbortError') return;
            reportShareOutcome(share, 'native', 'failed');
        }
    }

    document.querySelector('.detail-share-sheet')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'detail-share-sheet';
    sheet.tabIndex = -1;
    sheet.innerHTML = `
        <div class="detail-share-card" role="dialog" aria-modal="true" aria-labelledby="detail-share-title">
            <button class="detail-share-close" type="button" aria-label="关闭">&times;</button>
            <div class="detail-share-preview">
                ${share.image ? `<img src="${esc(share.image)}" alt="">` : ''}
                <div>
                    <h2 id="detail-share-title">${esc(share.title || '分享内容')}</h2>
                    <p>${esc(share.communityText || share.text || '把这部影片分享给朋友')}</p>
                </div>
            </div>
            <div class="detail-share-growth">
                <strong>邀请朋友一起看</strong>
                <span>链接会带上你的分享标识，后续可统计社区扩散、打开和播放转化。</span>
            </div>
            <label class="detail-share-url">
                <span>分享链接</span>
                <input type="text" readonly value="${esc(share.url)}">
            </label>
            <div class="detail-share-actions">
                <button class="detail-share-copy" type="button">复制链接</button>
                <button class="detail-share-copy-text" type="button">复制文案</button>
                ${navigator.share ? '<button class="detail-share-native" type="button">系统分享</button>' : ''}
                <a class="detail-share-open" href="${esc(share.url)}" target="_blank" rel="noopener">打开页面</a>
            </div>
            <div class="detail-share-status" role="status"></div>
        </div>
    `;
    document.body.appendChild(sheet);

    const restoreTarget = options.returnFocus instanceof HTMLElement ? options.returnFocus : document.activeElement;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        sheet.removeEventListener('keydown', onKeydown, true);
        sheet.remove();
        if (restoreTarget instanceof HTMLElement && document.contains(restoreTarget)) {
            restoreTarget.focus({ preventScroll: true });
        }
    };
    const input = sheet.querySelector('.detail-share-url input');
    const status = sheet.querySelector('.detail-share-status');
    const copyBtn = sheet.querySelector('.detail-share-copy');
    const copyTextBtn = sheet.querySelector('.detail-share-copy-text');
    const nativeBtn = sheet.querySelector('.detail-share-native');
    const setStatus = (text) => { if (status) status.textContent = text || ''; };

    sheet.querySelector('.detail-share-close')?.addEventListener('click', close);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    sheet.addEventListener('keydown', onKeydown, true);
    copyBtn?.addEventListener('click', async () => {
        if (copyBtn.disabled) return;
        setShareButtonBusy(copyBtn, '正在复制');
        const copied = await copyText(share.url);
        if (copied) {
            reportShareOutcome(share, 'copy_link', 'success');
            setStatus('链接已复制');
            copyBtn.textContent = '已复制';
            setTimeout(() => {
                if (!sheet.isConnected) return;
                copyBtn.textContent = '复制链接';
                copyBtn.disabled = false;
                setStatus('');
            }, 1500);
            return;
        }
        copyBtn.disabled = false;
        copyBtn.textContent = '复制链接';
        input?.focus();
        input?.select();
        reportShareOutcome(share, 'copy_link', 'failed');
        setStatus('当前浏览器无法自动复制，可手动复制选中的链接');
    });
    copyTextBtn?.addEventListener('click', async () => {
        if (copyTextBtn.disabled) return;
        setShareButtonBusy(copyTextBtn, '正在复制');
        const text = shareCopyText(share);
        const copied = await copyText(text);
        if (copied) {
            reportShareOutcome(share, 'copy_text', 'success');
            setStatus('分享文案已复制');
            copyTextBtn.textContent = '已复制';
            setTimeout(() => {
                if (!sheet.isConnected) return;
                copyTextBtn.textContent = '复制文案';
                copyTextBtn.disabled = false;
                setStatus('');
            }, 1500);
            return;
        }
        copyTextBtn.disabled = false;
        copyTextBtn.textContent = '复制文案';
        input?.focus();
        input?.select();
        reportShareOutcome(share, 'copy_text', 'failed');
        setStatus('当前浏览器无法自动复制文案，可先复制链接');
    });
    nativeBtn?.addEventListener('click', async () => {
        if (nativeBtn.disabled) return;
        setShareButtonBusy(nativeBtn, '正在分享');
        try {
            await navigator.share({ title: share.title, text: share.text, url: share.url });
            reportShareOutcome(share, 'native', 'success');
            close();
        } catch (err) {
            nativeBtn.disabled = false;
            nativeBtn.textContent = '系统分享';
            if (err?.name !== 'AbortError') {
                reportShareOutcome(share, 'native', 'failed');
                setStatus('系统分享失败，可改用复制文案');
            }
        }
    });
    sheet.querySelector('.detail-share-open')?.addEventListener('click', close);
    setTimeout(() => {
        copyBtn?.focus({ preventScroll: true });
        input?.select();
    }, 80);

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const focusables = shareSheetFocusables(sheet);
        if (!focusables.length) {
            event.preventDefault();
            sheet.focus({ preventScroll: true });
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }
}

function setShareButtonBusy(button, text) {
    button.disabled = true;
    button.textContent = text;
}

function shareCopyText(share = {}) {
    return [
        share.communityText || share.title || '分享内容',
        share.communityText ? '' : share.text || '',
        share.url || '',
    ].filter(Boolean).join('\n');
}

function reportShareOutcome(share = {}, channel, actionState) {
    if (actionState === 'success') recordCommunityShare(channel, {
        report: false,
        contentId: share.contentId,
        movieId: share.movieId,
        tmdbId: share.tmdbId,
        mediaType: share.mediaType,
        contentType: share.contentType,
        shareUrl: share.url,
    });
    reportEngagementEvent('share', {
        contentId: share.contentId,
        movieId: share.movieId,
        tmdbId: share.tmdbId,
        mediaType: share.mediaType,
        contentType: share.contentType,
        actionState,
        source: channel,
        label: share.title || '',
    });
}

function shareSheetFocusables(root) {
    return [...root.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
}

async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {}
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    } catch {
        return false;
    }
}

function bindEpisodeSidebarWheel(sideEl) {
    if (!sideEl) return () => {};
    const desktopQuery = window.matchMedia('(min-width: 901px)');

    const resolveScrollTarget = (startNode) => {
        let node = startNode;
        while (node && node !== sideEl) {
            if (node.matches?.('.episodes-list, .season-dropdown, .episodes-segments')) {
                return node;
            }
            node = node.parentElement;
        }
        const list = sideEl.querySelector('.episodes-list');
        return list && list.scrollHeight > list.clientHeight + 1 ? list : null;
    };

    const onWheel = (event) => {
        if (!desktopQuery.matches) return;
        const target = resolveScrollTarget(event.target);
        event.preventDefault();
        event.stopPropagation();
        if (!target) return;

        const { scrollTop, scrollHeight, clientHeight } = target;
        if (scrollHeight <= clientHeight + 1) return;

        const nextTop = scrollTop + event.deltaY;
        const maxTop = scrollHeight - clientHeight;
        target.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
    };

    sideEl.addEventListener('wheel', onWheel, { passive: false });
    return () => sideEl.removeEventListener('wheel', onWheel);
}

// 剧集交互：季切换（下拉/箭头）+ 搜索过滤 + 分段 + 当前段渲染（扛千集）
function bindEpisodes(container, type, id, meta, onHistorySynced, startDetailPlayback, inlinePlayer) {
    const videos = meta?.videos || [];
    const movieId = meta?.movieId;
    const segWrap = container.querySelector('.episodes-segments');
    const listWrap = container.querySelector('.episodes-list');
    const cueWrap = container.querySelector('#episode-cue');
    if (!segWrap || !listWrap) return;
    const cleanupFns = [];
    cleanupFns.push(bindEpisodeSidebarWheel(container.querySelector('.detail-side')));

    // 按季分组并排序
    const seasons = {};
    videos.forEach(v => { const s = v.season || 1; (seasons[s] ||= []).push(v); });
    Object.keys(seasons).forEach(s => seasons[s].sort((a, b) => (a.episode || 0) - (b.episode || 0)));
    const seasonKeys = Object.keys(seasons).sort((a, b) => a - b);

    let cue = getEpisodeCue(meta, id);
    let activeVideoId = inlinePlayer?.getCurrentVideoId?.() || null;
    const initialPosition = getInitialEpisodePosition(seasons, seasonKeys, activeVideoId ? { videoId: activeVideoId } : cue);
    const state = { season: initialPosition.season, seg: initialPosition.seg, query: '' };

    const labelEl = container.querySelector('.season-label');
    const dropdown = container.querySelector('#season-dropdown');
    const searchInput = container.querySelector('.side-search-input');
    const searchClear = container.querySelector('.side-search-clear');
    const searchSummary = container.querySelector('#episode-search-summary');
    if (labelEl) labelEl.textContent = t('detail.season', { n: state.season });
    if (dropdown) dropdown.querySelectorAll('.season-option').forEach(o => o.classList.toggle('active', o.dataset.season === state.season));

    // 单集项 HTML
    const itemHtml = (ep) => {
        const playback = getPlaybackBadge({ id, videoId: ep.id, ...resumeIdentity(meta, type, ep), episodeId: ep.episodeId });
        const resume = playback?.kind === 'watching' ? playback : null;
        const completed = playback?.kind === 'completed';
        const resumePercent = resume ? resolveEpisodeResumePercent({ percent: resume.percent, progress: resume.progress }, ep) : 0;
        const preview = shouldShowPreview(meta, ep.id);
        const playable = hasPlayableSource(meta, ep);
        const isPlaying = activeVideoId === ep.id;
        const isCue = !activeVideoId && cue?.videoId === ep.id;
        const cueBadge = isPlaying
            ? '<span class="episode-cue-badge">播放中</span>'
            : (isCue && cue?.label ? `<span class="episode-cue-badge">${esc(cue.label)}</span>` : '');
        return `
            <div class="episode-item ${ep.available ? 'has-source' : ''} ${preview ? 'has-preview' : ''} ${resume ? 'has-progress' : ''} ${completed ? 'has-watched' : ''} ${isPlaying ? 'is-playing' : ''} ${isCue ? 'is-cue' : ''} ${playable ? '' : 'is-unavailable'}" data-video-id="${esc(ep.id)}" ${playable ? 'role="button" tabindex="0"' : 'aria-disabled="true"'}${isPlaying || isCue ? ' aria-current="true"' : ''}>
                <div class="episode-item-body">
                    <div class="episode-line">
                        <div class="episode-line-main">
                            <span class="episode-num">${ep.episode || ''}.</span>
                            <span class="episode-title">${esc(ep.title || `第${ep.episode}集`)}</span>
                            ${cueBadge}
                            ${completed && !isCue && !isPlaying ? '<span class="episode-watched">已看完</span>' : ''}
                            ${resume && !isCue && !isPlaying ? `<span class="episode-resume">${esc(playback.label)}</span>` : ''}
                            ${preview ? '<span class="episode-preview">试看</span>' : ''}
                            ${ep.available ? '<span class="episode-dot" title="可播放"></span>' : ''}
                        </div>
                        ${ep.released ? `<span class="episode-date">${formatDate(ep.released)}</span>` : ''}
                    </div>
                    ${resume ? `<span class="episode-progress"><span style="width:${resumePercent}%"></span></span>` : ''}
                    ${completed ? '<span class="episode-progress episode-progress-completed"><span style="width:100%"></span></span>' : ''}
                </div>
            </div>
        `;
    };

    // 渲染当前季当前段（无搜索时）/ 搜索结果（有搜索时）
    function renderItems({ preserveScroll = false } = {}) {
        const previousScrollTop = preserveScroll ? listWrap.scrollTop : 0;
        const all = seasons[state.season] || [];
        let list;
        if (state.query) {
            const q = state.query.toLowerCase();
            list = all.filter(ep =>
                String(ep.episode).includes(q) ||
                (ep.title || '').toLowerCase().includes(q)
            ).slice(0, 200); // 搜索结果上限，防超大列表
        } else {
            const from = state.seg * EP_SEG_SIZE;
            list = all.slice(from, from + EP_SEG_SIZE);
        }
        listWrap.innerHTML = list.length
            ? list.map(itemHtml).join('')
            : '<div class="episodes-empty">没有匹配的剧集</div>';
        listWrap.scrollTop = preserveScroll ? previousScrollTop : 0;
        renderSearchSummary(list.length, all.length);
    }

    function renderSearchSummary(resultCount = 0, totalCount = 0) {
        if (!searchSummary) return;
        if (!state.query) {
            searchSummary.textContent = totalCount ? `${t('detail.season', { n: state.season })} · 共 ${totalCount} 集` : '';
            return;
        }
        const clipped = resultCount >= 200 ? '，已显示前 200 集' : '';
        searchSummary.textContent = `搜索「${state.query}」 · ${resultCount} 个结果${clipped}`;
    }

    function setEpisodeQuery(value, { restoreFocus = false } = {}) {
        state.query = value.trim();
        if (searchInput && searchInput.value !== value) searchInput.value = value;
        searchClear?.classList.toggle('hidden', !state.query);
        renderSegments();
        renderItems();
        if (restoreFocus) searchInput?.focus();
    }

    function renderCue() {
        if (!cueWrap) return;
        if (activeVideoId) {
            const video = findEpisodeVideo(meta, activeVideoId);
            if (video) {
                const resume = getResumeProgress({ id, videoId: video.id, ...resumeIdentity(meta, type, video), episodeId: video.episodeId });
                const pct = resume ? resolveEpisodeResumePercent(resume, video) : 0;
                cueWrap.classList.remove('hidden');
                cueWrap.innerHTML = episodeCueHTML({
                    kind: 'playing',
                    videoId: activeVideoId,
                    title: video.title || `第${video.episode}集`,
                    code: episodeCode(video),
                    label: '正在观看',
                    hint: resume?.progress > 0 ? formatResumeContinueHint(resume, video) : '',
                    progress: pct,
                    playable: hasPlayableSource(meta, video),
                });
                return;
            }
        }
        cue = getEpisodeCue(meta, id);
        if (!cue) {
            cueWrap.classList.add('hidden');
            cueWrap.innerHTML = '';
            return;
        }
        cueWrap.classList.remove('hidden');
        cueWrap.innerHTML = episodeCueHTML(cue);
    }

    function refreshHistoryState() {
        if (!activeVideoId) cue = getEpisodeCue(meta, id);
        renderCue();
        renderSegments();
        renderItems({ preserveScroll: true });
        onHistorySynced?.();
    }

    // 渲染当前季的分段 chip（搜索时隐藏，不足一段时隐藏）
    function renderSegments() {
        const all = seasons[state.season] || [];
        const segCount = Math.ceil(all.length / EP_SEG_SIZE);
        if (state.query || segCount <= 1) {
            segWrap.classList.add('hidden');
            segWrap.innerHTML = '';
            return;
        }
        segWrap.classList.remove('hidden');
        let html = '';
        for (let i = 0; i < segCount; i++) {
            const f = i * EP_SEG_SIZE;
            const tIdx = Math.min(f + EP_SEG_SIZE, all.length);
            const a = all[f]?.episode ?? (f + 1);
            const b = all[tIdx - 1]?.episode ?? tIdx;
            html += `<button class="episodes-seg ${i === state.seg ? 'active' : ''}" data-seg="${i}" role="tab">${a}-${b}</button>`;
        }
        segWrap.innerHTML = html;
    }

    // 切季
    function switchSeason(season) {
        if (season === state.season || !seasons[season]) return;
        state.season = season;
        state.seg = 0;
        if (labelEl) labelEl.textContent = t('detail.season', { n: season });
        if (dropdown) dropdown.querySelectorAll('.season-option').forEach(o => o.classList.toggle('active', o.dataset.season === season));
        renderSegments();
        renderItems();
    }

    // 初始渲染
    renderCue();
    renderSegments();
    renderItems();

    if (user.value && (meta?.tmdbId || movieId)) {
        syncMovieHistory(libraryItemPayload(meta, type, id)).then((updated) => {
            if (!updated) return;
            refreshHistoryState();
        });
    }

    // 季下拉开关
    const seasonBtn = container.querySelector('#season-current');
    if (seasonBtn && dropdown) {
        seasonBtn.addEventListener('click', () => dropdown.classList.toggle('hidden'));
        dropdown.addEventListener('click', (e) => {
            const opt = e.target.closest('.season-option');
            if (!opt) return;
            switchSeason(opt.dataset.season);
            dropdown.classList.add('hidden');
        });
        // 点外部关闭
        const onDocumentClick = (e) => {
            if (!seasonBtn.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
        };
        document.addEventListener('click', onDocumentClick);
        cleanupFns.push(() => document.removeEventListener('click', onDocumentClick));
    }

    // 上/下一季箭头
    container.querySelectorAll('.season-arrow').forEach(arrow => {
        arrow.addEventListener('click', () => {
            const idx = seasonKeys.indexOf(state.season);
            const next = seasonKeys[idx + parseInt(arrow.dataset.dir, 10)];
            if (next) switchSeason(next);
        });
    });

    // 搜索（防抖）
    if (searchInput) {
        let timer = null;
        cleanupFns.push(() => clearTimeout(timer));
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                setEpisodeQuery(searchInput.value);
            }, 150);
        });
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && searchInput.value) {
                event.preventDefault();
                clearTimeout(timer);
                setEpisodeQuery('', { restoreFocus: true });
            }
        });
        searchClear?.addEventListener('click', () => {
            clearTimeout(timer);
            setEpisodeQuery('', { restoreFocus: true });
        });
    }

    // 分段 chip 切换
    segWrap.addEventListener('click', (e) => {
        const seg = e.target.closest('.episodes-seg');
        if (!seg) return;
        const idx = parseInt(seg.dataset.seg, 10);
        if (idx === state.seg) return;
        state.seg = idx;
        segWrap.querySelectorAll('.episodes-seg').forEach(c => c.classList.toggle('active', c === seg));
        renderItems();
    });

    // 选某集 → 详情页内嵌播放（未登录先引导登录）
    listWrap.addEventListener('click', async (e) => {
        const item = e.target.closest('.episode-item');
        if (!item) return;
        const vid = item.dataset.videoId;
        const video = findEpisodeVideo(meta, vid);
        if (!hasPlayableSource(meta, video)) {
            showSiteNotice('暂无片源');
            return;
        }
        if (!hasPreviewSource(meta, vid) && !await ensureLogin()) return;
        if (inlinePlayer?.isPlaying?.()) {
            await inlinePlayer.playEpisodeById(vid);
            setActiveVideoId(vid);
            return;
        }
        await startDetailPlayback(vid);
    });
    listWrap.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const item = e.target.closest('.episode-item');
        if (!item || !listWrap.contains(item) || item.classList.contains('is-unavailable')) return;
        e.preventDefault();
        const vid = item.dataset.videoId;
        const video = findEpisodeVideo(meta, vid);
        if (!hasPlayableSource(meta, video)) {
            showSiteNotice('暂无片源');
            return;
        }
        if (!hasPreviewSource(meta, vid) && !await ensureLogin()) return;
        if (inlinePlayer?.isPlaying?.()) {
            await inlinePlayer.playEpisodeById(vid);
            setActiveVideoId(vid);
            return;
        }
        await startDetailPlayback(vid);
    });

    cueWrap?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.episode-cue-play');
        if (!btn || btn.disabled || !cue?.videoId || cue.playable === false) return;
        if (!hasPreviewSource(meta, cue.videoId) && !await ensureLogin()) return;
        if (inlinePlayer?.isPlaying?.()) {
            await inlinePlayer.playEpisodeById(cue.videoId);
            setActiveVideoId(cue.videoId);
            return;
        }
        await startDetailPlayback(cue.videoId);
    });

    function setActiveVideoId(vid) {
        activeVideoId = vid || null;
        if (!activeVideoId) cue = getEpisodeCue(meta, id);
        renderCue();
        renderItems({ preserveScroll: true });
    }

    return {
        refreshHistory: refreshHistoryState,
        refreshEpisodes: () => renderItems({ preserveScroll: true }),
        setActiveVideoId,
        cleanup() {
            cleanupFns.forEach((cleanup) => cleanup?.());
        },
    };
}

function getInitialEpisodePosition(seasons, seasonKeys, cue) {
    const fallback = { season: seasonKeys[0], seg: 0 };
    if (!cue?.videoId) return fallback;
    for (const season of seasonKeys) {
        const episodes = seasons[season] || [];
        const index = episodes.findIndex((video) => video.id === cue.videoId);
        if (index >= 0) {
            return { season, seg: Math.floor(index / EP_SEG_SIZE) };
        }
    }
    return fallback;
}

function getEpisodeCue(meta, id) {
    const videos = meta?.videos || [];
    if (!videos.length) return null;
    const noSourceHint = '当前暂无可用播放资源';

    const resume = bestEpisodeResume(meta, id);
    if (resume) {
        const playable = hasPlayableSource(meta, resume.video);
        const pct = resolveEpisodeResumePercent(resume.resume, resume.video);
        return {
            kind: 'resume',
            videoId: resume.video.id,
            title: resume.video.title || `第${resume.video.episode}集`,
            code: episodeCode(resume.video),
            label: '继续观看',
            hint: playable ? formatResumeContinueHint(resume.resume, resume.video) : noSourceHint,
            progress: playable ? pct : 0,
            playable,
        };
    }

    const latest = latestEpisodeHistory(meta, id);
    if (latest) {
        const latestVideo = videos.find((video) => isSameEpisodeHistory(video, latest, meta.movieId));
        const latestResume = latestVideo
            ? getResumeProgress({ id, videoId: latestVideo.id, ...resumeIdentity(meta, 'series', latestVideo), episodeId: latestVideo.episodeId })
            : null;
        const latestProgress = Number(latestResume?.progress || 0);
        const latestPercent = latestResume ? resolveEpisodeResumePercent(latestResume, latestVideo) : 0;
        if (latestVideo && latestResume && latestProgress > 0 && (latestPercent === 0 || latestPercent < COMPLETION_PERCENT)) {
            const playable = hasPlayableSource(meta, latestVideo);
            return {
                kind: 'resume',
                videoId: latestVideo.id,
                title: latestVideo.title || `第${latestVideo.episode}集`,
                code: episodeCode(latestVideo),
                label: '继续观看',
                hint: playable ? formatResumeContinueHint(latestResume, latestVideo) : noSourceHint,
                progress: playable ? latestPercent : 0,
                playable,
            };
        }
        const idx = videos.findIndex((video) => isSameEpisodeHistory(video, latest, meta.movieId));
        const next = videos.slice(idx + 1).find((video) => hasPlayableSource(meta, video)) || videos[idx + 1];
        if (next) {
            const playable = hasPlayableSource(meta, next);
            return {
                kind: 'next',
                videoId: next.id,
                title: next.title || `第${next.episode}集`,
                code: episodeCode(next),
                label: '播放下一集',
                hint: playable
                    ? (latest.name ? `接在 ${latest.name} 后继续` : '上一集已接近看完')
                    : noSourceHint,
                progress: 0,
                playable,
            };
        }
    }

    const first = videos.find((video) => hasPlayableSource(meta, video)) || videos[0];
    if (!first) return null;
    const playable = hasPlayableSource(meta, first);
    return {
        kind: 'first',
        videoId: first.id,
        title: first.title || `第${first.episode}集`,
        code: episodeCode(first),
        label: '开始观看',
        hint: playable ? '从首个可播放剧集开始' : noSourceHint,
        progress: 0,
        playable,
    };
}

function episodeCueHTML(cue) {
    const playBtn = cue.playable
        ? `<button class="episode-cue-play" type="button">${dIcons.play}<span>播放</span></button>`
        : `<button class="episode-cue-play is-unavailable" type="button" disabled aria-disabled="true">暂无片源</button>`;
    return `
        <div class="episode-cue-copy">
            <div class="episode-cue-kicker">${esc(cue.label)}</div>
            <div class="episode-cue-title">
                ${cue.code ? `<span>${esc(cue.code)}</span>` : ''}
                <strong>${esc(cue.title)}</strong>
            </div>
            ${cue.hint ? `<div class="episode-cue-hint">${esc(cue.hint)}</div>` : ''}
            ${cue.progress ? `<div class="episode-cue-progress"><span style="width:${cue.progress}%"></span></div>` : ''}
        </div>
        ${playBtn}
    `;
}

function latestEpisodeHistory(meta, id) {
    const movieId = meta?.movieId;
    const items = [...(watchHistory.value || [])]
        .filter((item) => (meta?.videos || []).some((video) => isSameEpisodeHistory(video, item, movieId)) || item.id === id)
        .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    return items[0] || null;
}

function isSameEpisodeHistory(video, item, movieId) {
    if (!video || !item) return false;
    if (item.videoId && item.videoId === video.id) return true;
    if (movieId && Number(item.movieId) === Number(movieId) && video.episodeId != null && Number(item.episodeId) === Number(video.episodeId)) return true;
    return false;
}

function bindDiscussionJump(container, loadComments, meta, type, id) {
    const btn = container.querySelector('#discussion-btn');
    if (!btn || typeof loadComments !== 'function') return;
    btn.addEventListener('click', async () => {
        reportDetailEngagement('discussion', meta, type, id, { actionState: 'open' });
        btn.disabled = true;
        btn.classList.add('is-loading');
        try {
            await loadComments({ scroll: true, focusComposer: true });
        } finally {
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
    });
}

function lazyLoadComments(container, id) {
    const anchor = container.querySelector('.detail-comments-anchor');
    if (!anchor) return null;
    let loaded = null;
    let loading = null;

    const focusComments = (comments, { scroll = false, focusComposer = false } = {}) => {
        if (!comments) return;
        if (scroll) comments.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const focusTarget = focusComposer
            ? comments.querySelector('#comment-input') || comments
            : comments;
        setTimeout(() => focusTarget?.focus?.({ preventScroll: true }), scroll ? 260 : 0);
    };

    const load = async (options = {}) => {
        const existing = loaded || container.querySelector('comment-section');
        if (existing) {
            focusComments(existing, options);
            return existing;
        }
        if (!loading) {
            loading = import('../components/comments.js').then(() => {
                const comments = document.createElement('comment-section');
                comments.setAttribute('video-id', id);
                comments.id = 'detail-comments';
                comments.tabIndex = -1;
                anchor.replaceWith(comments);
                loaded = comments;
                return comments;
            }).finally(() => {
                loading = null;
            });
        }
        const comments = await loading;
        focusComments(comments, options);
        return comments;
    };
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                io.disconnect();
                load();
            }
        }, { rootMargin: '300px' });
        io.observe(anchor);
    } else {
        load();
    }
    return load;
}

function formatDate(d) {
    try { return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return ''; }
}

function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function resolveEpisodeResumePercent(resume, video = null) {
    const pct = Math.round(getResumePercent(resume, video?.durationSeconds || 0));
    if (pct <= 0) return 0;
    return Math.min(99, Math.max(1, pct));
}

function formatResumeContinueHint(resume, video = null) {
    const progress = Number(resume?.progress || 0);
    if (progress <= 0) return '';
    const pct = resolveEpisodeResumePercent(resume, video);
    const clock = formatClock(progress);
    if (pct > 0) return `${pct}% · 从 ${clock} 继续`;
    return `从 ${clock} 继续`;
}

// 首页

import { getCatalog, getHome, getHomeCurations, getHomeRecommendations, getMeta } from '../services/api.js';
import { t } from '../services/i18n.js';
import { favorites, getContinueHistory, getRecentHistory, history, removeHistory, restoreHistoryItem, watchLater } from '../services/library.js';
import { dismissReferralLandingContext, getReferralLandingContext, markReferralLandingAccepted } from '../services/community-growth.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';
import { user } from '../services/auth.js';
import { pointsAccount, pointsTasks, pointsRules, fetchPointsAccount, checkinPoints, formatPoints } from '../services/points.js';
import { showSiteNotice } from '../services/site-notice.js';
import { esc, onLongPress } from '../core/html.js';
import { navigate, reloadRoute } from '../core/router.js';
import { showLibraryUndoToast } from './favorites.js';
import { bindTmdbImageFallback, bindTmdbImagesIn, normalizeTmdbImageUrl } from '../services/media-images.js';
import '../components/poster-grid.js';

const idle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout });
    else setTimeout(task, 0);
};

const HOME_POSTER_OPTS = { layout: 'row', showResume: false };

export async function render(container) {
    const recentHistory = getContinueHistory(10);

    container.innerHTML = `
        <div class="home-hero hero-loading" id="home-hero" aria-hidden="true"></div>
        <div id="home-points-banner-slot"></div>
        ${homeReferralBannerHTML(getReferralLandingContext())}
        ${continueSectionHTML(recentHistory, [])}
        <section class="catalog-section home-smart-section hidden" id="home-smart-section">
            <div class="continue-head home-smart-head">
                <div>
                    <h2 class="section-title">为你优选</h2>
                    <div class="continue-count" id="home-smart-count">正在计算更适合你的内容</div>
                </div>
                <div class="home-smart-metrics" id="home-smart-metrics"></div>
            </div>
            <poster-grid id="grid-smart"></poster-grid>
        </section>
        <section class="catalog-section">
            <h2 class="section-title">${t('home.movie')}</h2>
            <poster-grid id="grid-movie"></poster-grid>
        </section>
        <section class="catalog-section">
            <h2 class="section-title">${t('home.tv')}</h2>
            <poster-grid id="grid-tv"></poster-grid>
        </section>
        <section class="catalog-section">
            <h2 class="section-title">${t('home.anime')}</h2>
            <poster-grid id="grid-anime"></poster-grid>
        </section>
        <div class="home-local-fallback" id="home-local-fallback"></div>
        <div class="catalog-status" id="home-status"></div>
    `;
    bindHomeReferralBanner(container);
    mountHomePointsBanner(container);

    // 骨架屏（横向滑动行）
    container.querySelector('#grid-movie').showSkeleton(10, { layout: 'row' });
    container.querySelector('#grid-tv').showSkeleton(10, { layout: 'row' });
    container.querySelector('#grid-anime').showSkeleton(10, { layout: 'row' });

    // 继续观看
    if (recentHistory.length > 0) {
        container.querySelector('#grid-continue').render(recentHistory, recentHistory[0]?.type || 'movie', { ...HOME_POSTER_OPTS, removeLabel: '移除' });
        bindContinueRemove(container);
    }

    const unsubscribeHistory = history.subscribe(() => {
        renderContinueSection(container, getContinueHistory(10));
        renderSmartRecommendations(container, container._homeCatalogItems || []);
    });
    let smartLoadCancelled = false;

    // 首屏优先：片库行 + Hero；个性化推荐 idle 后再拉，减少阻塞
    const [homeR, curationsR] = await Promise.allSettled([
        getHome(),
        getHomeCurations({ slot: 'hero', limit: 5 }),
    ]);

    let movies = pickHomeCatalogRow(homeR.status === 'fulfilled' ? homeR.value : null, 'movie');
    let tvs = pickHomeCatalogRow(homeR.status === 'fulfilled' ? homeR.value : null, 'tv');
    let animes = pickHomeCatalogRow(homeR.status === 'fulfilled' ? homeR.value : null, 'anime');

    const catalogFallbackNeeded = !movies.length && !tvs.length && !animes.length;
    let moviesR = homeR;
    let tvsR = homeR;
    let animesR = homeR;

    if (catalogFallbackNeeded) {
        [moviesR, tvsR, animesR] = await Promise.allSettled([
            getCatalog('movie', 'guangying-movie'),
            getCatalog('series', 'guangying-tv'),
            getCatalog('series', 'guangying-anime'),
        ]);
        movies = moviesR.status === 'fulfilled' ? moviesR.value : [];
        tvs = tvsR.status === 'fulfilled' ? tvsR.value : [];
        animes = animesR.status === 'fulfilled' ? animesR.value : [];
    }

    container._homeRecommendations = null;
    container._homeContinueSignals = buildContinueSignals();
    renderContinueSection(container, getContinueHistory(10), container._homeContinueSignals);
    const heroCurations = curationsR.status === 'fulfilled' ? curationsR.value?.items || [] : [];
    const failures = [];
    if (homeR.status === 'rejected') failures.push(homeR.reason);
    if (catalogFallbackNeeded) {
        for (const result of [moviesR, tvsR, animesR]) {
            if (result.status === 'rejected') failures.push(result.reason);
        }
    }
    const isOffline = failures.some(isOfflineError);
    const allCatalogItems = [
        ...movies.map((item, index) => ({ ...item, type: item.type || 'movie', _sourceRank: index, _sourceBucket: 'movie' })),
        ...tvs.map((item, index) => ({ ...item, type: item.type || 'series', _sourceRank: index, _sourceBucket: 'tv' })),
        ...animes.map((item, index) => ({ ...item, type: item.type || 'series', _sourceRank: index, _sourceBucket: 'anime' })),
    ];
    container._homeCatalogItems = allCatalogItems;

    // 三个分类都失败时仍留在首页，优先展示本地片单/历史，避免把用户丢到路由错误页。
    if (!movies.length && !tvs.length && !animes.length) {
        renderEmptyCatalogRows(container);
        renderHomeRecovery(container, {
            state: isOffline ? 'offline' : 'failed',
            failures,
        });
        renderHero(container.querySelector('#home-hero'), []);
        return () => {
            smartLoadCancelled = true;
            unsubscribeHistory?.();
        };
    }

    container.querySelector('#grid-movie').render(movies.slice(0, 12), 'movie', HOME_POSTER_OPTS);
    container.querySelector('#grid-tv').render(tvs.slice(0, 12), 'series', HOME_POSTER_OPTS);
    container.querySelector('#grid-anime').render(animes.slice(0, 12), 'series', HOME_POSTER_OPTS);
    renderSmartRecommendations(container, allCatalogItems);

    // Hero：精选影片沉浸式轮播（混合电影+剧集前几部）
    const heroEl = container.querySelector('#home-hero');
    const homePayload = homeR.status === 'fulfilled' ? homeR.value : null;
    const featured = heroCurations.length
        ? heroCurations
        : (homePayload?.hero?.length ? homePayload.hero : [...movies.slice(0, 3), ...tvs.slice(0, 2)].filter(Boolean).slice(0, 5));
    renderHero(heroEl, featured.length ? featured : await hydrateFirstHeroItem([...movies.slice(0, 3), ...tvs.slice(0, 2)].filter(Boolean).slice(0, 5)));
    if (failures.length > 0) {
        renderHomeStatus(container, isOffline ? 'partial-offline' : 'partial-failed');
    }

    idle(async () => {
        if (smartLoadCancelled) return;
        try {
            const recommendations = await getHomeRecommendations({ limit: 14 });
            if (smartLoadCancelled) return;
            container._homeRecommendations = recommendations;
            renderSmartRecommendations(container, container._homeCatalogItems || []);
        } catch {
            // 本地 catalog 兜底已在首屏渲染
        }
    }, 400);

    // 离开首页时停止轮播定时器，避免后台空跑
    return () => {
        smartLoadCancelled = true;
        unsubscribeHistory?.();
        heroEl?._heroStop?.();
        container._homePointsTeardown?.();
    };
}

function homeReferralBannerHTML(context) {
    if (!context || context.dismissedAt) return '';
    const hasTarget = context.hash && context.hash !== '#/';
    const accepted = Number(context.acceptedAt || 0) > 0;
    const title = accepted ? '邀请已接住，继续把兴趣变成观看' : '朋友邀请你一起看';
    const hint = hasTarget
        ? '先打开朋友分享的内容，试看、收藏或加入讨论，下一次回访成本会更低。'
        : '从推荐或排行榜选一部内容，收藏后会更容易形成连续观看。';
    const href = hasTarget ? context.hash : '#/rankings';
    return `
        <section class="home-referral-banner" id="home-referral-banner" aria-label="社区邀请">
            <div class="home-referral-copy">
                <span>社区回流</span>
                <strong>${esc(title)}</strong>
                <p>${esc(hint)}</p>
            </div>
            <div class="home-referral-actions">
                <a class="home-referral-primary" href="${esc(href)}" data-referral-accept="home_referral">${hasTarget ? '打开分享内容' : '查看排行榜'}</a>
                <button class="home-referral-dismiss" type="button" aria-label="关闭邀请提示">稍后</button>
            </div>
        </section>
    `;
}

function homePointsBannerHTML() {
    if (!user.value || pointsTasks.value?.checkedInToday) return '';
    const balance = Number(pointsAccount.value?.balance || 0);
    const reward = Number(pointsTasks.value?.dailyCheckinReward || pointsRules.value?.dailyCheckin || 10);
    return `
        <section class="home-points-banner" id="home-points-banner" aria-label="每日签到">
            <div class="home-points-copy">
                <span>每日签到</span>
                <strong>签到领 ${esc(formatPoints(reward))} 积分</strong>
                <p>当前余额 ${esc(formatPoints(balance))} 积分 · 连续签到还可解锁周奖励</p>
            </div>
            <div class="home-points-actions">
                <button class="home-points-checkin" type="button" id="home-points-checkin">立即签到</button>
                <a class="home-points-link" href="#/account?section=points">积分中心</a>
            </div>
        </section>
    `;
}

function mountHomePointsBanner(container) {
    const slot = container.querySelector('#home-points-banner-slot');
    if (!slot) return;
    let teardown = null;

    const paint = () => {
        teardown?.();
        slot.innerHTML = homePointsBannerHTML();
        const banner = slot.querySelector('#home-points-banner');
        const button = slot.querySelector('#home-points-checkin');
        if (!banner || !button) return;
        const onCheckin = async () => {
            button.disabled = true;
            try {
                const result = await checkinPoints();
                showSiteNotice(`签到成功，获得 ${formatPoints(result.earned)} 积分`, { tone: 'success' });
                await fetchPointsAccount();
                paint();
            } catch (err) {
                const already = err?.code === 'ALREADY_CHECKED_IN' || err?.status === 409;
                showSiteNotice(already ? '今日已签到' : (err?.message || '签到失败'), { tone: already ? 'info' : 'error' });
                if (already) {
                    await fetchPointsAccount();
                    paint();
                } else {
                    button.disabled = false;
                }
            }
        };
        button.addEventListener('click', onCheckin);
        teardown = () => button.removeEventListener('click', onCheckin);
    };

    const sync = async () => {
        if (!user.value) {
            teardown?.();
            slot.innerHTML = '';
            return;
        }
        if (!pointsTasks.value) await fetchPointsAccount().catch(() => {});
        paint();
    };

    sync();
    const unsubUser = user.subscribe(() => { sync(); });
    const unsubTasks = pointsTasks.subscribe(() => { paint(); });
    container._homePointsTeardown = () => {
        unsubUser?.();
        unsubTasks?.();
        teardown?.();
    };
}

function pickHomeCatalogRow(homeData, kind) {
    const rowTitle = {
        movie: '热门电影',
        tv: '最新剧集',
        anime: '动漫精选',
    }[kind];
    const row = homeData?.rows?.find((section) => section.title === rowTitle);
    return Array.isArray(row?.items) ? row.items : [];
}

function bindHomeReferralBanner(container) {
    const banner = container.querySelector('#home-referral-banner');
    if (!banner) return;
    banner.querySelector('[data-referral-accept]')?.addEventListener('click', (event) => {
        markReferralLandingAccepted(event.currentTarget?.dataset?.referralAccept || 'home_referral');
    });
    banner.querySelector('.home-referral-dismiss')?.addEventListener('click', () => {
        dismissReferralLandingContext('home_referral');
        banner.remove();
    });
}

function renderSmartRecommendations(container, catalogItems) {
    const section = container.querySelector('#home-smart-section');
    const grid = container.querySelector('#grid-smart');
    if (!section || !grid) return;
    const serverResult = normalizeServerRecommendations(container._homeRecommendations);
    if (serverResult.items.length) {
        section.classList.remove('hidden');
        const count = container.querySelector('#home-smart-count');
        if (count) count.textContent = serverResult.summary;
        const metrics = container.querySelector('#home-smart-metrics');
        if (metrics) {
            metrics.innerHTML = serverResult.metrics.map((metric) => `
                <span class="home-smart-chip">
                    <strong>${esc(metric.value)}</strong>
                    <span>${esc(metric.label)}</span>
                </span>
            `).join('');
        }
        grid.render(serverResult.items, serverResult.items[0]?.type || 'movie', HOME_POSTER_OPTS);
        bindRecommendationAnalytics(grid, serverResult, 'server');
        return;
    }
    const result = buildSmartRecommendations(catalogItems, 14);
    if (!result.items.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    const count = container.querySelector('#home-smart-count');
    if (count) {
        count.textContent = result.summary;
    }
    const metrics = container.querySelector('#home-smart-metrics');
    if (metrics) {
        metrics.innerHTML = result.metrics.map((metric) => `
            <span class="home-smart-chip">
                <strong>${esc(metric.value)}</strong>
                <span>${esc(metric.label)}</span>
            </span>
        `).join('');
    }
    grid.render(result.items, result.items[0]?.type || 'movie', HOME_POSTER_OPTS);
    bindRecommendationAnalytics(grid, result, 'local');
}

function bindRecommendationAnalytics(grid, result, strategySource) {
    const items = Array.isArray(result?.items) ? result.items : [];
    if (!grid || !items.length) return;
    const signature = `${strategySource}:${items.map((item) => item?.id).filter(Boolean).join('|')}`;
    if (grid.dataset.recommendationImpression !== signature) {
        grid.dataset.recommendationImpression = signature;
        reportEngagementEvent('recommendation_impression', {
            contentId: 'gy:recommendations:home',
            contentType: 'movie',
            targetId: items.slice(0, 6).map((item) => item?.id).filter(Boolean).join(','),
            source: 'home_recommendations',
            label: strategySource,
            value: items.length,
        });
    }
    grid.dataset.recommendationSource = strategySource;
    if (grid.dataset.recommendationClickBound === '1') return;
    grid.dataset.recommendationClickBound = '1';
    grid.addEventListener('click', (event) => {
        const card = event.target.closest?.('.poster-item');
        if (!card || !grid.contains(card)) return;
        const index = Array.from(grid.querySelectorAll('.poster-item')).indexOf(card);
        reportEngagementEvent('recommendation_click', {
            contentId: 'gy:recommendations:home',
            contentType: card.dataset.type || 'movie',
            targetId: card.dataset.id,
            source: 'home_recommendations',
            label: grid.dataset.recommendationSource || strategySource,
            value: Math.max(0, index),
        });
    });
}

function normalizeServerRecommendations(data) {
    const items = Array.isArray(data?.items) ? data.items.filter(Boolean).slice(0, 14) : [];
    if (!items.length) return { items: [], summary: '', metrics: [] };
    const strategy = data?.strategy || {};
    const personalized = strategy.personalized === true;
    const signalCount = Array.isArray(strategy.signals) ? strategy.signals.length : 0;
    const topReasons = [...new Set(items.map((item) => item.recommendation?.reason).filter(Boolean))].slice(0, 2);
    return {
        items,
        summary: data.summary || (personalized
            ? `服务端根据你的观看和互动信号推荐 ${items.length} 部`
            : `根据热度、评分和新鲜度推荐 ${items.length} 部`),
        metrics: [
            { value: personalized ? '个性化' : '热门', label: '推荐策略' },
            { value: String(signalCount || 3), label: '排序信号' },
            { value: topReasons.join(' / ') || '混合', label: '推荐理由' },
        ],
    };
}

function buildSmartRecommendations(catalogItems, limit = 14) {
    const catalog = Array.isArray(catalogItems) ? catalogItems : [];
    const behaviorItems = [
        ...getRecentHistory(30).map((item, index) => ({ ...item, _behavior: 'history', _behaviorRank: index })),
        ...(favorites.value || []).map((item, index) => ({ ...item, _behavior: 'favorite', _behaviorRank: index })),
        ...(watchLater.value || []).map((item, index) => ({ ...item, _behavior: 'watchLater', _behaviorRank: index })),
    ].filter((item) => item?.id);
    const behaviorIds = new Set(behaviorItems.map((item) => item.id));
    const resumeIds = new Set(getContinueHistory(50).map((item) => item.id));
    const profile = buildTasteProfile(behaviorItems);
    const merged = mergeRecommendationCandidates(catalog, behaviorItems);
    const scored = merged
        .map((item) => scoreRecommendation(item, { profile, behaviorIds, resumeIds }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    const items = scored.map(({ item, reasons, score }) => ({
        ...item,
        subtitle: reasons.slice(0, 2).join(' · ') || item.subtitle || item.year || '',
        _recommendScore: score,
    }));
    const signalCount = profile.totalSignals;
    const savedChoices = Math.max(items.length * 4, 0);
    return {
        items,
        summary: signalCount
            ? `根据 ${signalCount} 个观看/收藏信号排序，先看最可能喜欢的 ${items.length} 部`
            : `先从热门与近期内容里挑出 ${items.length} 部，减少选择压力`,
        metrics: [
            { value: String(signalCount || items.length), label: signalCount ? '行为信号' : '候选内容' },
            { value: `${savedChoices}`, label: '少翻卡片' },
            { value: profile.topTypeLabel || '混合', label: '偏好方向' },
        ],
    };
}

function buildTasteProfile(items) {
    const typeScores = new Map();
    const tokens = new Map();
    let totalSignals = 0;
    items.forEach((item, index) => {
        const recency = Math.max(0.25, 1 - index / 40);
        const behaviorWeight = item._behavior === 'favorite' ? 1.4
            : item._behavior === 'watchLater' ? 1.2
                : 1;
        const weight = recency * behaviorWeight;
        const type = item.type === 'movie' ? 'movie' : 'series';
        typeScores.set(type, (typeScores.get(type) || 0) + weight);
        extractTasteTokens(item).forEach((token) => {
            tokens.set(token, (tokens.get(token) || 0) + weight);
        });
        totalSignals += 1;
    });
    const topType = [...typeScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return {
        typeScores,
        tokens,
        totalSignals,
        topType,
        topTypeLabel: topType === 'movie' ? '电影' : topType === 'series' ? '剧集' : '',
    };
}

function mergeRecommendationCandidates(catalogItems, behaviorItems) {
    const map = new Map();
    const add = (item, source) => {
        if (!item?.id) return;
        const prev = map.get(item.id) || {};
        map.set(item.id, {
            ...prev,
            ...item,
            type: item.type === 'movie' ? 'movie' : 'series',
            _sources: [...(prev._sources || []), source],
        });
    };
    catalogItems.forEach((item) => add(item, 'catalog'));
    behaviorItems.forEach((item) => add(item, item._behavior || 'behavior'));
    return [...map.values()];
}

function scoreRecommendation(item, { profile, behaviorIds, resumeIds }) {
    const reasons = [];
    let score = 20;
    const type = item.type === 'movie' ? 'movie' : 'series';
    const typeScore = profile.typeScores.get(type) || 0;
    if (typeScore > 0) {
        score += Math.min(22, typeScore * 8);
        reasons.push(type === 'movie' ? '延续电影偏好' : '延续剧集偏好');
    }
    const overlap = extractTasteTokens(item)
        .reduce((sum, token) => sum + Math.min(6, profile.tokens.get(token) || 0), 0);
    if (overlap > 0) {
        score += Math.min(24, overlap);
        reasons.push('题材相近');
    }
    if (item._sources?.includes('watchLater')) {
        score += 30;
        reasons.unshift('来自稍后看');
    }
    if (item._sources?.includes('favorite')) {
        score += 24;
        reasons.unshift('已收藏');
    }
    if (resumeIds.has(item.id)) {
        score -= 16;
    } else if (behaviorIds.has(item.id)) {
        score -= 6;
    }
    const year = Number(item.year);
    if (Number.isFinite(year) && year >= new Date().getFullYear() - 2) {
        score += 7;
        reasons.push('近年内容');
    }
    const rank = Number(item._sourceRank);
    if (Number.isFinite(rank)) {
        score += Math.max(0, 14 - rank * 0.8);
    }
    if (!reasons.length) reasons.push('热门备选');
    return { item, score, reasons: [...new Set(reasons)] };
}

function extractTasteTokens(item) {
    const fields = [
        item.name,
        item.title,
        item.subtitle,
        item.genre,
        item.genres,
        item.category,
        item.tags,
    ];
    return fields
        .flatMap((value) => Array.isArray(value) ? value : String(value || '').split(/[\s,，/|·、:：-]+/))
        .map((token) => String(token || '').trim().toLowerCase())
        .filter((token) => token.length >= 2 && token.length <= 16)
        .slice(0, 12);
}

function renderEmptyCatalogRows(container) {
    container.querySelector('#grid-movie')?.render([], 'movie', HOME_POSTER_OPTS);
    container.querySelector('#grid-tv')?.render([], 'series', HOME_POSTER_OPTS);
    container.querySelector('#grid-anime')?.render([], 'series', HOME_POSTER_OPTS);
    container.querySelectorAll('.catalog-section').forEach((section) => {
        if (section.id !== 'continue-section') section.classList.add('home-catalog-muted');
    });
}

function renderHomeRecovery(container, { state, failures = [] } = {}) {
    const root = container.querySelector('#home-local-fallback');
    if (!root) return;

    const localSections = [
        {
            key: 'watch-later',
            title: '稍后看',
            hint: '网络恢复前也能先整理本地片单',
            href: '#/watch-later',
            type: 'movie',
            items: (watchLater.value || []).slice(0, 12),
        },
        {
            key: 'favorites',
            title: '我的收藏',
            hint: '从已收藏内容继续找片',
            href: '#/favorites',
            type: 'movie',
            items: (favorites.value || []).slice(0, 12),
        },
        {
            key: 'history',
            title: '观看历史',
            hint: '查看最近打开过的内容',
            href: '#/history',
            type: 'movie',
            items: getRecentHistory(12),
        },
    ].filter((section) => section.items.length > 0);

    const copy = state === 'offline'
        ? {
            title: '当前离线，首页推荐暂时不可用',
            hint: '本地记录仍可访问；网络恢复后会自动重新加载推荐和分类片库。',
        }
        : {
            title: '内容服务暂时不可用',
            hint: failures.length > 1 ? '多个栏目加载失败，可能是服务维护或网络波动。' : '推荐和分类片库加载失败，可以重试或先进入本地片单。',
        };

    root.innerHTML = `
        <section class="home-recovery-panel" aria-labelledby="home-recovery-title">
            <div class="home-recovery-copy">
                <h2 id="home-recovery-title">${esc(copy.title)}</h2>
                <p>${esc(copy.hint)}</p>
            </div>
            <div class="home-recovery-actions">
                <button class="home-recovery-primary" id="home-retry-main" type="button">重新加载</button>
                <button class="home-recovery-secondary" id="home-open-search" type="button">搜索内容</button>
                <a href="#/rankings" class="home-recovery-secondary">排行榜</a>
                <a href="#/history" class="home-recovery-secondary">观看历史</a>
            </div>
        </section>
        ${localSections.length ? localSections.map((section) => `
            <section class="catalog-section home-local-section">
                <div class="continue-head">
                    <div>
                        <h2 class="section-title">${esc(section.title)}</h2>
                        <div class="continue-count">${esc(section.hint)}</div>
                    </div>
                    <a class="continue-all" href="${esc(section.href)}">全部</a>
                </div>
                <poster-grid id="home-local-${esc(section.key)}"></poster-grid>
            </section>
        `).join('') : `
            <section class="home-local-empty">
                <h2>还没有本地片单</h2>
                <p>登录后收藏、稍后看和观看历史会在这里留作临时入口。现在可以先重试，或进入搜索页。</p>
            </section>
        `}
    `;

    root.querySelector('#home-retry-main')?.addEventListener('click', () => reloadRoute());
    root.querySelector('#home-open-search')?.addEventListener('click', async () => {
        const shell = document.querySelector('app-shell');
        if (!shell) return;
        const { openSearch } = await import('../components/app-search.js');
        openSearch(shell);
    });
    localSections.forEach((section) => {
        root.querySelector(`#home-local-${section.key}`)?.render(section.items, section.type, HOME_POSTER_OPTS);
    });
    const statusState = localSections.length
        ? (state === 'offline' ? 'offline-with-history' : 'failed-with-history')
        : (state === 'offline' ? 'offline-empty' : 'failed-empty');
    renderHomeStatus(container, statusState);
}

function renderHomeStatus(container, state) {
    const status = container.querySelector('#home-status');
    if (!status) return;
    const copy = {
        'offline-with-history': {
            title: '当前离线，已显示本地继续观看',
            hint: '影片推荐和分类片库会在网络恢复后重新加载。',
        },
        'failed-with-history': {
            title: '内容暂时加载失败，已保留继续观看',
            hint: '可以先接着看本地记录，稍后再重试刷新首页。',
        },
        'partial-offline': {
            title: '网络不稳定，部分栏目来自缓存',
            hint: '未加载出的栏目会在网络恢复后补齐。',
        },
        'partial-failed': {
            title: '部分栏目加载失败',
            hint: '已展示可用内容，重试后会继续补齐片库。',
        },
        'offline-empty': {
            title: '当前离线，暂时没有可展示的本地内容',
            hint: '可以稍后重试；登录后收藏、稍后看和历史会在离线时作为入口保留。',
        },
        'failed-empty': {
            title: '内容暂时加载失败',
            hint: '可以重试刷新首页，或先进入排行榜、历史和搜索入口。',
        },
    }[state];
    if (!copy) {
        status.innerHTML = '';
        return;
    }
    status.innerHTML = `
        <div class="page-error home-recoverable">
            <div>${esc(copy.title)}</div>
            <div class="page-error-hint">${esc(copy.hint)}</div>
            <button class="retry-btn" id="home-retry" type="button">重试</button>
        </div>
    `;
    status.querySelector('#home-retry')?.addEventListener('click', () => reloadRoute());
}

function isOfflineError(err) {
    return err?.offline || navigator.onLine === false;
}

function continueSectionHTML(items, signals = []) {
    if (!items.length && !signals.length) return '';
    const lead = continueLeadItem(items[0]);
    const countText = continueCountText(items.length, signals.length);
    return `
        <section class="catalog-section continue-section" id="continue-section">
            ${lead ? continueLeadHTML(lead) : ''}
            ${continueSignalsHTML(signals)}
            <div class="continue-head">
                <div>
                    <h2 class="section-title">继续看与追更</h2>
                    <div class="continue-count">${esc(countText)}</div>
                </div>
                <a class="continue-all" href="#/history">管理历史</a>
            </div>
            <poster-grid id="grid-continue"></poster-grid>
        </section>
    `;
}

function renderContinueSection(container, items, signals = container._homeContinueSignals || []) {
    const existing = container.querySelector('#continue-section');
    if (!items.length && !signals.length) {
        existing?.remove();
        return;
    }
    if (!existing) {
        container.querySelector('#home-hero')?.insertAdjacentHTML('afterend', continueSectionHTML(items, signals));
    } else {
        const count = existing.querySelector('.continue-count');
        if (count) count.textContent = continueCountText(items.length, signals.length);
        const lead = continueLeadItem(items[0]);
        const leadEl = existing.querySelector('.continue-lead');
        if (lead) {
            const html = continueLeadHTML(lead);
            if (leadEl) leadEl.outerHTML = html;
            else existing.insertAdjacentHTML('afterbegin', html);
        } else {
            leadEl?.remove();
        }
        const signalsHtml = continueSignalsHTML(signals);
        const signalsEl = existing.querySelector('.continue-signals');
        if (signalsHtml) {
            if (signalsEl) signalsEl.outerHTML = signalsHtml;
            else existing.querySelector('.continue-head')?.insertAdjacentHTML('beforebegin', signalsHtml);
        } else {
            signalsEl?.remove();
        }
    }
    container.querySelector('#grid-continue')?.render(items, items[0]?.type || 'movie', { ...HOME_POSTER_OPTS, removeLabel: '移除' });
    bindContinueRemove(container);
}

function continueCountText(historyCount, signalCount) {
    const parts = [];
    if (historyCount) parts.push(`${historyCount} 条续播`);
    if (signalCount) parts.push(`${signalCount} 条追更提醒`);
    return parts.length ? parts.join(' · ') : '从历史和片单快速接回';
}

function continueSignalsHTML(signals = []) {
    if (!signals.length) return '';
    return `
        <div class="continue-signals" aria-label="追更提醒">
            ${signals.slice(0, 5).map((item) => `
                <a class="continue-signal ${esc(item.tone || 'info')}" href="${esc(item.href || '#/subscriptions')}">
                    <span>${esc(item.kicker || '追更')}</span>
                    <strong>${esc(item.title || '')}</strong>
                    <small>${esc(item.detail || '')}</small>
                </a>
            `).join('')}
        </div>
    `;
}

function buildContinueSignals() {
    const watchLaterCount = (watchLater.value || []).length;
    return watchLaterCount > 0
        ? [{
            tone: 'later',
            kicker: '稍后看',
            title: `${watchLaterCount} 部内容待观看`,
            detail: '从已保存片单继续推进',
            href: '#/watch-later',
        }]
        : [];
}

function continueLeadItem(item) {
    if (!item) return null;
    const type = item.type === 'series' ? 'series' : 'movie';
    const id = item.id || '';
    const videoId = item.videoId || '';
    const progress = Number(item.progress) || 0;
    const duration = Number(item.duration) || 0;
    const explicitPercent = Math.min(100, Math.max(0, Math.round(Number(item.percent) || 0)));
    const hasResume = progress > 0 || explicitPercent > 0;
    const href = videoId
        ? `#/play/${type}/${id}/${videoId}`
        : (type === 'movie' && hasResume)
            ? `#/play/${type}/${id}`
            : `#/detail/${type}/${id}`;
    const percent = duration > 0
        ? Math.min(100, Math.max(0, Math.round((progress / duration) * 100)))
        : explicitPercent;
    return {
        href,
        type,
        name: item.name || '未命名内容',
        poster: item.poster || item.background || '',
        subtitle: item.subtitle || item.episodeLabel || item.episodeTitle || item.year || '',
        percent,
        progress,
        duration,
        watchedAt: item.watchedAt,
        playbackKey: item.playbackKey || item.id || '',
    };
}

function continueLeadHTML(item) {
    const meta = [
        item.type === 'series' ? '剧集' : '电影',
        item.subtitle,
        item.percent ? `续播中 ${item.percent}%` : '',
        formatWatchedTime(item.watchedAt),
    ].filter(Boolean).map((text) => `<span>${esc(String(text))}</span>`).join('');
    const time = formatProgressTime(item.progress, item.duration);
    const progressStyle = `width:${item.percent}%`;
    return `
        <div class="continue-lead">
            <a class="continue-lead-poster" href="${esc(item.href)}" aria-label="继续观看 ${esc(item.name)}">
                ${item.poster ? `<img src="${esc(item.poster)}" alt="${esc(item.name)}" loading="lazy" decoding="async">` : ''}
            </a>
            <div class="continue-lead-copy">
                <div class="continue-lead-kicker">接着上次观看</div>
                <h2 class="continue-lead-title">${esc(item.name)}</h2>
                <div class="continue-lead-meta">${meta}</div>
                <div class="continue-lead-progress" aria-label="观看进度 ${item.percent}%">
                    <span style="${progressStyle}"></span>
                </div>
                ${time ? `<div class="continue-lead-time">${esc(time)}</div>` : ''}
                <div class="continue-lead-actions">
                    <a class="continue-play" href="${esc(item.href)}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.74l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>
                        <span>继续播放</span>
                    </a>
                    <a class="continue-secondary" href="#/history">管理历史</a>
                    <button class="continue-remove" type="button" data-playback-key="${esc(item.playbackKey)}">移除记录</button>
                </div>
            </div>
        </div>
    `;
}

function bindContinueRemove(container) {
    const section = container.querySelector('#continue-section');
    if (!section) return;

    if (section.dataset.removeBound !== '1') {
        section.dataset.removeBound = '1';
        section.addEventListener('click', (event) => {
            const removeButton = event.target.closest('.continue-remove, [data-action="remove"]');
            if (!removeButton || !section.contains(removeButton)) return;
            event.preventDefault();
            event.stopPropagation();
            const card = removeButton.closest('.poster-item');
            const id = removeButton.dataset.playbackKey || card?.dataset.playbackKey || card?.dataset.id;
            removeContinueHistoryItem(id, container);
        });

        section.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const removeButton = event.target.closest('[data-action="remove"]');
            if (!removeButton || !section.contains(removeButton)) return;
            event.preventDefault();
            const card = removeButton.closest('.poster-item');
            removeContinueHistoryItem(card?.dataset.playbackKey || card?.dataset.id, container);
        });
    }

    section.querySelectorAll('.poster-item:not([data-continue-longpress])').forEach((item) => {
        item.dataset.continueLongpress = '1';
        onLongPress(item, () => removeContinueHistoryItem(item.dataset.playbackKey || item.dataset.id, container));
    });
}

function removeContinueHistoryItem(id, container) {
    if (!id) return;
    const removed = findHistoryItem(id);
    removeHistory(id);
    renderContinueSection(container, getContinueHistory(10), container._homeContinueSignals || []);
    if (!removed) return;
    showLibraryUndoToast('已从继续观看移除', () => {
        restoreHistoryItem(removed);
        renderContinueSection(container, getContinueHistory(10), container._homeContinueSignals || []);
    });
}

function findHistoryItem(id) {
    return history.value.find((item) => item.playbackKey === id || item.id === id) || null;
}

function formatProgressTime(progress, duration) {
    if (!progress || !duration) return '';
    const remain = Math.max(0, duration - progress);
    return `已观看 ${formatDuration(progress)} · 剩余约 ${formatDuration(remain)}`;
}

function formatDuration(seconds) {
    const mins = Math.max(0, Math.round(Number(seconds || 0) / 60));
    if (mins < 60) return `${mins} 分钟`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function formatWatchedTime(ts) {
    const value = Number(ts);
    if (!value) return '';
    const diff = Date.now() - value;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 172_800_000) return '昨天';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

async function hydrateFirstHeroItem(items) {
    if (!items.length) return items;
    const [first, ...rest] = items;
    const type = first.type === 'series' ? 'series' : 'movie';
    const meta = await getMeta(type, first.id).catch(() => null);
    if (!meta) return items;
    return [{ ...first, ...meta, type }, ...rest];
}

// 精选影片沉浸式轮播 Hero
async function renderHero(el, items) {
    if (!el || items.length === 0) { el?.remove(); return; }
    el.removeAttribute('aria-hidden');
    el.classList.remove('hero-loading');

    const slides = items.map((item) => {
        const type = item.type === 'series' ? 'series' : 'movie';
        const rawBg = item.background || item.poster || '';
        return {
            id: item.id,
            type: item.type === 'creator' ? 'creator' : type,
            name: item.name,
            bg: normalizeTmdbImageUrl(rawBg, 'w1280') || rawBg,
            logo: item.logo || '',
            desc: item.description || '',
            year: item.year || '',
            rating: item.imdbRating || '',
            href: item.href || '',
        };
    });

    el.innerHTML = `
        <div class="hero-slides">
            ${slides.map((s, i) => `
                <div class="hero-slide ${i === 0 ? 'active' : ''}" data-i="${i}">
                    <div class="hero-bg"><img src="${esc(s.bg)}" alt="" decoding="async" ${i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}></div>
                    <div class="hero-content">
                        ${s.logo
                            ? `<img class="hero-logo" src="${esc(s.logo)}" alt="${esc(s.name)}">`
                            : `<h1 class="hero-title">${esc(s.name)}</h1>`}
                        <div class="hero-meta">
                            ${s.year ? `<span>${esc(String(s.year))}</span>` : ''}
                            ${s.rating ? `<span class="hero-rating">★ ${esc(String(s.rating))}</span>` : ''}
                            <span class="hero-type">${s.type === 'creator' ? '创作' : s.type === 'series' ? '剧集' : '电影'}</span>
                        </div>
                        ${s.desc ? `<p class="hero-desc">${esc(s.desc)}</p>` : ''}
                        <button class="hero-play" data-id="${esc(s.id)}" data-type="${s.type}" data-href="${esc(s.href || '')}">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.74l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>
                            <span>立即观看</span>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
        ${slides.length > 1 ? `<div class="hero-dots">${slides.map((_, i) => `<button class="hero-dot ${i === 0 ? 'active' : ''}" data-i="${i}" aria-label="第${i + 1}个"></button>`).join('')}</div>` : ''}
    `;

    // 首图淡入（CDN 404 回退 Worker；最终失败也标记 loaded，避免卡在透明导致首屏空白）
    bindTmdbImagesIn(el);
    el.querySelectorAll('.hero-logo').forEach((logo) => {
        bindTmdbImageFallback(logo, () => { logo.style.display = 'none'; });
    });
    const firstImg = el.querySelector('.hero-slide.active .hero-bg img');
    if (firstImg) {
        markHeroImageReady(firstImg);
    }

    // 点击播放 → 进详情
    el.querySelectorAll('.hero-play').forEach((btn) => {
        btn.addEventListener('click', () => navigate(btn.dataset.href || `#/detail/${btn.dataset.type}/${btn.dataset.id}`));
    });

    idle(() => enrichHero(el, slides), 1600);

    if (slides.length <= 1) return;

    // 轮播逻辑
    const slideEls = [...el.querySelectorAll('.hero-slide')];
    const dotEls = [...el.querySelectorAll('.hero-dot')];
    let cur = 0;
    let timer = null;

    const goTo = (i) => {
        if (i === cur) return;
        slideEls[cur].classList.remove('active');
        dotEls[cur].classList.remove('active');
        cur = i;
        slideEls[cur].classList.add('active');
        dotEls[cur].classList.add('active');
        // 懒加载当前图并淡入（失败也标记 loaded，避免卡透明）
        const img = slideEls[cur].querySelector('.hero-bg img');
        if (img && !img.classList.contains('loaded')) {
            markHeroImageReady(img);
        }
    };
    const next = () => goTo((cur + 1) % slideEls.length);
    const start = () => { stop(); timer = setInterval(next, 6000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    dotEls.forEach((dot, i) => {
        dot.addEventListener('click', () => { goTo(i); start(); });
    });
    // 鼠标悬停暂停轮播
    el.addEventListener('mouseenter', stop);
    el.addEventListener('mouseleave', start);
    // 触屏：手指触摸时暂停，松开后恢复（避免阅读简介时被切走）
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchend', start, { passive: true });

    // 触屏左右滑动切换 Hero（横向滑动达阈值时切上/下一张）
    let swipeX = 0, swipeY = 0, swiping = false;
    el.addEventListener('touchstart', (e) => {
        const tp = e.touches[0];
        swipeX = tp.clientX; swipeY = tp.clientY; swiping = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const tp = e.changedTouches[0];
        const dx = tp.clientX - swipeX;
        const dy = tp.clientY - swipeY;
        // 横向位移足够大且明显大于纵向（排除竖向滚动）才触发
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            goTo(dx < 0 ? (cur + 1) % slideEls.length : (cur - 1 + slideEls.length) % slideEls.length);
            start();
        }
    }, { passive: true });

    start();

    // 页面离开时清理定时器（用 IntersectionObserver 检测移出视口也停）
    el._heroStop = stop;
}

async function enrichHero(el, slides) {
    if (!el?.isConnected) return;
    await Promise.all(slides.map(async (slide, i) => {
        const meta = await getMeta(slide.type, slide.id).catch(() => null);
        if (!meta || !el.isConnected) return;
        const slideEl = el.querySelector(`.hero-slide[data-i="${i}"]`);
        if (slideEl?.classList.contains('active')) return;
        const bg = meta.background || meta.poster;
        if (bg) {
            const img = slideEl?.querySelector('.hero-bg img');
            if (img && img.getAttribute('src') !== bg) {
                await preloadHeroImage(bg);
                if (!el.isConnected) return;
                if (slideEl?.classList.contains('active')) return;
                img.src = bg;
                img.classList.add('loaded');
            }
        }
        const logo = meta.logo;
        const title = slideEl?.querySelector('.hero-title');
        if (logo && title) {
            const img = Object.assign(document.createElement('img'), {
                className: 'hero-logo',
                src: logo,
                alt: slide.name,
            });
            bindTmdbImageFallback(img, () => { img.style.display = 'none'; });
            title.replaceWith(img);
        }
        const desc = meta.description;
        const content = slideEl?.querySelector('.hero-content');
        if (desc && content && !content.querySelector('.hero-desc')) {
            const p = document.createElement('p');
            p.className = 'hero-desc';
            p.textContent = desc;
            const play = content.querySelector('.hero-play');
            content.insertBefore(p, play);
        }
    }));
}

function preloadHeroImage(src) {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = async () => {
            try {
                if (image.decode) await image.decode();
            } catch {}
            resolve();
        };
        image.onerror = () => resolve();
        image.src = src;
    });
}

async function markHeroImageReady(img) {
    if (!img) return;
    try {
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        }
        if (img.decode && img.naturalWidth > 0) await img.decode();
    } catch {}
    img.classList.add('loaded');
}

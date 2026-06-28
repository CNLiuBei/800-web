import { user } from './auth.js';
import { API_V1_BASE } from './config.js';
import { reportEngagementEvent } from './engagement-analytics.js';

const GUEST_REF_KEY = 'gy_guest_referral_code';
const VISITOR_ID_KEY = 'gy_referral_visitor_id';
const LANDING_KEY = 'gy_referral_landing_seen';
const LANDING_CONTEXT_KEY = 'gy_referral_landing_context';
const SHARE_STATS_KEY = 'gy_community_share_stats';
const SHARE_SOURCE = 'community_share';
const LANDING_CONTEXT_TTL = 7 * 24 * 60 * 60 * 1000;
const SHARE_DEDUPE_TTL = 5 * 60 * 1000;

export function buildCommunityShareUrl(hashPath, meta = {}) {
    const url = new URL(hashPath, location.href);
    const hash = url.hash || hashPath;
    const [path, query = ''] = String(hash).replace(/^#/, '').split('?');
    const params = new URLSearchParams(query);
    params.set('src', SHARE_SOURCE);
    params.set('ref', referralCode());
    if (meta.tmdbId) params.set('tmdbId', String(meta.tmdbId));
    if (meta.mediaType) params.set('mediaType', String(meta.mediaType));
    if (meta.movieId) params.set('mid', String(meta.movieId));
    url.hash = `${path}?${params.toString()}`;
    return url.href;
}

export function communityShareText({ title, description } = {}) {
    const name = String(title || '这部片').trim();
    const desc = String(description || '').replace(/\s+/g, ' ').trim();
    const hook = desc ? `我刚发现《${name}》：${desc}` : `我刚发现《${name}》，一起看看？`;
    return `${hook}\n\n点开后可以试看、收藏或接着讨论。`;
}

export function recordCommunityShare(channel = 'copy', payload = {}) {
    try {
        const stats = getCommunityGrowthStats();
        const now = Date.now();
        const dedupeKey = shareDedupeKey(channel, payload);
        const recentShares = pruneRecentShares(stats.recentShares, now);
        const lastCountedAt = Number(recentShares[dedupeKey] || 0);
        const dedupeMs = Math.max(1000, Number(payload.dedupeMs || SHARE_DEDUPE_TTL));
        if (lastCountedAt && now - lastCountedAt < dedupeMs) {
            reportReferralShare(channel, payload);
            return { ...stats, recentShares, duplicate: true };
        }
        recentShares[dedupeKey] = now;
        const next = {
            ...stats,
            lastShareAt: now,
            channels: {
                ...stats.channels,
                [channel]: (stats.channels?.[channel] || 0) + 1,
            },
            recentShares,
        };
        localStorage.setItem(SHARE_STATS_KEY, JSON.stringify(next));
        if (payload.report !== false) reportShareEvent(channel, payload, next);
        reportReferralShare(channel, payload);
        return next;
    } catch {
        const stats = getCommunityGrowthStats();
        if (payload.report !== false) reportShareEvent(channel, payload, stats);
        reportReferralShare(channel, payload);
        return stats;
    }
}

export function getCommunityGrowthStats() {
    try {
        const raw = localStorage.getItem(SHARE_STATS_KEY);
        const stats = raw ? JSON.parse(raw) : {};
        return {
            referralCode: referralCode(),
            shareCount: Math.max(0, Number(stats.shareCount || 0)),
            lastShareAt: Number(stats.lastShareAt || 0),
            channels: stats.channels && typeof stats.channels === 'object' ? stats.channels : {},
            recentShares: stats.recentShares && typeof stats.recentShares === 'object' ? stats.recentShares : {},
        };
    } catch {
        return {
            referralCode: referralCode(),
            shareCount: 0,
            lastShareAt: 0,
            channels: {},
            recentShares: {},
        };
    }
}

export function getReferralChallenge(stats = getCommunityGrowthStats()) {
    const count = Math.max(0, Number(stats.shareCount || 0));
    const tiers = [
        { target: 1, label: '发出第一张邀请', reward: '点亮社区身份' },
        { target: 3, label: '形成小圈层回流', reward: '解锁高分片单优先推荐' },
        { target: 7, label: '带动稳定讨论', reward: '进入核心影迷成长档' },
    ];
    const nextTier = tiers.find((tier) => count < tier.target) || tiers[tiers.length - 1];
    const previousTarget = tiers.slice().reverse().find((tier) => count >= tier.target)?.target || 0;
    const nextTarget = nextTier.target;
    const span = Math.max(1, nextTarget - previousTarget);
    const progress = count >= nextTarget ? 1 : Math.max(0, Math.min(1, (count - previousTarget) / span));
    const remaining = Math.max(0, nextTarget - count);
    return {
        count,
        nextTarget,
        remaining,
        progress,
        label: nextTier.label,
        reward: nextTier.reward,
        status: remaining > 0 ? `还差 ${remaining} 次邀请` : '本阶段已达成',
    };
}

export function getReferralLandingContext() {
    try {
        const raw = localStorage.getItem(LANDING_CONTEXT_KEY);
        const context = raw ? JSON.parse(raw) : null;
        if (!context?.ref || !context?.landedAt) return null;
        if (Date.now() - Number(context.landedAt) > LANDING_CONTEXT_TTL) {
            localStorage.removeItem(LANDING_CONTEXT_KEY);
            return null;
        }
        return {
            ref: String(context.ref || ''),
            source: String(context.source || SHARE_SOURCE),
            contentId: String(context.contentId || ''),
            movieId: Number(context.movieId) || undefined,
            tmdbId: Number(context.tmdbId) || undefined,
            mediaType: context.mediaType === 'movie' || context.mediaType === 'tv' ? context.mediaType : undefined,
            contentType: context.contentType || undefined,
            hash: String(context.hash || '#/'),
            landedAt: Number(context.landedAt),
            acceptedAt: Number(context.acceptedAt || 0),
            dismissedAt: Number(context.dismissedAt || 0),
        };
    } catch {
        return null;
    }
}

export function markReferralLandingAccepted(source = 'landing_banner') {
    const context = getReferralLandingContext();
    if (!context) return null;
    const next = { ...context, acceptedAt: Date.now(), dismissedAt: 0 };
    saveReferralLandingContext(next);
    reportEngagementEvent('referral_accept', {
        contentId: context.contentId || 'gy:referral-accept',
        movieId: context.movieId,
        tmdbId: context.tmdbId,
        mediaType: context.mediaType,
        contentType: context.contentType,
        source,
        targetId: context.ref,
        actionState: 'success',
        label: 'referral accepted',
    });
    return next;
}

export function dismissReferralLandingContext(source = 'landing_banner') {
    const context = getReferralLandingContext();
    if (!context) return null;
    const next = { ...context, dismissedAt: Date.now() };
    saveReferralLandingContext(next);
    reportEngagementEvent('referral_dismiss', {
        contentId: context.contentId || 'gy:referral-dismiss',
        movieId: context.movieId,
        tmdbId: context.tmdbId,
        mediaType: context.mediaType,
        contentType: context.contentType,
        source,
        targetId: context.ref,
        actionState: 'off',
        label: 'referral dismissed',
    });
    return next;
}

export function initCommunityGrowthTracking() {
    trackLandingFromLocation();
    refreshReferralStats();
    window.addEventListener('hashchange', trackLandingFromLocation);
}

function trackLandingFromLocation() {
    const params = currentHashParams();
    const source = params.get('src') || params.get('utm_source') || '';
    const ref = params.get('ref') || '';
    if (source !== SHARE_SOURCE || !ref) return;
    const contentId = contentIdFromHash();
    const key = `${source}:${ref}:${contentId || 'home'}`;
    const context = {
        ref,
        source,
        contentId: contentId || 'gy:home',
        movieId: Number(params.get('mid')) || undefined,
        tmdbId: Number(params.get('tmdbId')) || undefined,
        mediaType: mediaTypeFromParam(params.get('mediaType')),
        contentType: contentTypeFromHash(),
        hash: location.hash || '#/',
        landedAt: Date.now(),
        acceptedAt: 0,
        dismissedAt: 0,
    };
    saveReferralLandingContext(context);
    recordReferralLanding(context);
    if (seenLanding(key)) return;
    markLandingSeen(key);
    reportEngagementEvent('referral_landing', {
        contentId: context.contentId || 'gy:landing',
        movieId: Number(params.get('mid')) || undefined,
        tmdbId: Number(params.get('tmdbId')) || undefined,
        mediaType: mediaTypeFromParam(params.get('mediaType')),
        contentType: contentTypeFromHash(),
        source,
        targetId: ref,
        label: 'community referral landing',
    });
}

function saveReferralLandingContext(context) {
    try {
        localStorage.setItem(LANDING_CONTEXT_KEY, JSON.stringify(context));
    } catch {}
}

function reportShareEvent(channel, payload, stats) {
    reportEngagementEvent('share', {
        contentId: payload.contentId || 'gy:community-growth',
        movieId: Number(payload.movieId) || undefined,
        tmdbId: Number(payload.tmdbId) || undefined,
        mediaType: mediaTypeFromParam(payload.mediaType),
        contentType: payload.contentType,
        source: SHARE_SOURCE,
        targetId: stats.referralCode,
        value: Math.max(1, Number(stats.shareCount || 1)),
        label: `community share:${channel}`,
    });
}

async function recordReferralLanding(context) {
    try {
        const data = await referralApi('/analytics/referral-landing', {
            ref: context.ref,
            visitorId: referralVisitorId(),
            contentId: context.contentId,
            movieId: context.movieId,
            tmdbId: context.tmdbId,
            mediaType: context.mediaType,
            contentType: context.contentType,
            source: context.source,
        });
        if (data && typeof data.total === 'number') {
            mergeCommunityShareCount(data.total);
        }
    } catch {}
}

function reportReferralShare(channel, payload = {}) {
    const ref = referralCode();
    referralApi('/analytics/referral-share', {
        ref,
        visitorId: referralVisitorId(),
        contentId: payload.contentId || 'gy:community-growth',
        movieId: payload.movieId,
        tmdbId: payload.tmdbId,
        mediaType: mediaTypeFromParam(payload.mediaType),
        contentType: payload.contentType,
        source: channel,
    }).catch(() => {});
}

export async function refreshReferralStats() {
    const ref = referralCode();
    try {
        const data = await referralApi(`/analytics/referral-stats?ref=${encodeURIComponent(ref)}`, null, { method: 'GET' });
        if (data && typeof data.shareCount === 'number') mergeCommunityShareCount(data.shareCount);
    } catch {}
}

async function referralApi(path, body, options = {}) {
    const urls = [`${API_V1_BASE}${path}`];
    for (const url of urls) {
        const res = await fetch(url, {
            method: options.method || 'POST',
            credentials: 'include',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            keepalive: true,
        });
        if (res.status === 404 && url !== urls[urls.length - 1]) continue;
        if (!res.ok) return null;
        return await res.json().catch(() => null);
    }
    return null;
}

function mergeCommunityShareCount(count) {
    try {
        const stats = getCommunityGrowthStats();
        const shareCount = Math.max(stats.shareCount || 0, Math.max(0, Number(count) || 0));
        const next = { ...stats, shareCount };
        localStorage.setItem(SHARE_STATS_KEY, JSON.stringify(next));
        if (shareCount !== stats.shareCount && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('communitygrowth:stats', { detail: { shareCount } }));
        }
    } catch {}
}

function shareDedupeKey(channel, payload = {}) {
    const tmdbTarget = payload.tmdbId && payload.mediaType ? `tmdb:${payload.mediaType}:${payload.tmdbId}` : '';
    const legacyTarget = payload.movieId ? `gy:movie:${payload.movieId}` : '';
    const target = payload.shareUrl || payload.url || payload.targetId || tmdbTarget || payload.contentId || legacyTarget || 'community';
    const channelFallback = target === 'community' ? channel : '';
    return stableMetricToken(`share:${target}:${payload.contentType || ''}:${channelFallback}`);
}

function pruneRecentShares(recentShares = {}, now = Date.now()) {
    const next = {};
    for (const [key, value] of Object.entries(recentShares || {})) {
        const timestamp = Number(value || 0);
        if (timestamp && now - timestamp <= SHARE_DEDUPE_TTL * 4) next[key] = timestamp;
    }
    return next;
}

function stableMetricToken(value) {
    return String(value || '')
        .replace(/[^A-Za-z0-9._:-]/g, '-')
        .slice(0, 180) || 'share:community';
}

function currentHashParams() {
    const query = String(location.hash || '').split('?')[1] || '';
    return new URLSearchParams(query);
}

function contentIdFromHash() {
    const match = String(location.hash || '').match(/^#\/(?:detail|play)\/(?:movie|series|anime)\/([^/?#]+)/);
    return match?.[1] || '';
}

function contentTypeFromHash() {
    const match = String(location.hash || '').match(/^#\/(?:detail|play)\/(movie|series|anime)\//);
    return match?.[1] || undefined;
}

function mediaTypeFromParam(value) {
    return value === 'movie' || value === 'tv' ? value : undefined;
}

function referralCode() {
    const accountKey = user.value?.id || user.value?.userId || user.value?.email || '';
    if (accountKey) return `u_${shortHash(accountKey)}`;
    return guestReferralCode();
}

function referralVisitorId() {
    try {
        const existing = localStorage.getItem(VISITOR_ID_KEY);
        if (existing && /^[A-Za-z0-9_-]{12,80}$/.test(existing)) return existing;
        const id = `v_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
        localStorage.setItem(VISITOR_ID_KEY, id);
        return id;
    } catch {
        return `v_${shortHash(`${navigator.userAgent || 'web'}:${Math.random()}`)}`;
    }
}

function guestReferralCode() {
    try {
        const existing = localStorage.getItem(GUEST_REF_KEY);
        if (existing) return existing;
        const code = `g_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        localStorage.setItem(GUEST_REF_KEY, code);
        return code;
    } catch {
        return `g_${Math.random().toString(36).slice(2, 14)}`;
    }
}

function seenLanding(key) {
    try {
        const raw = sessionStorage.getItem(LANDING_KEY);
        const seen = raw ? JSON.parse(raw) : [];
        return Array.isArray(seen) && seen.includes(key);
    } catch {
        return false;
    }
}

function markLandingSeen(key) {
    try {
        const raw = sessionStorage.getItem(LANDING_KEY);
        const seen = raw ? JSON.parse(raw) : [];
        const next = Array.isArray(seen) ? [...seen, key].slice(-50) : [key];
        sessionStorage.setItem(LANDING_KEY, JSON.stringify(next));
    } catch {}
}

function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

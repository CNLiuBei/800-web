import { API_V1_BASE } from './config.js';

const SESSION_KEY = 'gy_engagement_session_id';
const CLIENT = isStandalonePwa() ? 'pwa' : 'web';

const EVENT_TYPES = new Set([
    'detail_view',
    'play_click',
    'favorite',
    'watch_later',
    'share',
    'discussion',
    'similar_click',
    'recommendation_impression',
    'recommendation_click',
    'decision_impression',
    'decision_click',
    'referral_landing',
    'referral_accept',
    'referral_dismiss',
    'notification_click',
    'short_like',
    'short_skip',
    'short_not_interested',
    'short_follow_click',
]);

let sessionId = null;

export function reportEngagementEvent(eventType, payload = {}) {
    const body = buildPayload(eventType, payload);
    if (!body) return;

    const json = JSON.stringify(body);
    const sent = tryBeacon('/analytics/engagement', json);
    if (sent) return;

    apiFetch('/analytics/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
    }).catch(() => {});
}

function buildPayload(eventType, payload) {
    if (!EVENT_TYPES.has(eventType)) return null;
    const contentId = stringValue(payload.contentId || payload.id, 160);
    const movieId = positiveInt(payload.movieId);
    const tmdbId = positiveInt(payload.tmdbId);
    const normalizedMediaType = mediaType(payload.mediaType);
    if (!contentId && !movieId && !(tmdbId && normalizedMediaType)) return null;
    return {
        eventType,
        contentId,
        movieId,
        tmdbId,
        mediaType: normalizedMediaType,
        contentType: contentType(payload.contentType || payload.type),
        actionState: actionState(payload.actionState),
        targetId: stringValue(payload.targetId, 160),
        targetType: targetType(payload.targetType),
        source: stringValue(payload.source, 80),
        value: boundedNumber(payload.value, 0, 100000),
        label: stringValue(payload.label, 160),
        sessionId: getSessionId(),
        client: CLIENT,
    };
}

function mediaType(value) {
    return value === 'movie' || value === 'tv' ? value : undefined;
}

function tryBeacon(path, json) {
    if (!navigator.sendBeacon) return false;
    try {
        const blob = new Blob([json], { type: 'application/json' });
        return navigator.sendBeacon(`${API_V1_BASE}${path}`, blob);
    } catch {
        return false;
    }
}

async function apiFetch(path, options = {}) {
    const urls = [`${API_V1_BASE}${path}`];

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

function getSessionId() {
    if (sessionId) return sessionId;
    try {
        sessionId = localStorage.getItem(SESSION_KEY);
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            localStorage.setItem(SESSION_KEY, sessionId);
        }
    } catch {
        sessionId = crypto.randomUUID();
    }
    return sessionId;
}

function isStandalonePwa() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function contentType(value) {
    return ['movie', 'series', 'anime', 'short', 'creator', 'live'].includes(value) ? value : undefined;
}

function targetType(value) {
    return ['movie', 'series', 'creator', 'channel'].includes(value) ? value : undefined;
}

function actionState(value) {
    return ['on', 'off', 'open', 'success', 'failed'].includes(value) ? value : undefined;
}

function positiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function boundedNumber(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.min(max, Math.max(min, Number(parsed.toFixed(2))));
}

function stringValue(value, max) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
}

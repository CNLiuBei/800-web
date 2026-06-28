import { API_V1_BASE } from './config.js';

const SESSION_KEY = 'gy_playback_session_id';
const CLIENT = isStandalonePwa() ? 'pwa' : 'web';

let sessionId = null;

export function reportPlaybackEvent(eventType, payload = {}) {
    const body = buildPayload(eventType, payload);
    if (!body) return;

    const json = JSON.stringify(body);
    const sent = tryBeacon('/analytics/playback', json);
    if (sent) return;

    apiFetch('/analytics/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
    }).catch(() => {});
}

function buildPayload(eventType, payload) {
    if (!['start', 'progress', 'complete', 'error', 'quality_change'].includes(eventType)) return null;
    const movieId = positiveInt(payload.movieId);
    const tmdbId = positiveInt(payload.tmdbId);
    const normalizedMediaType = mediaType(payload.mediaType);
    if (!payload.videoId && !movieId && !(tmdbId && normalizedMediaType)) return null;
    return {
        eventType,
        videoId: payload.videoId || undefined,
        movieId,
        tmdbId,
        mediaType: normalizedMediaType,
        episodeId: positiveInt(payload.episodeId),
        position: boundedInt(payload.position, 0, 86400),
        duration: boundedInt(payload.duration, 0, 86400),
        percent: boundedNumber(payload.percent, 0, 100),
        errorCode: stringValue(payload.errorCode, 80),
        errorMessage: stringValue(payload.errorMessage, 300),
        sourceLabel: stringValue(payload.sourceLabel, 120),
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

function positiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function boundedInt(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
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

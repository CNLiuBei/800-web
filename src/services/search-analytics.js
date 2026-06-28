import { API_V1_BASE } from './config.js';

const SESSION_KEY = 'gy_search_session_id';
const CLIENT = isStandalonePwa() ? 'pwa' : 'web';

let sessionId = null;

export function reportSearchEvent(eventType, payload = {}) {
    const body = buildPayload(eventType, payload);
    if (!body) return;

    const json = JSON.stringify(body);
    const sent = tryBeacon('/analytics/search', json);
    if (sent) return;

    apiFetch('/analytics/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
    }).catch(() => {});
}

function buildPayload(eventType, payload) {
    if (!['search', 'click'].includes(eventType)) return null;
    const query = stringValue(payload.query, 120);
    if (!query || query.length < 2) return null;
    const targetId = stringValue(payload.targetId, 160);
    if (eventType === 'click' && !targetId) return null;
    return {
        eventType,
        query,
        filter: searchFilter(payload.filter),
        resultCount: boundedInt(payload.resultCount, 0, 10000),
        failedCount: boundedInt(payload.failedCount, 0, 20),
        success: payload.success === false ? false : true,
        targetId,
        targetType: targetType(payload.targetType),
        position: boundedInt(payload.position, 0, 10000),
        sessionId: getSessionId(),
        client: CLIENT,
    };
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

function searchFilter(value) {
    return ['all', 'movie', 'tv', 'anime'].includes(value) ? value : 'all';
}

function targetType(value) {
    return ['movie', 'series'].includes(value) ? value : undefined;
}

function boundedInt(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function stringValue(value, max) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
}

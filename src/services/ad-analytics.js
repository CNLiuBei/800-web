import { API_V1_BASE } from './config.js';

const SESSION_KEY = 'gy_ad_session_id';
const CLIENT = isStandalonePwa() ? 'pwa' : 'web';
const EVENT_TYPES = new Set(['impression', 'complete', 'click']);
const PLACEMENTS = new Set(['pre_roll', 'pause', 'feed']);

let sessionId = null;

export async function getAdDecision(payload = {}) {
    const uploadId = creatorUploadId(payload.uploadId || payload.videoId || payload.analyticsVideoId);
    const placement = PLACEMENTS.has(payload.placement) ? payload.placement : 'pre_roll';
    if (!uploadId) return null;

    const params = new URLSearchParams({ uploadId, placement, sessionId: getSessionId() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const response = await apiFetch(`/ads/decision?${params}`, {
        method: 'GET',
        keepalive: false,
        signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timer);
    if (!response?.ok) return null;
    const data = await response.json().catch(() => null);
    return data?.ok && data.fill ? data : null;
}

export function reportAdEvent(eventType, payload = {}) {
    const body = buildPayload(eventType, payload);
    if (!body) return;

    const json = JSON.stringify(body);
    const sent = tryBeacon('/analytics/ad-impression', json);
    if (sent) return;

    apiFetch('/analytics/ad-impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
    }).catch(() => {});
}

function buildPayload(eventType, payload) {
    if (!EVENT_TYPES.has(eventType)) return null;
    const uploadId = creatorUploadId(payload.uploadId || payload.videoId || payload.analyticsVideoId);
    const campaignId = stringValue(payload.campaignId, 80);
    if (!uploadId) return null;
    if (!campaignId) return null;
    return {
        uploadId,
        campaignId,
        placement: PLACEMENTS.has(payload.placement) ? payload.placement : 'pre_roll',
        eventType,
        sessionId: getSessionId(),
        client: stringValue(payload.client, 40) || CLIENT,
        adDecisionId: stringValue(payload.adDecisionId, 80),
        impressionToken: stringValue(payload.impressionToken, 2048),
    };
}

function creatorUploadId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('gy:creator:')) return trimmed.slice('gy:creator:'.length);
    if (trimmed.startsWith('creator:')) return trimmed.slice('creator:'.length);
    return trimmed;
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

function stringValue(value, max) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
}

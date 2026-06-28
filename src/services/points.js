// 积分服务
// GET  /api/v1/me/points
// GET  /api/v1/me/points/ledger
// POST /api/v1/points/checkin
// POST /api/v1/points/redeem/vip-days
// GET  /api/v1/points/rules

import { signal } from '../core/signal.js';
import { user } from './auth.js';
import { API_V1_BASE } from './config.js';

const REQUEST_TIMEOUT_MS = 12000;

export const pointsAccount = signal(null);
export const pointsRules = signal(null);
export const pointsTasks = signal(null);

async function request(path, { needAuth = false, timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
    const init = { ...options };
    if (needAuth) init.credentials = 'include';
    if (options.body) init.headers = { 'Content-Type': 'application/json', ...options.headers };
    const controller = typeof AbortController !== 'undefined' && !init.signal ? new AbortController() : null;
    let timer = null;
    if (controller) {
        init.signal = controller.signal;
        timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
        const res = await fetch(`${API_V1_BASE}${path}`, init);
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        if (!res.ok) {
            const err = new Error(data?.message || `HTTP ${res.status}`);
            err.status = res.status;
            err.code = data?.code || '';
            throw err;
        }
        return data;
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error('请求超时，请检查网络后重试');
        }
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function fetchPointsRules() {
    try {
        const data = await request('/points/rules', { needAuth: false });
        pointsRules.value = data;
        return data;
    } catch {
        pointsRules.value = null;
        return null;
    }
}

export async function fetchPointsAccount() {
    if (!user.value) {
        pointsAccount.value = null;
        pointsTasks.value = null;
        return null;
    }
    try {
        const data = await request('/me/points', { needAuth: true });
        pointsAccount.value = data;
        pointsTasks.value = data?.tasks || null;
        return data;
    } catch {
        pointsAccount.value = null;
        pointsTasks.value = null;
        return null;
    }
}

export async function fetchPointsLedger(page = 1, limit = 20) {
    const data = await request(`/me/points/ledger?page=${page}&limit=${limit}`, { needAuth: true });
    return data;
}

export async function checkinPoints() {
    return request('/points/checkin', { needAuth: true, method: 'POST' });
}

export async function redeemVipDaysWithPoints(days) {
    return request('/points/redeem/vip-days', {
        needAuth: true,
        method: 'POST',
        body: JSON.stringify({ days }),
    });
}

export async function fetchPointsTasks() {
    if (!user.value) {
        pointsTasks.value = null;
        return null;
    }
    try {
        const data = await request('/me/points/tasks', { needAuth: true });
        pointsTasks.value = data;
        return data;
    } catch {
        pointsTasks.value = null;
        return null;
    }
}

export function formatPoints(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('zh-CN');
}

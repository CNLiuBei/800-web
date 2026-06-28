// 播放权限与每日观影时长（/api/v1/me/permissions、/api/v1/me/watch-time）

import { signal } from '../core/signal.js';
import { API_V1_BASE } from './config.js';
import { user } from './auth.js';

export const playbackPermission = signal(null);

export async function fetchPlaybackPermission() {
    try {
        const res = await fetch(`${API_V1_BASE}/me/permissions`, { credentials: 'include' });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message || '权限加载失败');
        playbackPermission.value = data;
        return data;
    } catch {
        playbackPermission.value = null;
        return null;
    }
}

export async function reportWatchTime(seconds) {
    if (!user.value) return null;
    const safeSeconds = Math.min(300, Math.max(1, Math.floor(Number(seconds) || 0)));
    if (!safeSeconds) return null;

    const res = await fetch(`${API_V1_BASE}/me/watch-time`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: safeSeconds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.message || '观看时长上报失败');
        err.exceeded = res.status === 403 || data?.exceeded === true;
        throw err;
    }

    if (playbackPermission.value && typeof data?.remaining === 'number') {
        const permission = playbackPermission.value;
        playbackPermission.value = {
            ...permission,
            dailyRemainingSeconds: data.remaining,
            dailyWatchedSeconds: permission.dailyLimitSeconds > 0
                ? Math.max(0, permission.dailyLimitSeconds - data.remaining)
                : permission.dailyWatchedSeconds,
        };
    }
    return data;
}

export function permissionQuotaText(permission = playbackPermission.value) {
    if (!permission) return '';
    if (!permission.canPlay) return '当前账号暂不可播放';
    if (permission.dailyLimitSeconds <= 0 || permission.dailyRemainingSeconds < 0) {
        return '今日观影：不限时长';
    }
    const remaining = Math.max(0, Number(permission.dailyRemainingSeconds) || 0);
    const minutes = Math.ceil(remaining / 60);
    return `今日剩余观影约 ${minutes} 分钟`;
}

export function canPlayContent(permission = playbackPermission.value) {
    if (!permission) return true;
    if (!permission.canPlay) return false;
    if (permission.dailyLimitSeconds <= 0 || permission.dailyRemainingSeconds < 0) return true;
    return Number(permission.dailyRemainingSeconds) > 0;
}

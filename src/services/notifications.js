// 全站消息中心：列表、已读、轮询与轻提示

import { signal } from '../core/signal.js';
import { user } from './auth.js';
import { API_V1_BASE } from './config.js';
import { showSiteNotice } from './site-notice.js';

export const notificationSummary = signal({
    items: [],
    unreadCount: 0,
    loaded: false,
    loading: false,
    error: null,
    page: 1,
    hasMore: false,
});

export const notificationPreferences = signal({
    mutedTypes: [],
    loaded: false,
    loading: false,
});

let loadPromise = null;
let pollTimer = null;
let pollStarted = false;
let pollIntervalMs = 90000;

export async function loadNotifications({
    force = false,
    unreadOnly = false,
    type = '',
    silent = false,
    page = 1,
    append = false,
} = {}) {
    if (loadPromise && !force && !append) return loadPromise;
    const previous = notificationSummary.value;
    if (!silent) {
        notificationSummary.value = { ...previous, loading: true, error: null };
    }
    const params = new URLSearchParams();
    if (unreadOnly) params.set('unreadOnly', 'true');
    if (type) params.set('type', type);
    params.set('page', String(page));
    params.set('limit', '30');
    const query = params.toString();
    loadPromise = fetch(`${API_V1_BASE}/me/notifications${query ? `?${query}` : ''}`, { credentials: 'include' })
        .then(async (res) => {
            if (res.status === 401) {
                const next = emptyNotificationState({ unauthorized: true });
                notificationSummary.value = next;
                return next;
            }
            if (!res.ok) throw new Error('消息提醒加载失败');
            const data = await res.json();
            const incoming = Array.isArray(data.items) ? data.items : [];
            const next = {
                items: append ? mergeNotificationItems(previous.items, incoming) : incoming,
                unreadCount: Number(data.unreadCount || 0),
                loaded: true,
                loading: false,
                error: null,
                page: Number(data.page || page) || 1,
                hasMore: Boolean(data.hasMore),
            };
            notificationSummary.value = next;
            if (silent && previous.loaded) {
                announceNewNotifications(previous, next);
            }
            return next;
        })
        .catch((error) => {
            notificationSummary.value = {
                ...notificationSummary.value,
                loaded: notificationSummary.value.loaded || silent,
                loading: false,
                error: silent ? notificationSummary.value.error : error,
            };
            throw error;
        })
        .finally(() => {
            loadPromise = null;
        });
    return loadPromise;
}

function mergeNotificationItems(existing, incoming) {
    const seen = new Set((existing || []).map((item) => Number(item.id)));
    const merged = [...(existing || [])];
    for (const item of incoming) {
        const id = Number(item.id);
        if (!seen.has(id)) {
            seen.add(id);
            merged.push(item);
        }
    }
    return merged;
}

export async function fetchNotificationPreferences({ force = false } = {}) {
    if (!user.value) {
        notificationPreferences.value = { mutedTypes: [], loaded: true, loading: false };
        return notificationPreferences.value;
    }
    if (notificationPreferences.value.loaded && !force) return notificationPreferences.value;
    notificationPreferences.value = { ...notificationPreferences.value, loading: true };
    try {
        const res = await fetch(`${API_V1_BASE}/me/notification-preferences`, { credentials: 'include' });
        if (!res.ok) throw new Error('偏好加载失败');
        const data = await res.json();
        const next = {
            mutedTypes: Array.isArray(data.mutedTypes) ? data.mutedTypes : [],
            loaded: true,
            loading: false,
        };
        notificationPreferences.value = next;
        return next;
    } catch {
        notificationPreferences.value = { mutedTypes: [], loaded: true, loading: false };
        return notificationPreferences.value;
    }
}

export async function updateNotificationPreferences(mutedTypes) {
    const res = await fetch(`${API_V1_BASE}/me/notification-preferences`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutedTypes }),
    });
    if (!res.ok) throw new Error('偏好保存失败');
    const data = await res.json();
    const next = {
        mutedTypes: Array.isArray(data.mutedTypes) ? data.mutedTypes : [],
        loaded: true,
        loading: false,
    };
    notificationPreferences.value = next;
    return next;
}

export function setNotificationPollInterval(intervalMs) {
    pollIntervalMs = Math.max(30000, Number(intervalMs) || 90000);
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = window.setInterval(tickNotifications, pollIntervalMs);
    }
}

function tickNotifications() {
    if (document.hidden || !user.value) return;
    loadNotifications({ force: true, silent: true }).catch(() => {});
}

export function startNotificationPolling({ intervalMs = 90000 } = {}) {
    if (pollStarted || typeof window === 'undefined') return;
    pollStarted = true;
    pollIntervalMs = intervalMs;
    pollTimer = window.setInterval(tickNotifications, pollIntervalMs);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tickNotifications();
    });
}

function announceNewNotifications(previous, next) {
    const muted = new Set(notificationPreferences.value?.mutedTypes || []);
    const prevIds = new Set((previous.items || []).map((item) => Number(item.id)));
    const freshUnread = (next.items || []).filter((item) => (
        isUnread(item)
        && !prevIds.has(Number(item.id))
        && !muted.has(item.type)
    ));
    const unreadIncreased = Number(next.unreadCount || 0) > Number(previous.unreadCount || 0);
    if (!freshUnread.length && !unreadIncreased) return;

    const item = freshUnread[0] || (next.items || []).find((entry) => isUnread(entry) && !muted.has(entry.type));
    if (!item) return;

    const href = safeNotificationHref(item.link);
    showSiteNotice(item.content || item.title || '你有新消息', {
        title: notificationTypeText(item.type),
        subtitle: item.content ? item.title : '',
        tone: 'info',
        duration: 5200,
        multiline: Boolean(item.content && item.title),
        action: href ? { label: '查看', href } : null,
    });
}

export async function markNotificationsRead({ all = false, ids = [] } = {}) {
    const cleanIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
    if (!all && cleanIds.length === 0) return notificationSummary.value;
    const res = await fetch(`${API_V1_BASE}/me/notifications`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? { all: true } : { ids: cleanIds }),
    });
    if (res.status === 401) {
        const next = emptyNotificationState({ unauthorized: true });
        notificationSummary.value = next;
        return next;
    }
    if (!res.ok) throw new Error('标记已读失败');
    const idSet = new Set(cleanIds);
    const current = notificationSummary.value;
    const items = current.items.map((item) => (
        all || idSet.has(Number(item.id)) ? { ...item, read: true } : item
    ));
    const unreadCount = all
        ? 0
        : items.reduce((total, item) => total + (isUnread(item) ? 1 : 0), 0);
    const next = { ...current, items, unreadCount, loaded: true, error: null };
    notificationSummary.value = next;
    return next;
}

export function isUnread(item) {
    return Number(item?.read) === 0 || item?.read === false;
}

function emptyNotificationState(extra = {}) {
    return {
        items: [],
        unreadCount: 0,
        loaded: true,
        loading: false,
        error: null,
        page: 1,
        hasMore: false,
        ...extra,
    };
}

export function notificationTypeText(type) {
    switch (type) {
    case 'creator_live':
        return '直播开播';
    case 'creator_broadcast':
        return '创作者广播';
    case 'creator_upload':
        return '关注更新';
    case 'movie':
        return '片库提醒';
    case 'watchlist':
        return '片单提醒';
    case 'movie_request':
        return '求片进度';
    case 'vip':
        return '会员提醒';
    case 'points':
        return '积分';
    case 'order':
        return '订单';
    case 'system':
    default:
        return '系统通知';
    }
}

export function safeNotificationHref(link) {
    const value = String(link || '').trim();
    if (!value) return '#/account?section=notifications';
    if (/^#\/[A-Za-z0-9/_:?.=&%~+-]*$/.test(value)) return value;
    if (/^\/#[A-Za-z0-9/_:?.=&%~+-]*$/.test(value)) return value.slice(1);
    if (/^https?:\/\//i.test(value)) return value;
    return '#/account?section=notifications';
}

export function isExternalNotificationHref(link) {
    return /^https?:\/\//i.test(String(link || '').trim());
}

export function notificationTypeClass(type) {
    const safe = String(type || 'system').replace(/[^a-z0-9_-]/gi, '');
    return safe || 'system';
}

export const NOTIFICATION_MUTE_OPTIONS = [
    { type: 'points', label: '积分' },
    { type: 'vip', label: '会员' },
    { type: 'movie_request', label: '求片' },
    { type: 'creator_upload', label: '创作' },
    { type: 'creator_live', label: '直播' },
    { type: 'system', label: '系统' },
];

export function notificationEmptyHint(filter = {}) {
    if (filter.unreadOnly) {
        return {
            title: '没有未读消息',
            body: '当前筛选下所有消息都已读过',
            href: '',
            action: '',
        };
    }
    switch (filter.type) {
    case 'points':
        return { title: '暂无积分消息', body: '签到、任务奖励与兑换结果会出现在这里', href: '#/account?section=points', action: '去积分中心' };
    case 'vip':
    case 'order':
        return { title: '暂无会员消息', body: '开通、续费与到期提醒会出现在这里', href: '#/vip', action: '查看 VIP' };
    case 'movie_request':
        return { title: '暂无求片消息', body: '提交求片后，处理结果会在这里通知你', href: '#/requests?tab=mine', action: '我的求片' };
    case 'creator_upload':
    case 'creator_live':
    case 'creator_broadcast':
        return { title: '暂无创作动态', body: '关注创作者后，新作品与直播开播会提醒你', href: '#/catalog', action: '去发现创作者' };
    default:
        return { title: '暂无消息通知', body: '系统提醒、积分变动与关注动态都会集中在这里', href: '#/catalog', action: '去逛逛' };
    }
}

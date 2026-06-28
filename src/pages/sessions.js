// 登录设备 / 会话管理 —— 列出所有登录会话，可单独撤销或一键登出其他设备

import { user, loading, initAuth, listSessions, getCurrentSession, revokeSession, revokeOtherSessions, waitForAuthReady } from '../services/auth.js';
import { esc, loadCSS } from '../core/html.js';
import { navigate } from '../core/router.js';
import { showSiteNotice } from '../services/site-notice.js';

let loadRequestId = 0;
const SESSION_LOAD_TIMEOUT_MS = 8000;

export async function render(container) {
    loadCSS('styles/account.css?v=account-clean-layout');

    if (!user.value && loading.value) {
        container.innerHTML = '<div class="page-loading">加载中...</div>';
        initAuth().catch(() => {});
        await waitForAuthReady();
    }

    if (!user.value) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                </div>
                <div class="empty-title">登录后查看登录设备</div>
                <button class="empty-cta" id="sess-login">登录 / 注册</button>
            </div>
        `;
        container.querySelector('#sess-login')?.addEventListener('click', async () => {
            const v = window.GY_WEB_STATIC_VERSION || '1';
            const { openAuthModal } = await import(`../services/auth-modal-loader.js?v=${v}`);
            openAuthModal('login');
        });
        return;
    }

    container.innerHTML = `
        <div class="account-page">
            <header class="account-header session-page-header">
                <div>
                    <button class="session-back" id="sessions-back" type="button" aria-label="返回个人中心">${iconBack()}</button>
                    <h1 class="account-h1">登录设备</h1>
                    <p class="account-subtitle">查看当前账号已登录的浏览器和设备，发现异常时可立即登出。</p>
                </div>
            </header>
            <section class="account-card">
                <div class="account-card-head session-toolbar">
                    <div>
                        <h2 class="account-card-title">活跃会话</h2>
                        <p class="account-card-desc" id="sessions-summary">正在同步登录状态...</p>
                    </div>
                    <div class="session-toolbar-actions">
                        <button class="account-secondary-btn session-refresh" id="sessions-refresh" type="button">刷新</button>
                        <button class="account-secondary-btn session-revoke-others" id="revoke-others" type="button">登出其他设备</button>
                    </div>
                </div>
                <div class="account-msg hidden" id="sessions-msg"></div>
                <div class="account-sessions" id="sessions-list">
                    <div class="account-orders-loading">加载中...</div>
                </div>
            </section>
        </div>
    `;

    container.querySelector('#sessions-back')?.addEventListener('click', () => navigate('#/account'));
    await loadSessions(container);

    container.querySelector('#sessions-refresh')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '刷新中...';
        setMessage(container, '');
        await loadSessions(container);
        btn.disabled = false;
        btn.textContent = '刷新';
    });

    container.querySelector('#revoke-others')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!confirm('确定登出其他所有设备？当前设备会保留登录。')) return;
        btn.disabled = true;
        btn.textContent = '处理中...';
        setMessage(container, '');
        const result = await revokeOtherSessions();
        btn.disabled = false;
        btn.textContent = '登出其他设备';
        if (!result.success) {
            setMessage(container, result.error || '操作失败，请稍后重试', 'err');
            return;
        }
        setMessage(container, result.revoked > 0 ? `已登出 ${result.revoked} 个其他设备` : '没有需要登出的其他设备', 'ok');
        await loadSessions(container);
    });
}

async function loadSessions(container) {
    const requestId = ++loadRequestId;
    const list = container.querySelector('#sessions-list');
    if (!list) return;

    list.innerHTML = '<div class="account-orders-loading">加载中...</div>';
    setSummary(container, '正在同步登录状态...');

    let sessions;
    let currentSession;
    try {
        [sessions, currentSession] = await withTimeout(
            Promise.all([listSessions(), getCurrentSession()]),
            SESSION_LOAD_TIMEOUT_MS,
            '会话同步超时'
        );
    } catch (error) {
        if (requestId !== loadRequestId) return;
        list.innerHTML = `
            <div class="account-orders-empty session-load-failed">
                ${esc(error?.message === '会话同步超时' ? '同步时间较长，请重试或稍后再看' : '会话加载失败，请稍后重试')}
                <button class="account-secondary-btn" id="sessions-inline-retry" type="button">重试</button>
            </div>
        `;
        list.querySelector('#sessions-inline-retry')?.addEventListener('click', () => loadSessions(container));
        setSummary(container, error?.message === '会话同步超时' ? '同步登录设备超时' : '暂时无法读取登录设备');
        setMessage(container, error?.message === '会话同步超时' ? '登录设备同步较慢，已停止等待，可立即重试。' : '网络或登录状态异常，刷新后可重试。', 'err');
        return;
    }
    if (requestId !== loadRequestId) return;

    const rawSessions = sessions.map(normalizeSession).filter((session) => session.id || session.fingerprint);
    const normalized = dedupeSessions(rawSessions);
    const current = currentSession ? normalizeSession(currentSession) : null;
    const currentId = current?.id || null;

    if (normalized.length === 0) {
        list.innerHTML = '<div class="account-orders-empty">暂无会话信息</div>';
        setSummary(container, '当前没有可显示的登录会话');
        return;
    }

    // 无法确定当前会话时，禁用「登出其他设备」，避免误把自己登出
    const othersBtn = container.querySelector('#revoke-others');
    if (othersBtn) othersBtn.disabled = !currentId;

    // 当前设备排在最前
    normalized.sort((a, b) => Number(isCurrentSession(b, current)) - Number(isCurrentSession(a, current)));
    const otherCount = normalized.filter((session) => !isCurrentSession(session, current)).length;
    const duplicateCount = Math.max(0, rawSessions.length - normalized.length);
    const duplicateText = duplicateCount ? `，已合并 ${duplicateCount} 个重复会话` : '';
    setSummary(container, `${normalized.length} 个登录设备，${otherCount} 个其他设备${duplicateText} · ${formatSyncTime()}`);

    const sessionIdMap = new Map();

    list.innerHTML = normalized.map((s, index) => {
        const isCurrent = isCurrentSession(s, current);
        // 无法确定当前会话时，隐藏所有单独登出按钮，避免误登出自己。
        const sessionIds = Array.isArray(s.ids) ? s.ids : [s.id].filter(Boolean);
        const canRevoke = !!currentId && !isCurrent && sessionIds.length > 0;
        if (canRevoke) sessionIdMap.set(String(index), sessionIds);
        const dev = parseUA(s.userAgent || '');
        const created = s.createdAt ? formatTime(s.createdAt) : '未知时间';
        const expires = s.expiresAt ? ` · 到期 ${formatTime(s.expiresAt)}` : '';
        const duplicates = Number(s.duplicateCount || 1) > 1 ? ` · 合并 ${Number(s.duplicateCount) - 1} 个重复会话` : '';
        return `
            <div class="session-item">
                <div class="session-icon">${dev.icon}</div>
                <div class="session-info">
                    <div class="session-dev"><span>${esc(dev.name)}</span>${isCurrent ? '<span class="session-current">本设备</span>' : ''}</div>
                    <div class="session-meta">${esc(s.ipAddress || '未知 IP')} · 最近登录 ${esc(created)}${esc(expires)}${esc(duplicates)}</div>
                </div>
                ${canRevoke ? `<button class="session-revoke" data-session-key="${index}">登出</button>` : ''}
            </div>
        `;
    }).join('');

    list.querySelectorAll('.session-revoke').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const sessionIds = sessionIdMap.get(btn.dataset.sessionKey);
            if (!sessionIds?.length) return;
            btn.disabled = true;
            btn.textContent = '...';
            setMessage(container, '');
            const results = [];
            for (const sessionId of sessionIds) {
                results.push(await revokeSession(sessionId));
            }
            const failed = results.find((result) => !result.success);
            if (failed) {
                btn.disabled = false;
                btn.textContent = '登出';
                setMessage(container, failed.error || '操作失败，请稍后重试', 'err');
                return;
            }
            setMessage(container, sessionIds.length > 1 ? `已登出该设备的 ${sessionIds.length} 个会话` : '已登出该设备', 'ok');
            await loadSessions(container);
        });
    });
}

function withTimeout(promise, timeoutMs, message = '请求超时') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

function normalizeSession(raw = {}) {
    const source = raw.session && typeof raw.session === 'object' ? raw.session : raw;
    const id = source.id || raw.id || '';
    const userAgent = source.userAgent || raw.userAgent || '';
    const ipAddress = source.ipAddress || raw.ipAddress || '';
    const createdAt = source.createdAt || raw.createdAt || '';
    const expiresAt = source.expiresAt || raw.expiresAt || '';
    return {
        id,
        userAgent,
        ipAddress,
        createdAt,
        expiresAt,
        current: Boolean(source.current || raw.current),
        fingerprint: [userAgent, ipAddress, createdAt, expiresAt].map((value) => String(value || '')).join('|'),
    };
}

function dedupeSessions(sessions) {
    const byKey = new Map();
    sessions.forEach((session) => {
        const key = sessionGroupKey(session);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, withGroupMeta(session));
            return;
        }
        const merged = mergeSessionGroup(existing, session);
        if (existing.current && !session.current) {
            byKey.set(key, merged);
        } else if (session.current || newerSession(session, merged)) {
            byKey.set(key, { ...session, current: merged.current, ids: merged.ids, duplicateCount: merged.duplicateCount });
        } else {
            byKey.set(key, merged);
        }
    });
    return Array.from(byKey.values());
}

function sessionGroupKey(session) {
    const device = [session.userAgent, session.ipAddress]
        .map((value) => String(value || '').trim().toLowerCase())
        .join('|');
    if (device.replace('|', '')) return `device:${device}`;
    return session.id ? `id:${session.id}` : `fp:${session.fingerprint}`;
}

function withGroupMeta(session) {
    return {
        ...session,
        ids: session.id ? [session.id] : [],
        duplicateCount: 1,
    };
}

function mergeSessionGroup(existing, session) {
    const ids = new Set(existing.ids || []);
    if (session.id) ids.add(session.id);
    return {
        ...existing,
        current: existing.current || session.current,
        ids: Array.from(ids),
        duplicateCount: Number(existing.duplicateCount || 1) + 1,
    };
}

function newerSession(a, b) {
    const at = new Date(a.createdAt || 0).getTime();
    const bt = new Date(b.createdAt || 0).getTime();
    return Number.isFinite(at) && at > bt;
}

function isCurrentSession(session, currentSession) {
    if (session?.current) return true;
    if (!currentSession) return false;
    if (session?.id && session.id === currentSession.id) return true;
    return Array.isArray(session?.ids) && session.ids.includes(currentSession.id);
}

function setSummary(container, text) {
    const summary = container.querySelector('#sessions-summary');
    if (summary) summary.textContent = text;
}

function setMessage(container, text, type = '') {
    const msg = container.querySelector('#sessions-msg');
    if (msg) {
        msg.textContent = '';
        msg.className = 'account-msg hidden';
    }
    if (!text) return;
    showSiteNotice(text, {
        id: 'sessions-notice',
        tone: type === 'err' ? 'error' : type === 'ok' ? 'success' : 'info',
    });
}

// 极简 UA 解析：识别常见平台/浏览器，给出名称与图标
function parseUA(ua) {
    const u = ua.toLowerCase();
    const phone = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>';
    const laptop = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>';

    let os = '未知设备';
    if (u.includes('iphone')) os = 'iPhone';
    else if (u.includes('ipad')) os = 'iPad';
    else if (u.includes('android')) os = 'Android 设备';
    else if (u.includes('mac os') || u.includes('macintosh')) os = 'Mac';
    else if (u.includes('windows')) os = 'Windows';
    else if (u.includes('linux')) os = 'Linux';
    else if (u.includes('curl')) os = '命令行';

    let browser = '';
    if (u.includes('edg/')) browser = 'Edge';
    else if (u.includes('chrome')) browser = 'Chrome';
    else if (u.includes('firefox')) browser = 'Firefox';
    else if (u.includes('safari')) browser = 'Safari';

    const isMobile = u.includes('iphone') || u.includes('android') || u.includes('ipad');
    const name = browser ? `${os} · ${browser}` : os;
    return { name, icon: isMobile ? phone : laptop };
}

function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatSyncTime(date = new Date()) {
    return `同步于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function iconBack() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
}

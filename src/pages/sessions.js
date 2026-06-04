// 登录设备 / 会话管理 —— 列出所有登录会话，可单独撤销或一键登出其他设备

import { user, loading, initAuth, listSessions, getCurrentSessionToken, revokeSession, revokeOtherSessions } from '../services/auth.js';
import { esc, loadCSS } from '../core/html.js';

export async function render(container) {
    loadCSS('styles/account.css');

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
            const { default: AuthModal } = await import('../components/auth-modal.js');
            AuthModal.open('login');
        });
        return;
    }

    container.innerHTML = `
        <div class="account-page">
            <h1 class="account-h1">登录设备</h1>
            <section class="account-card">
                <div class="account-sessions" id="sessions-list">
                    <div class="account-orders-loading">加载中...</div>
                </div>
            </section>
            <button class="account-signout" id="revoke-others">登出其他所有设备</button>
        </div>
    `;

    await loadSessions(container);

    container.querySelector('#revoke-others')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!confirm('确定登出其他所有设备？')) return;
        btn.disabled = true;
        btn.textContent = '处理中...';
        await revokeOtherSessions();
        btn.disabled = false;
        btn.textContent = '登出其他所有设备';
        await loadSessions(container);
    });
}

function waitForAuthReady(timeoutMs = 8000) {
    if (!loading.value) return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; unsub?.(); clearTimeout(timer); resolve(); };
        const unsub = loading.subscribe?.(() => { if (!loading.value) finish(); });
        const timer = setTimeout(finish, timeoutMs);
    });
}

async function loadSessions(container) {
    const list = container.querySelector('#sessions-list');
    if (!list) return;

    const [sessions, currentToken] = await Promise.all([listSessions(), getCurrentSessionToken()]);

    if (sessions.length === 0) {
        list.innerHTML = '<div class="account-orders-empty">暂无会话信息</div>';
        return;
    }

    // 无法确定当前会话时，禁用「登出其他设备」，避免误把自己登出
    const othersBtn = container.querySelector('#revoke-others');
    if (othersBtn) othersBtn.disabled = !currentToken;

    // 当前设备排在最前
    sessions.sort((a, b) => (b.token === currentToken ? 1 : 0) - (a.token === currentToken ? 1 : 0));

    list.innerHTML = sessions.map((s) => {
        const isCurrent = s.token === currentToken;
        // 无法确定当前会话时，隐藏所有单独登出按钮，避免误登出自己
        const canRevoke = !!currentToken && !isCurrent;
        const dev = parseUA(s.userAgent || '');
        const time = s.createdAt ? formatTime(s.createdAt) : '';
        return `
            <div class="session-item">
                <div class="session-icon">${dev.icon}</div>
                <div class="session-info">
                    <div class="session-dev">${esc(dev.name)}${isCurrent ? '<span class="session-current">本设备</span>' : ''}</div>
                    <div class="session-meta">${esc(s.ipAddress || '未知 IP')} · ${esc(time)}</div>
                </div>
                ${canRevoke ? `<button class="session-revoke" data-token="${esc(s.token)}">登出</button>` : ''}
            </div>
        `;
    }).join('');

    list.querySelectorAll('.session-revoke').forEach((btn) => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '...';
            await revokeSession(btn.dataset.token);
            await loadSessions(container);
        });
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

// 用户中心 —— 账号信息 / 个人资料 / 安全设置 / 退出

import { user, loading, initAuth, changePassword, updateProfile, deleteAccount, signOut } from '../services/auth.js';
import { checkVipStatus, vipStatus, hasVipAccess, daysUntilExpire } from '../services/vip.js';
import { canShowInstallEntry, triggerInstall } from '../services/pwa-install.js';
import { esc, loadCSS } from '../core/html.js';
import { navigate } from '../core/router.js';
import { API_BASE } from '../services/config.js';
import { clearPersistentCache } from '../services/api.js';

export async function render(container) {
    loadCSS('styles/account.css');

    // 认证仍在初始化（首次进入/刷新时 /get-session 未返回）：先显示加载态，
    // 等认证完成再判断登录态，避免误显示「未登录」造成闪烁/误判。
    if (!user.value && loading.value) {
        container.innerHTML = '<div class="page-loading">加载中...</div>';
        initAuth().catch(() => {});
        await waitForAuthReady();
    }

    // 未登录：引导登录
    if (!user.value) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div class="empty-title">登录后查看个人中心</div>
                <button class="empty-cta" id="account-login">登录 / 注册</button>
            </div>
        `;
        container.querySelector('#account-login')?.addEventListener('click', async () => {
            const { default: AuthModal } = await import('../components/auth-modal.js');
            AuthModal.open('login');
        });
        return;
    }

    const u = user.value;
    const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    const avatarHtml = u.image
        ? `<img class="account-avatar-img" src="${esc(u.image)}" alt="${esc(u.name || '头像')}">`
        : esc(initial);

    // 立即渲染：用 vipStatus 当前缓存值给初始展示（可能为 null），
    // 注册时间优先用 session user 自带的 createdAt 首屏直出，避免异步填充导致页面下移抖动；
    // 最新 VIP 状态在页面渲染后再异步拉取并更新对应元素。
    const badge0 = computeVipBadge();
    const createdText0 = formatCreatedAt(u.createdAt);

    container.innerHTML = `
        <div class="account-page">
            <header class="account-header">
                <div>
                    <h1 class="account-h1">个人中心</h1>
                    <p class="account-subtitle">管理资料、安全设置和会员记录</p>
                </div>
                <a href="#/vip" class="account-upgrade ${badge0.showUpgrade ? '' : 'hidden'}" id="account-upgrade">${badge0.upgradeText}</a>
            </header>

            <div class="account-layout">
                <aside class="account-sidebar">
                    <section class="account-card account-overview">
                        <div class="account-profile-kicker">账号资料</div>
                        <div class="account-avatar">${avatarHtml}</div>
                        <div class="account-overview-info">
                            <div class="account-name">${esc(u.name || '用户')}</div>
                            <div class="account-email">${esc(u.email || '')}</div>
                            <span class="account-badge ${badge0.vipClass}" id="account-badge">${badge0.text}</span>
                            <div class="account-created${createdText0 ? '' : ' is-placeholder'}" id="account-created">${createdText0 || ''}</div>
                        </div>
                    </section>

                    <button class="account-signout" id="account-signout">退出登录</button>
                </aside>

                <main class="account-main">
                    <section class="account-card">
                        <div class="account-card-head">
                            <div>
                                <h2 class="account-card-title">常用入口</h2>
                                <p class="account-card-desc">快速进入收藏、历史、设备和会员页面。</p>
                            </div>
                        </div>
                        <nav class="account-links" aria-label="个人中心快捷入口">
                            <a href="#/favorites" class="account-link">
                                <span class="account-link-icon" aria-hidden="true">${iconStar()}</span>
                                <span class="account-link-copy">
                                    <span class="account-link-title">我的收藏</span>
                                    <span class="account-link-desc">继续追看已收藏内容</span>
                                </span>
                                <span class="account-link-arrow" aria-hidden="true">${iconChevronRight()}</span>
                            </a>
                            <a href="#/history" class="account-link">
                                <span class="account-link-icon" aria-hidden="true">${iconHistory()}</span>
                                <span class="account-link-copy">
                                    <span class="account-link-title">观看历史</span>
                                    <span class="account-link-desc">回到最近播放进度</span>
                                </span>
                                <span class="account-link-arrow" aria-hidden="true">${iconChevronRight()}</span>
                            </a>
                            <a href="#/account/sessions" class="account-link">
                                <span class="account-link-icon" aria-hidden="true">${iconDevice()}</span>
                                <span class="account-link-copy">
                                    <span class="account-link-title">登录设备</span>
                                    <span class="account-link-desc">管理当前登录会话</span>
                                </span>
                                <span class="account-link-arrow" aria-hidden="true">${iconChevronRight()}</span>
                            </a>
                            <a href="#/vip" class="account-link">
                                <span class="account-link-icon" aria-hidden="true">${iconDiamond()}</span>
                                <span class="account-link-copy">
                                    <span class="account-link-title">VIP 会员</span>
                                    <span class="account-link-desc">查看权益与续费状态</span>
                                </span>
                                <span class="account-link-arrow" aria-hidden="true">${iconChevronRight()}</span>
                            </a>
                        </nav>
                    </section>

                    <section class="account-card">
                        <div class="account-card-head">
                            <div>
                                <h2 class="account-card-title">个人资料</h2>
                                <p class="account-card-desc">设置展示昵称，用于评论和账号菜单显示。</p>
                            </div>
                        </div>
                        <form class="account-form" id="profile-form">
                            <label class="account-field">
                                <span class="account-label">昵称</span>
                                <input class="account-input" id="profile-name" type="text" value="${esc(u.name || '')}" maxlength="40" required>
                            </label>
                            <div class="account-msg hidden" id="profile-msg"></div>
                            <button type="submit" class="account-btn" id="profile-submit">保存昵称</button>
                        </form>
                    </section>

                    <section class="account-card">
                        <div class="account-card-head">
                            <div>
                                <h2 class="account-card-title">安全设置</h2>
                                <p class="account-card-desc">修改密码后，其他设备会重新验证登录状态。</p>
                            </div>
                        </div>
                        <form class="account-form account-password-form" id="password-form">
                            <label class="account-field">
                                <span class="account-label">当前密码</span>
                                <input class="account-input" id="cur-password" type="password" autocomplete="current-password" required>
                            </label>
                            <label class="account-field">
                                <span class="account-label">新密码</span>
                                <input class="account-input" id="new-password" type="password" autocomplete="new-password" minlength="6" required>
                            </label>
                            <label class="account-field">
                                <span class="account-label">确认新密码</span>
                                <input class="account-input" id="confirm-password" type="password" autocomplete="new-password" minlength="6" required>
                            </label>
                            <div class="account-msg hidden" id="password-msg"></div>
                            <button type="submit" class="account-btn" id="password-submit">修改密码</button>
                        </form>
                    </section>

                    ${canShowInstallEntry() ? `
                    <section class="account-card account-install" id="account-install-card">
                        <div class="account-install-info">
                            <h2 class="account-card-title">添加到主屏幕</h2>
                            <p class="account-card-desc">把 800影视 添加到主屏，全屏沉浸观影，秒开免打扰。</p>
                        </div>
                        <button class="account-btn" id="account-install-btn">添加</button>
                    </section>
                    ` : ''}

                    <section class="account-card account-maintenance">
                        <div>
                            <h2 class="account-card-title">本地缓存</h2>
                            <p class="account-card-desc">清理片库与详情缓存，不会删除收藏、历史或账号信息。</p>
                            <div class="account-msg hidden" id="cache-msg"></div>
                        </div>
                        <button class="account-secondary-btn" id="clear-cache" type="button">清理缓存</button>
                    </section>

                    <section class="account-card" id="orders-card">
                        <div class="account-card-head">
                            <div>
                                <h2 class="account-card-title">消费记录</h2>
                                <p class="account-card-desc">查看最近的会员开通和续费记录。</p>
                            </div>
                        </div>
                        <div class="account-orders" id="orders-list">
                            <div class="account-orders-loading">加载中...</div>
                        </div>
                    </section>

                    <section class="account-card account-danger">
                        <div>
                            <h2 class="account-card-title">注销账号</h2>
                            <p class="account-danger-tip">注销后账号将无法登录，收藏与待办将被清除，此操作不可恢复。</p>
                        </div>
                        <button class="account-danger-btn" id="account-delete">注销账号</button>
                    </section>
                </main>
            </div>
        </div>
    `;

    bindProfileForm(container);
    bindPasswordForm(container);
    bindCacheAction(container);
    loadOrders(container);
    refreshOverview(container); // 渲染后异步拉取最新 VIP 状态与注册时间，更新概览

    container.querySelector('#account-signout')?.addEventListener('click', async () => {
        await signOut();
        navigate('#/');
    });

    container.querySelector('#account-delete')?.addEventListener('click', () => {
        openDeleteDialog(container);
    });

    // 添加到主屏入口
    container.querySelector('#account-install-btn')?.addEventListener('click', async () => {
        const result = await triggerInstall();
        if (result === 'ios') {
            alert('请点击浏览器底部的「分享」按钮，选择「添加到主屏幕」即可安装。');
        } else if (result === 'installed') {
            container.querySelector('#account-install-card')?.remove();
        }
    });
}

function iconStar() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.2 2.66 5.5 6.04.86-4.38 4.22 1.05 5.98L12 16.92l-5.37 2.84 1.05-5.98-4.38-4.22 6.04-.86L12 3.2Z"/></svg>';
}

function iconHistory() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.35-5.65L4 8"/><path d="M4 4v4h4"/><path d="M12 7v5l3 2"/></svg>';
}

function iconDevice() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="12" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';
}

function iconDiamond() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 3.8 9.1 12 21l8.2-11.9L12 3Zm0 3.2 3 3.3h-6l3-3.3Z"/></svg>';
}

function iconChevronRight() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
}

function bindCacheAction(container) {
    const btn = container.querySelector('#clear-cache');
    const msg = container.querySelector('#cache-msg');
    if (!btn || !msg) return;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '清理中...';
        const cleared = await clearPersistentCache();
        btn.disabled = false;
        btn.textContent = '清理缓存';
        showMsg(msg, cleared ? '本地缓存已清理' : '内存缓存已清理', true);
    });
}

// 显示表单内联消息（成功/错误）
function showMsg(el, text, ok) {
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('err', !ok);
}

// 根据当前 vipStatus 缓存值计算概览徽章文案/样式/开通按钮
function computeVipBadge() {
    const isVip = hasVipAccess();
    const role = vipStatus.value?.role;
    const expireAt = vipStatus.value?.expireAt;
    let text;
    if (role === 'admin') text = '管理员';
    else if (isVip) text = `VIP 会员 · 剩余 ${daysUntilExpire()} 天`;
    else if (role === 'vip' && expireAt) text = 'VIP 已过期';
    else if (!vipStatus.value) text = '会员中心'; // 状态未拉取时的中性占位
    else text = '普通用户';
    return {
        text,
        vipClass: (isVip || role === 'admin') ? 'vip' : '',
        showUpgrade: role !== 'admin' && !isVip,
        upgradeText: (role === 'vip' && expireAt) ? '续费 VIP' : '开通 VIP',
    };
}

// 格式化注册时间为「注册于 YYY/M/D」。无效或缺失返回空串。
function formatCreatedAt(createdAt) {
    if (!createdAt) return '';
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return `注册于 ${d.toLocaleDateString('zh-CN')}`;
}

// 渲染后异步拉取最新 VIP 状态与注册时间，更新概览区（不阻塞首屏渲染）
async function refreshOverview(container) {
    const [meRes] = await Promise.all([
        fetch(`${API_BASE}/me`, { credentials: 'include' }).catch(() => null),
        checkVipStatus().catch(() => {}),
    ]);

    // 更新徽章与开通按钮
    const badge = computeVipBadge();
    const badgeEl = container.querySelector('#account-badge');
    if (badgeEl) { badgeEl.textContent = badge.text; badgeEl.className = `account-badge ${badge.vipClass}`; }
    const upgradeEl = container.querySelector('#account-upgrade');
    if (upgradeEl) {
        upgradeEl.textContent = badge.upgradeText;
        upgradeEl.classList.toggle('hidden', !badge.showUpgrade);
    }

    // 更新注册时间（首屏已用 session.createdAt 直出占位高度，这里仅在拿到 /me 值时校正文本，
    // 元素始终占位，不再有显示/隐藏导致的布局位移）
    try {
        if (meRes && meRes.ok) {
            const me = await meRes.json();
            const text = formatCreatedAt(me.createdAt);
            if (text) {
                const el = container.querySelector('#account-created');
                if (el) { el.textContent = text; el.classList.remove('is-placeholder'); }
            }
        }
    } catch {}
}

// 等待认证初始化完成（loading 由 true 变 false）。带超时兜底，避免异常时永久等待。
function waitForAuthReady(timeoutMs = 8000) {
    if (!loading.value) return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; unsub?.(); clearTimeout(timer); resolve(); };
        const unsub = loading.subscribe?.(() => { if (!loading.value) finish(); });
        const timer = setTimeout(finish, timeoutMs);
    });
}

// 订单状态文案与样式
const ORDER_STATUS = {
    paid: { text: '已支付', cls: 'ok' },
    pending: { text: '待支付', cls: 'pending' },
    expired: { text: '已过期', cls: 'expired' },
};

// 加载消费记录（GET /me/orders）
async function loadOrders(container) {
    const list = container.querySelector('#orders-list');
    if (!list) return;
    try {
        const res = await fetch(`${API_BASE}/me/orders`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const items = data.items || [];
        if (items.length === 0) {
            list.innerHTML = '<div class="account-orders-empty">暂无消费记录</div>';
            return;
        }
        list.innerHTML = items.map((o) => {
            const st = ORDER_STATUS[o.status] || { text: esc(o.status || ''), cls: '' };
            const yuan = ((Number(o.amount) || 0) / 100).toFixed(2);
            const date = o.createdAt ? formatOrderTime(o.createdAt) : '';
            return `
                <div class="account-order">
                    <div class="account-order-main">
                        <span class="account-order-name">${esc(o.planName || 'VIP 套餐')}</span>
                        <span class="account-order-meta">${date} · ${esc(String(o.days || 0))} 天</span>
                    </div>
                    <div class="account-order-right">
                        <span class="account-order-amount">¥${yuan}</span>
                        <span class="account-order-status ${st.cls}">${st.text}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch {
        list.innerHTML = '<div class="account-orders-empty">加载失败</div>';
    }
}

// 订单时间：后端 created_at 为秒时间戳
function formatOrderTime(ts) {
    const ms = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function bindProfileForm(container) {
    const form = container.querySelector('#profile-form');
    const input = container.querySelector('#profile-name');
    const msg = container.querySelector('#profile-msg');
    const btn = container.querySelector('#profile-submit');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { showMsg(msg, '昵称不能为空', false); return; }

        btn.disabled = true;
        btn.textContent = '保存中...';
        const result = await updateProfile(name);
        btn.disabled = false;
        btn.textContent = '保存昵称';

        if (result.success) {
            showMsg(msg, '昵称已更新', true);
            // 同步更新概览区昵称显示，无需整页重渲
            const nameEl = container.querySelector('.account-name');
            if (nameEl) nameEl.textContent = name;
        }
        else showMsg(msg, result.error, false);
    });
}

function bindPasswordForm(container) {
    const form = container.querySelector('#password-form');
    const cur = container.querySelector('#cur-password');
    const next = container.querySelector('#new-password');
    const confirm = container.querySelector('#confirm-password');
    const msg = container.querySelector('#password-msg');
    const btn = container.querySelector('#password-submit');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const curVal = cur.value;
        const nextVal = next.value;
        const confirmVal = confirm.value;

        if (nextVal.length < 6) { showMsg(msg, '新密码至少 6 位', false); return; }
        if (nextVal !== confirmVal) { showMsg(msg, '两次输入的新密码不一致', false); return; }
        if (nextVal === curVal) { showMsg(msg, '新密码不能与当前密码相同', false); return; }

        btn.disabled = true;
        btn.textContent = '修改中...';
        const result = await changePassword(curVal, nextVal);
        btn.disabled = false;
        btn.textContent = '修改密码';

        if (result.success) {
            showMsg(msg, '密码修改成功', true);
            form.reset();
        } else {
            showMsg(msg, result.error, false);
        }
    });
}

// 注销账号确认弹窗：要求输入密码二次确认，成功后回首页
function openDeleteDialog(container) {
    const backdrop = document.createElement('div');
    backdrop.className = 'auth-backdrop';
    backdrop.innerHTML = `
        <div class="auth-card">
            <button class="auth-close" type="button" id="del-close">&times;</button>
            <h2 class="auth-title">注销账号</h2>
            <p class="account-danger-tip" style="text-align:center;margin-bottom:1rem;">
                请输入密码确认注销。账号将无法再登录，且操作不可恢复。
            </p>
            <form class="auth-form" id="del-form">
                <input type="password" id="del-password" class="auth-input" placeholder="当前密码" required autocomplete="current-password">
                <div class="auth-error hidden" id="del-error"></div>
                <button type="submit" class="auth-submit" id="del-submit" style="background:#ff453a;">确认注销</button>
            </form>
        </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector('#del-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    const form = backdrop.querySelector('#del-form');
    const input = backdrop.querySelector('#del-password');
    const errorEl = backdrop.querySelector('#del-error');
    const btn = backdrop.querySelector('#del-submit');

    setTimeout(() => input.focus(), 100);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = input.value;
        if (!password) return;

        btn.disabled = true;
        btn.textContent = '注销中...';
        errorEl.classList.add('hidden');

        const result = await deleteAccount(password);
        if (result.success) {
            close();
            navigate('#/');
        } else {
            errorEl.textContent = result.error;
            errorEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = '确认注销';
        }
    });
}

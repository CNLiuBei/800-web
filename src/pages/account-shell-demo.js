// 个人中心布局 Demo（假数据）

import { loadCSS } from '../core/html.js';
import { initTheme } from '../services/theme.js';

const MOCK = {
    name: '光影用户',
    email: 'demo@guangying.org',
    vipUntil: '2026-12-01',
    resumeTitle: '庆余年 第二季',
    stats: { history: 12, favorites: 8, watchLater: 3, unread: 2 },
};

const NAV = [
    { id: 'personal', label: '个人信息', icon: iconPerson },
    { id: 'security', label: '登录与安全', icon: iconLock },
    { id: 'subscription', label: '会员与订阅', icon: iconStar },
    { id: 'library', label: '片库与记录', icon: iconLibrary },
    { id: 'notifications', label: '通知', icon: iconBell },
    { id: 'orders', label: '付款与订单', icon: iconCard },
];

function iconPerson() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>';
}
function iconLock() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
}
function iconStar() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4l2.2 4.5 5 .7-3.6 3.4.9 5-4.7-2.5-4.7 2.5.9-5L5 9.2l5-.7z"/></svg>';
}
function iconLibrary() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="6" height="14" rx="1"/><rect x="14" y="5" width="6" height="14" rx="1"/></svg>';
}
function iconBell() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4a4 4 0 0 0-4 4v3l-1.5 3h11L15 11V8a4 4 0 0 0-4-4z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>';
}
function iconCard() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>';
}

function row(label, value, { static: isStatic = false, href = '', hint = '', badge = '', badgeTone = 'neutral' } = {}) {
    const tag = href ? 'a' : 'button';
    const attrs = href ? `href="${href}"` : 'type="button"';
    const extraClass = isStatic ? ' is-static' : '';
    const badgeHtml = badge
        ? `<span class="gy-account-status is-${badgeTone}">${badge}</span>`
        : '';
    const valueHtml = value
        ? `<span class="gy-account-card-value">${value}</span>`
        : '';
    const chevronHtml = isStatic ? '' : `
        <svg class="gy-account-chevron-svg" viewBox="0 0 10 16" width="7" height="12" aria-hidden="true">
            <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    return `
        <${tag} class="gy-account-card${extraClass}" ${attrs}>
            <div class="gy-account-card-main">
                <span class="gy-account-card-label">${label}</span>
                ${hint ? `<span class="gy-account-card-hint">${hint}</span>` : ''}
            </div>
            <div class="gy-account-card-end">
                ${badgeHtml}
                ${valueHtml}
                ${chevronHtml}
            </div>
        </${tag}>
    `;
}

function summaryCard(title, desc, tone = 'ok') {
    return `
        <div class="gy-account-summary is-${tone}">
            <span class="gy-account-summary-dot" aria-hidden="true"></span>
            <div class="gy-account-summary-copy">
                <strong>${title}</strong>
                <span>${desc}</span>
            </div>
        </div>
    `;
}

function sectionBlock(title, rowsHtml, { intro = '' } = {}) {
    const titleHtml = title ? `<h2 class="gy-account-block-title">${title}</h2>` : '';
    const introHtml = intro ? `<p class="gy-account-block-intro">${intro}</p>` : '';
    return `
        <div class="gy-account-block">
            ${titleHtml}
            ${introHtml}
            <div class="gy-account-stack">${rowsHtml}</div>
        </div>
    `;
}

function sectionHero(title, lead, kicker = '账户') {
    return `
        <header class="gy-account-hero">
            <p class="gy-account-kicker">${kicker}</p>
            <h1 class="gy-account-heading">${title}</h1>
            <p class="gy-account-lead">${lead}</p>
        </header>
    `;
}

function renderSection(id) {
    switch (id) {
    case 'personal':
        return `
            <section class="gy-account-section" data-section="personal" hidden>
                ${sectionHero('个人信息', '姓名、联系方式与账户标识。')}
                ${sectionBlock('基本资料', [
                    row('姓名', MOCK.name, { hint: '显示在评论与个人主页' }),
                    row('电子邮件', MOCK.email, { hint: '登录与找回密码' }),
                    row('地区', '中国大陆', { hint: '内容分级与推荐偏好' }),
                ].join(''), { intro: '这些信息会用于账户识别与服务个性化。' })}
                ${sectionBlock('账户标识', [
                    row('光影账户 ID', 'GY-DEMO-001', { static: true, hint: '不可更改' }),
                ].join(''))}
            </section>
        `;
    case 'security':
        return `
            <section class="gy-account-section is-active" data-section="security">
                ${sectionHero('登录与安全', '密码、双重认证与已登录设备。', '安全')}
                ${summaryCard('账户状态正常', '建议开启双重认证以增强保护。', 'warn')}
                ${sectionBlock('登录方式', [
                    row('电子邮件', MOCK.email, { hint: '主要登录方式' }),
                    row('密码', '2026-05-01 更新', { hint: '定期更换更安全' }),
                ].join(''), { intro: '管理用于登录光影的凭证。' })}
                ${sectionBlock('安全增强', [
                    row('双重认证', '', { badge: '未启用', badgeTone: 'warn', hint: '短信或验证器 App' }),
                    row('登录设备', '2 台', { hint: 'Mac · iPhone', href: '#/account/sessions' }),
                ].join(''))}
                <p class="gy-account-footnote">在 <a href="#/account/sessions">设备管理</a> 中可查看详情并移除未知设备。</p>
            </section>
        `;
    case 'subscription':
        return `
            <section class="gy-account-section" data-section="subscription" hidden>
                ${sectionHero('会员与订阅', 'VIP 方案、到期时间与权益说明。')}
                ${summaryCard('光影 VIP 生效中', `有效期至 ${MOCK.vipUntil} · 自动续费已关闭`, 'ok')}
                ${sectionBlock('当前订阅', [
                    row('方案', '光影 VIP 年卡', { hint: '4K · 多端同步 · 无广告' }),
                    row('到期日', MOCK.vipUntil, { static: true }),
                    row('管理订阅', '查看权益', { href: '#/vip', hint: '升级、续费与发票' }),
                ].join(''))}
            </section>
        `;
    case 'library':
        return `
            <section class="gy-account-section" data-section="library" hidden>
                ${sectionHero('片库与记录', '继续观看、历史与收藏一览。')}
                ${sectionBlock('继续观看', [
                    row(MOCK.resumeTitle, '第 8 集 · 62%', { hint: '上次观看于 2 小时前' }),
                ].join(''))}
                ${sectionBlock('我的片库', [
                    row('看过', `${MOCK.stats.history} 部`, { hint: '含进度同步' }),
                    row('收藏', `${MOCK.stats.favorites} 部`, { hint: '片单与预约' }),
                    row('稍后看', `${MOCK.stats.watchLater} 部`, { hint: '待看队列' }),
                ].join(''), { intro: '数据会在登录设备间同步。' })}
            </section>
        `;
    case 'notifications':
        return `
            <section class="gy-account-section" data-section="notifications" hidden>
                ${sectionHero('通知', '系统、会员与内容提醒。')}
                ${summaryCard(`${MOCK.stats.unread} 条未读`, '会员到期与上新提醒待处理', 'warn')}
                ${sectionBlock('最近通知', [
                    row('VIP 即将到期', '3 天后', { badge: '未读', badgeTone: 'warn', hint: '2026-06-29' }),
                    row('新片上线', '《某某》已可观看', { badge: '未读', badgeTone: 'warn', hint: '今天 10:24' }),
                    row('系统维护', '已完成', { badge: '已读', badgeTone: 'muted', hint: '6 月 20 日', static: true }),
                ].join(''))}
            </section>
        `;
    case 'orders':
        return `
            <section class="gy-account-section" data-section="orders" hidden>
                ${sectionHero('付款与订单', '消费记录与支付方式。')}
                ${sectionBlock('最近订单', [
                    row('光影 VIP 年卡', '¥128.00', { hint: '订单号 GY20260512001', badge: '已完成', badgeTone: 'ok', static: true }),
                    row('支付时间', '2026-05-12 14:32', { static: true, hint: '微信支付' }),
                    row('下载发票', 'PDF', { hint: '电子发票 · 个人' }),
                ].join(''))}
            </section>
        `;
    default:
        return '';
    }
}

function renderNav(activeId = 'security') {
    return NAV.map((item) => `
        <button
            type="button"
            class="gy-account-nav-item ${item.id === activeId ? 'is-active' : ''}"
            data-section-nav="${item.id}"
            aria-current="${item.id === activeId ? 'page' : 'false'}"
        >
            <span class="gy-account-nav-leading">
                <span class="gy-account-nav-icon" aria-hidden="true">${item.icon()}</span>
                <span>${item.label}</span>
            </span>
            <svg class="gy-account-nav-chevron" viewBox="0 0 10 16" width="7" height="12" aria-hidden="true">
                <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
    `).join('');
}

function bindDemo(root) {
    const sections = [...root.querySelectorAll('.gy-account-section')];
    const shell = root.querySelector('.gy-account');
    const mobileBack = root.querySelector('#gy-shell-mobile-back');
    const mq = window.matchMedia('(max-width: 820px)');
    let activeSectionId = 'security';

    const isMobile = () => mq.matches;

    const syncMobileShell = () => {
        if (!shell) return;
        if (!isMobile()) {
            shell.classList.remove('is-mobile-detail');
            return;
        }
        shell.classList.toggle('is-mobile-detail', Boolean(activeSectionId));
    };

    const showSection = (id, { scrollTop = true } = {}) => {
        activeSectionId = id;
        sections.forEach((section) => {
            const active = section.dataset.section === id;
            section.classList.toggle('is-active', active);
            section.hidden = !active;
        });
        root.querySelectorAll('[data-section-nav]').forEach((btn) => {
            const on = btn.dataset.sectionNav === id;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-current', on ? 'page' : 'false');
        });
        syncMobileShell();
        if (scrollTop) {
            shell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const showMobileMenu = () => {
        activeSectionId = '';
        sections.forEach((section) => {
            section.classList.remove('is-active');
            section.hidden = true;
        });
        root.querySelectorAll('[data-section-nav]').forEach((btn) => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-current', 'false');
        });
        shell?.classList.remove('is-mobile-detail');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const applyLayoutMode = () => {
        if (isMobile()) {
            if (activeSectionId) {
                showSection(activeSectionId, { scrollTop: false });
            } else {
                showMobileMenu();
            }
            return;
        }
        if (!activeSectionId) activeSectionId = 'security';
        showSection(activeSectionId, { scrollTop: false });
    };

    root.querySelectorAll('[data-section-nav]').forEach((button) => {
        button.addEventListener('click', () => {
            showSection(button.dataset.sectionNav);
        });
    });

    mobileBack?.addEventListener('click', showMobileMenu);

    mq.addEventListener('change', applyLayoutMode);

    applyLayoutMode();
}

export async function render(container, { standalone = false } = {}) {
    initTheme();
    loadCSS('styles/account-shell.css');

    if (standalone) {
        document.body.classList.add('gy-account-standalone');
    }

    const defaultSection = 'security';
    const sectionHtml = NAV.map((item) => renderSection(item.id)).join('');

    container.innerHTML = `
        <div class="gy-account">
            <div class="gy-account-frame">
                <aside class="gy-account-sidebar" aria-label="账户导航">
                    <div class="gy-account-profile">
                        <div class="gy-account-avatar" aria-hidden="true">${MOCK.name.slice(0, 1)}</div>
                        <div class="gy-account-profile-copy">
                            <p class="gy-account-profile-name">${MOCK.name}</p>
                            <p class="gy-account-profile-email">${MOCK.email}</p>
                        </div>
                    </div>
                    <nav class="gy-account-nav">${renderNav(defaultSection)}</nav>
                </aside>
                <main class="gy-account-main" id="gy-shell-main">
                    <button type="button" class="gy-account-mobile-back" id="gy-shell-mobile-back" aria-label="返回账户菜单">
                        <svg viewBox="0 0 12 20" width="8" height="14" aria-hidden="true">
                            <path d="M10 2L3 10l7 8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span>账户</span>
                    </button>
                    ${sectionHtml}
                </main>
            </div>
        </div>
    `;

    bindDemo(container);
}

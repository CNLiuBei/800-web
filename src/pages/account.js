// 用户中心 - 左侧导航 + 右侧内容，导航在本页内切换面板

import {
    user, loading, initAuth, changePassword, updateProfile, deleteAccount, signOut,
    changeEmail, enableTwoFactor, verifyTwoFactorTotp, disableTwoFactor, regenerateBackupCodes,
    listLinkedAccounts, waitForAuthReady,
} from '../services/auth.js';
import { checkVipStatus, vipStatus, hasVipAccess, daysUntilExpire } from '../services/vip.js';
import {
    checkinPoints,
    fetchPointsAccount,
    fetchPointsLedger,
    fetchPointsRules,
    fetchPointsTasks,
    formatPoints,
    pointsAccount,
    pointsRules,
    pointsTasks,
    redeemVipDaysWithPoints,
} from '../services/points.js';
import { fetchPlaybackPermission, playbackPermission, permissionQuotaText } from '../services/permissions.js';
import { canShowInstallEntry, triggerInstall } from '../services/pwa-install.js';
import { esc, loadCSS } from '../core/html.js';
import { showSiteNotice } from '../services/site-notice.js';
import { navigate } from '../core/router.js';
import { effect } from '../core/signal.js';
import { bindAccountShell, renderAccountNavItem, renderAccountShell } from './account-shell.js';
import { API_V1_BASE } from '../services/config.js';
import { clearPersistentCache } from '../services/api.js';
import { favorites, getResumeProgress, history as watchHistory, watchLater } from '../services/library.js';
import { COMPLETION_PERCENT, historyPercent, isCompletedHistoryItem, playbackProgressShortLabel } from '../services/playback-progress.js';
import { librarySyncState } from '@gy/library-sync-state';
import { bindTmdbImageFallback, normalizeTmdbImageUrl } from '../services/media-images.js';
import { isUnread, loadNotifications, markNotificationsRead, notificationSummary, notificationPreferences, notificationTypeText, notificationEmptyHint, safeNotificationHref, isExternalNotificationHref, notificationTypeClass, fetchNotificationPreferences, updateNotificationPreferences, NOTIFICATION_MUTE_OPTIONS, setNotificationPollInterval } from '../services/notifications.js';
import {
    attachCreatorUploadSource,
    batchCreatorUploads,
    createCreatorCollection,
    createCreatorChannelAppeal,
    createCreatorPayoutRequest,
    createCreatorLiveSession,
    createCreatorUpload,
    createCreatorUploadAppeal,
    creatorContentTypeText,
    creatorReviewStatusText,
    deleteCreatorUpload,
    downloadCreatorRevenueBill,
    getCreatorAnalyticsOverview,
    getCreatorLiveStats,
    getCreatorRevenueLedger,
    getCreatorRevenueSummary,
    getCreatorStudio,
    getCreatorUploadRights,
    listCreatorChannelAppeals,
    listCreatorUploadAppeals,
    listCreatorPayoutRequests,
    listCreatorLiveMutes,
    listCreatorLiveSessions,
    requestCreatorUploadIntent,
    retryCreatorUploadTranscode,
    saveCreatorChannel,
    saveCreatorUploadRights,
    setCreatorPinnedUpload,
    sendCreatorBroadcast,
    updateCreatorLiveSession,
    updateCreatorLivePinnedNotice,
    updateCreatorUploadChapters,
    updateCreatorUploadDanmaku,
    updateCreatorUploadStatus,
    unmuteCreatorLiveUser,
    uploadCreatorObject,
} from '../services/creator.js';

let activeSection = 'profile';
let notificationFilter = { unreadOnly: false, type: '' };
let notificationListPage = 1;
let accountEffectsDispose = null;
let accountShellControls = null;

const SECTIONS = [
    { id: 'profile', label: '首页', sublabel: '账号概览', icon: iconUser },
    { id: 'points', label: '积分', sublabel: '签到与兑换', icon: iconCoins },
    { id: 'history', label: '看过', sublabel: '播放进度', icon: iconHistory },
    { id: 'watchlist', label: '收藏', sublabel: '收藏片单', icon: iconStar },
    { id: 'downloads', label: '稍后看', sublabel: '待看片单', icon: iconDownload },
    { id: 'notifications', label: '消息', sublabel: '系统提醒', icon: iconBell },
    { id: 'settings', label: '设置', sublabel: '安全与账单', icon: iconGear },
];

export async function render(container) {
    accountEffectsDispose?.();
    accountEffectsDispose = null;
    loadCSS('styles/account-shell.css');
    loadCSS('styles/account.css');

    if (!user.value && loading.value) {
        container.innerHTML = '<div class="page-loading">加载中...</div>';
        initAuth().catch(() => {});
        await waitForAuthReady();
    }

    if (!user.value) {
        renderGuest(container);
        accountEffectsDispose = effect(() => {
            if (user.value?.id) render(container).catch(() => {});
        });
        return;
    }

    activeSection = resolveInitialSection();
    try {
        const hashQuery = location.hash.split('?')[1] || '';
        const hasHashSection = new URLSearchParams(hashQuery).has('section');
        if (window.matchMedia('(max-width: 820px)').matches && !hasHashSection) {
            activeSection = '';
        }
    } catch {}

    renderShell(container);
    bindShell(container);
    if (activeSection) renderActiveSection(container);

    Promise.all([
        checkVipStatus().catch(() => {}),
        fetchPlaybackPermission().catch(() => {}),
        fetchPointsAccount().catch(() => {}),
        fetchPointsRules().catch(() => {}),
        fetchPointsTasks().catch(() => {}),
    ]);

    let lastLibrarySyncState = librarySyncState.value;
    accountEffectsDispose = effect(() => {
        const uid = user.value?.id || null;
        if (!uid) {
            if (container.querySelector('.gy-account')) {
                accountShellControls = null;
                activeSection = 'profile';
                renderGuest(container);
            }
            return;
        }
        vipStatus.value;
        playbackPermission.value;
        librarySyncState.value;
        favorites.value;
        watchHistory.value;
        watchLater.value;
        refreshAccountSidebar(container);
        const syncState = librarySyncState.value;
        if (lastLibrarySyncState === 'syncing' && syncState === 'done') {
            if (['watchlist', 'downloads', 'history'].includes(activeSection)) {
                renderActiveSection(container);
            }
        }
        lastLibrarySyncState = syncState;
    });
}

function renderGuest(container) {
    container.innerHTML = `
        <div class="account-page account-guest-page">
            <section class="account-guest-card">
                <span class="account-guest-icon" aria-hidden="true">${iconUser()}</span>
                <h1 class="account-guest-title">登录后使用个人中心</h1>
                <p class="account-guest-desc">同步观看进度、收藏片单、会员权益与消息通知。</p>
                <button class="account-primary-btn account-guest-btn" id="account-login" type="button">登录 / 注册</button>
                <a class="account-guest-link" href="#/vip">了解 VIP 权益</a>
            </section>
        </div>
    `;
    container.querySelector('#account-login')?.addEventListener('click', async () => {
        const v = window.GY_WEB_STATIC_VERSION || '1';
        const { openAuthModal } = await import(`../services/auth-modal-loader.js?v=${v}`);
        openAuthModal('login');
    });
}

function renderShell(container) {
    const u = user.value || {};
    const stats = accountStats();
    const navHtml = SECTIONS.map((section) => {
        const badge = section.id === 'notifications' && stats.unread > 0
            ? (stats.unread > 99 ? '99+' : String(stats.unread))
            : '';
        return renderAccountNavItem(section, { active: section.id === activeSection, badge });
    }).join('');
    const profileMeta = [
        hasVipAccess() ? `<p class="gy-account-profile-meta">${esc(vipBadgeText())}</p>` : '',
        librarySyncHint() ? `<p class="gy-account-profile-meta">${esc(librarySyncHint())}</p>` : '',
        playbackPermission.value ? `<p class="gy-account-profile-meta">${esc(permissionQuotaText())}</p>` : '',
    ].filter(Boolean).join('');

    container.innerHTML = renderAccountShell({
        profileAvatarHtml: renderAvatar(u, 'gy-account-avatar'),
        profileName: esc(displayName(u)),
        profileEmail: esc(u.email || '光影用户'),
        profileMetaHtml: profileMeta,
        navHtml,
    });
}

function bindShell(container) {
    accountShellControls = bindAccountShell(container, {
        getActiveSection: () => activeSection,
        onSectionChange: (sectionId, opts = {}) => {
            if (opts.mobileMenu || sectionId === '') {
                activeSection = '';
                container.querySelector('#account-panel-host')?.replaceChildren();
                accountShellControls?.syncMobileShell?.();
                return;
            }
            setActiveSection(container, sectionId);
        },
    });
    bindSectionJumpers(container);
    bindSignOutButtons(container);
}

async function handleAccountSignOut(container) {
    const result = await signOut();
    if (!result?.success) {
        if (result?.error) showSiteNotice(result.error, { tone: 'error' });
        return;
    }
    accountEffectsDispose?.();
    accountEffectsDispose = null;
    activeSection = 'profile';
    renderGuest(container);
}

function bindSignOutButtons(container) {
    if (container._signOutBound) return;
    container._signOutBound = true;
    container.addEventListener('click', (event) => {
        const btn = event.target.closest('#account-signout, .account-hero-signout');
        if (!btn || !container.contains(btn)) return;
        event.preventDefault();
        handleAccountSignOut(container);
    });
}

function bindSectionJumpers(container) {
    container.querySelectorAll('[data-section-jump]').forEach((button) => {
        button.addEventListener('click', () => {
            setActiveSection(container, button.dataset.sectionJump || 'profile');
        });
    });
}

function refreshAccountSidebar(container) {
    const u = user.value || {};
    const stats = accountStats();
    container.querySelector('.gy-account-profile-name')?.replaceChildren(document.createTextNode(displayName(u)));
    const emailEl = container.querySelector('.gy-account-profile-email');
    if (emailEl) emailEl.textContent = u.email || '光影用户';

    const avatarHost = container.querySelector('.gy-account-profile');
    const avatar = container.querySelector('.gy-account-avatar');
    if (avatarHost && avatar) {
        avatar.outerHTML = renderAvatar(u, 'gy-account-avatar');
    }

    const copy = container.querySelector('.gy-account-profile-copy');
    if (copy) {
        copy.querySelectorAll('.gy-account-profile-meta').forEach((node) => node.remove());
        const metaHtml = [
            hasVipAccess() ? `<p class="gy-account-profile-meta">${esc(vipBadgeText())}</p>` : '',
            librarySyncHint() ? `<p class="gy-account-profile-meta">${esc(librarySyncHint())}</p>` : '',
            playbackPermission.value ? `<p class="gy-account-profile-meta">${esc(permissionQuotaText())}</p>` : '',
        ].filter(Boolean).join('');
        if (metaHtml) copy.insertAdjacentHTML('beforeend', metaHtml);
    }

    const nav = container.querySelector('.gy-account-nav');
    if (nav) {
        nav.innerHTML = SECTIONS.map((section) => {
            const badge = section.id === 'notifications' && stats.unread > 0
                ? (stats.unread > 99 ? '99+' : String(stats.unread))
                : '';
            return renderAccountNavItem(section, { active: section.id === activeSection, badge });
        }).join('');
    }
    accountShellControls?.syncNavActive?.();
}

function setActiveSection(container, sectionId) {
    const previous = activeSection;
    activeSection = sectionId === 'billing' ? 'settings' : sectionId;
    if (activeSection === 'notifications') {
        setNotificationPollInterval(45000);
        fetchNotificationPreferences().catch(() => {});
    } else if (previous === 'notifications') {
        setNotificationPollInterval(90000);
    }
    accountShellControls?.syncNavActive?.();
    accountShellControls?.syncMobileShell?.();
    renderActiveSection(container);
    bindSectionJumpers(container);
}

function renderActiveSection(container) {
    const host = container.querySelector('#account-panel-host');
    if (!host) return;
    switch (activeSection) {
    case 'points':
        host.innerHTML = renderPointsSection();
        bindPointsSection(host, container);
        loadPointsSection(host);
        break;
    case 'watchlist':
        host.innerHTML = renderWatchlistSection();
        bindMediaFilters(host);
        break;
    case 'downloads':
        host.innerHTML = renderDownloadsSection();
        break;
    case 'history':
        host.innerHTML = renderHistorySection();
        break;
    case 'notifications':
        host.innerHTML = renderNotificationsSection();
        bindNotificationsSection(host);
        loadAccountNotifications(host);
        break;
    case 'settings':
        host.innerHTML = renderSettingsSection();
        bindSettings(host, container);
        loadOrders(host);
        break;
    case 'profile':
    default:
        host.innerHTML = renderProfileSection();
        bindProfileActions(host, container);
        break;
    }
    bindAccountPosters(host);
    bindSectionJumpers(container);
}

function bindAccountPosters(container) {
    if (!container?.querySelectorAll) return;
    container.querySelectorAll(
        'img[src*="/tmdb/t/p/"], img[src*="/api/t/p/"], img[src*="/t/p/"]',
    ).forEach((img) => bindTmdbImageFallback(img));
}

function checkinButtonLabel() {
    return pointsTasks.value?.checkedInToday ? '今日已签到' : '签到领积分';
}

function checkinButtonDisabled(disabled = false) {
    return disabled || pointsTasks.value?.checkedInToday;
}

function renderProfileSection() {
    const latest = getLatestResumeItem();
    return `
        <div class="account-hub account-panel-body">
            <section class="account-hub-resume">
                <div class="account-card-head">
                    <h2>继续观看</h2>
                    ${latest ? `<a class="account-link-btn" href="${esc(historyPlayHref(latest.item))}">立即播放</a>` : ''}
                </div>
                ${renderResume(latest)}
            </section>

            <section class="account-card account-hub-activity account-points-hub-card">
                <div class="account-card-head">
                    <h2>积分</h2>
                    <button class="account-link-btn" type="button" data-section-jump="points">明细</button>
                </div>
                <p class="account-points-balance">${esc(formatPoints(pointsAccount.value?.balance || 0))}</p>
                <p class="account-empty small">签到、购 VIP 返积分，可兑换会员天数</p>
                <div class="account-points-hub-actions">
                    <button class="account-primary-btn" type="button" id="account-profile-checkin" ${checkinButtonDisabled() ? 'disabled' : ''}>${esc(checkinButtonLabel())}</button>
                    <button class="account-secondary-btn" type="button" data-section-jump="points">兑换 VIP</button>
                </div>
            </section>

            <section class="account-card account-hub-activity">
                <div class="account-card-head">
                    <h2>最近看过</h2>
                    <button class="account-link-btn" type="button" data-section-jump="history">查看全部</button>
                </div>
                <div class="account-list compact">
                    ${renderRecentActivity()}
                </div>
            </section>
        </div>
    `;
}

function renderPointsProgressBars(tasks) {
    const weekly = tasks?.weeklyCheckin;
    const watch = tasks?.dailyWatch;
    const blocks = [];
    if (weekly?.target > 0) {
        const pct = Math.min(100, Math.round((Number(weekly.current || 0) / weekly.target) * 100));
        blocks.push(`
            <div class="account-points-progress">
                <div class="account-points-progress-head"><span>本周签到</span><span>${esc(String(weekly.current || 0))}/${esc(String(weekly.target))}${weekly.granted ? ' · 已领' : ''}</span></div>
                <div class="account-points-progress-track"><div class="account-points-progress-fill" style="width:${pct}%"></div></div>
            </div>
        `);
    }
    if (watch?.targetMinutes > 0) {
        const pct = Math.min(100, Math.round((Number(watch.watchedMinutes || 0) / watch.targetMinutes) * 100));
        blocks.push(`
            <div class="account-points-progress">
                <div class="account-points-progress-head"><span>今日观看</span><span>${esc(String(watch.watchedMinutes || 0))}/${esc(String(watch.targetMinutes))} 分钟${watch.granted ? ' · 已完成' : ''}</span></div>
                <div class="account-points-progress-track"><div class="account-points-progress-fill" style="width:${pct}%"></div></div>
            </div>
        `);
    }
    return blocks.length ? `<div class="account-points-progress-list">${blocks.join('')}</div>` : '';
}

function renderPointsTaskHints(rules, tasks) {
    if (!rules || rules.enabled === false) return '';
    const progress = tasks || {};
    const parts = [];
    const weekly = progress.weeklyCheckin;
    if (Number(rules.weeklyCheckinBonus) > 0 && Number(rules.weeklyCheckinTarget) > 0) {
        const current = Number(weekly?.current || 0);
        const target = Number(rules.weeklyCheckinTarget);
        const status = weekly?.granted ? '已领取' : (current >= target ? '可领取' : `${current}/${target}`);
        parts.push(`本周签到 ${status} → +${formatPoints(rules.weeklyCheckinBonus)}`);
    }
    const watch = progress.dailyWatch;
    if (Number(rules.dailyWatchPoints) > 0 && Number(rules.dailyWatchMinutes) > 0) {
        const watched = Number(watch?.watchedMinutes || 0);
        const target = Number(rules.dailyWatchMinutes);
        const status = watch?.granted ? '已完成' : `${Math.min(watched, target)}/${target} 分钟`;
        parts.push(`今日观看 ${status} → +${formatPoints(rules.dailyWatchPoints)}`);
    }
    if (!parts.length) return '';
    return `<div class="account-points-tasks">${parts.map((line) => `<p class="account-empty small">${esc(line)}</p>`).join('')}</div>`;
}

function renderPointsSection() {
    const account = pointsAccount.value || {};
    const rules = pointsRules.value || {};
    const tasks = pointsTasks.value || {};
    const disabled = account.enabled === false;
    const redeemPerDay = Number(rules.vipRedeemPointsPerDay || account.redeemPointsPerDay || 1000);
    const redeemHint = (days) => `${days} 天 · ${formatPoints(days * redeemPerDay)} 积分`;
    return renderSectionPage('points', {
        desc: '每日签到、VIP 购买返点，积分可兑换会员天数。',
        count: account.balance,
        countLabel: '分',
        actions: `
            <button class="account-primary-btn" type="button" id="account-points-checkin" ${checkinButtonDisabled(disabled) ? 'disabled' : ''}>${esc(checkinButtonLabel())}</button>
        `,
        body: `
            <div class="account-card account-full-card">
                <div class="account-card-head">
                    <h3>我的积分</h3>
                </div>
                <p class="account-points-balance">${esc(formatPoints(account.balance || 0))}</p>
                <p class="account-empty small">累计获得 ${esc(formatPoints(account.lifetimeEarned || 0))} · 累计消耗 ${esc(formatPoints(account.lifetimeSpent || 0))}</p>
                ${renderPointsTaskHints(rules, tasks)}
                ${disabled ? '<p class="account-empty small">积分功能暂未开启</p>' : ''}
            </div>
            <div class="account-card account-full-card">
                <div class="account-card-head">
                    <h3>兑换 VIP</h3>
                </div>
                <div class="account-points-redeem">
                    <button class="account-secondary-btn" type="button" data-redeem-days="1" ${disabled ? 'disabled' : ''} title="${esc(redeemHint(1))}">1 天</button>
                    <button class="account-secondary-btn" type="button" data-redeem-days="7" ${disabled ? 'disabled' : ''} title="${esc(redeemHint(7))}">7 天</button>
                    <button class="account-secondary-btn" type="button" data-redeem-days="30" ${disabled ? 'disabled' : ''} title="${esc(redeemHint(30))}">30 天</button>
                    <button class="account-secondary-btn" type="button" data-redeem-days="90" ${disabled ? 'disabled' : ''} title="${esc(redeemHint(90))}">90 天</button>
                </div>
                ${renderPointsProgressBars(tasks)}
                <p class="account-empty small" id="account-points-redeem-hint">当前兑换单价 ${esc(formatPoints(redeemPerDay))} 积分/天，选择后将即时扣除并延长 VIP。</p>
            </div>
            <div class="account-card account-full-card">
                <div class="account-card-head">
                    <h3>积分明细</h3>
                </div>
                <div class="account-list compact" id="account-points-ledger">
                    <p class="account-empty small">加载中...</p>
                </div>
            </div>
        `,
    });
}

function bindPointsSection(host, container) {
    host.querySelector('#account-points-checkin')?.addEventListener('click', () => {
        runPointsCheckin(container, host.querySelector('#account-points-checkin'));
    });

    host.querySelectorAll('[data-redeem-days]').forEach((button) => {
        button.addEventListener('click', async () => {
            const days = Number(button.dataset.redeemDays);
            if (!Number.isFinite(days) || days < 1) return;
            button.disabled = true;
            try {
                const result = await redeemVipDaysWithPoints(days);
                showSiteNotice(`已兑换 ${days} 天 VIP，消耗 ${formatPoints(result.cost)} 积分`, { tone: 'success' });
                await Promise.all([fetchPointsAccount(), fetchPointsTasks(), checkVipStatus()]);
                renderActiveSection(container);
            } catch (err) {
                showSiteNotice(err?.message || '兑换失败', { tone: 'error' });
                button.disabled = false;
            }
        });
    });
}

async function loadPointsSection(host) {
    await fetchPointsTasks().catch(() => {});
    const progressHost = host.querySelector('.account-points-progress-list');
    if (progressHost) {
        progressHost.outerHTML = renderPointsProgressBars(pointsTasks.value || {});
    }
    const tasksHost = host.querySelector('.account-points-tasks');
    if (tasksHost) {
        tasksHost.outerHTML = renderPointsTaskHints(pointsRules.value || {}, pointsTasks.value || {});
    }
    const ledgerHost = host.querySelector('#account-points-ledger');
    if (!ledgerHost) return;
    try {
        const data = await fetchPointsLedger(1, 30);
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
            ledgerHost.innerHTML = '<p class="account-empty small">暂无积分记录</p>';
            return;
        }
        ledgerHost.innerHTML = items.map((item) => `
            <div class="account-list-row">
                <div>
                    <strong>${esc(item.reasonLabel || item.reason || '积分变动')}</strong>
                    <p class="account-empty small">${esc(formatLedgerTime(item.createdAt))}</p>
                </div>
                <span class="${item.delta >= 0 ? 'account-points-plus' : 'account-points-minus'}">
                    ${item.delta >= 0 ? '+' : ''}${esc(formatPoints(item.delta))}
                </span>
            </div>
        `).join('');
    } catch {
        ledgerHost.innerHTML = '<p class="account-empty small">积分明细加载失败</p>';
    }
}

function formatLedgerTime(ts) {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return '';
    try {
        return new Date(num * 1000).toLocaleString('zh-CN', { hour12: false });
    } catch {
        return '';
    }
}

function renderWatchlistSection() {
    const items = favorites.value || [];
    return renderSectionPage('watchlist', {
        desc: '收藏的影片会出现在这里，方便随时回看。',
        count: items.length,
        countLabel: '部',
        body: items.length
            ? `<div class="account-media-grid">${renderMediaCards(items)}</div>`
            : renderEmptyState('暂无收藏内容', '浏览首页，把喜欢的影片加入收藏', '#/', '去首页看看'),
    });
}

function renderDownloadsSection() {
    const items = watchLater.value || [];
    return renderSectionPage('downloads', {
        desc: '想稍后继续的内容，先加入这里。',
        count: items.length,
        countLabel: '项',
        body: items.length
            ? `<div class="account-media-grid">${renderMediaCards(items)}</div>`
            : renderEmptyState('暂无稍后观看', '在详情页点击「稍后看」即可加入', '#/', '去发现内容'),
    });
}

function renderHistorySection() {
    const rows = (watchHistory.value || [])
        .slice()
        .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    const body = rows.length
        ? groupHistoryByTime(rows).map((group) => `
            <section class="account-history-group">
                <h3 class="account-history-group-title">${esc(group.title)}</h3>
                <div class="account-history-list">
                    ${group.items.map(renderHistoryItem).join('')}
                </div>
            </section>
        `).join('')
        : renderEmptyState('暂无观看历史', '开始观看后会自动记录进度', '#/', '去首页看看');
    return renderSectionPage('history', {
        desc: '最近观看记录与续播进度。',
        count: rows.length,
        countLabel: '条',
        body,
    });
}

function renderNotificationsSection() {
    const summary = notificationSummary.value || {};
    const items = Array.isArray(summary.items) ? summary.items : [];
    const filters = notificationFilterOptions();
    const actions = `
        <div class="account-row-actions account-section-toolbar">
            <span class="account-notify-count" id="account-notifications-count">${esc(notificationCountText(summary))}</span>
            <button class="account-icon-button" type="button" id="account-notifications-refresh" aria-label="刷新消息">${iconRefresh()}</button>
            <button class="account-secondary-btn account-notify-read-all" type="button" id="account-notifications-read-all" ${Number(summary.unreadCount || 0) <= 0 ? 'disabled' : ''}>全部已读</button>
        </div>
    `;
    const body = `
        <div class="account-segment account-notification-segment" id="account-notification-filters" role="tablist" aria-label="消息筛选">
            ${filters.map((item) => `
                <button type="button" class="${notificationFilterActive(item) ? 'active' : ''}" data-notification-filter="${esc(item.id)}">
                    ${esc(item.label)}
                </button>
            `).join('')}
        </div>
        <div class="account-notification-prefs" id="account-notification-prefs" aria-label="消息偏好">
            <span class="account-notification-prefs-label">轻提示</span>
            ${renderNotificationPrefsHTML()}
        </div>
        <div class="account-notification-list" id="account-notification-list">
            ${summary.loading && !summary.loaded ? '<div class="account-loading">消息加载中...</div>' : renderNotificationItems(items)}
        </div>
        ${summary.hasMore ? '<button class="account-secondary-btn account-notification-more" type="button" id="account-notifications-more">加载更多</button>' : ''}
    `;
    return renderSectionPage('notifications', {
        desc: '系统通知、会员提醒与关注创作者更新。',
        actions,
        body,
    });
}

function notificationFilterOptions() {
    return [
        { id: 'all', label: '全部', unreadOnly: false, type: '' },
        { id: 'unread', label: '未读', unreadOnly: true, type: '' },
        { id: 'vip', label: '会员', unreadOnly: false, type: 'vip' },
        { id: 'points', label: '积分', unreadOnly: false, type: 'points' },
        { id: 'movie_request', label: '求片', unreadOnly: false, type: 'movie_request' },
        { id: 'order', label: '订单', unreadOnly: false, type: 'order' },
        { id: 'system', label: '系统', unreadOnly: false, type: 'system' },
        { id: 'movie', label: '影片', unreadOnly: false, type: 'movie' },
        { id: 'watchlist', label: '收藏', unreadOnly: false, type: 'watchlist' },
        { id: 'creator_upload', label: '创作', unreadOnly: false, type: 'creator_upload' },
        { id: 'creator_live', label: '直播', unreadOnly: false, type: 'creator_live' },
    ];
}

function notificationFilterActive(item) {
    return notificationFilter.unreadOnly === item.unreadOnly && notificationFilter.type === item.type;
}

function renderCreatorSection() {
    return `
        <div class="creator-dashboard-grid">
            <section class="account-card account-full-card">
                <div class="account-card-head">
                    <div>
                        <h2>创作者频道</h2>
                        <p>设置频道资料，提交原创视频、短视频、剧集或直播回放。</p>
                    </div>
                    <span id="creator-channel-status">同步中</span>
                </div>
                <form class="account-form creator-channel-form" id="creator-channel-form">
                    <label class="account-field">
                        <span>频道标识</span>
                        <input id="creator-handle" type="text" placeholder="creator_name" minlength="3" maxlength="30" pattern="[A-Za-z0-9_-]{3,30}" required>
                    </label>
                    <label class="account-field">
                        <span>频道名称</span>
                        <input id="creator-display-name" type="text" placeholder="我的创作频道" minlength="2" maxlength="40" required>
                    </label>
                    <label class="account-field account-field-full">
                        <span>频道简介</span>
                        <textarea id="creator-bio" rows="3" maxlength="240" placeholder="介绍你的内容方向、更新节奏或代表作品"></textarea>
                    </label>
                    <label class="account-field account-field-full">
                        <span>频道公告</span>
                        <textarea id="creator-announcement" rows="3" maxlength="280" placeholder="更新计划、直播预告、停更说明或粉丝活动"></textarea>
                    </label>
                    <div class="account-msg hidden" id="creator-channel-msg"></div>
                    <div class="creator-rights-actions">
                        <button class="account-primary-btn" type="submit" id="creator-channel-submit">保存频道</button>
                        <button class="account-secondary-btn hidden" type="button" id="creator-channel-appeal">频道申诉</button>
                    </div>
                </form>
            </section>

            <section class="account-card creator-summary-card">
                <div class="account-card-head">
                    <h2>创作概览</h2>
                    <span>实时</span>
                </div>
                <div class="creator-stat-grid" id="creator-summary">
                    ${renderCreatorSummary()}
                </div>
            </section>

            <section class="account-card account-full-card creator-broadcast-card">
                <div class="account-card-head">
                    <div>
                        <h2>粉丝广播</h2>
                        <p>向关注你的用户发送站内消息，用于更新预告、直播提醒或活动通知。</p>
                    </div>
                    <span>Fan P0</span>
                </div>
                <div class="account-msg hidden" id="creator-broadcast-gate"></div>
                <form class="account-form creator-upload-form" id="creator-broadcast-form">
                    <label class="account-field">
                        <span>广播标题</span>
                        <input id="creator-broadcast-title" type="text" maxlength="60" placeholder="今晚 8 点直播剪辑复盘" required>
                    </label>
                    <label class="account-field account-field-full">
                        <span>广播内容</span>
                        <textarea id="creator-broadcast-content" rows="3" maxlength="500" placeholder="告诉粉丝本次更新、直播安排或活动重点"></textarea>
                    </label>
                    <div class="account-msg hidden" id="creator-broadcast-msg"></div>
                    <button class="account-primary-btn" type="submit" id="creator-broadcast-submit">发送广播</button>
                </form>
            </section>

            <section class="account-card account-full-card creator-analytics-card">
                <div class="account-card-head">
                    <div>
                        <h2>数据分析</h2>
                        <p>独立统计近 30 天播放、完播、互动和预估收益。</p>
                    </div>
                    <span>30 天</span>
                </div>
                <div id="creator-analytics">
                    ${renderCreatorAnalytics()}
                </div>
            </section>

            <section class="account-card account-full-card creator-revenue-card">
                <div class="account-card-head">
                    <div>
                        <h2>收益中心</h2>
                        <p>展示内测估算、来源拆分与结算流水占位。</p>
                    </div>
                    <span>内测</span>
                </div>
                <div id="creator-revenue">
                    ${renderCreatorRevenue()}
                </div>
            </section>

            <section class="account-card account-full-card creator-collections-card">
                <div class="account-card-head">
                    <div>
                        <h2>合集管理</h2>
                        <p>把公开视频编排成专题、系列或片单，并同步展示到公开频道。</p>
                    </div>
                    <span>Collections P0</span>
                </div>
                <div class="account-msg hidden" id="creator-collection-gate"></div>
                <form class="account-form creator-upload-form" id="creator-collection-form">
                    <label class="account-field">
                        <span>合集标题</span>
                        <input id="creator-collection-title" type="text" maxlength="80" placeholder="新手入门系列" required>
                    </label>
                    <label class="account-field">
                        <span>可见性</span>
                        <select id="creator-collection-visibility">
                            <option value="public">公开</option>
                            <option value="private">私密</option>
                        </select>
                    </label>
                    <label class="account-field account-field-full">
                        <span>作品 ID</span>
                        <textarea id="creator-collection-upload-ids" rows="3" maxlength="2000" placeholder="用逗号或换行填写作品 ID，例如 upload-a, upload-b"></textarea>
                        <small>公开合集只允许加入已发布、审核通过、转码完成且公开的作品。</small>
                    </label>
                    <label class="account-field account-field-full">
                        <span>合集简介</span>
                        <textarea id="creator-collection-description" rows="2" maxlength="240" placeholder="说明这个合集的主题、观看顺序或更新节奏"></textarea>
                    </label>
                    <div class="account-msg hidden" id="creator-collection-msg"></div>
                    <button class="account-primary-btn" type="submit" id="creator-collection-submit">创建合集</button>
                </form>
                <div class="creator-work-list" id="creator-collections">
                    <div class="account-loading">加载中...</div>
                </div>
            </section>

            <section class="account-card account-full-card creator-live-panel">
                <div class="account-card-head">
                    <div>
                        <h2>直播排期</h2>
                        <p>创建预约直播，管理开始、结束和取消状态；公开排期会进入直播发现流。</p>
                    </div>
                    <span>Live MVP</span>
                </div>
                <div class="account-msg hidden" id="creator-live-gate"></div>
                <form class="account-form creator-upload-form" id="creator-live-form">
                    <label class="account-field">
                        <span>直播标题</span>
                        <input id="creator-live-title" type="text" maxlength="120" required placeholder="周五创作夜谈">
                    </label>
                    <label class="account-field">
                        <span>预约时间</span>
                        <input id="creator-live-scheduled" type="datetime-local">
                    </label>
                    <label class="account-field">
                        <span>可见性</span>
                        <select id="creator-live-visibility">
                            <option value="private">私密</option>
                            <option value="unlisted">仅链接可见</option>
                            <option value="public">公开</option>
                        </select>
                    </label>
                    <label class="account-field account-field-full">
                        <span>直播简介</span>
                        <textarea id="creator-live-description" rows="3" maxlength="2000" placeholder="告诉观众这场直播会聊什么"></textarea>
                    </label>
                    <div class="account-msg hidden" id="creator-live-msg"></div>
                    <button class="account-primary-btn" type="submit" id="creator-live-submit">创建排期</button>
                </form>
                <div class="creator-work-list" id="creator-live-sessions">
                    <div class="account-loading">加载中...</div>
                </div>
            </section>

            <section class="account-card account-full-card creator-upload-panel">
                <div class="account-card-head">
                    <div>
                        <h2>提交投稿</h2>
                        <p>上传源文件并提交审核；审核通过且转码完成后才会进入发布态。</p>
                    </div>
                    <span>审核流</span>
                </div>
                <div class="account-msg hidden" id="creator-upload-gate"></div>
                <form class="account-form creator-upload-form" id="creator-upload-form">
                    <label class="account-field">
                        <span>标题</span>
                        <input id="creator-upload-title" type="text" maxlength="120" required placeholder="第一支原创短片">
                    </label>
                    <label class="account-field">
                        <span>内容类型</span>
                        <select id="creator-upload-type" required>
                            <option value="video">长视频</option>
                            <option value="short">短视频</option>
                            <option value="series">剧集</option>
                            <option value="live">直播回放</option>
                        </select>
                    </label>
                    <label class="account-field">
                        <span>可见性</span>
                        <select id="creator-upload-visibility">
                            <option value="private">私密</option>
                            <option value="unlisted">仅链接可见</option>
                            <option value="public">公开</option>
                        </select>
                    </label>
                    <label class="account-field account-field-full creator-file-field">
                        <span>上传文件</span>
                        <input id="creator-upload-file" type="file" accept="video/mp4,video/webm,video/quicktime,application/vnd.apple.mpegurl,application/x-mpegurl">
                        <small>支持 MP4、WebM、MOV 与 HLS manifest；上传成功后会自动回填对象路径。</small>
                        <button class="account-secondary-btn" type="button" id="creator-file-upload-btn">上传到媒体库</button>
                        <div class="creator-upload-status hidden" id="creator-file-upload-status"></div>
                    </label>
                    <label class="account-field">
                        <span>对象路径</span>
                        <input id="creator-upload-source" type="text" placeholder="uploads/user/video.mp4 或 videos/item/master.m3u8">
                    </label>
                    <label class="account-field">
                        <span>时长（秒）</span>
                        <input id="creator-upload-duration" type="number" min="1" max="86400" placeholder="短视频必填，≤180 秒">
                    </label>
                    <label class="account-field">
                        <span>视频宽度</span>
                        <input id="creator-upload-width" type="number" min="1" max="16000" placeholder="如 720">
                    </label>
                    <label class="account-field">
                        <span>视频高度</span>
                        <input id="creator-upload-height" type="number" min="1" max="16000" placeholder="如 1280">
                    </label>
                    <label class="account-field">
                        <span>封面帧（秒）</span>
                        <input id="creator-upload-cover-frame" type="number" min="0" max="86400" placeholder="如 3">
                    </label>
                    <label class="account-field account-field-full">
                        <span>话题标签</span>
                        <input id="creator-upload-tags" type="text" maxlength="200" placeholder="用逗号分隔，例如 原创,旅行,Vlog">
                        <small>短视频会校验竖版比例，建议 9:16；话题用于短视频 Feed 和后续推荐召回。</small>
                    </label>
                    <label class="account-field account-field-full">
                        <span>简介</span>
                        <textarea id="creator-upload-description" rows="3" maxlength="2000" placeholder="补充内容简介、版权说明或审核备注"></textarea>
                    </label>
                    <div class="account-msg hidden" id="creator-upload-msg"></div>
                    <button class="account-primary-btn" type="submit" id="creator-upload-submit">提交审核</button>
                </form>
            </section>

            <section class="account-card account-full-card">
                <div class="account-card-head">
                    <div>
                        <h2>作品管理</h2>
                        <p>追踪草稿、审核中、已发布和驳回内容。</p>
                    </div>
                    <button class="account-secondary-btn" type="button" id="creator-refresh">刷新</button>
                </div>
                <div class="creator-work-list" id="creator-uploads">
                    <div class="account-loading">加载中...</div>
                </div>
            </section>
        </div>
    `;
}

function renderSettingsSection() {
    const install = canShowInstallEntry() ? `
        <div class="account-settings-row" id="account-install-card">
            <div class="account-settings-row-copy">
                <strong>添加到主屏幕</strong>
                <small>全屏沉浸观影，秒开免打扰。</small>
            </div>
            <button class="account-secondary-btn" id="account-install-btn" type="button">添加</button>
        </div>
    ` : '';

    const body = `
        <div class="account-settings-stack">
            <section class="account-card account-settings-card">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconUser()}</span>
                    <div>
                        <h3>个人资料</h3>
                        <p>修改你在站内显示的昵称。</p>
                    </div>
                </div>
                <form class="account-form" id="profile-form">
                    <label class="account-field">
                        <span>昵称</span>
                        <input id="profile-name" type="text" value="${esc(user.value?.name || '')}" maxlength="40" required>
                    </label>
                    <div class="account-msg hidden" id="profile-msg"></div>
                    <button class="account-primary-btn" type="submit" id="profile-submit">保存昵称</button>
                </form>
            </section>

            <section class="account-card account-settings-card">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconGear()}</span>
                    <div>
                        <h3>安全设置</h3>
                        <p>定期更新密码，保护账号安全。</p>
                    </div>
                </div>
                <form class="account-form" id="password-form">
                    <label class="account-field">
                        <span>当前密码</span>
                        <input id="cur-password" type="password" autocomplete="current-password" required>
                    </label>
                    <label class="account-field">
                        <span>新密码</span>
                        <input id="new-password" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <label class="account-field">
                        <span>确认新密码</span>
                        <input id="confirm-password" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <div class="account-msg hidden" id="password-msg"></div>
                    <button class="account-primary-btn" type="submit" id="password-submit">修改密码</button>
                </form>
                <div class="account-settings-row">
                    <div class="account-settings-row-copy">
                        <strong>登录设备</strong>
                        <small>查看并管理已登录的浏览器与设备，发现异常可立即登出。</small>
                    </div>
                    <a class="account-secondary-btn" href="#/account/sessions">管理登录设备</a>
                </div>
            </section>

            <section class="account-card account-settings-card">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconGear()}</span>
                    <div>
                        <h3>邮箱与登录方式</h3>
                        <p>修改绑定邮箱或查看已链接的第三方账号。</p>
                    </div>
                </div>
                <form class="account-form" id="email-form">
                    <label class="account-field">
                        <span>当前邮箱</span>
                        <input type="email" value="${esc(user.value?.email || '')}" disabled>
                    </label>
                    <label class="account-field">
                        <span>新邮箱</span>
                        <input id="new-email" type="email" autocomplete="email" inputmode="email" required>
                    </label>
                    <div class="account-msg hidden" id="email-msg"></div>
                    <button class="account-primary-btn" type="submit" id="email-submit">发送验证邮件</button>
                </form>
                <div class="account-linked-accounts" id="linked-accounts">
                    <div class="account-loading">加载登录方式...</div>
                </div>
            </section>

            <section class="account-card account-settings-card" id="twofa-card">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconGear()}</span>
                    <div>
                        <h3>双因素认证</h3>
                        <p id="twofa-status-text">使用验证器 App 增强账号安全。</p>
                    </div>
                </div>
                <div id="twofa-panel">
                    <div class="account-loading">加载中...</div>
                </div>
            </section>

            <section class="account-card account-settings-card account-settings-card-wide">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconDownload()}</span>
                    <div>
                        <h3>应用与维护</h3>
                        <p>缓存清理、安装到主屏幕与账号操作。</p>
                    </div>
                </div>
                <div class="account-settings-list">
                    ${install}
                    <div class="account-settings-row">
                        <div class="account-settings-row-copy">
                            <strong>本地缓存</strong>
                            <small>清理片库与详情缓存，不会删除收藏、历史或账号信息。</small>
                            <div class="account-msg hidden" id="cache-msg"></div>
                        </div>
                        <button class="account-secondary-btn" id="clear-cache" type="button">清理缓存</button>
                    </div>
                    <div class="account-settings-row danger">
                        <div class="account-settings-row-copy">
                            <strong>账号操作</strong>
                            <small>注销不可恢复；退出登录只会清除当前会话。</small>
                        </div>
                        <div class="account-row-actions">
                            <button class="account-danger-btn" id="account-delete" type="button">注销账号</button>
                            <button class="account-secondary-btn" id="account-signout" type="button">退出登录</button>
                        </div>
                    </div>
                </div>
            </section>

            <section class="account-card account-settings-card account-settings-card-wide" id="orders-card">
                <div class="account-settings-card-head">
                    <span class="account-settings-card-icon" aria-hidden="true">${iconStar()}</span>
                    <div>
                        <h3>消费记录</h3>
                        <p>会员开通与站内消费明细。</p>
                    </div>
                </div>
                <div class="account-orders" id="orders-list">
                    <div class="account-loading">加载中...</div>
                </div>
            </section>
        </div>
    `;

    return renderSectionPage('settings', {
        desc: '资料、密码、缓存与账号安全。',
        body,
    });
}

function bindProfileActions(host, container) {
    bindMediaFilters(host);
    host.querySelectorAll('[data-section-jump]').forEach((button) => {
        button.addEventListener('click', () => setActiveSection(container, button.dataset.sectionJump || 'profile'));
    });
    host.querySelector('#account-profile-checkin')?.addEventListener('click', () => {
        runPointsCheckin(container, host.querySelector('#account-profile-checkin'));
    });
}

async function runPointsCheckin(container, button) {
    if (button) button.disabled = true;
    try {
        const result = await checkinPoints();
        showSiteNotice(`签到成功，获得 ${formatPoints(result.earned)} 积分`, { tone: 'success' });
        await Promise.all([fetchPointsAccount(), fetchPointsTasks()]);
        if (activeSection === 'profile' || activeSection === 'points') renderActiveSection(container);
        refreshAccountSidebar(container);
    } catch (err) {
        const already = err?.code === 'ALREADY_CHECKED_IN' || err?.status === 409;
        const msg = already ? '今日已签到' : (err?.message || '签到失败');
        showSiteNotice(msg, { tone: already ? 'info' : 'error' });
        if (already) {
            await fetchPointsTasks().catch(() => {});
            if (activeSection === 'profile' || activeSection === 'points') renderActiveSection(container);
        } else if (button) {
            button.disabled = false;
        }
    }
}

function bindSettings(host, container) {
    bindProfileForm(host);
    bindPasswordForm(host);
    bindEmailForm(host);
    bindTwoFactorPanel(host);
    bindLinkedAccounts(host);
    bindCacheAction(host);
    host.querySelector('#account-delete')?.addEventListener('click', () => openDeleteDialog());
    host.querySelector('#account-install-btn')?.addEventListener('click', async () => {
        const result = await triggerInstall();
        if (result === 'ios') showSiteNotice('请点击浏览器底部的“分享”按钮，选择“添加到主屏幕”。', { duration: 5000 });
        if (result === 'installed') host.querySelector('#account-install-card')?.remove();
    });
}

function bindNotificationsSection(host) {
    host.querySelector('#account-notifications-refresh')?.addEventListener('click', () => {
        notificationListPage = 1;
        loadAccountNotifications(host, { force: true });
    });
    host.querySelector('#account-notification-filters')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-notification-filter]');
        if (!button) return;
        const next = notificationFilterOptions().find((item) => item.id === button.dataset.notificationFilter);
        if (!next) return;
        notificationFilter = { unreadOnly: next.unreadOnly, type: next.type };
        notificationListPage = 1;
        renderAccountNotificationFilters(host);
        loadAccountNotifications(host, { force: true });
    });
    host.querySelector('#account-notification-prefs')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-mute-type]');
        if (!button) return;
        const type = button.dataset.muteType || '';
        if (!type) return;
        const muted = new Set(notificationPreferences.value?.mutedTypes || []);
        if (muted.has(type)) muted.delete(type);
        else muted.add(type);
        button.disabled = true;
        try {
            await updateNotificationPreferences([...muted]);
            renderAccountNotificationPrefs(host);
        } catch {
            showSiteNotice('偏好保存失败', { tone: 'error' });
        } finally {
            button.disabled = false;
        }
    });
    host.querySelector('#account-notifications-more')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = '加载中...';
        try {
            notificationListPage += 1;
            await loadAccountNotifications(host, { append: true });
        } catch {
            notificationListPage = Math.max(1, notificationListPage - 1);
            showSiteNotice('加载失败', { tone: 'error' });
        } finally {
            button.disabled = false;
            button.textContent = '加载更多';
        }
    });
    host.querySelector('#account-notifications-read-all')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await markNotificationsRead({ all: true });
            renderAccountNotificationState(host);
        } catch {
            button.disabled = false;
        }
    });
    host.querySelector('#account-notification-list')?.addEventListener('click', async (event) => {
        const link = event.target.closest('[data-notification-link]');
        if (!link) return;
        const id = Number(link.dataset.notificationId || 0);
        if (id > 0) {
            markNotificationsRead({ ids: [id] })
                .then(() => renderAccountNotificationState(host))
                .catch(() => {});
        }
    });
}

async function loadAccountNotifications(host, options = {}) {
    const list = host.querySelector('#account-notification-list');
    if (list && !options.append) list.innerHTML = '<div class="account-loading">消息加载中...</div>';
    try {
        await Promise.all([
            fetchNotificationPreferences({ force: options.force }).catch(() => {}),
            loadNotifications({
                force: options.force ?? !notificationSummary.value.loaded,
                unreadOnly: notificationFilter.unreadOnly,
                type: notificationFilter.type,
                page: options.append ? notificationListPage : 1,
                append: Boolean(options.append),
            }),
        ]);
        if (!options.append) notificationListPage = 1;
        renderAccountNotificationState(host);
    } catch {
        if (list && !options.append) list.innerHTML = '<div class="account-empty">消息加载失败，请稍后重试</div>';
    }
}

function renderAccountNotificationState(host) {
    const summary = notificationSummary.value || {};
    const list = host.querySelector('#account-notification-list');
    const count = host.querySelector('#account-notifications-count');
    const readAll = host.querySelector('#account-notifications-read-all');
    const more = host.querySelector('#account-notifications-more');
    if (list && summary.loaded) {
        list.innerHTML = renderNotificationItems(Array.isArray(summary.items) ? summary.items : []);
    }
    if (count) count.textContent = notificationCountText(summary);
    if (readAll) readAll.disabled = Number(summary.unreadCount || 0) <= 0;
    if (more) {
        more.hidden = !summary.hasMore;
        more.disabled = false;
        more.textContent = '加载更多';
    }
    renderAccountNotificationPrefs(host);
    renderAccountNotificationFilters(host);
}

function renderNotificationPrefsHTML() {
    const muted = new Set(notificationPreferences.value?.mutedTypes || []);
    return NOTIFICATION_MUTE_OPTIONS.map((option) => `
        <button type="button" class="account-notify-mute${muted.has(option.type) ? ' is-muted' : ''}" data-mute-type="${esc(option.type)}" aria-pressed="${muted.has(option.type) ? 'true' : 'false'}">${esc(option.label)}</button>
    `).join('');
}

function renderAccountNotificationPrefs(host) {
    const panel = host.querySelector('#account-notification-prefs');
    if (!panel) return;
    panel.innerHTML = `
        <span class="account-notification-prefs-label">轻提示</span>
        ${renderNotificationPrefsHTML()}
    `;
}

function renderAccountNotificationFilters(host) {
    host.querySelectorAll('[data-notification-filter]').forEach((button) => {
        const item = notificationFilterOptions().find((option) => option.id === button.dataset.notificationFilter);
        button.classList.toggle('active', !!item && notificationFilterActive(item));
    });
}

function bindCreatorSection(host) {
    bindCreatorChannelForm(host);
    bindCreatorBroadcastForm(host);
    bindCreatorCollectionForm(host);
    bindCreatorUploadForm(host);
    bindCreatorLiveForm(host);
    bindCreatorUploadActions(host);
    bindCreatorRevenueActions(host);
    host.querySelector('#creator-refresh')?.addEventListener('click', () => {
        loadCreatorStudio(host);
        loadCreatorAnalytics(host, { force: true });
        loadCreatorRevenue(host);
        loadCreatorLiveSessions(host);
    });
}

function bindCreatorRevenueActions(host) {
    const panel = host.querySelector('#creator-revenue');
    if (!panel) return;
    panel.addEventListener('click', async (event) => {
        const exportButton = event.target.closest('[data-creator-revenue-export]');
        if (exportButton) {
            exportButton.disabled = true;
            exportButton.textContent = '导出中...';
            try {
                await downloadCreatorRevenueBill({ days: 30 });
                exportButton.textContent = '已导出账单';
                setTimeout(() => { exportButton.textContent = '导出账单 CSV'; exportButton.disabled = false; }, 1200);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, '账单导出失败'), { tone: 'error' });
                exportButton.disabled = false;
                exportButton.textContent = '导出账单 CSV';
            }
            return;
        }
        const button = event.target.closest('[data-creator-payout-action]');
        if (!button || button.dataset.creatorPayoutAction !== 'request') return;
        const availableCents = Number(button.dataset.availableCents || 0);
        if (!availableCents) return;
        const note = window.prompt('补充结算申请备注（选填）', '申请结算可结算收益')?.trim() || '';
        button.disabled = true;
        button.textContent = '申请中...';
        try {
            await createCreatorPayoutRequest({ amountCents: availableCents, note });
            await loadCreatorRevenue(host);
        } catch (error) {
            showSiteNotice(creatorErrorText(error, '结算申请失败'), { tone: 'error' });
            button.disabled = false;
            button.textContent = '申请结算';
        }
    });
}

function bindCreatorUploadActions(host) {
    const list = host.querySelector('#creator-uploads');
    if (!list) return;
    list.addEventListener('click', async (event) => {
        const bulkButton = event.target.closest('[data-upload-bulk-action]');
        if (bulkButton) {
            const action = bulkButton.dataset.uploadBulkAction;
            const ids = selectedCreatorUploadIds(list);
            if (!ids.length || !action) {
                showSiteNotice('请先勾选要批量操作的作品', { tone: 'error' });
                return;
            }
            const actionText = { publish: '发布', unpublish: '下架', delete: '删除' }[action] || '操作';
            const confirmText = action === 'delete'
                ? `确认批量删除 ${ids.length} 个作品？已发布作品请先下架。`
                : `确认批量${actionText} ${ids.length} 个作品？`;
            if (!window.confirm(confirmText)) return;
            bulkButton.disabled = true;
            bulkButton.textContent = `${actionText}中...`;
            try {
                const result = await batchCreatorUploads({ action, ids });
                showSiteNotice(`批量${actionText}完成：成功 ${Number(result.succeeded || 0)}，失败 ${Number(result.failed || 0)}`, { tone: 'success', duration: 4500 });
                await loadCreatorStudio(host);
                await loadCreatorAnalytics(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, `批量${actionText}失败`), { tone: 'error' });
                bulkButton.disabled = false;
                bulkButton.textContent = actionText;
            }
            return;
        }
        const button = event.target.closest('[data-upload-action]');
        if (!button) return;
        if (button.dataset.uploadAction === 'appeal') {
            await openCreatorAppealDialog(host, {
                type: 'upload',
                uploadId: button.dataset.uploadId,
                title: button.dataset.uploadTitle,
            });
            return;
        }
        if (button.dataset.uploadAction === 'rights') {
            await openCreatorRightsDialog(host, button.dataset.uploadId, button.dataset.uploadTitle, button.dataset.uploadStatus);
            return;
        }
        if (button.dataset.uploadAction === 'retry-transcode') {
            const uploadId = button.dataset.uploadId;
            if (!uploadId) return;
            button.disabled = true;
            button.textContent = '重试中...';
            try {
                await retryCreatorUploadTranscode(uploadId);
                await loadCreatorStudio(host);
                await loadCreatorAnalytics(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, '转码重试失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = '重试转码';
            }
            return;
        }
        if (button.dataset.uploadAction === 'pin' || button.dataset.uploadAction === 'unpin') {
            const uploadId = button.dataset.uploadAction === 'pin' ? button.dataset.uploadId : null;
            const confirmText = uploadId
                ? '确认将这个公开作品置顶到频道首页？'
                : '确认取消当前频道置顶作品？';
            if (!window.confirm(confirmText)) return;
            button.disabled = true;
            button.textContent = uploadId ? '置顶中...' : '取消中...';
            try {
                await setCreatorPinnedUpload(uploadId);
                await loadCreatorStudio(host);
                await loadCreatorAnalytics(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, uploadId ? '置顶失败' : '取消置顶失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = uploadId ? '置顶' : '取消置顶';
            }
            return;
        }
        if (button.dataset.uploadAction === 'danmaku') {
            const uploadId = button.dataset.uploadId;
            const enabled = button.dataset.uploadDanmakuEnabled === 'true';
            if (!uploadId) return;
            button.disabled = true;
            button.textContent = enabled ? '关闭中...' : '开启中...';
            try {
                await updateCreatorUploadDanmaku(uploadId, !enabled);
                await loadCreatorStudio(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, enabled ? '关闭弹幕失败' : '开启弹幕失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = enabled ? '关闭弹幕' : '开启弹幕';
            }
            return;
        }
        if (button.dataset.uploadAction === 'chapters') {
            const uploadId = button.dataset.uploadId;
            if (!uploadId) return;
            const current = decodeURIComponent(button.dataset.uploadChapters || '');
            const value = window.prompt('每行一个章节，格式：秒数 标题。例如：600 核心答疑', current);
            if (value == null) return;
            const chapters = parseCreatorChapterInput(value);
            if (!chapters) {
                showSiteNotice('章节格式无效：时间需递增，标题不能为空，最多 50 条。', { tone: 'error' });
                return;
            }
            button.disabled = true;
            button.textContent = '保存中...';
            try {
                await updateCreatorUploadChapters(uploadId, chapters);
                await loadCreatorStudio(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, '章节保存失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = '编辑章节';
            }
            return;
        }
        if (button.dataset.uploadAction === 'set-status') {
            const uploadId = button.dataset.uploadId;
            const status = button.dataset.uploadStatusTarget;
            if (!uploadId || !status) return;
            const confirmText = status === 'draft'
                ? '确认下架这个作品？下架后观众将无法在公开页看到它。'
                : '确认重新发布这个作品？公开作品会重新进入创作者主页和订阅更新。';
            if (!window.confirm(confirmText)) return;
            button.disabled = true;
            button.textContent = status === 'draft' ? '下架中...' : '发布中...';
            try {
                await updateCreatorUploadStatus(uploadId, { status });
                await loadCreatorStudio(host);
                await loadCreatorAnalytics(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, status === 'draft' ? '下架失败' : '发布失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = status === 'draft' ? '下架' : '发布';
            }
            return;
        }
        if (button.dataset.uploadAction === 'delete') {
            const uploadId = button.dataset.uploadId;
            if (!uploadId) return;
            if (!window.confirm('确认删除这个作品？删除后将从创作者中心隐藏，已发布作品请先下架。')) return;
            button.disabled = true;
            button.textContent = '删除中...';
            try {
                await deleteCreatorUpload(uploadId);
                await loadCreatorStudio(host);
                await loadCreatorAnalytics(host);
            } catch (error) {
                showSiteNotice(creatorErrorText(error, '删除失败'), { tone: 'error' });
                button.disabled = false;
                button.textContent = '删除';
            }
            return;
        }
        if (button.dataset.uploadAction !== 'attach-source') return;
        const uploadId = button.dataset.uploadId;
        const sourcePath = window.prompt('请输入刚上传完成的对象路径（uploads/... 或 videos/...）', '')?.trim();
        if (!uploadId || !sourcePath) return;
        button.disabled = true;
        try {
            await attachCreatorUploadSource(uploadId, { sourcePath });
            await loadCreatorStudio(host);
            await loadCreatorAnalytics(host);
        } catch (error) {
            showSiteNotice(creatorErrorText(error, '绑定源文件失败'), { tone: 'error' });
            button.disabled = false;
        }
    });
}

async function openCreatorAppealDialog(host, { type = 'upload', uploadId = '', title = '' } = {}) {
    const isChannelAppeal = type === 'channel';
    if (!isChannelAppeal && !uploadId) return;
    const dialog = document.createElement('div');
    dialog.className = 'creator-rights-dialog';
    dialog.innerHTML = renderCreatorAppealDialog({
        title: title || (isChannelAppeal ? '创作者频道' : '未命名投稿'),
        type,
        loading: true,
    });
    document.body.appendChild(dialog);

    const close = () => dialog.remove();
    dialog.addEventListener('click', (event) => {
        if (event.target.matches('[data-appeal-close], .creator-rights-backdrop')) close();
    });

    let appeals = [];
    try {
        const data = isChannelAppeal
            ? await listCreatorChannelAppeals()
            : await listCreatorUploadAppeals(uploadId);
        appeals = data.items || [];
        dialog.innerHTML = renderCreatorAppealDialog({
            title: title || (isChannelAppeal ? '创作者频道' : '未命名投稿'),
            type,
            appeals,
        });
    } catch (error) {
        dialog.innerHTML = renderCreatorAppealDialog({
            title: title || (isChannelAppeal ? '创作者频道' : '未命名投稿'),
            type,
            error: creatorErrorText(error, '申诉记录加载失败'),
        });
        return;
    }

    const form = dialog.querySelector('#creator-appeal-form');
    const message = dialog.querySelector('#creator-appeal-msg');
    const submit = dialog.querySelector('#creator-appeal-submit');
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const reason = form.reason.value.replace(/\s+/g, ' ').trim();
        const evidenceUrl = form.evidenceUrl.value.trim();
        if (reason.length < 10) {
            showMsg(message, '申诉原因至少 10 个字符，请补充具体依据。', false);
            return;
        }
        submit.disabled = true;
        submit.textContent = '提交中...';
        try {
            if (isChannelAppeal) {
                await createCreatorChannelAppeal({ reason, evidenceUrl });
            } else {
                await createCreatorUploadAppeal(uploadId, { reason, evidenceUrl });
            }
            showMsg(message, '申诉已提交，平台运营会在申诉队列中复核。', true);
            const data = isChannelAppeal
                ? await listCreatorChannelAppeals()
                : await listCreatorUploadAppeals(uploadId);
            appeals = data.items || [];
            dialog.innerHTML = renderCreatorAppealDialog({
                title: title || (isChannelAppeal ? '创作者频道' : '未命名投稿'),
                type,
                appeals,
                notice: '申诉已提交，平台运营会在申诉队列中复核。',
            });
            await loadCreatorStudio(host);
        } catch (error) {
            showMsg(message, creatorErrorText(error, '申诉提交失败'), false);
            submit.disabled = false;
            submit.textContent = '提交申诉';
        }
    });
}

async function openCreatorRightsDialog(host, uploadId, uploadTitle, uploadStatus) {
    if (!uploadId) return;
    const published = uploadStatus === 'published';
    const dialog = document.createElement('div');
    dialog.className = 'creator-rights-dialog';
    dialog.innerHTML = renderCreatorRightsDialog({
        title: uploadTitle || '未命名投稿',
        loading: true,
        published,
    });
    document.body.appendChild(dialog);

    const close = () => dialog.remove();
    dialog.addEventListener('click', (event) => {
        if (event.target.matches('[data-rights-close], .creator-rights-backdrop')) close();
    });

    try {
        const data = await getCreatorUploadRights(uploadId);
        dialog.innerHTML = renderCreatorRightsDialog({
            title: uploadTitle || '未命名投稿',
            rights: data.rights || null,
            published,
        });
    } catch (error) {
        dialog.innerHTML = renderCreatorRightsDialog({
            title: uploadTitle || '未命名投稿',
            error: creatorErrorText(error, '版权声明加载失败'),
            published,
        });
        return;
    }

    const form = dialog.querySelector('#creator-rights-form');
    const message = dialog.querySelector('#creator-rights-msg');
    const submit = dialog.querySelector('#creator-rights-submit');
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (published) {
            showMsg(message, '已发布作品的版权声明需联系平台运营复核。', false);
            return;
        }
        const payload = creatorRightsPayload(new FormData(form));
        if (payload.declarationType === 'licensed' && (!payload.ownerName || !payload.licenseUrl)) {
            showMsg(message, '授权内容需要填写权利方和授权链接。', false);
            return;
        }
        if (payload.declarationType === 'fair_use' && !payload.notes) {
            showMsg(message, '合理使用声明需要补充说明。', false);
            return;
        }
        submit.disabled = true;
        submit.textContent = '提交中...';
        try {
            await saveCreatorUploadRights(uploadId, payload);
            showMsg(message, '版权声明已提交，等待平台审核。', true);
            await loadCreatorStudio(host);
        } catch (error) {
            showMsg(message, creatorErrorText(error, '版权声明提交失败'), false);
        } finally {
            submit.disabled = false;
            submit.textContent = '提交声明';
        }
    });
}

function creatorRightsPayload(formData) {
    return {
        declarationType: String(formData.get('declarationType') || 'original'),
        ownerName: String(formData.get('ownerName') || '').trim() || null,
        licenseUrl: String(formData.get('licenseUrl') || '').trim() || null,
        territories: String(formData.get('territories') || '').trim() || 'worldwide',
        expiresAt: String(formData.get('expiresAt') || '').trim() || null,
        monetizationAllowed: formData.get('monetizationAllowed') === 'on',
        notes: String(formData.get('notes') || '').trim() || null,
    };
}

function bindCreatorChannelForm(host) {
    const form = host.querySelector('#creator-channel-form');
    const handle = host.querySelector('#creator-handle');
    const displayNameInput = host.querySelector('#creator-display-name');
    const bio = host.querySelector('#creator-bio');
    const announcement = host.querySelector('#creator-announcement');
    const msg = host.querySelector('#creator-channel-msg');
    const btn = host.querySelector('#creator-channel-submit');
    if (!form || !handle || !displayNameInput || !bio || !announcement || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            handle: handle.value.trim(),
            displayName: displayNameInput.value.trim(),
            bio: bio.value.trim(),
            announcement: announcement.value.trim(),
        };
        if (!payload.handle || !payload.displayName) {
            showMsg(msg, '频道标识和名称不能为空', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '保存中...';
        try {
            await saveCreatorChannel(payload);
            showMsg(msg, '频道资料已保存', true);
            await loadCreatorStudio(host);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '保存失败'), false);
        } finally {
            btn.disabled = false;
            btn.textContent = '保存频道';
        }
    });

    host.querySelector('#creator-channel-appeal')?.addEventListener('click', () => {
        const status = host.dataset.creatorChannelStatus || '';
        if (status !== 'rejected' && status !== 'suspended') return;
        openCreatorAppealDialog(host, {
            type: 'channel',
            title: host.querySelector('#creator-display-name')?.value || '创作者频道',
        });
    });
}

function bindCreatorBroadcastForm(host) {
    const form = host.querySelector('#creator-broadcast-form');
    const title = host.querySelector('#creator-broadcast-title');
    const content = host.querySelector('#creator-broadcast-content');
    const msg = host.querySelector('#creator-broadcast-msg');
    const btn = host.querySelector('#creator-broadcast-submit');
    if (!form || !title || !content || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            title: title.value.trim(),
            content: content.value.trim(),
        };
        if (!payload.title || !payload.content) {
            showMsg(msg, '广播标题和内容不能为空', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '发送中...';
        try {
            const result = await sendCreatorBroadcast(payload);
            form.reset();
            showMsg(msg, `广播已发送，触达 ${Number(result.sent || 0).toLocaleString()} 位关注者`, true);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '广播发送失败'), false);
        } finally {
            btn.disabled = false;
            btn.textContent = '发送广播';
        }
    });
}

function bindCreatorCollectionForm(host) {
    const form = host.querySelector('#creator-collection-form');
    const title = host.querySelector('#creator-collection-title');
    const visibility = host.querySelector('#creator-collection-visibility');
    const uploadIds = host.querySelector('#creator-collection-upload-ids');
    const description = host.querySelector('#creator-collection-description');
    const msg = host.querySelector('#creator-collection-msg');
    const btn = host.querySelector('#creator-collection-submit');
    if (!form || !title || !visibility || !uploadIds || !description || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ids = uploadIds.value.split(/[,\n\s]+/).map((item) => item.trim()).filter(Boolean);
        if (!title.value.trim() || !ids.length) {
            showMsg(msg, '合集标题和作品 ID 不能为空', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '创建中...';
        try {
            await createCreatorCollection({
                title: title.value.trim(),
                description: description.value.trim(),
                visibility: visibility.value,
                uploadIds: ids,
            });
            form.reset();
            showMsg(msg, '合集已创建', true);
            await loadCreatorStudio(host);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '合集创建失败'), false);
        } finally {
            btn.disabled = false;
            btn.textContent = '创建合集';
        }
    });
}

function bindCreatorUploadForm(host) {
    const form = host.querySelector('#creator-upload-form');
    const title = host.querySelector('#creator-upload-title');
    const contentType = host.querySelector('#creator-upload-type');
    const visibility = host.querySelector('#creator-upload-visibility');
    const sourcePath = host.querySelector('#creator-upload-source');
    const description = host.querySelector('#creator-upload-description');
    const duration = host.querySelector('#creator-upload-duration');
    const width = host.querySelector('#creator-upload-width');
    const height = host.querySelector('#creator-upload-height');
    const tags = host.querySelector('#creator-upload-tags');
    const coverFrame = host.querySelector('#creator-upload-cover-frame');
    const msg = host.querySelector('#creator-upload-msg');
    const btn = host.querySelector('#creator-upload-submit');
    const fileInput = host.querySelector('#creator-upload-file');
    const uploadBtn = host.querySelector('#creator-file-upload-btn');
    const uploadStatus = host.querySelector('#creator-file-upload-status');
    if (!form || !title || !contentType || !visibility || !sourcePath || !description || !msg || !btn) return;

    uploadBtn?.addEventListener('click', async () => {
        const file = fileInput?.files?.[0];
        if (!file) {
            showUploadStatus(uploadStatus, '请选择要上传的视频文件', false);
            return;
        }
        uploadBtn.disabled = true;
        uploadBtn.textContent = '申请上传...';
        showUploadStatus(uploadStatus, '正在申请上传凭证...', true);
        try {
            const intent = await requestCreatorUploadIntent({
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || guessMimeType(file.name),
            });
            uploadBtn.textContent = '上传中...';
            const result = await uploadCreatorObject(intent, file, {
                onProgress: (percent) => showUploadStatus(uploadStatus, `上传中 ${percent}%`, true),
            });
            sourcePath.value = intent.sourcePath || '';
            showUploadStatus(uploadStatus, `上传完成：${formatFileSize(result?.size || file.size)} · ${result?.contentType || file.type || '未知类型'}，对象路径已回填`, true);
        } catch (error) {
            showUploadStatus(uploadStatus, creatorErrorText(error, '上传失败'), false);
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = '上传到媒体库';
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            title: title.value.trim(),
            contentType: contentType.value,
            visibility: visibility.value,
            sourcePath: sourcePath.value.trim(),
            description: description.value.trim(),
            durationSeconds: duration?.value ? Number(duration.value) : undefined,
            width: width?.value ? Number(width.value) : undefined,
            height: height?.value ? Number(height.value) : undefined,
            topicTags: tags?.value ? tags.value : undefined,
            coverFrameSeconds: coverFrame?.value ? Number(coverFrame.value) : undefined,
        };
        if (!payload.title) {
            showMsg(msg, '标题不能为空', false);
            return;
        }
        if (payload.contentType === 'short' && payload.sourcePath) {
            if (!payload.durationSeconds || payload.durationSeconds > 180) {
                showMsg(msg, '短视频需填写 1-180 秒的时长', false);
                return;
            }
            if (!payload.width || !payload.height || payload.width / payload.height < 0.45 || payload.width / payload.height > 0.8) {
                showMsg(msg, '短视频需填写竖版宽高，建议 9:16', false);
                return;
            }
        }
        btn.disabled = true;
        btn.textContent = '提交中...';
        try {
            await createCreatorUpload(payload);
            form.reset();
            visibility.value = 'private';
            showMsg(msg, payload.sourcePath ? '投稿已进入审核队列' : '草稿已创建，可稍后补充对象路径', true);
            await loadCreatorStudio(host);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '提交失败'), false);
        } finally {
            btn.disabled = false;
            btn.textContent = '提交审核';
        }
    });
}

function bindCreatorLiveForm(host) {
    const form = host.querySelector('#creator-live-form');
    const title = host.querySelector('#creator-live-title');
    const scheduled = host.querySelector('#creator-live-scheduled');
    const visibility = host.querySelector('#creator-live-visibility');
    const description = host.querySelector('#creator-live-description');
    const msg = host.querySelector('#creator-live-msg');
    const btn = host.querySelector('#creator-live-submit');
    const list = host.querySelector('#creator-live-sessions');
    if (!form || !title || !scheduled || !visibility || !description || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            title: title.value.trim(),
            description: description.value.trim(),
            scheduledStartAt: scheduled.value ? new Date(scheduled.value).toISOString() : null,
            visibility: visibility.value,
        };
        if (!payload.title) {
            showMsg(msg, '直播标题不能为空', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '创建中...';
        try {
            await createCreatorLiveSession(payload);
            form.reset();
            visibility.value = 'private';
            showMsg(msg, '直播排期已创建', true);
            await loadCreatorLiveSessions(host);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '创建失败'), false);
        } finally {
            btn.disabled = false;
            btn.textContent = '创建排期';
        }
    });

    list?.addEventListener('click', async (event) => {
        const muteButton = event.target.closest('[data-live-mute-action]');
        if (muteButton) {
            const liveId = muteButton.dataset.liveId;
            const userId = muteButton.dataset.liveMuteUser;
            if (!liveId || !userId) return;
            muteButton.disabled = true;
            try {
                await unmuteCreatorLiveUser(liveId, userId);
                await loadCreatorLiveMutes(host, liveId);
            } catch (error) {
                showMsg(msg, creatorErrorText(error, '解除禁言失败'), false);
                muteButton.disabled = false;
            }
            return;
        }

        const button = event.target.closest('[data-live-action]');
        if (!button) return;
        if (button.dataset.liveAction === 'notice') {
            const notice = window.prompt('设置直播间置顶公告（留空将清除公告）', button.dataset.liveNotice || '')?.trim() || '';
            button.disabled = true;
            try {
                await updateCreatorLivePinnedNotice(button.dataset.liveId, notice);
                await loadCreatorLiveSessions(host);
            } catch (error) {
                showMsg(msg, creatorErrorText(error, '公告更新失败'), false);
                button.disabled = false;
            }
            return;
        }
        if (button.dataset.liveAction === 'mutes') {
            await loadCreatorLiveMutes(host, button.dataset.liveId);
            return;
        }
        if (button.dataset.liveAction === 'stats') {
            await loadCreatorLiveStats(host, button.dataset.liveId);
            return;
        }
        button.disabled = true;
        try {
            await updateCreatorLiveSession(button.dataset.liveId, { status: button.dataset.liveAction });
            await loadCreatorLiveSessions(host);
        } catch (error) {
            showMsg(msg, creatorErrorText(error, '状态更新失败'), false);
            button.disabled = false;
        }
    });
}

async function loadCreatorStudio(root) {
    const status = root.querySelector('#creator-channel-status');
    const summary = root.querySelector('#creator-summary');
    const list = root.querySelector('#creator-uploads');
    const collections = root.querySelector('#creator-collections');
    if (status) status.textContent = '同步中';
    if (summary) summary.innerHTML = renderCreatorSummary();
    if (list) list.innerHTML = '<div class="account-loading">加载中...</div>';
    if (collections) collections.innerHTML = '<div class="account-loading">加载中...</div>';

    try {
        const data = await getCreatorStudio();
        fillCreatorChannel(root, data.channel);
        if (status) status.textContent = data.channel ? channelStatusText(data.channel.status) : '未开通';
        if (summary) summary.innerHTML = renderCreatorSummary(data.summary, data.analytics);
        if (list) list.innerHTML = renderCreatorUploads(data.recentUploads || [], data.analytics, data.channel);
        if (collections) collections.innerHTML = renderCreatorCollections(data.collections || []);
        root.classList.toggle('creator-has-channel', Boolean(data.channel));
        root.dataset.creatorChannelStatus = data.channel?.status || '';
        root.dataset.creatorPinnedUploadId = data.channel?.pinnedUploadId || '';
        updateCreatorCapabilityGate(root, data.channel);
    } catch (error) {
        if (status) status.textContent = '同步失败';
        if (summary) summary.innerHTML = renderCreatorSummary();
        if (list) list.innerHTML = `<div class="account-empty">${esc(creatorErrorText(error, '创作者中心加载失败'))}</div>`;
        if (collections) collections.innerHTML = `<div class="account-empty">${esc(creatorErrorText(error, '合集加载失败'))}</div>`;
        root.dataset.creatorChannelStatus = '';
        root.dataset.creatorPinnedUploadId = '';
        updateCreatorCapabilityGate(root, null);
    }
}

async function loadCreatorLiveSessions(root) {
    const panel = root.querySelector('#creator-live-sessions');
    if (!panel) return;
    panel.innerHTML = '<div class="account-loading">加载中...</div>';
    try {
        const data = await listCreatorLiveSessions();
        panel.innerHTML = renderCreatorLiveSessions(data.items || []);
        updateCreatorCapabilityGate(root, data.channel || currentCreatorChannelFromRoot(root));
    } catch (error) {
        panel.innerHTML = `<div class="account-empty">${esc(creatorErrorText(error, '直播排期加载失败'))}</div>`;
        updateCreatorCapabilityGate(root, currentCreatorChannelFromRoot(root));
    }
}

async function loadCreatorLiveMutes(root, liveId) {
    if (!liveId) return;
    const panel = root.querySelector(`#creator-live-mutes-${cssEscape(liveId)}`);
    if (!panel) return;
    panel.innerHTML = '<div class="account-loading">加载禁言名单...</div>';
    try {
        const data = await listCreatorLiveMutes(liveId);
        panel.innerHTML = renderCreatorLiveMutes(liveId, data.items || []);
    } catch (error) {
        panel.innerHTML = `<div class="creator-review-note">${esc(creatorErrorText(error, '禁言名单加载失败'))}</div>`;
    }
}

async function loadCreatorLiveStats(root, liveId) {
    if (!liveId) return;
    const panel = root.querySelector(`#creator-live-stats-${cssEscape(liveId)}`);
    if (!panel) return;
    panel.innerHTML = '<div class="account-loading">加载实时统计...</div>';
    try {
        const data = await getCreatorLiveStats(liveId);
        panel.innerHTML = renderCreatorLiveStats(data.stats || {});
    } catch (error) {
        panel.innerHTML = `<div class="creator-review-note">${esc(creatorErrorText(error, '实时统计加载失败'))}</div>`;
    }
}

function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function loadCreatorAnalytics(root) {
    const panel = root.querySelector('#creator-analytics');
    if (!panel) return;
    panel.innerHTML = renderCreatorAnalytics();
    try {
        const data = await getCreatorAnalyticsOverview({ days: 30, limit: 10 });
        panel.innerHTML = renderCreatorAnalytics(data.analytics, data.channel);
    } catch (error) {
        panel.innerHTML = `
            <div class="creator-empty-state">
                <strong>数据分析加载失败</strong>
                <small>${esc(creatorErrorText(error, '可稍后刷新重试，频道和作品管理不受影响。'))}</small>
            </div>
        `;
    }
}

async function loadCreatorRevenue(root) {
    const panel = root.querySelector('#creator-revenue');
    if (!panel) return;
    panel.innerHTML = renderCreatorRevenue();
    try {
        const [summaryResult, ledgerResult, payoutResult] = await Promise.allSettled([
            getCreatorRevenueSummary({ days: 30 }),
            getCreatorRevenueLedger({ days: 30 }),
            listCreatorPayoutRequests(),
        ]);
        if (summaryResult.status !== 'fulfilled') throw summaryResult.reason;
        const ledger = ledgerResult.status === 'fulfilled'
            ? ledgerResult.value.ledger
            : { items: [], error: creatorErrorText(ledgerResult.reason, '流水加载失败，可稍后刷新重试。') };
        const payouts = payoutResult.status === 'fulfilled'
            ? payoutResult.value
            : { items: [], availableCents: 0, available: '¥0.00', error: creatorErrorText(payoutResult.reason, '结算申请记录加载失败。') };
        panel.innerHTML = renderCreatorRevenue(summaryResult.value.revenue, ledger, summaryResult.value.channel, payouts);
    } catch (error) {
        panel.innerHTML = `
            <div class="creator-empty-state">
                <strong>收益中心加载失败</strong>
                <small>${esc(creatorErrorText(error, '可稍后刷新重试，作品管理不受影响。'))}</small>
            </div>
        `;
    }
}

function fillCreatorChannel(root, channel) {
    const handle = root.querySelector('#creator-handle');
    const displayNameInput = root.querySelector('#creator-display-name');
    const bio = root.querySelector('#creator-bio');
    const announcement = root.querySelector('#creator-announcement');
    const appealButton = root.querySelector('#creator-channel-appeal');
    if (!handle || !displayNameInput || !bio || !announcement) return;
    if (appealButton) {
        appealButton.classList.toggle('hidden', !canAppealCreatorChannel(channel));
        appealButton.dataset.channelTitle = channel?.displayName || channel?.handle || '创作者频道';
    }
    if (!channel) return;
    handle.value = channel.handle || '';
    displayNameInput.value = channel.displayName || '';
    bio.value = channel.bio || '';
    announcement.value = channel.announcement || '';
}

function creatorCanPublish(channel) {
    return channel?.status === 'active';
}

function canAppealCreatorChannel(channel) {
    return channel?.status === 'rejected' || channel?.status === 'suspended';
}

function currentCreatorChannelFromRoot(root) {
    const status = root.dataset.creatorChannelStatus || '';
    return status ? { status } : null;
}

function creatorGateMessage(channel) {
    if (!channel) return '请先保存频道资料并提交入驻审核，通过后即可上传作品和创建直播。';
    if (channel.status === 'pending') return '频道正在审核中。审核通过前，上传、直播、收益和广告准入暂不可用。';
    if (channel.status === 'rejected') return '频道入驻已被驳回。你可以修改频道资料后重新提交审核。';
    if (channel.status === 'suspended') return '频道已被平台停用。上传、直播、收益和广告准入已暂停，请联系平台处理。';
    return '';
}

function updateCreatorCapabilityGate(root, channel) {
    const canPublish = creatorCanPublish(channel);
    const message = creatorGateMessage(channel);
    [
        ['#creator-upload-gate', '#creator-upload-form'],
        ['#creator-live-gate', '#creator-live-form'],
        ['#creator-collection-gate', '#creator-collection-form'],
        ['#creator-broadcast-gate', '#creator-broadcast-form'],
    ].forEach(([gateSelector, formSelector]) => {
        const gate = root.querySelector(gateSelector);
        const form = root.querySelector(formSelector);
        if (gate) {
            gate.textContent = message;
            gate.classList.toggle('hidden', canPublish);
            gate.classList.toggle('err', !canPublish);
            gate.classList.toggle('ok', canPublish);
        }
        form?.querySelectorAll('input, select, textarea, button').forEach((control) => {
            control.disabled = !canPublish;
        });
    });
    root.querySelectorAll('[data-live-action], [data-upload-action], #creator-file-upload-btn').forEach((control) => {
        control.disabled = !canPublish;
    });
}

function bindMediaFilters(host) {
    const preview = host.querySelector('#account-media-preview');
    if (!preview) return;
    host.querySelectorAll('[data-media-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            host.querySelectorAll('[data-media-filter]').forEach((btn) => btn.classList.toggle('active', btn === button));
            const type = button.dataset.mediaFilter || 'favorites';
            preview.innerHTML = renderPosterPreview(type === 'watchLater' ? watchLater.value || [] : favorites.value || [], type);
        });
    });
}

function bindProfileForm(root) {
    const form = root.querySelector('#profile-form');
    const input = root.querySelector('#profile-name');
    const msg = root.querySelector('#profile-msg');
    const btn = root.querySelector('#profile-submit');
    if (!form || !input || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) {
            showMsg(msg, '昵称不能为空', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '保存中...';
        const result = await updateProfile(name);
        btn.disabled = false;
        btn.textContent = '保存昵称';
        if (result.success) {
            showMsg(msg, '昵称已更新', true);
            document.querySelectorAll('.account-name').forEach((el) => { el.textContent = name; });
        } else {
            showMsg(msg, result.error || '保存失败', false);
        }
    });
}

function bindPasswordForm(root) {
    const form = root.querySelector('#password-form');
    const cur = root.querySelector('#cur-password');
    const next = root.querySelector('#new-password');
    const confirm = root.querySelector('#confirm-password');
    const msg = root.querySelector('#password-msg');
    const btn = root.querySelector('#password-submit');
    if (!form || !cur || !next || !confirm || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (next.value.length < 6) {
            showMsg(msg, '新密码至少 6 位', false);
            return;
        }
        if (next.value !== confirm.value) {
            showMsg(msg, '两次输入的新密码不一致', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '修改中...';
        const result = await changePassword(cur.value, next.value);
        btn.disabled = false;
        btn.textContent = '修改密码';
        if (result.success) {
            showMsg(msg, '密码修改成功', true);
            form.reset();
        } else {
            showMsg(msg, result.error || '修改失败', false);
        }
    });
}

function bindEmailForm(root) {
    const form = root.querySelector('#email-form');
    const input = root.querySelector('#new-email');
    const msg = root.querySelector('#email-msg');
    const btn = root.querySelector('#email-submit');
    if (!form || !input || !msg || !btn) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const newEmail = String(input.value || '').trim().toLowerCase();
        if (!newEmail || !newEmail.includes('@')) {
            showMsg(msg, '请输入有效邮箱', false);
            return;
        }
        btn.disabled = true;
        btn.textContent = '发送中...';
        const result = await changeEmail(newEmail);
        btn.disabled = false;
        btn.textContent = '发送验证邮件';
        if (result.success) {
            showMsg(msg, result.message || '验证邮件已发送', true);
            input.value = '';
        } else {
            showMsg(msg, result.error || '发送失败', false);
        }
    });
}

async function bindLinkedAccounts(root) {
    const host = root.querySelector('#linked-accounts');
    if (!host) return;
    const result = await listLinkedAccounts();
    if (!result.success) {
        host.innerHTML = '<div class="account-empty">登录方式加载失败</div>';
        return;
    }
    const accounts = result.accounts || [];
    if (!accounts.length) {
        host.innerHTML = '<div class="account-empty">暂无已链接的第三方账号</div>';
        return;
    }
    host.innerHTML = accounts.map((item) => {
        const provider = esc(String(item.providerId || item.provider || '账号'));
        return `<div class="account-settings-row"><div class="account-settings-row-copy"><strong>${provider}</strong><small>${esc(item.accountId || item.id || '')}</small></div></div>`;
    }).join('');
}

async function bindTwoFactorPanel(root) {
    const panel = root.querySelector('#twofa-panel');
    const statusText = root.querySelector('#twofa-status-text');
    if (!panel) return;

    const enabled = Boolean(user.value?.twoFactorEnabled);
    if (statusText) {
        statusText.textContent = enabled
            ? '双因素认证已开启，登录时需输入验证器代码。'
            : '使用验证器 App 增强账号安全。';
    }

    if (enabled) {
        panel.innerHTML = `
            <form class="account-form" id="twofa-disable-form">
                <label class="account-field">
                    <span>当前密码（关闭 2FA）</span>
                    <input id="twofa-disable-password" type="password" autocomplete="current-password" required>
                </label>
                <div class="account-msg hidden" id="twofa-msg"></div>
                <div class="account-row-actions">
                    <button class="account-danger-btn" type="submit" id="twofa-disable-btn">关闭双因素认证</button>
                    <button class="account-secondary-btn" type="button" id="twofa-regen-btn">重新生成备用码</button>
                </div>
            </form>
        `;
        const form = panel.querySelector('#twofa-disable-form');
        const msg = panel.querySelector('#twofa-msg');
        const regenBtn = panel.querySelector('#twofa-regen-btn');
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const password = panel.querySelector('#twofa-disable-password')?.value || '';
            const btn = panel.querySelector('#twofa-disable-btn');
            if (btn) { btn.disabled = true; btn.textContent = '处理中...'; }
            const result = await disableTwoFactor(password);
            if (btn) { btn.disabled = false; btn.textContent = '关闭双因素认证'; }
            if (result.success) {
                showMsg(msg, '双因素认证已关闭', true);
                bindTwoFactorPanel(root);
            } else {
                showMsg(msg, result.error || '关闭失败', false);
            }
        });
        regenBtn?.addEventListener('click', async () => {
            const password = window.prompt('输入当前密码以重新生成备用码');
            if (!password) return;
            regenBtn.disabled = true;
            const result = await regenerateBackupCodes(password);
            regenBtn.disabled = false;
            if (result.success && result.backupCodes?.length) {
                showSiteNotice(`请妥善保存备用码（仅用一次）：\n\n${result.backupCodes.join('\n')}`, {
                    title: '备份码',
                    multiline: true,
                    duration: 20000,
                });
            } else {
                showSiteNotice(result.error || '生成失败', { tone: 'error' });
            }
        });
        return;
    }

    panel.innerHTML = `
        <form class="account-form" id="twofa-enable-form">
            <label class="account-field">
                <span>当前密码</span>
                <input id="twofa-enable-password" type="password" autocomplete="current-password" required>
            </label>
            <div class="account-msg hidden" id="twofa-msg"></div>
            <button class="account-primary-btn" type="submit" id="twofa-enable-btn">开启双因素认证</button>
        </form>
        <div class="hidden" id="twofa-setup">
            <p class="account-settings-row-copy"><small>用验证器 App 扫描下方链接（或手动输入 URI），然后输入 6 位验证码完成绑定。</small></p>
            <label class="account-field">
                <span>TOTP URI</span>
                <input id="twofa-uri" type="text" readonly>
            </label>
            <label class="account-field">
                <span>验证码</span>
                <input id="twofa-verify-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
            </label>
            <button class="account-primary-btn" type="button" id="twofa-verify-btn">确认验证码</button>
        </div>
    `;

    const form = panel.querySelector('#twofa-enable-form');
    const setup = panel.querySelector('#twofa-setup');
    const msg = panel.querySelector('#twofa-msg');
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = panel.querySelector('#twofa-enable-password')?.value || '';
        const btn = panel.querySelector('#twofa-enable-btn');
        if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
        const result = await enableTwoFactor(password);
        if (btn) { btn.disabled = false; btn.textContent = '开启双因素认证'; }
        if (!result.success) {
            showMsg(msg, result.error || '开启失败', false);
            return;
        }
        form.classList.add('hidden');
        setup?.classList.remove('hidden');
        const uriInput = panel.querySelector('#twofa-uri');
        if (uriInput) uriInput.value = result.totpURI || '';
        if (result.backupCodes?.length) {
            showMsg(msg, `备用码已生成，请保存：${result.backupCodes.join('、')}`, true);
        }
    });
    panel.querySelector('#twofa-verify-btn')?.addEventListener('click', async () => {
        const code = panel.querySelector('#twofa-verify-code')?.value?.trim() || '';
        const btn = panel.querySelector('#twofa-verify-btn');
        if (!code) return;
        if (btn) { btn.disabled = true; btn.textContent = '验证中...'; }
        const result = await verifyTwoFactorTotp(code, true);
        if (btn) { btn.disabled = false; btn.textContent = '确认验证码'; }
        if (result.success) {
            if (user.value) user.value = { ...user.value, twoFactorEnabled: true };
            showMsg(msg, '双因素认证已开启', true);
            bindTwoFactorPanel(root);
        } else {
            showMsg(msg, result.error || '验证码错误', false);
        }
    });
}

function bindCacheAction(root) {
    const btn = root.querySelector('#clear-cache');
    const msg = root.querySelector('#cache-msg');
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

async function loadOrders(root) {
    const list = root.querySelector('#orders-list');
    if (!list) return;
    list.innerHTML = '<div class="account-loading">加载中...</div>';
    try {
        const res = await fetch(`${API_V1_BASE}/me/orders`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const items = data.items || [];
        list.innerHTML = items.length ? items.slice(0, 8).map(renderOrderItem).join('') : renderEmpty('暂无消费记录');
    } catch {
        list.innerHTML = '<div class="account-empty">消费记录加载失败</div>';
    }
}

function renderNavButton(section, stats = accountStats()) {
    const selected = section.id === activeSection;
    const badge = section.id === 'notifications' && stats.unread > 0
        ? `<span class="account-nav-badge">${stats.unread > 99 ? '99+' : stats.unread}</span>`
        : '';
    return `
        <button class="account-nav-item ${selected ? 'active' : ''}" type="button" data-section="${section.id}" aria-current="${selected ? 'page' : 'false'}">
            <span class="account-nav-icon" aria-hidden="true">${section.icon()}</span>
            <span class="account-nav-copy">
                <strong>${esc(section.label)}</strong>
                <small>${esc(section.sublabel)}</small>
            </span>
            ${badge}
        </button>
    `;
}

function renderSectionPill(section, stats = accountStats()) {
    const selected = section.id === activeSection;
    const badge = section.id === 'notifications' && stats.unread > 0
        ? `<span class="account-pill-badge">${stats.unread > 99 ? '99+' : stats.unread}</span>`
        : '';
    return `
        <button class="account-section-pill ${selected ? 'active' : ''}" type="button" data-section="${section.id}" aria-current="${selected ? 'page' : 'false'}">
            <span class="account-pill-icon" aria-hidden="true">${section.icon()}</span>
            <span>${esc(section.label)}</span>
            ${badge}
        </button>
    `;
}

function renderAccountMasthead(u, stats) {
    const latest = getLatestResumeItem();
    const resumeTitle = latest?.item?.name
        ? (latest.item.name.length > 10 ? `${latest.item.name.slice(0, 10)}…` : latest.item.name)
        : '暂无进度';
    return `
        <header class="account-masthead">
            <div class="account-masthead-user">
                <div class="account-masthead-profile">
                    ${renderAvatar(u, 'account-avatar-xl')}
                    <div class="account-masthead-copy">
                        <h1 class="account-masthead-name">
                            ${esc(displayName(u))}
                            ${hasVipAccess() ? '<span class="account-vip-mark" aria-label="VIP 会员">VIP</span>' : ''}
                        </h1>
                        <div class="account-masthead-links">
                            <button type="button" data-section="watchlist">收藏 ${esc(String(stats.favorites))}</button>
                            <button type="button" data-section="downloads">稍后看 ${esc(String(stats.watchLater))}</button>
                            <button type="button" data-section="history">看过 ${esc(String(stats.history))}</button>
                            <button type="button" data-section-jump="settings">账号设置</button>
                        </div>
                        ${playbackPermission.value ? `<p class="account-permission-hint">${esc(permissionQuotaText())}</p>` : ''}
                        ${librarySyncHint() ? `<p class="account-permission-hint account-library-sync-hint">${esc(librarySyncHint())}</p>` : ''}
                    </div>
                </div>
            </div>
            <div class="account-masthead-vip" aria-label="会员与快捷入口">
                <a class="account-vip-col" href="#/vip">
                    <strong>影视会员</strong>
                    <span>${esc(hasVipAccess() ? vipBadgeText() : '高清片库 · 多端同步')}</span>
                    <em class="account-vip-cta">${hasVipAccess() ? '管理会员' : '开通 VIP'}</em>
                </a>
                <a class="account-vip-col" href="${latest ? esc(historyPlayHref(latest.item)) : '#/'}">
                    <strong>继续观看</strong>
                    <span>${esc(resumeTitle)}</span>
                    <em class="account-vip-cta">${latest ? '立即播放' : '去首页'}</em>
                </a>
                <a class="account-vip-col" href="#/rankings">
                    <strong>热门榜单</strong>
                    <span>发现高分好片</span>
                    <em class="account-vip-cta">去看看</em>
                </a>
            </div>
        </header>
    `;
}

function renderAccountTabbar(stats) {
    return `
        <nav class="account-tabbar" aria-label="个人中心分区">
            <div class="account-tabbar-main" role="tablist">
                ${SECTIONS.map((section) => renderTabButton(section, stats)).join('')}
            </div>
            <div class="account-tabbar-utils">
                <a class="account-tabbar-util" href="#/">首页</a>
                <button class="account-tabbar-util account-hero-signout" type="button">退出</button>
            </div>
        </nav>
    `;
}

function renderTabButton(section, stats = accountStats()) {
    const selected = section.id === activeSection;
    const badge = section.id === 'notifications' && stats.unread > 0
        ? `<span class="account-tab-badge">${stats.unread > 99 ? '99+' : stats.unread}</span>`
        : '';
    return `
        <button class="account-tab ${selected ? 'active' : ''}" type="button" role="tab" data-section="${section.id}" aria-selected="${selected}" aria-current="${selected ? 'page' : 'false'}">
            ${esc(section.label)}${badge}
        </button>
    `;
}

function renderAccountHero(u) {
    return `
        <header class="account-hero">
            <div class="account-hero-main">
                ${renderAvatar(u, 'account-avatar-lg')}
                <div class="account-profile-copy">
                    <p class="account-eyebrow">个人中心</p>
                    <h1 class="account-name">${esc(displayName(u))}</h1>
                    <span class="account-role">${esc(u.email || '光影用户')}</span>
                    <span class="account-badge ${hasVipAccess() ? 'vip' : ''}">${esc(vipBadgeText())}</span>
                </div>
            </div>
            <div class="account-hero-actions">
                <button class="account-icon-button" type="button" data-section-jump="settings" aria-label="账号设置">${iconGear()}</button>
                <button class="account-secondary-btn account-hero-signout" type="button">退出</button>
            </div>
        </header>
    `;
}

function renderAccountStats(stats) {
    return `
        <div class="account-stats" aria-label="账号数据概览">
            <button class="account-stat" type="button" data-section="watchlist">
                <strong>${esc(String(stats.favorites))}</strong>
                <span>收藏</span>
            </button>
            <button class="account-stat" type="button" data-section="downloads">
                <strong>${esc(String(stats.watchLater))}</strong>
                <span>稍后看</span>
            </button>
            <button class="account-stat" type="button" data-section="history">
                <strong>${esc(String(stats.history))}</strong>
                <span>历史</span>
            </button>
            <button class="account-stat ${stats.unread > 0 ? 'has-alert' : ''}" type="button" data-section="notifications">
                <strong>${esc(stats.unread > 0 ? String(stats.unread) : '—')}</strong>
                <span>消息</span>
            </button>
        </div>
    `;
}

function renderQuickTile(sectionId, label, meta, icon, badgeCount = 0) {
    const badge = badgeCount > 0 ? `<span class="account-quick-badge">${badgeCount > 99 ? '99+' : badgeCount}</span>` : '';
    return `
        <button class="account-quick-tile" type="button" data-section-jump="${sectionId}">
            <span class="account-quick-icon" aria-hidden="true">${icon}</span>
            <span class="account-quick-copy">
                <strong>${esc(label)}</strong>
                <small>${esc(meta)}</small>
            </span>
            ${badge}
        </button>
    `;
}

function accountStats() {
    return {
        favorites: (favorites.value || []).length,
        watchLater: (watchLater.value || []).length,
        history: (watchHistory.value || []).length,
        unread: Number(notificationSummary.value?.unreadCount || 0),
    };
}

function librarySyncHint() {
    switch (librarySyncState.value) {
    case 'syncing':
        return '片库同步中…';
    case 'error':
        return '片库同步失败，已保留本地数据';
    default:
        return '';
    }
}

function renderAvatar(u, className = 'account-avatar') {
    if (u.image) {
        return `<span class="${className}"><img src="${esc(u.image)}" alt="${esc(displayName(u))}" onerror="this.remove()"></span>`;
    }
    return `<span class="${className}">${esc(displayName(u).trim().charAt(0).toUpperCase() || '?')}</span>`;
}

function renderRecentActivity() {
    const rows = (watchHistory.value || [])
        .slice()
        .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0))
        .slice(0, 5);
    if (!rows.length) return renderEmpty('暂无观看记录');
    return rows.map(renderActivityItem).join('');
}

function renderActivityItem(item) {
    return `
        <a class="account-list-item" href="${esc(historyPlayHref(item))}">
            <span class="account-mini-poster">${renderPoster(item)}</span>
            <span>
                <strong>${esc(item.name || '未命名内容')}</strong>
                <small>${esc(activityMeta(item))}</small>
            </span>
            <span class="account-more" aria-hidden="true">...</span>
        </a>
    `;
}

function renderPosterPreview(items, type) {
    const shown = (items || []).slice(0, 8);
    if (!shown.length) return `<a class="account-poster-empty" href="${type === 'watchLater' ? '#/watch-later' : '#/favorites'}">暂无内容</a>`;
    return shown.map((item) => `
        <a class="account-poster" href="${esc(mediaHref(item))}" title="${esc(item.name || '内容')}">
            ${renderPoster(item)}
        </a>
    `).join('');
}

function renderMediaCards(items) {
    return items.map((item) => `
        <a class="account-media-card" href="${esc(mediaHref(item))}">
            <span class="account-media-poster">${renderPoster(item)}</span>
            <span class="account-media-copy">
                <strong>${esc(item.name || '未命名内容')}</strong>
                <small>${esc(item.type === 'movie' ? '电影' : '剧集')}</small>
            </span>
        </a>
    `).join('');
}

function renderHistoryItem(item) {
    const percent = isCompletedHistoryItem(item) ? 100 : Math.round(historyPercent(item));
    const meta = historyItemMeta(item, percent);
    return `
        <a class="account-history-card" href="${esc(historyPlayHref(item))}">
            <span class="account-history-poster">${renderPoster(item)}</span>
            <span class="account-history-body">
                <span class="account-history-head">
                    <strong>${esc(item.name || '未命名内容')}</strong>
                    <span class="account-history-play" aria-hidden="true">${iconPlay()}</span>
                </span>
                <small>${esc(meta)}</small>
                <span class="account-history-progress">
                    <span class="account-progress" aria-hidden="true"><span style="width:${percent}%"></span></span>
                    <span class="account-history-percent">${playbackProgressShortLabel(item)}</span>
                </span>
            </span>
        </a>
    `;
}

function historyItemMeta(item, percent = 0) {
    const episode = item.episodeLabel || item.videoTitle || '';
    const watched = formatWatchedTime(item.watchedAt);
    if (percent >= COMPLETION_PERCENT) {
        return [episode, watched || '已看完'].filter(Boolean).join(' · ');
    }
    return [episode, watched].filter(Boolean).join(' · ') || '最近观看';
}

function groupHistoryByTime(items) {
    const buckets = [
        { key: 'today', title: '今天', items: [] },
        { key: 'yesterday', title: '昨天', items: [] },
        { key: 'week', title: '最近 7 天', items: [] },
        { key: 'older', title: '更早', items: [] },
    ];
    items.forEach((item) => {
        const age = historyAgeInDays(item.watchedAt);
        if (age <= 0) buckets[0].items.push(item);
        else if (age === 1) buckets[1].items.push(item);
        else if (age <= 7) buckets[2].items.push(item);
        else buckets[3].items.push(item);
    });
    return buckets.filter((bucket) => bucket.items.length > 0);
}

function historyAgeInDays(value) {
    const time = Number(value || 0);
    if (!Number.isFinite(time) || time <= 0) return 9999;
    const day = 24 * 60 * 60 * 1000;
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const startItem = new Date(time);
    startItem.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((startToday.getTime() - startItem.getTime()) / day));
}

function formatWatchedTime(ts) {
    const value = Number(ts);
    if (!value) return '';
    const diff = Date.now() - value;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 172_800_000) return '昨天';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function renderResume(entry) {
    if (!entry) {
        return `
            <div class="account-resume empty">
                <strong>暂无可续播内容</strong>
                <small>开始观看后会自动记录进度。</small>
            </div>
        `;
    }
    const { item, resume } = entry;
    const percent = Math.round(Math.min(100, Math.max(0, Number(resume.percent || 0))));
    return `
        <a class="account-resume" href="${esc(historyPlayHref(item))}">
            <span class="account-resume-poster">${renderPoster(item)}</span>
            <span class="account-resume-copy">
                <small>继续观看</small>
                <strong>${esc(item.name || '未命名内容')}</strong>
                <span>${esc([item.episodeLabel || item.videoTitle || '', `${percent}%`].filter(Boolean).join(' · '))}</span>
                <span class="account-progress" aria-hidden="true"><span style="width:${percent}%"></span></span>
            </span>
            <span class="account-play">${iconPlay()}</span>
        </a>
    `;
}

function renderStreamingRows() {
    const rows = getResumableHistory().slice(1, 4);
    if (!rows.length) return '<div class="account-empty small">暂无更多续播条目</div>';
    return rows.map(({ item, resume }) => {
        const percent = Math.round(Math.min(100, Math.max(0, Number(resume.percent || 0))));
        return `
            <a class="account-stream-row" href="${esc(historyPlayHref(item))}">
                <span>${esc(item.name || '未命名内容')}</span>
                <small>${percent}%</small>
            </a>
        `;
    }).join('');
}

function renderDetailsRows() {
    const rows = [
        ['会员状态', hasVipAccess() ? '已开通' : '未开通'],
        ['账号类型', vipBadgeText()],
        ['收藏内容', String((favorites.value || []).length)],
        ['稍后观看', String((watchLater.value || []).length)],
        ['观看记录', String((watchHistory.value || []).length)],
    ];
    return `<div class="account-details">${rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`;
}

function renderCreatorSummary(summary = {}, analytics = null) {
    const totals = analytics?.totals || {};
    const monetization = analytics?.monetization || {};
    const rows = [
        ['投稿总数', summary.totalUploads ?? 0],
        ['已发布', summary.publishedUploads ?? 0],
        ['30天播放', compactNumber(totals.views, '待统计')],
        ['完播率', typeof totals.completionRate === 'number' ? `${totals.completionRate}%` : '待统计'],
        ['互动', compactNumber(totals.interactions, '待统计')],
        ['预估收益', monetization.estimatedRevenue || '内测中'],
    ];
    return rows.map(([label, value]) => `
        <div class="creator-stat-card">
            <span>${esc(label)}</span>
            <strong>${esc(String(value))}</strong>
        </div>
    `).join('');
}

function renderCreatorAnalytics(analytics = null, channel = null) {
    if (!analytics) {
        return '<div class="account-loading">数据分析加载中...</div>';
    }
    if (!channel) {
        return `
            <div class="creator-empty-state">
                <strong>开通频道后开始统计</strong>
                <small>发布作品后，这里会展示播放趋势、互动和收益预估。</small>
            </div>
        `;
    }
    if (!creatorCanPublish(channel)) {
        return `
            <div class="creator-empty-state">
                <strong>${esc(channelStatusText(channel.status))}</strong>
                <small>${esc(creatorGateMessage(channel))}</small>
            </div>
        `;
    }
    const totals = analytics.totals || {};
    const series = Array.isArray(analytics.series) ? analytics.series : [];
    const topVideos = Array.isArray(analytics.topVideos) ? analytics.topVideos : [];
    const contentBreakdown = Array.isArray(analytics.contentBreakdown) ? analytics.contentBreakdown : [];
    const shortStats = contentBreakdown.find((item) => item.contentType === 'short');
    const maxViews = Math.max(1, ...series.map((item) => Number(item.views || 0)));
    return `
        <div class="creator-analytics-layout">
            <div class="creator-analytics-trend" aria-label="近 ${esc(String(analytics.rangeDays || 30))} 天播放趋势">
                ${series.slice(-14).map((item) => {
                    const height = Math.max(8, Math.round((Number(item.views || 0) / maxViews) * 100));
                    return `
                        <span title="${esc(item.date)} · ${esc(String(item.views || 0))} 次播放">
                            <i style="height:${height}%"></i>
                            <small>${esc(String(item.date || '').slice(5))}</small>
                        </span>
                    `;
                }).join('')}
            </div>
            <div class="creator-analytics-copy">
                <strong>${esc(channel.displayName || channel.handle || '创作者频道')}</strong>
                <span>${esc([
                    `播放 ${compactNumber(totals.views, '0')}`,
                    `完播 ${compactNumber(totals.completes, '0')}`,
                    `观看 ${formatWatchSeconds(totals.watchSeconds)}`,
                    `互动 ${compactNumber(totals.interactions, '0')}`,
                ].join(' · '))}</span>
                <small>${esc(analytics.monetization?.basis || '收益为内测估算，不代表最终结算。')}</small>
            </div>
        </div>
        <div class="creator-content-breakdown" aria-label="创作者内容类型表现">
            <div class="creator-short-insight">
                <span>短视频看板</span>
                <strong>${esc(shortStats ? compactNumber(shortStats.views, '0') : '0')} 播放</strong>
                <small>${esc(shortStats
                    ? `完播率 ${shortStats.completionRate || 0}% · 互动 ${compactNumber(shortStats.interactions, '0')} · 均看 ${formatWatchSeconds(shortStats.avgWatchSeconds || 0)}`
                    : '发布短视频后，这里会展示竖屏内容的播放、完播和互动表现。')}</small>
            </div>
            ${contentBreakdown.length ? contentBreakdown.map((item) => `
                <div class="creator-content-breakdown-item">
                    <span>${esc(item.label || creatorContentTypeText(item.contentType))}</span>
                    <strong>${esc(compactNumber(item.views, '0'))}</strong>
                    <small>${esc([
                        `${item.uploads || 0} 个作品`,
                        `完播 ${item.completionRate || 0}%`,
                        `互动 ${compactNumber(item.interactions, '0')}`,
                    ].join(' · '))}</small>
                </div>
            `).join('') : '<div class="creator-content-breakdown-item"><span>内容分布</span><strong>待统计</strong><small>有播放数据后自动生成。</small></div>'}
        </div>
        <div class="creator-analytics-top">
            <strong>作品表现</strong>
            ${topVideos.length ? topVideos.slice(0, 5).map((item, index) => `
                <div class="creator-analytics-row">
                    <span>${esc(String(index + 1))}. ${esc(item.title || '未命名作品')} ${item.diagnosis ? `· ${creatorDiagnosisBadge(item.diagnosis)}` : ''}</span>
                    <small>${esc([
                        creatorContentTypeText(item.contentType),
                        `播放 ${compactNumber(item.views, '0')}`,
                        `完播 ${item.views > 0 ? Math.round((Number(item.completes || 0) / Number(item.views || 1)) * 1000) / 10 : 0}%`,
                        `互动 ${compactNumber(item.interactions, '0')}`,
                        item.estimatedRevenue ? `预估 ${item.estimatedRevenue}` : '',
                    ].filter(Boolean).join(' · '))}</small>
                    ${item.diagnosis ? `<small>${esc(creatorDiagnosisText(item.diagnosis))}</small>` : ''}
                </div>
            `).join('') : '<small>发布作品后开始生成排行。</small>'}
        </div>
    `;
}

function renderCreatorRevenue(revenue = null, ledger = null, channel = null, payouts = null) {
    if (!revenue) return '<div class="account-loading">收益中心加载中...</div>';
    if (!channel) {
        return `
            <div class="creator-empty-state">
                <strong>开通频道后启用收益中心</strong>
                <small>当前收益功能为内测估算，提现与正式结算尚未开放。</small>
            </div>
        `;
    }
    if (!creatorCanPublish(channel)) {
        return `
            <div class="creator-empty-state">
                <strong>收益中心暂未开放</strong>
                <small>${esc(creatorGateMessage(channel))}</small>
            </div>
        `;
    }
    const sources = Array.isArray(revenue.sources) ? revenue.sources : [];
    const items = Array.isArray(ledger?.items) ? ledger.items : [];
    const payoutItems = Array.isArray(payouts?.items) ? payouts.items : [];
    const availableCents = Number(payouts?.availableCents || 0);
    const ledgerError = ledger?.error;
    const payoutError = payouts?.error;
    const eligibility = revenue.eligibility || {};
    const eligibilityReasons = Array.isArray(eligibility.reasons) ? eligibility.reasons : [];
    const eligibilityLabel = {
        eligible: '可参与收益',
        limited: '待满足条件',
        blocked: '收益受限',
    }[eligibility.status] || '待满足条件';
    return `
        <div class="creator-revenue-summary">
            ${[
                ['预估收益', revenue.estimatedRevenue || '¥0.00'],
                ['可结算', revenue.payableRevenue || '¥0.00'],
                ['结算中', revenue.pendingRevenue || '¥0.00'],
                ['状态', eligibilityLabel],
            ].map(([label, value]) => `
                <div class="creator-stat-card">
                    <span>${esc(label)}</span>
                    <strong>${esc(String(value))}</strong>
                </div>
            `).join('')}
        </div>
        <div class="creator-revenue-sources">
            <strong>收益资格</strong>
            <div class="creator-analytics-row">
                <span>${esc(eligibility.canEarnAdRevenue ? '广告收益门控正常' : '广告收益暂不可用')}</span>
                <small>${esc([
                    `风险等级：${eligibility.riskLevel === 'high' ? '高' : eligibility.riskLevel === 'medium' ? '中' : '低'}`,
                    `可变现作品：${Number(eligibility.monetizableUploads || 0)}`,
                ].join(' · '))}</small>
            </div>
            ${eligibilityReasons.length ? eligibilityReasons.map((reason) => `
                <div class="creator-analytics-row">
                    <span>${esc(reason)}</span>
                    <small>${esc(eligibility.status === 'eligible' ? '当前满足 P0 广告收益条件' : '请按提示补齐后等待平台复核')}</small>
                </div>
            `).join('') : '<small>暂无收益资格提示。</small>'}
        </div>
        <div class="creator-revenue-sources">
            <strong>结算申请</strong>
            <div class="creator-analytics-row">
                <span>当前可申请：${esc(payouts?.available || revenue.payableRevenue || '¥0.00')}</span>
                <small>${esc(availableCents > 0 ? '可提交 P0 结算申请，等待平台审核/打款系统接入。' : '暂无可申请金额，需平台先确认为可结算收益。')}</small>
            </div>
            <button class="account-secondary-btn" type="button" data-creator-payout-action="request" data-available-cents="${esc(String(availableCents))}" ${availableCents > 0 ? '' : 'disabled'}>申请结算</button>
            <button class="account-secondary-btn" type="button" data-creator-revenue-export>导出账单 CSV</button>
            ${payoutError ? `<small>${esc(payoutError)}</small>` : payoutItems.length ? payoutItems.slice(0, 5).map((item) => `
                <div class="creator-analytics-row">
                    <span>${esc(item.amount || '¥0.00')}</span>
                    <small>${esc([
                        payoutStatusText(item.status),
                        item.requestedAt ? formatCreatorTime(item.requestedAt, true) : '',
                    ].filter(Boolean).join(' · '))}</small>
                </div>
            `).join('') : '<small>暂无结算申请记录。</small>'}
        </div>
        <div class="creator-revenue-sources">
            <strong>收益来源</strong>
            ${sources.length ? sources.map((source) => `
                <div class="creator-analytics-row">
                    <span>${esc(source.label || source.source || '收益来源')}</span>
                    <small>${esc([
                        source.estimatedRevenue || '¥0.00',
                        source.status === 'estimated' ? '估算' : '未接入',
                    ].join(' · '))}</small>
                </div>
            `).join('') : '<small>暂无可展示来源；广告、会员分成和活动激励仍在内测接入中。</small>'}
        </div>
        <div class="creator-revenue-sources">
            <strong>收益流水</strong>
            ${ledgerError ? `<small>${esc(ledgerError)}</small>` : items.length ? items.map((item) => `
                <div class="creator-analytics-row">
                    <span>${esc(item.description || item.type || '收益记录')}</span>
                    <small>${esc([
                        item.amount || '¥0.00',
                        item.status || 'estimated',
                        item.createdAt ? formatCreatorTime(item.createdAt, true) : '',
                    ].filter(Boolean).join(' · '))}</small>
                </div>
            `).join('') : '<small>暂无收益流水；提现、结算与付款能力尚未开放。</small>'}
        </div>
        <p class="creator-revenue-disclaimer">${esc(revenue.disclaimer || '当前收益为内测估算，不代表最终结算或付款承诺。')}</p>
    `;
}

function payoutStatusText(status) {
    return {
        requested: '已申请',
        reviewing: '审核中',
        paid: '已打款',
        rejected: '已驳回',
        cancelled: '已取消',
    }[status] || status || '未知状态';
}

function renderCreatorRightsDialog({ title, rights = null, loading = false, error = '', published = false }) {
    const declarationType = rights?.declarationType || 'original';
    const expiresAt = rights?.expiresAt ? new Date(rights.expiresAt).toISOString().slice(0, 10) : '';
    return `
        <div class="creator-rights-backdrop" aria-hidden="true"></div>
        <section class="creator-rights-panel" role="dialog" aria-modal="true" aria-labelledby="creator-rights-title">
            <div class="creator-rights-header">
                <div>
                    <small>版权声明</small>
                    <h3 id="creator-rights-title">${esc(title)}</h3>
                </div>
                <button class="account-secondary-btn" type="button" data-rights-close>关闭</button>
            </div>
            ${loading ? '<div class="account-loading">版权声明加载中...</div>' : error ? `<div class="account-empty">${esc(error)}</div>` : `
                <form class="creator-rights-form" id="creator-rights-form">
                    <label>
                        <span>声明类型</span>
                        <select name="declarationType" ${published ? 'disabled' : ''}>
                            ${creatorRightsOption('original', '原创内容', declarationType)}
                            ${creatorRightsOption('licensed', '已获授权', declarationType)}
                            ${creatorRightsOption('public_domain', '公版内容', declarationType)}
                            ${creatorRightsOption('fair_use', '合理使用', declarationType)}
                        </select>
                    </label>
                    <label>
                        <span>权利方 / 授权方</span>
                        <input name="ownerName" value="${esc(rights?.ownerName || '')}" placeholder="原创可填写本人或团队名称" ${published ? 'disabled' : ''}>
                    </label>
                    <label>
                        <span>授权链接</span>
                        <input name="licenseUrl" value="${esc(rights?.licenseUrl || '')}" placeholder="https://..." ${published ? 'disabled' : ''}>
                    </label>
                    <label>
                        <span>授权地区</span>
                        <input name="territories" value="${esc(rights?.territories || 'worldwide')}" placeholder="worldwide / CN / US" ${published ? 'disabled' : ''}>
                    </label>
                    <label>
                        <span>到期日期</span>
                        <input name="expiresAt" type="date" value="${esc(expiresAt)}" ${published ? 'disabled' : ''}>
                    </label>
                    <label class="creator-rights-check">
                        <input name="monetizationAllowed" type="checkbox" ${rights?.monetizationAllowed ? 'checked' : ''} ${published ? 'disabled' : ''}>
                        <span>允许参与广告收益、会员分成等创作者变现</span>
                    </label>
                    <label class="creator-rights-notes">
                        <span>补充说明</span>
                        <textarea name="notes" rows="4" placeholder="授权范围、素材来源、合理使用说明等" ${published ? 'disabled' : ''}>${esc(rights?.notes || '')}</textarea>
                    </label>
                    ${rights ? `<div class="creator-rights-current">
                        <strong>${esc(creatorRightsStatusText(rights.status))}</strong>
                        <small>${esc([
                            rights.updatedAt ? `更新 ${formatCreatorTime(rights.updatedAt, true)}` : '',
                            rights.reviewNote ? `审核意见：${rights.reviewNote}` : '',
                        ].filter(Boolean).join(' · '))}</small>
                    </div>` : ''}
                    ${published ? '<p class="creator-rights-hint">已发布作品的版权声明需由平台运营复核，避免影响已上线内容、广告准入和收益结算。</p>' : '<p class="creator-rights-hint">提交后进入平台版权审核；只有审核通过且允许变现的作品才会进入广告收益分成。</p>'}
                    <div class="creator-rights-actions">
                        <span class="account-msg hidden" id="creator-rights-msg"></span>
                        <button class="account-primary-btn" id="creator-rights-submit" type="submit" ${published ? 'disabled' : ''}>提交声明</button>
                    </div>
                </form>
            `}
        </section>
    `;
}

function renderCreatorAppealDialog({ title, type = 'upload', appeals = [], loading = false, error = '', notice = '' }) {
    const openAppeal = appeals.find((item) => item.status === 'open');
    const isChannelAppeal = type === 'channel';
    return `
        <div class="creator-rights-backdrop" aria-hidden="true"></div>
        <section class="creator-rights-panel" role="dialog" aria-modal="true" aria-labelledby="creator-appeal-title">
            <div class="creator-rights-header">
                <div>
                    <small>${isChannelAppeal ? '频道申诉' : '投稿申诉'}</small>
                    <h3 id="creator-appeal-title">${esc(title)}</h3>
                </div>
                <button class="account-secondary-btn" type="button" data-appeal-close>关闭</button>
            </div>
            ${loading ? '<div class="account-loading">申诉记录加载中...</div>' : error ? `<div class="account-empty">${esc(error)}</div>` : `
                ${notice ? `<p class="creator-rights-hint">${esc(notice)}</p>` : ''}
                <div class="creator-rights-current">
                    <strong>申诉历史</strong>
                    ${appeals.length ? appeals.map((item) => `
                        <small>${esc([
                            creatorAppealStatusText(item.status),
                            item.createdAt ? `提交 ${formatCreatorTime(item.createdAt, true)}` : '',
                            item.reviewedAt ? `处理 ${formatCreatorTime(item.reviewedAt, true)}` : '',
                        ].filter(Boolean).join(' · '))}</small>
                        <div class="creator-review-note">${esc(item.reason || '')}</div>
                        ${item.evidenceUrl ? `<a class="creator-public-link" href="${esc(item.evidenceUrl)}" target="_blank" rel="noreferrer">查看证据链接</a>` : ''}
                        ${item.reviewNote ? `<div class="creator-review-note">运营备注：${esc(item.reviewNote)}</div>` : ''}
                    `).join('') : `<small>${isChannelAppeal ? '暂无频道申诉记录。你可以提交一次申诉，补充整改说明、身份资质或其他证明。' : '暂无申诉记录。你可以提交一次申诉，补充素材来源、创作说明或其他证明。'}</small>`}
                </div>
                <form class="creator-rights-form" id="creator-appeal-form">
                    <label class="creator-rights-notes">
                        <span>申诉原因</span>
                        <textarea name="reason" rows="5" placeholder="${isChannelAppeal ? '请说明频道整改情况、资质证明或为什么需要重新审核' : '请说明为什么需要重新审核，例如素材来源、授权依据、误判说明等'}" ${openAppeal ? 'disabled' : ''}></textarea>
                    </label>
                    <label>
                        <span>证据链接（选填）</span>
                        <input name="evidenceUrl" placeholder="https://..." ${openAppeal ? 'disabled' : ''}>
                    </label>
                    <p class="creator-rights-hint">${openAppeal ? '当前已有待处理申诉，请等待平台运营处理。' : isChannelAppeal ? '提交后会进入 Admin 创作者审核页的申诉队列；接受申诉会把频道退回入驻复核，不会自动开通。' : '提交后会进入 Admin 创作者审核页的申诉队列；接受申诉会把作品退回人工复核，不会自动发布。'}</p>
                    <div class="creator-rights-actions">
                        <span class="account-msg hidden" id="creator-appeal-msg"></span>
                        <button class="account-primary-btn" id="creator-appeal-submit" type="submit" ${openAppeal ? 'disabled' : ''}>提交申诉</button>
                    </div>
                </form>
            `}
        </section>
    `;
}

function creatorRightsOption(value, label, selected) {
    return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
}

function creatorRightsStatusText(status) {
    return {
        pending: '待版权审核',
        approved: '版权已通过',
        rejected: '版权已驳回',
    }[status] || '未提交版权声明';
}

function creatorAppealStatusText(status) {
    return {
        open: '待处理',
        accepted: '已接受',
        rejected: '已驳回',
        cancelled: '已取消',
    }[status] || '未知状态';
}


function renderCreatorUploads(items, analytics = null, channel = null) {
    if (!items.length) {
        return `
            <div class="creator-empty-state">
                <strong>还没有投稿</strong>
                <small>保存频道后，可以先创建草稿，再补充对象路径提交审核。</small>
            </div>
        `;
    }
    const metrics = new Map((analytics?.topVideos || []).map((item) => [item.id, item]));
    const pinnedUploadId = channel?.pinnedUploadId || '';
    const toolbar = `
        <div class="creator-bulk-toolbar">
            <span>批量操作</span>
            <button class="account-secondary-btn" type="button" data-upload-bulk-action="publish">发布</button>
            <button class="account-secondary-btn" type="button" data-upload-bulk-action="unpublish">下架</button>
            <button class="account-secondary-btn" type="button" data-upload-bulk-action="delete">删除</button>
        </div>
    `;
    return toolbar + items.map((item) => `
        <article class="creator-work-row">
            <label class="creator-work-select">
                <input type="checkbox" data-upload-select value="${esc(item.id)}" aria-label="选择 ${esc(item.title || '未命名投稿')}">
            </label>
            <div class="creator-work-icon" aria-hidden="true">${creatorContentTypeText(item.contentType).slice(0, 1)}</div>
            <div class="creator-work-copy">
                <div class="creator-work-title">${esc(item.title || '未命名投稿')}</div>
                <div class="creator-work-meta">
                    ${esc(renderCreatorUploadMeta(item))}
                </div>
                <div class="creator-work-meta creator-work-details">
                    ${esc([
                        item.sourceSize ? formatFileSize(item.sourceSize) : '',
                        item.sourceMime || '',
                        item.uploadedAt ? `上传 ${formatCreatorTime(item.uploadedAt, true)}` : '',
                        processingStatusText(item.processingStatus),
                        item.danmakuEnabled === false ? '弹幕已关闭' : '弹幕开启',
                        Array.isArray(item.chapters) && item.chapters.length ? `${item.chapters.length} 个章节` : '',
                    ].filter(Boolean).join(' · '))}
                </div>
                <div class="creator-work-meta creator-work-details">
                    ${esc(renderCreatorUploadMetrics(item, metrics.get(item.id)))}
                </div>
                ${item.processingStatus === 'failed' ? '<div class="creator-review-note">转码失败，可重试转码；若仍失败请重新上传源文件或联系平台处理。</div>' : ''}
                ${item.reviewReason ? `<div class="creator-review-note">${esc(item.reviewReason)}</div>` : ''}
            </div>
            <div class="creator-work-status">
                <span class="creator-status-badge ${esc(item.reviewStatus || 'not_submitted')}">${esc(creatorReviewStatusText(item.reviewStatus))}</span>
                <small>${esc(uploadStatusText(item.status))}</small>
                ${item.id === pinnedUploadId ? '<span class="creator-status-badge approved">频道置顶</span>' : ''}
                <button class="account-secondary-btn" type="button" data-upload-action="rights" data-upload-id="${esc(item.id)}" data-upload-title="${esc(item.title || '未命名投稿')}" data-upload-status="${esc(item.status || '')}">版权声明</button>
                ${item.id === pinnedUploadId ? `<button class="account-secondary-btn" type="button" data-upload-action="unpin" data-upload-id="${esc(item.id)}">取消置顶</button>` : ''}
                ${item.id !== pinnedUploadId && canPinCreatorUpload(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="pin" data-upload-id="${esc(item.id)}">置顶</button>` : ''}
                ${canAppealCreatorUpload(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="appeal" data-upload-id="${esc(item.id)}" data-upload-title="${esc(item.title || '未命名投稿')}">申诉</button>` : ''}
                <button class="account-secondary-btn" type="button" data-upload-action="danmaku" data-upload-id="${esc(item.id)}" data-upload-danmaku-enabled="${item.danmakuEnabled === false ? 'false' : 'true'}">${item.danmakuEnabled === false ? '开启弹幕' : '关闭弹幕'}</button>
                <button class="account-secondary-btn" type="button" data-upload-action="chapters" data-upload-id="${esc(item.id)}" data-upload-chapters="${esc(encodeURIComponent(formatCreatorChapterInput(item.chapters)))}">编辑章节</button>
                ${canRetryCreatorTranscode(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="retry-transcode" data-upload-id="${esc(item.id)}">重试转码</button>` : ''}
                ${canUnpublishCreatorUpload(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="set-status" data-upload-status-target="draft" data-upload-id="${esc(item.id)}">下架</button>` : ''}
                ${canPublishCreatorUpload(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="set-status" data-upload-status-target="published" data-upload-id="${esc(item.id)}">发布</button>` : ''}
                ${canDeleteCreatorUpload(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="delete" data-upload-id="${esc(item.id)}">删除</button>` : ''}
                ${canAttachCreatorUploadSource(item) ? `<button class="account-secondary-btn" type="button" data-upload-action="attach-source" data-upload-id="${esc(item.id)}">绑定源文件</button>` : ''}
                ${item.status === 'published' && item.processingStatus === 'ready' ? `<a class="creator-public-link" href="#/detail/creator/creator:${esc(item.id)}">公开页</a>` : ''}
            </div>
        </article>
    `).join('');
}

function selectedCreatorUploadIds(root) {
    return [...root.querySelectorAll('[data-upload-select]:checked')]
        .map((input) => input.value)
        .filter(Boolean);
}

function formatCreatorChapterInput(chapters = []) {
    return Array.isArray(chapters)
        ? chapters.map((chapter) => `${Number(chapter.startSeconds || 0)} ${chapter.title || ''}`.trim()).join('\n')
        : '';
}

function parseCreatorChapterInput(value = '') {
    const lines = String(value).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 50) return null;
    const chapters = [];
    let previous = -1;
    for (const line of lines) {
        const match = line.match(/^(\d+)(?:\s+(.+))$/);
        if (!match) return null;
        const startSeconds = Number(match[1]);
        const title = (match[2] || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!title || !Number.isFinite(startSeconds) || startSeconds <= previous) return null;
        previous = startSeconds;
        chapters.push({ title, startSeconds });
    }
    return chapters;
}

function renderCreatorCollections(items = []) {
    if (!items.length) {
        return `
            <div class="creator-empty-state">
                <strong>还没有合集</strong>
                <small>把相关作品组织成专题、系列或课程，观众会更容易连续观看。</small>
            </div>
        `;
    }
    return items.map((item) => {
        const ids = Array.isArray(item.uploadIds) ? item.uploadIds : [];
        return `
            <article class="creator-work-row">
                <div class="creator-work-icon" aria-hidden="true">合</div>
                <div class="creator-work-copy">
                    <div class="creator-work-title">${esc(item.title || '未命名合集')}</div>
                    <div class="creator-work-meta">${esc([collectionVisibilityText(item.visibility), `${Number(item.itemCount || ids.length || 0)} 个作品`].join(' · '))}</div>
                    ${item.description ? `<div class="creator-work-meta creator-work-details">${esc(item.description)}</div>` : ''}
                    ${ids.length ? `<div class="creator-work-meta creator-work-details">作品：${esc(ids.slice(0, 6).join(', '))}${ids.length > 6 ? '…' : ''}</div>` : ''}
                </div>
                <div class="creator-work-status">
                    <span class="creator-status-badge ${item.visibility === 'public' ? 'approved' : 'pending'}">${esc(collectionVisibilityText(item.visibility))}</span>
                    <small>${esc(item.status === 'archived' ? '已归档' : '生效中')}</small>
                </div>
            </article>
        `;
    }).join('');
}

function collectionVisibilityText(value) {
    return value === 'private' ? '私密合集' : '公开合集';
}

function canAttachCreatorUploadSource(item) {
    return item
        && item.status === 'draft'
        && !item.sourcePath
        && ['not_started', null, undefined, ''].includes(item.processingStatus);
}

function canRetryCreatorTranscode(item) {
    return item
        && item.sourcePath
        && item.processingStatus === 'failed'
        && item.reviewStatus !== 'rejected'
        && item.status !== 'rejected';
}

function canPinCreatorUpload(item) {
    return item
        && item.sourcePath
        && item.status === 'published'
        && item.reviewStatus === 'approved'
        && item.processingStatus === 'ready'
        && item.visibility === 'public';
}

function canUnpublishCreatorUpload(item) {
    return item
        && item.status === 'published'
        && item.reviewStatus !== 'rejected';
}

function canPublishCreatorUpload(item) {
    return item
        && item.status === 'draft'
        && item.sourcePath
        && item.processingStatus === 'ready'
        && item.reviewStatus === 'approved';
}

function canDeleteCreatorUpload(item) {
    return item
        && item.status !== 'published'
        && item.status !== 'deleted'
        && !['queued', 'processing'].includes(item.processingStatus);
}

function canAppealCreatorUpload(item) {
    return item
        && (item.status === 'rejected' || item.reviewStatus === 'rejected');
}

function renderCreatorLiveSessions(items) {
    if (!items.length) {
        return `
            <div class="creator-empty-state">
                <strong>还没有直播排期</strong>
                <small>先创建预约直播，之后可以从这里开始、结束或取消。</small>
            </div>
        `;
    }
    return items.map((item) => `
        <article class="creator-work-row">
            <div class="creator-work-icon" aria-hidden="true">直</div>
            <div class="creator-work-copy">
                <div class="creator-work-title">${esc(item.title || '未命名直播')}</div>
                <div class="creator-work-meta">
                    ${esc([
                        liveStatusText(item.status),
                        visibilityText(item.visibility),
                        item.scheduledStartAt ? `预约 ${formatCreatorTime(item.scheduledStartAt, true)}` : '未设置预约时间',
                        item.startedAt ? `开始 ${formatCreatorTime(item.startedAt, true)}` : '',
                        item.endedAt ? `结束 ${formatCreatorTime(item.endedAt, true)}` : '',
                        item.replay?.uploadId ? `回放草稿 ${String(item.replay.uploadId).slice(0, 8)}` : '',
                    ].filter(Boolean).join(' · '))}
                </div>
                ${item.description ? `<div class="creator-work-meta creator-work-details">${esc(item.description)}</div>` : ''}
                ${item.pinnedNotice ? `<div class="creator-review-note">置顶公告：${esc(item.pinnedNotice)}</div>` : ''}
                ${item.replay?.uploadId ? '<div class="creator-review-note">直播已结束，回放草稿已进入作品管理，可补充录制文件后提交审核。</div>' : ''}
                <div class="creator-live-stats" id="creator-live-stats-${esc(item.id)}"></div>
                <div class="creator-live-mutes" id="creator-live-mutes-${esc(item.id)}"></div>
            </div>
            <div class="creator-work-status">
                <span class="creator-status-badge ${esc(liveStatusBadge(item.status))}">${esc(liveStatusText(item.status))}</span>
                <small>${esc(item.replay?.uploadId ? '回放草稿已生成' : item.playbackUrl ? '已有播放地址' : '暂未接入推流')}</small>
                ${renderCreatorLiveActions(item)}
            </div>
        </article>
    `).join('');
}

function renderCreatorLiveActions(item) {
    const noticeButton = ['scheduled', 'live'].includes(item.status)
        ? `<button class="account-secondary-btn" type="button" data-live-action="notice" data-live-id="${esc(item.id)}" data-live-notice="${esc(item.pinnedNotice || '')}">${item.pinnedNotice ? '编辑公告' : '置顶公告'}</button>`
        : '';
    const statsButton = `<button class="account-secondary-btn" type="button" data-live-action="stats" data-live-id="${esc(item.id)}">实时统计</button>`;
    const mutesButton = `<button class="account-secondary-btn" type="button" data-live-action="mutes" data-live-id="${esc(item.id)}">禁言名单</button>`;
    if (item.status === 'scheduled') {
        return `
            ${noticeButton}
            ${statsButton}
            ${mutesButton}
            <button class="account-secondary-btn" type="button" data-live-action="live" data-live-id="${esc(item.id)}">开始直播</button>
            <button class="account-secondary-btn" type="button" data-live-action="cancelled" data-live-id="${esc(item.id)}">取消</button>
        `;
    }
    if (item.status === 'live') {
        return `${noticeButton}${statsButton}${mutesButton}<button class="account-secondary-btn" type="button" data-live-action="ended" data-live-id="${esc(item.id)}">结束直播</button>`;
    }
    return `${statsButton}${mutesButton}`;
}

function renderCreatorLiveStats(stats = {}) {
    const cards = [
        ['在线', stats.onlineCount],
        ['点赞', stats.likeCount],
        ['可见聊天', stats.visibleMessageCount ?? stats.messageCount],
        ['隐藏聊天', stats.hiddenMessageCount],
        ['举报', stats.reportCount],
        ['热度', stats.heatScore],
    ];
    const lastSeen = stats.lastPresenceAt ? formatCreatorTime(stats.lastPresenceAt, true) : '';
    const lastMessage = stats.lastMessageAt ? formatCreatorTime(stats.lastMessageAt, true) : '';
    return `
        <div class="creator-live-stat-grid" aria-label="直播实时统计">
            ${cards.map(([label, value]) => `
                <span>
                    <strong>${esc(compactNumber(value, '0'))}</strong>
                    <small>${esc(label)}</small>
                </span>
            `).join('')}
        </div>
        <div class="creator-review-note creator-live-stat-note">
            ${esc([
                lastSeen ? `最近在线心跳 ${lastSeen}` : '',
                lastMessage ? `最近聊天 ${lastMessage}` : '',
                '仅展示聚合数据，不含观众标识',
            ].filter(Boolean).join(' · '))}
        </div>
    `;
}

function renderCreatorLiveMutes(liveId, items) {
    if (!items.length) return '<div class="creator-review-note">当前没有活跃禁言用户。</div>';
    return `
        <div class="creator-review-note creator-live-mute-list">
            <strong>活跃禁言</strong>
            ${items.map((item) => `
                <span>
                    <em class="creator-live-mute-type ${item.moderationType === 'long_ban' ? 'is-ban' : ''}">${esc(item.label || (item.moderationType === 'long_ban' ? '长期封禁' : '临时禁言'))}</em>
                    ${esc(item.userName || '用户')}
                    ${item.mutedUntil ? ` · 至 ${esc(formatCreatorTime(item.mutedUntil, true))}` : ''}
                    ${item.reason ? ` · ${esc(item.reason)}` : ''}
                    <button class="live-text-button" type="button" data-live-mute-action="unmute" data-live-id="${esc(liveId)}" data-live-mute-user="${esc(item.userId)}">解除</button>
                </span>
            `).join('')}
        </div>
    `;
}

function renderCreatorUploadMetrics(item, metrics) {
    if (item.status !== 'published' || item.processingStatus !== 'ready') return '发布后开始统计播放与互动';
    if (!metrics) return '播放与互动待统计';
    return [
        `播放 ${compactNumber(metrics.views, '0')}`,
        `完播 ${compactNumber(metrics.completes, '0')}`,
        `互动 ${compactNumber(metrics.interactions, '0')}`,
        metrics.diagnosis ? creatorDiagnosisText(metrics.diagnosis) : '',
        metrics.estimatedRevenue ? `预估 ${metrics.estimatedRevenue}` : '',
    ].filter(Boolean).join(' · ');
}

function creatorDiagnosisBadge(diagnosis = {}) {
    const labels = {
        growth: '增长建议',
        watch: '完播优化',
        engage: '互动优化',
        publish: '发布待办',
        monitor: '表现稳定',
    };
    return labels[diagnosis.level] || '诊断';
}

function creatorDiagnosisText(diagnosis = {}) {
    const actionLabels = {
        complete_publish_gates: '补齐发布门槛',
        improve_title_cover_and_share: '优化标题封面并分享冷启动',
        tighten_opening_and_chapters: '压缩开场并补章节',
        ask_for_comments_and_follow: '引导评论收藏关注',
        keep_updating: '延续选题并观察趋势',
    };
    const parts = [
        actionLabels[diagnosis.action] || diagnosis.action || '',
        diagnosis.reason || '',
    ].filter(Boolean);
    return parts.join('：');
}

function renderCreatorUploadMeta(item) {
    return [
                        creatorContentTypeText(item.contentType),
                        visibilityText(item.visibility),
                        item.sourcePath || '未绑定对象路径',
                        formatCreatorTime(item.updatedAt || item.createdAt),
    ].filter(Boolean).join(' · ');
}

function renderOrderItem(order) {
    return `
        <div class="account-order-item">
            <span>
                <strong>${esc(order.planName || 'VIP 套餐')}</strong>
                <small>${esc([formatOrderTime(order.createdAt), `${Number(order.days) || 0} 天`, order.orderNo ? `订单 ${order.orderNo}` : ''].filter(Boolean).join(' · '))}</small>
            </span>
            <span>
                <strong>¥${formatYuan(order.amount)}</strong>
                <small>${esc(orderStatusText(order.status))}</small>
            </span>
        </div>
    `;
}

function renderNotificationItems(items) {
    if (!items.length) {
        const hint = notificationEmptyHint(notificationFilter);
        return renderEmptyState(hint.title, hint.body, hint.href, hint.action);
    }
    return groupNotificationsByDate(items).map((group) => `
        <section class="account-notification-group">
            <h3 class="account-notification-date">${esc(group.label)}</h3>
            <div class="account-notification-group-list">
                ${group.items.map(renderNotificationItem).join('')}
            </div>
        </section>
    `).join('');
}

function groupNotificationsByDate(items) {
    const groups = [];
    const bucketMap = new Map();
    for (const item of items) {
        const label = notificationDateLabel(item.createdAt);
        if (!bucketMap.has(label)) {
            const bucket = { label, items: [] };
            bucketMap.set(label, bucket);
            groups.push(bucket);
        }
        bucketMap.get(label).items.push(item);
    }
    return groups;
}

function notificationDateLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '更早';
    const timestamp = n < 10_000_000_000 ? n * 1000 : n;
    const date = new Date(timestamp);
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = startOfDay(new Date());
    const target = startOfDay(date);
    const diffDays = Math.round((today - target) / 86_400_000);
    if (diffDays <= 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return '本周';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function renderNotificationItem(item) {
    const unread = isUnread(item);
    const href = safeNotificationHref(item.link);
    const external = isExternalNotificationHref(item.link);
    const targetAttrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const typeClass = notificationTypeClass(item.type);
    return `
        <a class="account-notification-item ${unread ? 'unread' : ''}" href="${esc(href)}"${targetAttrs} data-notification-link data-notification-id="${esc(String(item.id || ''))}">
            <span class="account-notification-dot" aria-hidden="true"></span>
            <span class="account-notification-copy">
                <span class="account-notification-kicker">
                    <span class="account-notification-type account-notification-type--${esc(typeClass)}">${esc(notificationTypeText(item.type))}</span>
                    <span>${esc(formatNotificationTime(item.createdAt))}</span>
                </span>
                <strong>${esc(item.title || '消息通知')}</strong>
                ${item.content ? `<small>${esc(item.content)}</small>` : ''}
            </span>
            <span class="account-notification-chevron" aria-hidden="true">${iconChevron()}</span>
        </a>
    `;
}

function notificationCountText(summary = {}) {
    const unread = Number(summary.unreadCount || 0);
    const total = Array.isArray(summary.items) ? summary.items.length : 0;
    if (unread > 0) return `${unread > 99 ? '99+' : unread} 条未读`;
    return total > 0 ? `${total} 条消息` : '暂无未读';
}

function renderPoster(item) {
    const poster = normalizeTmdbImageUrl(item?.poster, 'w500') || item?.poster || '';
    return poster
        ? `<img src="${esc(poster)}" alt="" loading="lazy" decoding="async">`
        : '<span class="account-poster-placeholder"></span>';
}

function renderEmpty(text) {
    return `<div class="account-empty">${esc(text)}</div>`;
}

function renderEmptyState(title, hint = '', href = '', linkLabel = '') {
    return `
        <div class="account-empty-state">
            <strong>${esc(title)}</strong>
            ${hint ? `<p>${esc(hint)}</p>` : ''}
            ${href && linkLabel ? `<a class="account-primary-btn" href="${esc(href)}">${esc(linkLabel)}</a>` : ''}
        </div>
    `;
}

function renderSectionPage(sectionId, options = {}) {
    const section = SECTIONS.find((item) => item.id === sectionId);
    const { desc = section?.sublabel || '', count, countLabel = '', actions = '', body = '' } = options;
    const countBadge = count !== undefined
        ? `<span class="account-count-badge">${esc(String(count))}${countLabel ? ` ${countLabel}` : ''}</span>`
        : '';
    return `
        <section class="account-section-page account-panel-body" data-section-page="${esc(sectionId)}">
            <header class="account-section-top">
                <div class="account-section-top-main">
                    <span class="account-section-top-icon" aria-hidden="true">${section?.icon?.() || ''}</span>
                    <div class="account-section-top-copy">
                        <h2>${esc(section?.label || '')}</h2>
                        <p>${esc(desc)}</p>
                    </div>
                </div>
                ${countBadge || actions ? `
                    <div class="account-section-top-actions">
                        ${countBadge}
                        ${actions}
                    </div>
                ` : ''}
            </header>
            <div class="account-section-content">${body}</div>
        </section>
    `;
}

function getResumableHistory() {
    return (watchHistory.value || [])
        .map((item) => ({
            item,
            resume: getResumeProgress({
                id: item.id,
                videoId: item.videoId,
                movieId: item.movieId,
                episodeId: item.episodeId,
            }),
        }))
        .filter((entry) => entry.resume)
        .sort((a, b) => Number(b.item.watchedAt || 0) - Number(a.item.watchedAt || 0));
}

function getLatestResumeItem() {
    return getResumableHistory()[0] || null;
}

function historyPlayHref(item) {
    if (!item?.id) return '#/';
    const type = item.type === 'movie' ? 'movie' : 'series';
    if (item.videoId) return `#/play/${type}/${item.id}/${item.videoId}`;
    const hasProgress = Number(item.progress || 0) > 0 || Number(item.percent || 0) > 0;
    if (type === 'movie' && hasProgress) return `#/play/${type}/${item.id}`;
    return `#/detail/${type}/${item.id}`;
}

function mediaHref(item) {
    const id = item?.slug || item?.id || item?.movieId;
    if (!id) return '#/';
    return `#/detail/${item.type === 'movie' ? 'movie' : 'series'}/${id}`;
}

function activityMeta(item) {
    return [
        item.episodeLabel || item.videoTitle || '',
        item.progress ? `已观看 ${formatClock(item.progress)}` : '',
    ].filter(Boolean).join(' · ') || '最近观看';
}

function displayName(u) {
    return u?.name || u?.username || u?.email || '用户';
}

function resolveInitialSection() {
    const querySection = (() => {
        try {
            const rawHash = location.hash.slice(1) || '';
            const queryString = rawHash.split('?')[1] || '';
            return new URLSearchParams(queryString).get('section') || '';
        } catch {
            return '';
        }
    })();
    const next = querySection || activeSection;
    return SECTIONS.some((section) => section.id === next) ? next : 'profile';
}

function sectionTitle(sectionId) {
    return SECTIONS.find((section) => section.id === sectionId)?.label || '个人资料';
}

function vipBadgeText() {
    if (vipStatus.value?.role === 'admin') return '管理员';
    if (hasVipAccess()) return `VIP 会员 · 剩余 ${daysUntilExpire()} 天`;
    if (vipStatus.value?.role === 'vip') return 'VIP 已过期';
    return '普通用户';
}

function showMsg(el, text, ok) {
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('err', !ok);
}

function showUploadStatus(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('err', !ok);
}

function guessMimeType(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
    if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    return 'video/mp4';
}

function openDeleteDialog() {
    const backdrop = document.createElement('div');
    backdrop.className = 'auth-backdrop';
    backdrop.innerHTML = `
        <div class="auth-card">
            <button class="auth-close" type="button" id="del-close">&times;</button>
            <h2 class="auth-title">注销账号</h2>
            <p class="account-danger-note">请输入密码确认注销。账号将无法再登录，且操作不可恢复。</p>
            <form class="auth-form" id="del-form">
                <input type="password" id="del-password" class="auth-input" placeholder="当前密码" required autocomplete="current-password">
                <div class="auth-error hidden" id="del-error"></div>
                <button type="submit" class="auth-submit" id="del-submit" style="background:#ff453a;">确认注销</button>
            </form>
        </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#del-close')?.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) close();
    });
    const form = backdrop.querySelector('#del-form');
    const input = backdrop.querySelector('#del-password');
    const errorEl = backdrop.querySelector('#del-error');
    const btn = backdrop.querySelector('#del-submit');
    setTimeout(() => input?.focus(), 100);
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        btn.disabled = true;
        btn.textContent = '注销中...';
        errorEl.classList.add('hidden');
        const result = await deleteAccount(input.value);
        if (result.success) {
            close();
            navigate('#/');
        } else {
            errorEl.textContent = result.error || '注销失败';
            errorEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = '确认注销';
        }
    });
}

function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatOrderTime(ts) {
    if (!ts) return '';
    const ms = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatNotificationTime(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '刚刚';
    const timestamp = n < 10_000_000_000 ? n * 1000 : n;
    const diff = Date.now() - timestamp;
    if (diff >= 0 && diff < 60_000) return '刚刚';
    if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatYuan(amount) {
    return ((Number(amount) || 0) / 100).toFixed(2);
}

function orderStatusText(status) {
    const map = { paid: '已支付', pending: '待支付', expired: '已过期' };
    return map[status] || status || '未知';
}

function channelStatusText(status) {
    return { pending: '审核中', active: '已开通', rejected: '已驳回', suspended: '已停用' }[status] || '已创建';
}

function visibilityText(value) {
    return { public: '公开', unlisted: '仅链接可见', private: '私密' }[value] || '私密';
}

function uploadStatusText(status) {
    return { draft: '草稿', processing: '处理中', published: '已发布', rejected: '已驳回' }[status] || '草稿';
}

function liveStatusText(status) {
    return { scheduled: '已预约', live: '直播中', ended: '已结束', cancelled: '已取消' }[status] || '已预约';
}

function liveStatusBadge(status) {
    return { scheduled: 'pending', live: 'approved', ended: 'not_submitted', cancelled: 'rejected' }[status] || 'pending';
}

function processingStatusText(status) {
    return {
        not_started: '未入转码',
        queued: '转码排队中',
        processing: '转码处理中',
        ready: '转码完成',
        failed: '转码失败',
    }[status] || '';
}

function formatFileSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function compactNumber(value, fallback = '—') {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    if (number <= 0) return number === 0 ? '0' : fallback;
    if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
    return String(Math.round(number));
}

function formatWatchSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
    if (seconds < 60) return `${Math.round(seconds)} 秒`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.round((minutes / 60) * 10) / 10;
    return `${hours} 小时`;
}

function formatCreatorTime(value, withTime = false) {
    if (!value) return '';
    const numeric = Number(value);
    const ms = Number.isFinite(numeric) ? (numeric > 1e12 ? numeric : numeric * 1000) : Date.parse(value);
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    const options = withTime
        ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
        : { month: '2-digit', day: '2-digit' };
    return date.toLocaleString('zh-CN', options);
}

function creatorErrorText(error, fallback) {
    if (error?.status === 401) return '请重新登录后再试';
    if (error?.status === 409) return error.message || '请先保存创作者频道';
    return error?.message || fallback;
}

function iconCoins() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4h-2"/></svg>';
}

function iconUser() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0v1H5v-1Z"/></svg>';
}

function iconStar() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.2 2.66 5.5 6.04.86-4.38 4.22 1.05 5.98L12 16.92l-5.37 2.84 1.05-5.98-4.38-4.22 6.04-.86L12 3.2Z"/></svg>';
}

function iconDownload() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
}

function iconHistory() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.35-5.65L4 8"/><path d="M4 4v4h4"/><path d="M12 7v5l3 2"/></svg>';
}

function iconBell() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
}

function iconGear() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.6.78 1 1.42 1H21a2 2 0 1 1 0 4h-.09c-.64 0-1.2.4-1.51 1Z"/></svg>';
}

function iconPlay() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}

function iconChevron() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
}

function iconRefresh() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
}

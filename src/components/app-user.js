import { user, loading, initAuth, signOut } from '../services/auth.js';
import { showSiteNotice } from '../services/site-notice.js';
import { vipStatus, checkVipStatus, daysUntilExpire, hasVipAccess } from '../services/vip.js';
import { favorites, history as watchHistory, watchLater } from '../services/library.js';
import { playbackStatusLabel, isResumableHistoryItem } from '../services/playback-progress.js';
import { notificationSummary, loadNotifications } from '../services/notifications.js';
import { effect } from '../core/signal.js';
import { esc, loadCSS } from '../core/html.js';

export async function handleUserClick(shell, event) {
    event?.stopPropagation?.();
    ensureUserShell(shell);
    if (loading.value) await initAuth().catch(() => {});
    if (user.value) {
        loadCSS('styles/nav.css');
        if (!vipStatus.value) checkVipStatus().catch(() => {});
        toggleUserMenu(shell);
    } else {
        loadCSS('styles/layout.css');
        const v = window.GY_WEB_STATIC_VERSION || '1';
        const { openAuthModal } = await import(`../services/auth-modal-loader.js?v=${v}`);
        openAuthModal('login');
    }
}

function ensureUserShell(shell) {
    if (shell._userShellBound) return;
    shell.closeUserMenu = () => closeUserMenu(shell);
    effect(() => { user.value; closeUserMenu(shell); });
    effect(() => {
        if (user.value) {
            checkVipStatus().catch(() => {});
        } else {
            vipStatus.value = null;
        }
    });
    shell._userShellBound = true;
}

function toggleUserMenu(shell) {
    if (shell.querySelector('#user-menu')) { closeUserMenu(shell, { restoreFocus: true }); return; }
    const u = user.value;
    if (!u) return;

    const userButton = shell.querySelector('#user-btn');
    const menu = document.createElement('div');
    menu.id = 'user-menu';
    menu.className = 'user-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'user-btn');
    const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    const avatarInner = u.image
        ? `<img src="${esc(u.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.remove()">`
        : initial;
    const vipBadge = hasVipAccess() ? '<span class="user-menu-vip">VIP</span>' : '';
    const unreadCount = Number(notificationSummary.value.unreadCount || 0);
    const unreadBadge = unreadCount > 0 ? `<span class="user-menu-count">${esc(unreadCount > 99 ? '99+' : String(unreadCount))}</span>` : '';
    const resumeItem = latestResumeItem();
    const resumeCard = resumeItem ? resumeCardHTML(resumeItem) : '';
    const favoritesBadge = countBadge(favorites.value?.length);
    const historyBadge = countBadge(watchHistory.value?.length);
    const laterBadge = countBadge(watchLater.value?.length);
    const vipMenuBadge = vipStatusBadge();
    menu.innerHTML = `
        <div class="user-menu-head">
            <div class="user-menu-avatar">${avatarInner}</div>
            <div class="user-menu-info">
                <div class="user-menu-name">${esc(u.name || '用户')}${vipBadge}</div>
                <div class="user-menu-email">${esc(u.email || '')}</div>
            </div>
        </div>
        ${resumeCard}
        <a href="#/account" class="user-menu-item" role="menuitem" data-act="account"><span>个人中心</span></a>
        <a href="#/account?section=notifications" class="user-menu-item" role="menuitem" data-act="notifications"><span>消息通知</span>${unreadBadge}</a>
        <a href="#/favorites" class="user-menu-item" role="menuitem" data-act="favorites"><span>我的收藏</span>${favoritesBadge}</a>
        <a href="#/watch-later" class="user-menu-item" role="menuitem" data-act="watch-later"><span>稍后看</span>${laterBadge}</a>
        <a href="#/history" class="user-menu-item" role="menuitem" data-act="history"><span>观看历史</span>${historyBadge}</a>
        <a href="#/requests?tab=mine" class="user-menu-item" role="menuitem" data-act="requests"><span>我的求片</span></a>
        <a href="#/vip" class="user-menu-item" role="menuitem" data-act="vip"><span>VIP 会员</span>${vipMenuBadge}</a>
        <button class="user-menu-item user-menu-signout" role="menuitem" data-act="signout">退出登录</button>
    `;
    shell.querySelector('.nav-actions').appendChild(menu);
    userButton?.setAttribute('aria-expanded', 'true');
    userButton?.setAttribute('aria-controls', 'user-menu');
    loadNotifications({ force: !notificationSummary.value.loaded }).catch(() => {});

    menu.querySelector('[data-act="signout"]').addEventListener('click', async () => {
        closeUserMenu(shell);
        const result = await signOut();
        if (!result?.success && result?.error) showSiteNotice(result.error, { tone: 'error' });
    });
    menu.querySelectorAll('a.user-menu-item, a.user-menu-resume').forEach((el) => {
        el.addEventListener('click', () => closeUserMenu(shell));
    });
    shell._userMenuOutside = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== userButton) {
            closeUserMenu(shell);
        }
    };
    shell._userMenuKeydown = (ev) => handleUserMenuKeydown(shell, ev);
    menu.addEventListener('keydown', shell._userMenuKeydown);
    setTimeout(() => document.addEventListener('click', shell._userMenuOutside), 0);
    requestAnimationFrame(() => focusUserMenuItem(menu, 0));
}

function latestResumeItem() {
    const items = [...(watchHistory.value || [])]
        .filter((item) => item?.id)
        .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    return items.find((item) => isResumableHistoryItem(item)) || null;
}

function resumeCardHTML(item) {
    const href = historyPlayHref(item);
    const title = item.name || '继续观看';
    const progress = resumeProgressText(item);
    const meta = [
        item.episodeLabel || item.episodeTitle || '',
        progress,
    ].filter(Boolean).join(' · ');
    return `
        <a href="${esc(href)}" class="user-menu-resume" role="menuitem" data-act="resume">
            <span class="user-menu-resume-copy">
                <span class="user-menu-resume-kicker">继续观看</span>
                <span class="user-menu-resume-title">${esc(title)}</span>
                ${meta ? `<span class="user-menu-resume-meta">${esc(meta)}</span>` : ''}
            </span>
            <span class="user-menu-resume-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
        </a>
    `;
}

function historyPlayHref(item) {
    const type = item.type === 'movie' ? 'movie' : 'series';
    if (item.videoId) return `#/play/${type}/${item.id}/${item.videoId}`;
    const hasProgress = Number(item.progress || 0) > 0 || Number(item.percent || 0) > 0;
    if (type === 'movie' && hasProgress) return `#/play/${type}/${item.id}`;
    return `#/detail/${type}/${item.id}`;
}

function resumeProgressText(item) {
    return playbackStatusLabel(item, { unwatchedLabel: '' });
}

function countBadge(value) {
    const count = Number(value || 0);
    if (count <= 0) return '';
    return `<span class="user-menu-pill">${esc(count > 99 ? '99+' : String(count))}</span>`;
}

function vipStatusBadge() {
    const status = vipStatus.value;
    if (!status) return '<span class="user-menu-pill user-menu-pill-muted">同步中</span>';
    if (status.role === 'admin') return '<span class="user-menu-pill user-menu-pill-vip">管理</span>';
    if (hasVipAccess()) {
        const days = daysUntilExpire();
        const urgent = days > 0 && days <= 7;
        return `<span class="user-menu-pill ${urgent ? 'user-menu-pill-warn' : 'user-menu-pill-vip'}">${esc(days > 0 ? `剩余 ${days} 天` : '已生效')}</span>`;
    }
    if (status.role === 'vip' && status.expireAt) {
        return '<span class="user-menu-pill user-menu-pill-warn">已过期</span>';
    }
    return '<span class="user-menu-pill user-menu-pill-muted">未开通</span>';
}

function closeUserMenu(shell, options = {}) {
    const menu = shell.querySelector('#user-menu');
    menu?.removeEventListener('keydown', shell._userMenuKeydown);
    menu?.remove();
    const userButton = shell.querySelector('#user-btn');
    userButton?.setAttribute('aria-expanded', 'false');
    userButton?.removeAttribute('aria-controls');
    if (shell._userMenuOutside) {
        document.removeEventListener('click', shell._userMenuOutside);
        shell._userMenuOutside = null;
    }
    shell._userMenuKeydown = null;
    if (options.restoreFocus) {
        userButton?.focus?.({ preventScroll: true });
    }
}

function handleUserMenuKeydown(shell, event) {
    const menu = shell.querySelector('#user-menu');
    if (!menu) return;
    const items = userMenuItems(menu);
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement));
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeUserMenu(shell, { restoreFocus: true });
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        focusUserMenuItem(menu, currentIndex + 1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        focusUserMenuItem(menu, currentIndex - 1);
        return;
    }
    if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        focusUserMenuItem(menu, 0);
        return;
    }
    if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        focusUserMenuItem(menu, items.length - 1);
        return;
    }
    if (event.key === 'Tab') {
        const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= items.length) {
            event.preventDefault();
            event.stopPropagation();
            focusUserMenuItem(menu, event.shiftKey ? items.length - 1 : 0);
        }
    }
}

function userMenuItems(menu) {
    return [...menu.querySelectorAll('.user-menu-resume, .user-menu-item')]
        .filter((item) => !item.disabled && item.offsetParent !== null);
}

function focusUserMenuItem(menu, index) {
    const items = userMenuItems(menu);
    if (!items.length) return;
    const normalized = (index + items.length) % items.length;
    items[normalized].focus({ preventScroll: true });
}

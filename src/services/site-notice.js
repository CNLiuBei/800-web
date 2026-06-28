// 全站顶部通知（Apple 风格）：统一 toast / 离线条 / 操作反馈

import { esc, loadCSS } from '../core/html.js';

const notices = new Map();
let host = null;
let cssReady = false;

const DEFAULT_ICONS = {
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    success: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    offline: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>',
    online: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M12 20h.01"/></svg>',
};

function ensureHost() {
    if (!cssReady) {
        loadCSS('styles/site-notice.css');
        cssReady = true;
    }
    if (!host) {
        host = document.createElement('div');
        host.id = 'site-notice-host';
        host.className = 'site-notice-host';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    return host;
}

function clearTimer(entry) {
    if (entry?.timer) clearTimeout(entry.timer);
}

export function dismissSiteNotice(id, reason = '') {
    const entry = notices.get(id);
    if (!entry) return;
    entry.onDismiss?.(reason);
    clearTimer(entry);
    notices.delete(id);
    const { el } = entry;
    el.classList.remove('is-visible');
    el.classList.add('is-leaving');
    const remove = () => el.remove();
    el.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 320);
}

export function showSiteNotice(message, options = {}) {
    const {
        id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title = '',
        subtitle = '',
        tone = 'info',
        duration = 3200,
        persistent = false,
        multiline = false,
        dismissible = true,
        icon = '',
        action = null,
        secondaryAction = null,
        actions = null,
        onDismiss = null,
    } = options;

    const root = ensureHost();
    dismissSiteNotice(id);

    const notice = document.createElement('div');
    notice.className = `site-notice site-notice--${tone}${persistent ? ' is-persistent' : ''}${multiline ? ' is-multiline' : ''}`;
    notice.dataset.noticeId = id;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    const iconHtml = icon || DEFAULT_ICONS[tone] || DEFAULT_ICONS.info;
    const bodyText = multiline ? esc(message).replace(/\n/g, '<br>') : esc(message);
    const titleHtml = title ? `<strong class="site-notice-title">${esc(title)}</strong>` : '';
    const subtitleHtml = subtitle ? `<span class="site-notice-subtitle">${esc(subtitle)}</span>` : '';
    const messageHtml = message
        ? `<span class="site-notice-message${title || subtitle ? ' has-heading' : ''}">${bodyText}</span>`
        : '';

    const actionButtons = [];
    const pushAction = (act, kind = 'button') => {
        if (!act) return;
        if (kind === 'link' && act.href) {
            actionButtons.push(`<a class="site-notice-action" href="${esc(act.href)}">${esc(act.label || '查看')}</a>`);
            return;
        }
        actionButtons.push(`<button type="button" class="site-notice-action${act.primary ? ' is-primary' : ''}${act.dismiss ? ' is-dismiss' : ''}" data-action-key="${esc(act.key || act.label || 'action')}">${esc(act.label || '确定')}</button>`);
    };

    if (Array.isArray(actions)) actions.forEach((act) => pushAction(act, act.href ? 'link' : 'button'));
    else {
        pushAction(action?.onClick || action?.href ? action : null, action?.href ? 'link' : 'button');
        pushAction(secondaryAction?.onClick || secondaryAction?.href ? secondaryAction : null, secondaryAction?.href ? 'link' : 'button');
    }

    notice.innerHTML = `
        <div class="site-notice-card">
            <div class="site-notice-leading" aria-hidden="true">${iconHtml}</div>
            <div class="site-notice-copy">
                ${titleHtml}
                ${subtitleHtml}
                ${messageHtml}
            </div>
            ${actionButtons.length ? `<div class="site-notice-actions">${actionButtons.join('')}</div>` : ''}
            ${dismissible ? '<button type="button" class="site-notice-close" aria-label="关闭">&times;</button>' : ''}
        </div>
    `;

    const actionMap = new Map();
    const actionMeta = new Map();
    if (Array.isArray(actions)) {
        actions.forEach((act) => {
            if (act?.onClick) {
                const key = act.key || act.label || 'action';
                actionMap.set(key, act.onClick);
                actionMeta.set(key, act);
            }
        });
    } else {
        if (action?.onClick) {
            actionMap.set(action.label || 'action', action.onClick);
            actionMeta.set(action.label || 'action', action);
        }
        if (secondaryAction?.onClick) {
            actionMap.set(secondaryAction.label || 'secondary', secondaryAction.onClick);
            actionMeta.set(secondaryAction.label || 'secondary', secondaryAction);
        }
    }

    notice.querySelectorAll('[data-action-key]').forEach((btn) => {
        const key = btn.dataset.actionKey;
        btn.addEventListener('click', (event) => {
            actionMap.get(key)?.(event);
            if (!actionMeta.get(key)?.keepOpen) dismissSiteNotice(id);
        });
    });
    notice.querySelectorAll('a.site-notice-action').forEach((link) => {
        link.addEventListener('click', () => dismissSiteNotice(id));
    });
    notice.querySelector('.site-notice-close')?.addEventListener('click', () => dismissSiteNotice(id));

    root.prepend(notice);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => notice.classList.add('is-visible'));
    });

    let timer = null;
    if (!persistent && duration > 0) {
        timer = setTimeout(() => dismissSiteNotice(id), duration);
    }
    notices.set(id, { el: notice, timer, onDismiss });
    return id;
}

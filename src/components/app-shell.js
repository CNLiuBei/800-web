// App Shell - 顶层轻壳。搜索、用户菜单等重交互按需加载。

import { toggleTheme } from '../services/theme.js';
import { t } from '../services/i18n.js';
import { user, initAuth } from '../services/auth.js';
import { notificationSummary, loadNotifications, startNotificationPolling, fetchNotificationPreferences } from '../services/notifications.js';
import { effect } from '../core/signal.js';
import { loadCSS } from '../core/html.js';

const template = () => `
<nav id="navbar">
    <a href="#/" class="nav-logo"><span class="nav-logo-img" aria-label="800"></span></a>
    <div class="nav-tabs">
        <a href="#/" class="nav-tab" data-route="home">${t('nav.home')}</a>
        <a href="#/movie" class="nav-tab" data-route="movie">${t('nav.movie')}</a>
        <a href="#/tv" class="nav-tab" data-route="tv">${t('nav.tv')}</a>
        <a href="#/anime" class="nav-tab" data-route="anime">${t('nav.anime')}</a>
        <a href="#/rankings" class="nav-tab" data-route="rankings">排行</a>
        <a href="#/favorites" class="nav-tab" data-route="favorites">收藏</a>
        <a href="#/vip" class="nav-tab" data-route="vip">VIP</a>
    </div>
    <div class="nav-actions">
        <button class="nav-btn" id="search-toggle" title="${t('nav.search')}" aria-label="${t('nav.search')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>
        <button class="nav-btn" id="theme-toggle" title="${t('nav.theme')}" aria-label="${t('nav.theme')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
        <button class="nav-btn" id="user-btn" title="用户" aria-label="用户菜单" aria-haspopup="menu" aria-expanded="false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </button>
    </div>
</nav>
<main id="app"></main>
<button class="back-to-top" id="back-to-top" aria-label="返回顶部">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 15l-6-6-6 6"/></svg>
</button>
<nav id="bottom-nav" aria-label="主导航">
    <a href="#/" class="bottom-tab" data-route="home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
        <span>${t('nav.home')}</span>
    </a>
    <a href="#/movie" class="bottom-tab" data-route="movie">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/></svg>
        <span>${t('nav.movie')}</span>
    </a>
    <a href="#/tv" class="bottom-tab" data-route="tv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/></svg>
        <span>${t('nav.tv')}</span>
    </a>
    <a href="#/anime" class="bottom-tab" data-route="anime">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
        <span>${t('nav.anime')}</span>
    </a>
    <a href="#/requests" class="bottom-tab" data-route="requests">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <span>求片</span>
    </a>
    <a href="#/account" class="bottom-tab" data-route="account">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        <span>我的</span>
    </a>
</nav>
`;

class AppShell extends HTMLElement {
    connectedCallback() {
        this.innerHTML = template();
        this.setupTheme();
        this.setupNavHighlight();
        this.setupLazySearch();
        this.setupLazyUser();
        this.setupNotificationBadge();
        this.setupBackToTop();
    }

    setupTheme() {
        this.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
    }

    setupNavHighlight() {
        const update = () => {
            const hash = location.hash.slice(1) || '/';
            const matchRoute = (route) =>
                (route === 'home' && (hash === '/' || hash === '')) ||
                (route === 'movie' && hash.startsWith('/movie')) ||
                (route === 'tv' && hash.startsWith('/tv')) ||
                (route === 'anime' && hash.startsWith('/anime')) ||
                (route === 'requests' && hash.startsWith('/requests')) ||
                (route === 'rankings' && hash.startsWith('/rankings')) ||
                (route === 'favorites' && (hash.startsWith('/favorites') || hash.startsWith('/watch-later') || hash.startsWith('/history'))) ||
                (route === 'vip' && hash.startsWith('/vip')) ||
                (route === 'account' && hash.startsWith('/account'));
            this.querySelectorAll('.nav-tab, .bottom-tab').forEach(tab => {
                const active = matchRoute(tab.dataset.route);
                tab.classList.toggle('active', active);
                if (active) tab.setAttribute('aria-current', 'page');
                else tab.removeAttribute('aria-current');
            });
            this.querySelector('#back-to-top')?.classList.remove('visible');
            this._closeSearch?.();
            this.closeUserMenu?.();
        };
        window.addEventListener('hashchange', update);
        update();
    }

    setupLazySearch() {
        this.querySelector('#search-toggle').addEventListener('click', async () => {
            const { openSearch } = await import('./app-search.js');
            openSearch(this);
        });
    }

    setupLazyUser() {
        const btn = this.querySelector('#user-btn');
        if (!btn) return;
        let userModulePromise = null;
        const preloadUserModule = () => {
            loadCSS('styles/nav.css');
            if (!userModulePromise) {
                userModulePromise = import('./app-user.js');
            }
            import('../pages/account.js?v=' + (window.GY_WEB_STATIC_VERSION || '1')).catch(() => {});
            return userModulePromise;
        };
        btn.addEventListener('pointerenter', preloadUserModule, { passive: true });
        btn.addEventListener('focus', preloadUserModule);
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const { handleUserClick } = await preloadUserModule();
            handleUserClick(this, e);
        });
    }

    setupNotificationBadge() {
        initAuth().catch(() => {});
        effect(() => {
            const currentUser = user.value;
            if (currentUser) {
                loadNotifications().catch(() => {});
                fetchNotificationPreferences().catch(() => {});
                startNotificationPolling();
            } else {
                notificationSummary.value = { items: [], unreadCount: 0, loaded: false, loading: false, error: null };
            }
        });
        effect(() => {
            const btn = this.querySelector('#user-btn');
            const libraryTab = this.querySelector('#bottom-nav .bottom-tab[data-route="account"]');
            if (!btn && !libraryTab) return;
            const count = Number(notificationSummary.value.unreadCount || 0);
            const label = count > 99 ? '99+' : String(count);
            updateBadge(btn, {
                count,
                label,
                className: 'nav-btn-badge',
                emptyAria: '用户菜单',
                aria: `用户菜单，${label} 条未读消息`,
            });
            updateBadge(libraryTab, {
                count,
                label,
                className: 'bottom-tab-badge',
                emptyAria: '我的',
                aria: `我的，${label} 条未读消息`,
            });
        });
    }

    setupBackToTop() {
        const btn = this.querySelector('#back-to-top');
        const app = document.getElementById('app');
        if (!app || !btn) return;
        let ticking = false;
        app.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                btn.classList.toggle('visible', app.scrollTop > 500);
                ticking = false;
            });
        }, { passive: true });
        btn.addEventListener('click', () => {
            app.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}

function updateBadge(target, options) {
    if (!target) return;
    let badge = target.querySelector(`.${options.className}`);
    if (options.count <= 0) {
        badge?.remove();
        target.setAttribute('aria-label', options.emptyAria);
        return;
    }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = options.className;
        target.appendChild(badge);
    }
    badge.textContent = options.label;
    target.setAttribute('aria-label', options.aria);
}

customElements.define('app-shell', AppShell);

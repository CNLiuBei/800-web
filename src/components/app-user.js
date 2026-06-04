import { user, initAuth, signOut } from '../services/auth.js';
import { vipStatus, checkVipStatus, hasVipAccess } from '../services/vip.js';
import { effect } from '../core/signal.js';
import { esc, loadCSS } from '../core/html.js';

let authReady = null;

export async function handleUserClick(shell, event) {
    event?.stopPropagation?.();
    await ensureUserShell(shell);
    if (user.value) {
        await loadCSS('styles/nav.css');
        toggleUserMenu(shell);
    } else {
        await loadCSS('styles/layout.css');
        const { default: AuthModal } = await import('./auth-modal.js');
        AuthModal.open('login');
    }
}

async function ensureUserShell(shell) {
    if (!authReady) authReady = initAuth().catch(() => {});
    if (!shell._userShellBound) {
        shell.closeUserMenu = () => closeUserMenu(shell);
        effect(() => { user.value; closeUserMenu(shell); });
        effect(() => {
            if (user.value) checkVipStatus().catch(() => {});
            else vipStatus.value = null;
        });
        shell._userShellBound = true;
    }
    await authReady;
}

function toggleUserMenu(shell) {
    if (shell.querySelector('#user-menu')) { closeUserMenu(shell); return; }
    const u = user.value;
    if (!u) return;

    const menu = document.createElement('div');
    menu.id = 'user-menu';
    menu.className = 'user-menu';
    const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    const avatarInner = u.image
        ? `<img src="${esc(u.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : initial;
    const vipBadge = hasVipAccess() ? '<span class="user-menu-vip">VIP</span>' : '';
    menu.innerHTML = `
        <div class="user-menu-head">
            <div class="user-menu-avatar">${avatarInner}</div>
            <div class="user-menu-info">
                <div class="user-menu-name">${esc(u.name || '用户')}${vipBadge}</div>
                <div class="user-menu-email">${esc(u.email || '')}</div>
            </div>
        </div>
        <a href="#/account" class="user-menu-item" data-act="account">个人中心</a>
        <a href="#/favorites" class="user-menu-item" data-act="favorites">我的收藏</a>
        <a href="#/history" class="user-menu-item" data-act="history">观看历史</a>
        <a href="#/vip" class="user-menu-item" data-act="vip">VIP 会员</a>
        <button class="user-menu-item user-menu-signout" data-act="signout">退出登录</button>
    `;
    shell.querySelector('.nav-actions').appendChild(menu);

    menu.querySelector('[data-act="signout"]').addEventListener('click', async () => {
        closeUserMenu(shell);
        await signOut();
    });
    menu.querySelectorAll('a.user-menu-item').forEach((el) => {
        el.addEventListener('click', () => closeUserMenu(shell));
    });
    shell._userMenuOutside = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== shell.querySelector('#user-btn')) {
            closeUserMenu(shell);
        }
    };
    setTimeout(() => document.addEventListener('click', shell._userMenuOutside), 0);
}

function closeUserMenu(shell) {
    shell.querySelector('#user-menu')?.remove();
    if (shell._userMenuOutside) {
        document.removeEventListener('click', shell._userMenuOutside);
        shell._userMenuOutside = null;
    }
}

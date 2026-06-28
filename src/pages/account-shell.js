// 个人中心外壳：侧栏 + 主内容 + 移动端 drill-down

const NAV_CHEVRON = `
    <svg class="gy-account-nav-chevron" viewBox="0 0 10 16" width="7" height="12" aria-hidden="true">
        <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

export function renderAccountNavItem(section, { active = false, badge = '' } = {}) {
    const badgeHtml = badge
        ? `<span class="gy-account-nav-badge">${badge}</span>`
        : '';
    return `
        <button
            type="button"
            class="gy-account-nav-item ${active ? 'is-active' : ''}"
            data-section="${section.id}"
            aria-current="${active ? 'page' : 'false'}"
        >
            <span class="gy-account-nav-leading">
                <span class="gy-account-nav-icon" aria-hidden="true">${section.icon()}</span>
                <span>${section.label}</span>
                ${badgeHtml}
            </span>
            ${NAV_CHEVRON}
        </button>
    `;
}

export function renderAccountShell({
    profileAvatarHtml,
    profileName,
    profileEmail,
    profileMetaHtml = '',
    navHtml,
}) {
    return `
        <div class="gy-account">
            <div class="gy-account-frame">
                <aside class="gy-account-sidebar" aria-label="个人中心导航">
                    <div class="gy-account-profile">
                        ${profileAvatarHtml}
                        <div class="gy-account-profile-copy">
                            <p class="gy-account-profile-name">${profileName}</p>
                            <p class="gy-account-profile-email">${profileEmail}</p>
                            ${profileMetaHtml}
                        </div>
                    </div>
                    <nav class="gy-account-nav">${navHtml}</nav>
                </aside>
                <main class="gy-account-main">
                    <button type="button" class="gy-account-mobile-back" id="account-shell-mobile-back" aria-label="返回账户菜单">
                        <svg viewBox="0 0 12 20" width="8" height="14" aria-hidden="true">
                            <path d="M10 2L3 10l7 8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span>账户</span>
                    </button>
                    <div class="account-panel-host" id="account-panel-host"></div>
                </main>
            </div>
        </div>
    `;
}

export function bindAccountShell(root, {
    getActiveSection,
    onSectionChange,
}) {
    const shell = root.querySelector('.gy-account');
    const mq = window.matchMedia('(max-width: 820px)');

    const isMobile = () => mq.matches;

    const syncMobileShell = () => {
        if (!shell) return;
        if (!isMobile()) {
            shell.classList.remove('is-mobile-detail');
            return;
        }
        shell.classList.toggle('is-mobile-detail', Boolean(getActiveSection()));
    };

    const syncNavActive = () => {
        const id = getActiveSection();
        root.querySelectorAll('.gy-account-nav-item[data-section]').forEach((btn) => {
            const on = btn.dataset.section === id;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-current', on ? 'page' : 'false');
        });
    };

    const showMobileMenu = () => {
        onSectionChange('', { mobileMenu: true });
        shell?.classList.remove('is-mobile-detail');
        root.querySelector('#account-panel-host')?.replaceChildren();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const applyLayoutMode = () => {
        if (isMobile()) {
            if (!getActiveSection()) showMobileMenu();
            else syncMobileShell();
            return;
        }
        if (!getActiveSection()) onSectionChange('profile');
        syncMobileShell();
        syncNavActive();
    };

    root.querySelector('.gy-account-nav')?.addEventListener('click', (event) => {
        const button = event.target.closest('.gy-account-nav-item[data-section]');
        if (!button) return;
        onSectionChange(button.dataset.section || 'profile');
        syncNavActive();
        syncMobileShell();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    root.querySelector('#account-shell-mobile-back')?.addEventListener('click', showMobileMenu);

    mq.addEventListener('change', applyLayoutMode);
    applyLayoutMode();

    return { syncNavActive, syncMobileShell, applyLayoutMode, showMobileMenu };
}
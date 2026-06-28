/** 带版本号的 auth-modal 动态加载，避免浏览器/SW 缓存旧注册验证逻辑。 */
export async function loadAuthModal() {
    const v = window.GY_WEB_STATIC_VERSION || '1';
    const mod = await import(`../components/auth-modal.js?v=${v}`);
    return mod.default;
}

export async function openAuthModal(mode = 'login') {
    const AuthModal = await loadAuthModal();
    return AuthModal.open(mode);
}

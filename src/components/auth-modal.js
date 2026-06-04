// 登录/注册弹窗组件

import { signIn, signUp } from '../services/auth.js';
import { t } from '../services/i18n.js';

class AuthModal extends HTMLElement {
    connectedCallback() {
        this._mode = 'login'; // 'login' | 'signup'
        this._render();
    }

    _render() {
        const isLogin = this._mode === 'login';
        this.innerHTML = `
            <div class="auth-backdrop">
                <div class="auth-card">
                    <button class="auth-close" id="auth-close">&times;</button>
                    <h2 class="auth-title">${isLogin ? '登录' : '注册'}</h2>
                    <form class="auth-form" id="auth-form">
                        ${!isLogin ? '<input type="text" name="name" placeholder="昵称" required class="auth-input" maxlength="40">' : ''}
                        <input type="email" name="email" placeholder="邮箱" required class="auth-input" autocomplete="email">
                        <input type="password" name="password" placeholder="密码（至少 6 位）" required class="auth-input" minlength="6" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
                        ${!isLogin ? '<input type="password" name="confirm" placeholder="确认密码" required class="auth-input" minlength="6" autocomplete="new-password">' : ''}
                        <div class="auth-error hidden" id="auth-error"></div>
                        <button type="submit" class="auth-submit">${isLogin ? '登录' : '注册'}</button>
                    </form>
                    <div class="auth-switch">
                        ${isLogin ? '没有账号？' : '已有账号？'}
                        <a href="#" id="auth-switch-link">${isLogin ? '注册' : '登录'}</a>
                    </div>
                </div>
            </div>
        `;

        // 事件
        this.querySelector('#auth-close').addEventListener('click', () => this.close());
        this.querySelector('.auth-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
        this.querySelector('#auth-switch-link').addEventListener('click', (e) => {
            e.preventDefault();
            this._mode = this._mode === 'login' ? 'signup' : 'login';
            this._render();
        });
        this.querySelector('#auth-form').addEventListener('submit', (e) => this._handleSubmit(e));

        // 自动聚焦
        setTimeout(() => this.querySelector('input[name="email"]')?.focus(), 100);
    }

    async _handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const errorEl = this.querySelector('#auth-error');
        const submitBtn = form.querySelector('.auth-submit');

        const email = form.email.value.trim();
        const password = form.password.value;
        const name = form.name?.value?.trim();

        // 注册：前端先校验昵称与确认密码，避免无谓的请求与误导性错误
        if (this._mode === 'signup') {
            if (!name || name.length < 1 || name.length > 40) {
                errorEl.textContent = '请输入 1-40 个字符的昵称';
                errorEl.classList.remove('hidden');
                return;
            }
            const confirm = form.confirm?.value || '';
            if (password.length < 6) {
                errorEl.textContent = '密码至少 6 位';
                errorEl.classList.remove('hidden');
                return;
            }
            if (password !== confirm) {
                errorEl.textContent = '两次输入的密码不一致';
                errorEl.classList.remove('hidden');
                return;
            }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';
        errorEl.classList.add('hidden');

        let result;
        if (this._mode === 'login') {
            result = await signIn(email, password);
        } else {
            result = await signUp(name, email, password);
        }

        if (result.success) {
            this.close();
            this.dispatchEvent(new CustomEvent('authenticated'));
            // 登录态变化后，刷新依赖用户数据的当前页面（个人中心 / VIP / 收藏 / 历史）
            const hash = location.hash;
            if (/^#\/(account|vip|favorites|history)/.test(hash)) {
                const { reloadRoute } = await import('../core/router.js');
                reloadRoute();
            }
        } else {
            errorEl.textContent = result.error;
            errorEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = this._mode === 'login' ? '登录' : '注册';
        }
    }

    close() {
        this.remove();
    }

    // 静态方法：打开弹窗
    static open(mode = 'login') {
        // 防止重复打开
        if (document.querySelector('auth-modal')) return;
        const modal = document.createElement('auth-modal');
        modal._mode = mode;
        document.body.appendChild(modal);
        return modal;
    }
}

customElements.define('auth-modal', AuthModal);
export default AuthModal;

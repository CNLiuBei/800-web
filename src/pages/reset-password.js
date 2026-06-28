import { esc } from '../core/html.js';
import { resetPassword } from '../services/auth.js';
import { navigate } from '../core/router.js';

export function render(container, params = {}) {
    const query = params.query || new URLSearchParams();
    const token = query.get('token') || '';
    const error = query.get('error') || '';

    container.innerHTML = `
        <section class="account-page reset-password-page">
            <div class="account-card reset-password-card">
                <h1 class="account-guest-title">重置密码</h1>
                <p class="account-guest-copy">${error === 'INVALID_TOKEN'
                    ? '重置链接无效或已过期，请重新申请。'
                    : '请输入新密码完成重置。'}</p>
                ${token && error !== 'INVALID_TOKEN' ? `
                    <form class="account-form" id="reset-password-form">
                        ${passwordFieldHTML('new-password', '新密码（至少 6 位）')}
                        ${passwordFieldHTML('confirm-password', '确认新密码')}
                        <div class="account-msg hidden" id="reset-password-msg"></div>
                        <button class="account-primary-btn" type="submit" id="reset-password-submit">更新密码</button>
                    </form>
                ` : `
                    <button class="account-primary-btn" type="button" id="reset-password-back">返回个人中心</button>
                `}
            </div>
        </section>
    `;

    container.querySelector('#reset-password-back')?.addEventListener('click', () => {
        navigate('/account');
    });

    const form = container.querySelector('#reset-password-form');
    if (!form || !token) return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const msg = container.querySelector('#reset-password-msg');
        const btn = container.querySelector('#reset-password-submit');
        const next = form.querySelector('input[name="new-password"]')?.value || '';
        const confirm = form.querySelector('input[name="confirm-password"]')?.value || '';

        const showMsg = (text, ok = false) => {
            if (!msg) return;
            msg.textContent = text;
            msg.classList.toggle('hidden', !text);
            msg.classList.toggle('ok', ok);
            msg.classList.toggle('error', !ok && !!text);
        };

        if (next.length < 6) {
            showMsg('密码至少 6 位');
            return;
        }
        if (next !== confirm) {
            showMsg('两次输入的密码不一致');
            return;
        }

        btn.disabled = true;
        showMsg('正在更新…', true);
        const result = await resetPassword(token, next);
        if (result.success) {
            showMsg('密码已更新，请使用新密码登录', true);
            setTimeout(() => navigate('/account'), 1200);
            return;
        }
        showMsg(result.error || '重置失败');
        btn.disabled = false;
    });
}

function passwordFieldHTML(name, placeholder) {
    return `
        <label class="auth-password-field">
            <input type="password" name="${name}" placeholder="${esc(placeholder)}" required class="auth-input" minlength="6" autocomplete="new-password">
        </label>
    `;
}

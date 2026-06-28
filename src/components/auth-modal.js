// 登录/注册弹窗组件

import { showSiteNotice } from '../services/site-notice.js';

const AUTH_NOTICE_ID = 'auth-notice';

let authModulePromise;
function getAuthModule() {
    if (!authModulePromise) {
        // 必须与 app 其余部分共用同一 auth 模块实例，不可加 ?v=（否则会 duplicate module、登录态不同步）
        authModulePromise = import('../services/auth.js');
    }
    return authModulePromise;
}

class AuthModal extends HTMLElement {
    connectedCallback() {
        this._mode = ['signup', 'reset', 'twofa'].includes(this._mode) ? this._mode : 'login'; // 'login' | 'signup' | 'reset' | 'twofa'
        this._draft = this._draft || { email: '', name: '', username: '', identifier: '', password: '' };
        this._requireSignupCode = this._requireSignupCode ?? null;
        this._signupPolicy = this._signupPolicy || { usernameMinLength: 5, usernameMaxLength: 30 };
        this._usernameStatus = this._usernameStatus || null;
        this._signupCodeSentFor = this._signupCodeSentFor || '';
        this._signupCodeCooldownUntil = this._signupCodeCooldownUntil || 0;
        this._signupCodeTimer = this._signupCodeTimer || null;
        this._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                return;
            }
            if (e.key === 'Tab') this._trapFocus(e);
        };
        document.addEventListener('keydown', this._onKeyDown, true);
        if (this._mode === 'signup') void this._ensureSignupPolicy();
        this._render();
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this._onKeyDown, true);
        if (this._signupCodeTimer) {
            clearInterval(this._signupCodeTimer);
            this._signupCodeTimer = null;
        }
        if (this._previousFocus?.isConnected) this._previousFocus.focus();
    }

    _render() {
        const isLogin = this._mode === 'login';
        const isReset = this._mode === 'reset';
        const isTwoFa = this._mode === 'twofa';
        const draft = this._draft || {};
        const emailValue = escapeAttribute(draft.email || '');
        const usernameValue = escapeAttribute(draft.username || '');
        const identifierValue = escapeAttribute(draft.identifier || '');
        const title = isTwoFa ? '双因素验证' : (isReset ? '找回密码' : (isLogin ? '登录' : '注册'));
        const helper = isTwoFa
            ? '请输入验证器 App 中的 6 位验证码，或使用备用码。'
            : (isReset
            ? '输入注册邮箱，我们会发送重置链接（如邮箱已注册）。'
            : (isLogin
                ? '登录后可同步收藏、历史、会员和播放进度。'
                : '设置登录用户名，验证邮箱后即可完成注册；展示昵称可在个人中心修改。'));
        const showSignupCode = !isLogin && !isReset && !isTwoFa && this._requireSignupCode !== false;
        const { usernameMinLength, usernameMaxLength } = this._usernameLimits();
        this.innerHTML = `
            <div class="auth-backdrop" role="presentation">
                <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-helper">
                    <button class="auth-close" id="auth-close" type="button" aria-label="关闭">&times;</button>
                    <h2 class="auth-title" id="auth-title">${title}</h2>
                    <p class="auth-helper" id="auth-helper">${helper}</p>
                    <form class="auth-form" id="auth-form">
                        ${!isLogin && !isReset && !isTwoFa ? `<input type="text" name="username" placeholder="用户名（${usernameMinLength}-${usernameMaxLength} 位，字母开头）" required class="auth-input" minlength="${usernameMinLength}" maxlength="${usernameMaxLength}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" value="${usernameValue}">` : ''}
                        ${!isLogin && !isReset && !isTwoFa ? '<div class="auth-password-hint" id="auth-username-hint" role="status" aria-live="polite"></div>' : ''}
                        ${isLogin ? `<input type="text" name="identifier" placeholder="邮箱或用户名" required class="auth-input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" value="${identifierValue}">` : ''}
                        ${!isLogin && !isTwoFa ? `<input type="email" name="email" placeholder="邮箱" required class="auth-input" autocomplete="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" value="${emailValue}">` : ''}
                        ${showSignupCode ? signupOtpRowHTML() : ''}
                        ${isTwoFa ? `<input type="text" name="twofa" placeholder="验证码或备用码" required class="auth-input" autocomplete="one-time-code" inputmode="numeric" maxlength="16">` : ''}
                        ${!isReset && !isTwoFa ? passwordFieldHTML('password', '密码（至少 6 位）', isLogin ? 'current-password' : 'new-password') : ''}
                        ${!isLogin && !isReset && !isTwoFa ? passwordFieldHTML('confirm', '确认密码', 'new-password') : ''}
                        ${!isLogin && !isReset && !isTwoFa ? '<div class="auth-password-hint" id="auth-password-hint" role="status" aria-live="polite">密码至少 6 位</div>' : ''}
                        <div class="auth-error hidden" id="auth-error" role="alert"></div>
                        <div class="auth-success hidden" id="auth-success" role="status"></div>
                        <button type="submit" class="auth-submit">${isTwoFa ? '验证并登录' : (isReset ? '发送重置邮件' : (isLogin ? '登录' : '注册'))}</button>
                    </form>
                    <div class="auth-oauth hidden" id="auth-oauth"></div>
                    <div class="auth-switch">
                        ${isTwoFa ? '<a href="#" id="auth-back-link">返回登录</a>' : (isReset ? '<a href="#" id="auth-back-link">返回登录</a>' : `${isLogin ? '没有账号？' : '已有账号？'}<a href="#" id="auth-switch-link">${isLogin ? '注册' : '登录'}</a>`)}
                        ${isLogin ? '<span class="auth-switch-sep"> · </span><a href="#" id="auth-forgot-link">忘记密码？</a>' : ''}
                    </div>
                </div>
            </div>
        `;

        // 事件
        this.querySelector('#auth-close').addEventListener('click', () => this.close());
        this.querySelector('.auth-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
        this.querySelector('#auth-switch-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._rememberDraft();
            this._mode = this._mode === 'login' ? 'signup' : 'login';
            this._render();
        });
        this.querySelector('#auth-forgot-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._rememberDraft();
            this._mode = 'reset';
            this._render();
        });
        this.querySelector('#auth-back-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._rememberDraft();
            this._mode = 'login';
            this._render();
        });
        this.querySelector('#auth-form').addEventListener('submit', (e) => this._handleSubmit(e));
        this.querySelectorAll('.auth-password-toggle').forEach((btn) => {
            btn.addEventListener('click', () => togglePassword(btn));
        });
        this.querySelectorAll('.auth-input').forEach((input) => {
            input.addEventListener('input', () => {
                this._rememberDraft();
                this._hideError();
                if (!isLogin) {
                    this._updatePasswordHint();
                    if (input.name === 'username') {
                        this._usernameStatus = null;
                        this._updateUsernameHint();
                    }
                    if (input.name === 'email') this._handleEmailChanged();
                }
            });
        });
        this.querySelector('input[name="email"]')?.addEventListener('blur', () => this._normalizeEmailInput());
        this.querySelector('input[name="username"]')?.addEventListener('blur', () => {
            this._normalizeUsernameInput();
            void this._checkUsernameAvailable();
        });
        this.querySelector('#auth-send-signup-code')?.addEventListener('click', () => this._handleSendSignupCode());
        if (!isLogin && !isReset) {
            this._updatePasswordHint();
            this._updateUsernameHint();
        }
        this._restoreSignupCodeCooldown();

        if (isLogin) this._renderOAuthButtons();

        // 自动聚焦
        setTimeout(() => {
            if (isTwoFa) this.querySelector('input[name="twofa"]')?.focus();
            else if (isLogin) this.querySelector('input[name="identifier"]')?.focus();
            else if (isReset) this.querySelector('input[name="email"]')?.focus();
            else this.querySelector('input[name="username"]')?.focus();
        }, 100);
    }

    _usernameLimits() {
        const min = Number(this._signupPolicy?.usernameMinLength) || 5;
        const max = Number(this._signupPolicy?.usernameMaxLength) || 30;
        return { usernameMinLength: min, usernameMaxLength: max };
    }

    async _ensureSignupPolicy() {
        if (this._requireSignupCode !== null) return;
        try {
            const { fetchSignupPolicy } = await getAuthModule();
            const policy = await fetchSignupPolicy();
            this._signupPolicy = policy;
            this._requireSignupCode = policy.requireSignupCode === true;
        } catch {
            this._signupPolicy = { requireSignupCode: true, usernameMinLength: 5, usernameMaxLength: 30 };
            this._requireSignupCode = true;
        }
        if (this._mode === 'signup' && this.isConnected) this._render();
    }

    async _handleSendSignupCode() {
        const form = this.querySelector('#auth-form');
        const emailInput = form?.email;
        const email = emailInput ? normalizeEmail(emailInput.value) : '';
        if (emailInput) emailInput.value = email;
        this._rememberDraft();
        this._hideError();
        this._hideSuccess();

        if (!email || !email.includes('@')) {
            this._showError('请先填写有效邮箱', emailInput);
            return;
        }

        const btn = this.querySelector('#auth-send-signup-code');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        btn.textContent = '发送中...';
        let result;
        try {
            const { sendSignupCode } = await getAuthModule();
            result = await sendSignupCode(email);
        } catch (err) {
            result = { success: false, error: err?.message || '发送失败' };
        }

        if (!result.success) {
            btn.disabled = false;
            btn.textContent = '获取验证码';
            this._showError(result.error || '发送失败，请稍后重试', emailInput);
            return;
        }

        this._showSuccess(result.message || '验证码已发送，请查收邮件');
        this._signupCodeSentFor = email;
        this._startSignupCodeCooldown(btn, 60);
        this.querySelector('input[name="signupCode"]')?.focus();
    }

    _restoreSignupCodeCooldown() {
        const btn = this.querySelector('#auth-send-signup-code');
        if (!btn || !this._signupCodeCooldownUntil) return;
        const remaining = Math.ceil((this._signupCodeCooldownUntil - Date.now()) / 1000);
        if (remaining > 0) this._startSignupCodeCooldown(btn, remaining);
    }

    _handleEmailChanged() {
        const emailInput = this.querySelector('input[name="email"]');
        if (!emailInput || !this._signupCodeSentFor) return;
        const email = normalizeEmail(emailInput.value);
        if (email === this._signupCodeSentFor) return;
        const codeInput = this.querySelector('input[name="signupCode"]');
        if (codeInput) codeInput.value = '';
        this._signupCodeSentFor = '';
        this._hideSuccess();
    }

    _startSignupCodeCooldown(btn, seconds) {
        if (this._signupCodeTimer) clearInterval(this._signupCodeTimer);
        let remaining = seconds;
        this._signupCodeCooldownUntil = Date.now() + remaining * 1000;
        btn.disabled = true;
        btn.textContent = `${remaining}s`;
        this._signupCodeTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(this._signupCodeTimer);
                this._signupCodeTimer = null;
                this._signupCodeCooldownUntil = 0;
                btn.disabled = false;
                btn.textContent = '获取验证码';
                return;
            }
            btn.textContent = `${remaining}s`;
        }, 1000);
    }

    async _renderOAuthButtons() {
        const host = this.querySelector('#auth-oauth');
        if (!host) return;
        const { fetchSocialProviders } = await getAuthModule();
        const providers = await fetchSocialProviders();
        if (!providers.length) {
            host.classList.add('hidden');
            return;
        }
        const labels = { google: 'Google', github: 'GitHub' };
        host.classList.remove('hidden');
        host.innerHTML = `
            <div class="auth-oauth-divider">或使用第三方登录</div>
            ${providers.map((p) => `<button type="button" class="auth-oauth-btn" data-provider="${escapeAttribute(p)}">${labels[p] || p}</button>`).join('')}
        `;
        host.querySelectorAll('[data-provider]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                const { signInWithSocial } = await getAuthModule();
                const result = await signInWithSocial(btn.dataset.provider);
                if (result.redirectUrl) {
                    window.location.href = result.redirectUrl;
                    return;
                }
                btn.disabled = false;
                if (result.success) {
                    await this._finishAuthenticated();
                } else {
                    this._showError(result.error || 'OAuth 登录失败');
                }
            });
        });
    }

    _trapFocus(event) {
        const focusables = [...this.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
            .filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            event.stopPropagation();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            event.stopPropagation();
            first.focus({ preventScroll: true });
        } else if (!this.contains(document.activeElement)) {
            event.preventDefault();
            event.stopPropagation();
            first.focus({ preventScroll: true });
        }
    }

    async _finishAuthenticated() {
        let title = '登录成功';
        let subtitle = '欢迎回来，账号数据已同步';
        if (this._mode === 'signup') {
            title = '注册成功';
            subtitle = '欢迎加入，收藏与观看进度将自动同步';
        } else if (this._mode === 'twofa') {
            title = '验证成功';
            subtitle = '双因素验证通过，已登录';
        } else if (this._verificationEmail || this._verificationIdentifier) {
            title = '邮箱验证成功';
            subtitle = '欢迎加入，账号已激活';
        }
        showSiteNotice('', {
            id: AUTH_NOTICE_ID,
            tone: 'success',
            duration: 2800,
            title,
            subtitle,
        });
        this.dispatchEvent(new CustomEvent('authenticated'));
        this.close('authenticated');
        const { scheduleLibrarySync } = await import('../services/library.js');
        scheduleLibrarySync();
        const hash = location.hash;
        if (/^#\/(account|vip|favorites|history|watch-later|play|requests)/.test(hash)) {
            const { reloadRoute } = await import('../core/router.js');
            reloadRoute();
        }
    }

    async _handleSubmit(e) {
        e.preventDefault();
        const form = e.target;

        const identifier = form.identifier?.value?.trim() || '';
        const email = form.email ? normalizeEmail(form.email.value) : '';
        if (form.email) form.email.value = email;
        const password = form.password?.value || '';
        const username = form.username?.value?.trim() || '';
        this._rememberDraft();

        if (this._mode === 'reset') {
            setFormBusy(form, true, this._mode);
            this._hideError();
            this._hideSuccess();
            let result;
            try {
                const { requestPasswordReset } = await getAuthModule();
                result = await requestPasswordReset(email);
            } catch (err) {
                result = { success: false, error: err?.message || '发送失败，请重试' };
            }
            setFormBusy(form, false, this._mode);
            if (result.success) {
                this._showSuccess(result.message || '如邮箱已注册，请查收重置邮件');
            } else {
                this._showError(result.error || '发送失败，请重试', form.email);
            }
            return;
        }

        if (this._mode === 'twofa') {
            const code = form.twofa?.value?.trim() || '';
            if (!code) {
                this._showError('请输入验证码', form.twofa);
                return;
            }
            setFormBusy(form, true, this._mode);
            this._hideError();
            let result;
            try {
                const { verifyTwoFactorTotp, verifyTwoFactorBackupCode } = await getAuthModule();
                result = await verifyTwoFactorTotp(code, true);
                if (!result.success && code.length >= 8) {
                    result = await verifyTwoFactorBackupCode(code, true);
                }
            } catch (err) {
                result = { success: false, error: err?.message || '验证失败' };
            }
            if (result.success) {
                await this._finishAuthenticated();
            } else {
                setFormBusy(form, false, this._mode);
                this._showError(result.error || '验证失败', form.twofa);
            }
            return;
        }

        // 注册：前端先校验用户名、验证码与确认密码
        if (this._mode === 'signup') {
            this._updatePasswordHint();
            this._updateUsernameHint();
            const limits = this._usernameLimits();
            const usernameError = validateUsername(username, limits);
            if (usernameError) {
                this._usernameStatus = 'invalid';
                this._updateUsernameHint();
                this._showError(usernameError, form.username);
                return;
            }
            if (this._usernameStatus === 'taken') {
                this._showError('该用户名已被占用', form.username);
                return;
            }
            const confirm = form.confirm?.value || '';
            if (password.length < 6) {
                this._showError('密码至少 6 位', form.password);
                return;
            }
            if (password !== confirm) {
                this._showError('两次输入的密码不一致', form.confirm);
                return;
            }
            if (this._requireSignupCode) {
                const code = form.signupCode?.value?.trim() || '';
                if (!/^\d{6}$/.test(code)) {
                    this._showError('请输入 6 位邮箱验证码', form.signupCode);
                    return;
                }
                if (this._signupCodeSentFor && email !== this._signupCodeSentFor) {
                    this._showError('邮箱已变更，请重新获取验证码', form.email);
                    return;
                }
            }
        }

        setFormBusy(form, true, this._mode);
        this._hideError();

        let result;
        try {
            const { signInWithIdentifier, signUp, isUsernameAvailable } = await getAuthModule();
            if (this._mode === 'login') {
                if (!identifier) {
                    setFormBusy(form, false, this._mode);
                    this._showError('请输入邮箱或用户名', form.identifier);
                    return;
                }
                result = await signInWithIdentifier(identifier, password);
            } else {
                const avail = await isUsernameAvailable(username);
                if (!avail.available) {
                    setFormBusy(form, false, this._mode);
                    this._usernameStatus = 'taken';
                    this._updateUsernameHint();
                    this._showError(avail.error || '该用户名已被占用', form.username);
                    return;
                }
                const code = form.signupCode?.value?.trim() || '';
                result = await signUp(username, email, password, code);
            }
        } catch (err) {
            result = { success: false, error: err?.message || '操作失败，请重试' };
        }

        if (result.success) {
            await this._finishAuthenticated();
        } else if (result.needsTwoFactor) {
            setFormBusy(form, false, this._mode);
            this._mode = 'twofa';
            this._render();
        } else if (result.needsEmailVerification) {
            this._stashDraft({
                email: result.email || email || identifier,
                password,
                identifier: result.identifier || identifier,
            });
            setFormBusy(form, false, this._mode);
            this._showVerificationNotice({
                email: result.email || email || '',
                identifier: result.identifier || identifier || '',
                error: result.error,
            });
        } else {
            setFormBusy(form, false, this._mode);
            this._showError(result.error || '操作失败，请重试', this._fieldForError(form, result.error));
        }
    }

    // 展示验证码输入界面，供用户输入邮箱收到的验证码完成验证。
    _showVerificationNotice({ email = '', identifier = '', error: errorMessage = '' } = {}) {
        this._verificationEmail = String(email || '').includes('@') ? email : '';
        this._verificationIdentifier = String(identifier || email || '').trim();
        const displayTarget = this._verificationEmail || this._verificationIdentifier || '你的邮箱';
        this._hideSuccess();
        this._hideError();
        if (errorMessage) this._showError(errorMessage, null);
        this.innerHTML = `
            <div class="auth-backdrop" role="presentation">
                <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-otp-title">
                    <button class="auth-close" id="auth-close" type="button" aria-label="关闭">&times;</button>
                    <h2 class="auth-title" id="auth-otp-title">验证邮箱</h2>
                    <p class="auth-helper">${this._verificationEmail
                        ? `验证码将发送至 ${escapeAttribute(this._verificationEmail)}，请输入邮件中的 6 位验证码。`
                        : `账号 ${escapeAttribute(displayTarget)} 需验证邮箱。请点击下方按钮获取验证码。`}</p>
                    <form class="auth-form" id="auth-otp-form">
                        <div class="auth-otp-row">
                            <input type="text" name="otp" placeholder="请输入验证码" required class="auth-input auth-input-otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6" autofocus>
                        </div>
                        <div class="auth-error hidden" id="auth-error" role="alert"></div>
                        <div class="auth-success hidden" id="auth-success" role="status"></div>
                        <button type="submit" class="auth-submit">验证</button>
                        <button type="button" class="auth-link-btn" id="auth-resend-btn">重新发送验证码</button>
                    </form>
                    <div class="auth-switch">
                        <a href="#" id="auth-back-link">返回登录</a>
                    </div>
                </div>
            </div>
        `;
        this.querySelector('#auth-close').addEventListener('click', () => this.close());
        this.querySelector('.auth-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.close();
        });
        this.querySelector('#auth-back-link').addEventListener('click', (e) => {
            e.preventDefault();
            this._mode = 'login';
            this._render();
        });
        this.querySelector('#auth-otp-form').addEventListener('submit', (e) => this._handleOtpSubmit(e));
        this.querySelector('#auth-resend-btn').addEventListener('click', () => this._handleResendVerificationCode());
        setTimeout(() => this.querySelector('input[name="otp"]')?.focus(), 100);
        if (!this._verificationEmail && this._verificationIdentifier) {
            void this._handleResendVerificationCode({ auto: true });
        }
    }

    async _handleResendVerificationCode({ auto = false } = {}) {
        const btn = this.querySelector('#auth-resend-btn');
        if (!btn || btn.disabled) return;
        if (!auto) {
            btn.disabled = true;
            btn.textContent = '发送中...';
        }
        this._hideError();
        const target = this._verificationEmail || this._verificationIdentifier || this._draft?.identifier || this._draft?.email || '';
        const { resendVerificationEmail } = await getAuthModule();
        const res = await resendVerificationEmail(target);
        if (res.success) {
            if (res.email) {
                this._verificationEmail = res.email;
                const helper = this.querySelector('.auth-helper');
                if (helper) {
                    helper.textContent = `验证码将发送至 ${res.email}，请输入邮件中的 6 位验证码。`;
                }
            }
            this._showSuccess(res.message || '验证码已发送，请查收邮件');
            if (!auto) {
                btn.textContent = '已重新发送';
                setTimeout(() => { btn.textContent = '重新发送验证码'; btn.disabled = false; }, 3000);
            }
            return;
        }
        if (!auto) {
            btn.textContent = '重新发送验证码';
            btn.disabled = false;
        }
        this._showError(res.error || '发送失败，请稍后重试');
    }

    async _handleOtpSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const code = form.otp?.value?.trim() || '';
        if (!/^\d{6}$/.test(code)) {
            this._showError('请输入 6 位验证码', form.otp);
            return;
        }
        const email = this._verificationEmail
            || (String(this._draft?.email || '').includes('@') ? this._draft.email : '');
        if (!email) {
            this._showError('请先点击「重新发送验证码」获取邮件', form.otp);
            return;
        }
        setFormBusy(form, true, 'signup');
        this._hideError();
        let result;
        let signInFn;
        try {
            const auth = await getAuthModule();
            signInFn = auth.signInWithIdentifier;
            result = await auth.verifyEmailOtp(email, code);
        } catch (err) {
            result = { success: false, error: err?.message || '验证失败' };
        }
        if (result.success) {
            this._showSuccess('邮箱验证成功！正在登录...');
            setSubmitText(form, '验证成功');
            const loginId = this._verificationIdentifier || email || this._draft?.identifier || this._draft?.email || '';
            const autoLoginResult = await signInFn(loginId, this._draft?.password || '');
            if (autoLoginResult.success) {
                await this._finishAuthenticated();
            } else if (autoLoginResult.needsTwoFactor) {
                setFormBusy(form, false, 'signup');
                this._mode = 'twofa';
                this._render();
            } else {
                setFormBusy(form, false, 'signup');
                this._showSuccess('邮箱验证成功！');
                this._showError(autoLoginResult.error || '自动登录失败，请手动登录');
            }
        } else {
            setFormBusy(form, false, 'signup');
            this._showError(result.error || '验证码错误或已过期', form.otp);
        }
    }

    _showError(message, focusTarget = null) {
        const titles = {
            login: '登录失败',
            signup: '注册失败',
            reset: '找回密码',
            twofa: '验证失败',
        };
        showSiteNotice(message || '操作失败，请重试', {
            id: AUTH_NOTICE_ID,
            tone: 'error',
            duration: 4500,
            title: titles[this._mode] || '操作失败',
        });
        this._hideError();
        focusTarget?.focus?.({ preventScroll: true });
    }

    _hideError() {
        const errorEl = this.querySelector('#auth-error');
        errorEl?.classList.add('hidden');
        errorEl && (errorEl.textContent = '');
    }

    _showSuccess(message) {
        showSiteNotice(message, {
            id: AUTH_NOTICE_ID,
            tone: 'success',
            duration: 3600,
            title: this._mode === 'reset' ? '邮件已发送' : '操作成功',
        });
        this._hideSuccess();
    }

    _hideSuccess() {
        const successEl = this.querySelector('#auth-success');
        successEl?.classList.add('hidden');
    }

    _updateUsernameHint() {
        const hint = this.querySelector('#auth-username-hint');
        const form = this.querySelector('#auth-form');
        if (!hint || !form) return;
        const username = form.username?.value?.trim() || '';
        const limits = this._usernameLimits();
        const formatError = validateUsername(username, limits);
        hint.classList.remove('ok', 'warn');
        if (!username) {
            hint.textContent = `用户名 ${limits.usernameMinLength}-${limits.usernameMaxLength} 位，字母开头，可含数字与下划线`;
            return;
        }
        if (formatError) {
            hint.classList.add('warn');
            hint.textContent = formatError;
            return;
        }
        if (this._usernameStatus === 'checking') {
            hint.textContent = '正在检查用户名…';
            return;
        }
        if (this._usernameStatus === 'taken') {
            hint.classList.add('warn');
            hint.textContent = '该用户名已被占用';
            return;
        }
        if (this._usernameStatus === 'available') {
            hint.classList.add('ok');
            hint.textContent = '用户名可用';
            return;
        }
        hint.textContent = '失焦后将检查是否可用';
    }

    _updatePasswordHint() {
        const hint = this.querySelector('#auth-password-hint');
        const form = this.querySelector('#auth-form');
        if (!hint || !form) return;
        const password = form.password?.value || '';
        const confirm = form.confirm?.value || '';
        const longEnough = password.length >= 6;
        const matched = confirm.length > 0 && password === confirm;
        hint.classList.toggle('ok', longEnough && matched);
        hint.classList.toggle('warn', confirm.length > 0 && !matched);
        if (!longEnough) {
            hint.textContent = `还需 ${6 - password.length} 位`;
        } else if (!confirm) {
            hint.textContent = '请再次输入密码确认';
        } else if (!matched) {
            hint.textContent = '两次密码不一致';
        } else {
            hint.textContent = '密码已确认';
        }
    }

    _rememberDraft() {
        const form = this.querySelector('#auth-form');
        const currentDraft = this._draft || {};
        const passwordValue = form?.password?.value;
        this._draft = {
            email: form?.email ? form.email.value : (currentDraft.email || ''),
            username: form?.username ? form.username.value : (currentDraft.username || ''),
            name: form?.name ? form.name.value : (currentDraft.name || ''),
            identifier: form?.identifier ? form.identifier.value : (currentDraft.identifier || ''),
            password: passwordValue != null && passwordValue !== ''
                ? passwordValue
                : (currentDraft.password || ''),
        };
    }

    _stashDraft(partial = {}) {
        this._draft = { ...(this._draft || {}), ...partial };
    }

    async _checkUsernameAvailable() {
        const input = this.querySelector('input[name="username"]');
        if (!input || this._mode !== 'signup') return;
        const username = input.value.trim();
        this._rememberDraft();
        const limits = this._usernameLimits();
        const formatError = validateUsername(username, limits);
        if (formatError) {
            this._usernameStatus = 'invalid';
            this._updateUsernameHint();
            return;
        }
        this._usernameStatus = 'checking';
        this._updateUsernameHint();
        try {
            const { isUsernameAvailable } = await getAuthModule();
            const result = await isUsernameAvailable(username);
            if (input.value.trim() !== username) return;
            this._usernameStatus = result.available ? 'available' : 'taken';
            this._updateUsernameHint();
        } catch {
            this._usernameStatus = null;
            this._updateUsernameHint();
        }
    }

    _normalizeUsernameInput() {
        const input = this.querySelector('input[name="username"]');
        if (!input) return;
        input.value = input.value.trim();
        this._rememberDraft();
    }

    _normalizeEmailInput() {
        const emailInput = this.querySelector('input[name="email"]');
        if (!emailInput) return;
        emailInput.value = normalizeEmail(emailInput.value);
        this._rememberDraft();
    }

    _fieldForError(form, message = '') {
        if (form.identifier) return form.identifier;
        if (/用户名|username/i.test(message)) return form.username;
        if (/邮箱|email/i.test(message)) return form.email;
        if (/验证码|code/i.test(message)) return form.signupCode || form.twofa;
        return form.querySelector('[name="password"]');
    }

    close(reason = 'dismiss') {
        if (this._draft) this._draft.password = '';
        this.dispatchEvent(new CustomEvent('closed', { detail: { reason } }));
        this.remove();
    }

    // 静态方法：打开弹窗
    static open(mode = 'login') {
        // 防止重复打开
        const existing = document.querySelector('auth-modal');
        if (existing) {
            existing._rememberDraft?.();
            existing._mode = mode === 'signup' ? 'signup' : (mode === 'reset' ? 'reset' : 'login');
            existing._render();
            return existing;
        }
        const modal = document.createElement('auth-modal');
        modal._mode = mode;
        document.body.appendChild(modal);
        return modal;
    }
}

function signupOtpRowHTML() {
    return `
        <div class="auth-otp-send-row">
            <input type="text" name="signupCode" placeholder="邮箱验证码" required class="auth-input auth-input-otp-inline" autocomplete="one-time-code" inputmode="numeric" maxlength="6" enterkeyhint="next">
            <button type="button" class="auth-code-btn" id="auth-send-signup-code">获取验证码</button>
        </div>
    `;
}

function passwordFieldHTML(name, placeholder, autocomplete) {
    return `
        <label class="auth-password-field">
            <input type="password" name="${name}" placeholder="${placeholder}" required class="auth-input" minlength="6" autocomplete="${autocomplete}">
            <button class="auth-password-toggle" type="button" data-target="${name}" aria-label="显示${name === 'confirm' ? '确认' : ''}密码" aria-pressed="false">
                <svg class="auth-eye-open" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="auth-eye-closed hidden" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.58 10.58a2 2 0 0 0 2.83 2.83"/><path d="M9.88 4.24A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a18.2 18.2 0 0 1-2.14 3.19"/><path d="M6.61 6.61C3.76 8.53 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 4.35-.9"/></svg>
            </button>
        </label>
    `;
}

function validateUsername(value, { usernameMinLength = 5, usernameMaxLength = 30 } = {}) {
    const username = String(value || '').trim();
    if (!username) return '请输入用户名';
    if (username.length < usernameMinLength || username.length > usernameMaxLength) {
        return `用户名需 ${usernameMinLength}-${usernameMaxLength} 个字符`;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(username)) {
        return '用户名需以字母开头，仅含字母、数字、下划线';
    }
    return null;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function togglePassword(btn) {
    const input = btn.closest('.auth-password-field')?.querySelector('input');
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    btn.setAttribute('aria-pressed', String(!visible));
    btn.setAttribute('aria-label', `${visible ? '显示' : '隐藏'}${btn.dataset.target === 'confirm' ? '确认' : ''}密码`);
    btn.querySelector('.auth-eye-open')?.classList.toggle('hidden', !visible);
    btn.querySelector('.auth-eye-closed')?.classList.toggle('hidden', visible);
    input.focus();
}

function setFormBusy(form, busy, mode) {
    const submitBtn = form.querySelector('.auth-submit');
    form.querySelectorAll('input, button').forEach((el) => {
        if (el === submitBtn) return;
        el.disabled = busy;
    });
    submitBtn.disabled = busy;
    const labels = { login: '登录', signup: '注册', reset: '发送重置邮件' };
    submitBtn.textContent = busy ? '处理中...' : (labels[mode] || '提交');
}

function setSubmitText(form, text) {
    const submitBtn = form.querySelector('.auth-submit');
    if (submitBtn) submitBtn.textContent = text;
}

customElements.define('auth-modal', AuthModal);
export default AuthModal;

// 用户认证服务 - Better Auth

import { signal } from '../core/signal.js';
import { API_BASE, API_V1_BASE, lazyApiString } from './config.js';

const AUTH_BASE = lazyApiString(() => `${API_BASE}/auth`);

// 当前用户状态
export const user = signal(null);      // { id, name, email } | null
export const loading = signal(true);   // 初始加载中
let initPromise = null;
let sessionStatePromise = null;
let hydratePromise = null;
/** 防止 initAuth 与登录/退出并发时覆盖最新登录态 */
let authEpoch = 0;

function bumpAuthEpoch() {
    authEpoch += 1;
    return authEpoch;
}

function authCode(data) {
    return data?.code || data?.error?.code || null;
}

function needsEmailVerification(data) {
    if (authCode(data) === 'EMAIL_NOT_VERIFIED') return true;
    const message = String(data?.message || data?.error?.message || '').toLowerCase();
    return /email not verified|email.*not.*verified|邮箱.*验证|尚未验证/.test(message);
}

async function finishSignInFromResponse(data) {
    if (data?.twoFactorRedirect) {
        return {
            success: false,
            needsTwoFactor: true,
            twoFactorMethods: Array.isArray(data.twoFactorMethods) ? data.twoFactorMethods : ['totp'],
        };
    }
    if (data?.user) {
        return completeAuthenticatedSession(data.user);
    }
    if (needsEmailVerification(data)) {
        return null;
    }
    if (authCode(data)) {
        return { success: false, error: zhError(data, '登录失败') };
    }
    if (await ensureSessionEstablished()) {
        await hydrateUserFromMe();
        return { success: true };
    }
    return null;
}

async function completeAuthenticatedSession(nextUser) {
    bumpAuthEpoch();
    user.value = nextUser;
    loading.value = false;
    if (await ensureSessionEstablished()) {
        await hydrateUserFromMe();
        return { success: true };
    }
    bumpAuthEpoch();
    user.value = null;
    return { success: false, error: SESSION_SAVE_ERROR };
}

// 初始化：检查当前会话
export async function initAuth() {
    if (initPromise) return initPromise;
    loading.value = true;
    initPromise = doInitAuth().finally(() => {
        initPromise = null;
    });
    return initPromise;
}

async function doInitAuth() {
    const epoch = authEpoch;
    try {
        const session = await request('/get-session');
        if (epoch !== authEpoch) return;
        user.value = session?.user || null;
        if (user.value) await hydrateUserFromMe();
    } catch {
        if (epoch === authEpoch && !user.value) user.value = null;
    } finally {
        loading.value = false;
    }
}

/** 等待 initAuth 完成，避免未就绪时误判为未登录。 */
export async function waitForAuthReady(timeoutMs = 8000) {
    if (!initPromise) initAuth().catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (loading.value && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (initPromise) await initPromise.catch(() => {});
}

export function isAuthenticated() {
    return Boolean(user.value);
}

/** 用业务 /me 补齐 role、VIP、头像、2FA 等字段（去重并发） */
export async function hydrateUserFromMe() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = doHydrateUserFromMe().finally(() => {
        hydratePromise = null;
    });
    return hydratePromise;
}

async function doHydrateUserFromMe() {
    const snapshot = user.value;
    if (!snapshot?.id) return null;
    try {
        const res = await fetch(`${API_V1_BASE}/me`, { credentials: 'include' });
        const me = await res.json().catch(() => null);
        if (!res.ok || !me?.id) return null;
        if (!user.value || user.value.id !== snapshot.id) return null;
        user.value = { ...user.value, ...me };
        return me;
    } catch {
        return null;
    }
}

// Better Auth 错误码 → 中文文案（基于真实返回的 code 字段）
const ERROR_MESSAGES = {
    INVALID_EMAIL_OR_PASSWORD: '邮箱或密码错误',
    INVALID_USERNAME_OR_PASSWORD: '用户名或密码错误',
    USER_ALREADY_EXISTS: '该邮箱已被注册',
    EMAIL_ALREADY_EXISTS: '该邮箱已被注册',
    PASSWORD_TOO_SHORT: '密码至少 6 位',
    PASSWORD_TOO_LONG: '密码过长',
    VALIDATION_ERROR: '请求参数不正确',
    INVALID_EMAIL: '邮箱格式不正确',
    INVALID_PASSWORD: '当前密码错误',
    USER_NOT_FOUND: '用户不存在',
    TOO_MANY_REQUESTS: '操作过于频繁，请稍后再试',
    RESET_PASSWORD_DISABLED: '密码重置暂未开启，请联系管理员',
    EMAIL_NOT_VERIFIED: '邮箱尚未验证，请查收验证邮件后再登录',
    EMAIL_ALREADY_VERIFIED: '邮箱已验证，请直接登录',
    INVALID_ORIGIN: '请求来源无效，请从官网页面登录',
    MISSING_OR_NULL_ORIGIN: '浏览器安全校验失败，请关闭无痕模式或更换浏览器后重试',
    EMAIL_DOMAIN_NOT_ALLOWED: '该邮箱后缀暂不支持注册，请更换邮箱',
    SIGNUP_CODE_REQUIRED: '请输入 6 位邮箱验证码',
    SIGNUP_CODE_INVALID: '验证码错误或已过期',
    EMAIL_DELIVERY_DISABLED: '邮箱验证暂未开启',
    INVALID_USERNAME: '用户名格式不正确',
    USERNAME_ALREADY_EXISTS: '该用户名已被占用',
};

function zhError(data, fallback) {
    if (!data) return fallback;
    const code = authCode(data);
    const message = data.message || data?.error?.message;
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    return message || fallback;
}

async function ensureSessionEstablished() {
    const epoch = authEpoch;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const session = await request('/get-session');
            if (epoch !== authEpoch) return false;
            if (session?.user) {
                user.value = session.user;
                return true;
            }
        } catch {
            /* retry */
        }
        if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
        }
    }
    if (epoch === authEpoch) user.value = null;
    return false;
}

const SESSION_SAVE_ERROR = '登录状态未能保存，请允许 Cookie 或关闭无痕模式后重试';

// 登录
export async function signIn(email, password) {
    try {
        const data = await request('/sign-in/email', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        const result = await finishSignInFromResponse(data);
        if (result) {
            if (result.success === false && needsEmailVerification(data)) {
                return { success: false, needsEmailVerification: true, email, identifier: email, error: zhError(data, '邮箱尚未验证') };
            }
            return result;
        }
        if (needsEmailVerification(data)) {
            return { success: false, needsEmailVerification: true, email, identifier: email, error: zhError(data, '邮箱尚未验证') };
        }
        return { success: false, error: zhError(data, '登录失败') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '登录失败') };
    }
}

// 用户名登录（Better Auth username 插件）
export async function signInWithUsername(username, password) {
    try {
        const data = await request('/sign-in/username', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        const result = await finishSignInFromResponse(data);
        if (result) {
            if (result.success === false && needsEmailVerification(data)) {
                return {
                    success: false,
                    needsEmailVerification: true,
                    email: data?.user?.email || '',
                    identifier: username,
                    error: zhError(data, '邮箱尚未验证'),
                };
            }
            return result;
        }
        if (needsEmailVerification(data)) {
            return {
                success: false,
                needsEmailVerification: true,
                email: data?.user?.email || '',
                identifier: username,
                error: zhError(data, '邮箱尚未验证'),
            };
        }
        return { success: false, error: zhError(data, '登录失败') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '登录失败') };
    }
}

// 检查用户名是否可用
export async function isUsernameAvailable(username) {
    try {
        const data = await request('/is-username-available', {
            method: 'POST',
            body: JSON.stringify({ username: String(username || '').trim() }),
        });
        if (data?.available === true) return { available: true, error: null };
        return { available: false, error: zhError(data, '该用户名已被占用') };
    } catch (e) {
        return { available: false, error: e.message || '检查失败' };
    }
}

// 注册策略：邮箱验证码、用户名长度等
export async function fetchSignupPolicy() {
    try {
        const data = await request('/signup-policy');
        return {
            requireSignupCode: data?.requireSignupCode === true,
            usernameMinLength: Number(data?.usernameMinLength) || 5,
            usernameMaxLength: Number(data?.usernameMaxLength) || 30,
        };
    } catch {
        return { requireSignupCode: true, usernameMinLength: 5, usernameMaxLength: 30 };
    }
}

// 发送注册邮箱验证码（入库前）
export async function sendSignupCode(email) {
    try {
        const data = await request('/send-signup-code', {
            method: 'POST',
            body: JSON.stringify({ email: String(email || '').trim().toLowerCase() }),
        });
        if (data?.status === true) {
            return { success: true, message: data.message || '验证码已发送，请查收邮件' };
        }
        return { success: false, error: zhError(data, '发送失败，请稍后重试') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '发送失败') };
    }
}

// 注册（用户名 + 邮箱验证码通过后再入库）
export async function signUp(username, email, password, code) {
    try {
        const payload = {
            username: String(username || '').trim(),
            email,
            password,
        };
        if (code) payload.code = code;
        const data = await request('/sign-up/email', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        if (data?.user) {
            return completeAuthenticatedSession(data.user);
        }
        if (await ensureSessionEstablished()) {
            await hydrateUserFromMe();
            return { success: true };
        }
        return { success: false, error: zhError(data, '注册失败') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '注册失败') };
    }
}

// 登录（邮箱或用户名自动识别）：含 @ 视为邮箱，否则按用户名登录。
export async function signInWithIdentifier(identifier, password) {
    const value = String(identifier || '').trim();
    if (value.includes('@')) {
        return signIn(value.toLowerCase(), password);
    }
    return signInWithUsername(value, password);
}

// 重新发送登录验证邮件（6 位 OTP，支持邮箱或用户名）
export async function resendVerificationEmail(emailOrUsername) {
    try {
        const value = String(emailOrUsername || '').trim();
        const payload = value.includes('@')
            ? { email: value.toLowerCase() }
            : { username: value };
        const data = await request('/send-login-verification-code', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        if (data?.status === true) {
            return {
                success: true,
                message: data.message || '验证码已发送，请查收邮件',
                email: data.email || (value.includes('@') ? value.toLowerCase() : ''),
            };
        }
        return { success: false, error: zhError(data, '发送失败，请稍后重试') };
    } catch (e) {
        return { success: false, error: e.message || '发送失败，请稍后重试' };
    }
}

// 验证邮箱验证码（注册后输入验证码完成邮箱验证）
export async function verifyEmailOtp(email, code) {
    try {
        const data = await request('/verify-email-otp', {
            method: 'POST',
            body: JSON.stringify({ email, code }),
        });
        if (data?.status === true) {
            return { success: true };
        }
        return { success: false, error: zhError(data, '验证码错误或已过期') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '验证失败') };
    }
}

// 退出
export async function signOut() {
    bumpAuthEpoch();
    try {
        await request('/sign-out', { method: 'POST', body: '{}' });
    } catch {
        return { success: false, error: '退出失败，请检查网络后重试' };
    }
    try {
        const session = await request('/get-session');
        if (session?.user) {
            user.value = session.user;
            return { success: false, error: '退出失败，请重试' };
        }
    } catch {
        /* sign-out 已成功，get-session 失败时仍视为已退出 */
    }
    user.value = null;
    return { success: true };
}

// 修改密码（Better Auth /auth/change-password）
export async function changePassword(currentPassword, newPassword, revokeOtherSessions = true) {
    try {
        const data = await request('/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions }),
        });
        // 成功返回 { user } 或 token；失败返回含 code/message 的 body
        if (data && data.user) return { success: true };
        if (data && !authCode(data) && !data.message) return { success: true };
        return { success: false, error: zhError(data, '当前密码错误或修改失败') };
    } catch (e) {
        return { success: false, error: e.message || '修改失败，请稍后重试' };
    }
}

// 请求重置密码（Better Auth POST /auth/request-password-reset）
export async function requestPasswordReset(email, redirectTo) {
    try {
        const target = redirectTo || `${window.location.origin}/#/reset-password`;
        const data = await request('/request-password-reset', {
            method: 'POST',
            body: JSON.stringify({ email, redirectTo: target }),
        });
        if (data?.status === true || data?.status === undefined) {
            return { success: true, message: data?.message || '如邮箱已注册，请查收重置邮件' };
        }
        return { success: false, error: zhError(data, '发送失败') };
    } catch (e) {
        return { success: false, error: e.message || '发送失败，请稍后重试' };
    }
}

// 使用邮件 token 重置密码（Better Auth POST /auth/reset-password）
export async function resetPassword(token, newPassword) {
    try {
        const data = await request('/reset-password', {
            method: 'POST',
            body: JSON.stringify({ token, newPassword }),
        });
        if (data?.status === true || (data && !authCode(data) && !data.message)) {
            return { success: true };
        }
        return { success: false, error: zhError(data, '重置失败，链接可能已过期') };
    } catch (e) {
        return { success: false, error: e.message || '重置失败，请稍后重试' };
    }
}

// 更新个人资料（Better Auth POST /auth/update-user）
export async function updateProfile(name) {
    try {
        const data = await request('/update-user', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
        if (data?.user) {
            user.value = user.value ? { ...user.value, ...data.user } : data.user;
            await hydrateUserFromMe();
            return { success: true };
        }
        if (data && !authCode(data) && !data.message) {
            await hydrateUserFromMe();
            return { success: true };
        }
        return { success: false, error: zhError(data, '保存失败') };
    } catch (e) {
        return { success: false, error: e.message || '保存失败' };
    }
}

// 注销账号（软删除）—— 需密码二次确认，成功后清空本地登录态
export async function deleteAccount(password) {
    try {
        const res = await fetchBusiness('/me', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            bumpAuthEpoch();
            user.value = null;
            return { success: true };
        }
        return { success: false, error: data?.message || '注销失败' };
    } catch (e) {
        return { success: false, error: e.message || '注销失败，请稍后重试' };
    }
}

// 列出当前用户的所有登录会话。走业务接口，避免把 session token 暴露给浏览器页面。
export async function listSessions() {
    const data = await fetchSessionState();
    if (Array.isArray(data?.sessions)) return data.sessions;
    return [];
}

// 兼容旧调用：当前页面不再需要 token，只返回当前会话 id。
export async function getCurrentSessionToken() {
    try {
        const data = await fetchSessionState();
        return data?.currentSessionId || null;
    } catch {
        return null;
    }
}

// 获取当前会话信息（用于在会话列表中标记「本设备」）
export async function getCurrentSession() {
    try {
        const data = await fetchSessionState();
        const current = data?.sessions?.find?.((session) => session.current) || null;
        return current || (data?.currentSessionId ? { id: data.currentSessionId } : null);
    } catch {
        return null;
    }
}

// 撤销指定会话（按服务端安全 session id）
export async function revokeSession(sessionId) {
    try {
        const res = await fetchBusiness('/me/sessions/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, error: zhError(data, '操作失败') };
        return { success: true, revoked: Number(data?.revoked ?? 1) || 1 };
    } catch (e) {
        return { success: false, error: e.message || '操作失败' };
    }
}

// 撤销除当前外的所有其他会话
export async function revokeOtherSessions() {
    try {
        const res = await fetchBusiness('/me/sessions/revoke-others', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, error: zhError(data, '操作失败') };
        return { success: true, revoked: Number(data?.revoked ?? 0) || 0 };
    } catch (e) {
        return { success: false, error: e.message || '操作失败' };
    }
}

// 修改邮箱（Better Auth POST /auth/change-email，需验证邮件）
export async function changeEmail(newEmail, callbackURL) {
    try {
        const target = callbackURL || `${window.location.origin}/#/account?section=settings`;
        const data = await request('/change-email', {
            method: 'POST',
            body: JSON.stringify({ newEmail, callbackURL: target }),
        });
        if (data?.status === true || (data && !authCode(data) && !data.message)) {
            return { success: true, message: '验证邮件已发送，请查收并确认新邮箱' };
        }
        return { success: false, error: zhError(data, '修改邮箱失败') };
    } catch (e) {
        return { success: false, error: e.message || '修改邮箱失败' };
    }
}

// 列出已链接的 OAuth 账号
export async function listLinkedAccounts() {
    try {
        const data = await request('/list-accounts');
        return { success: true, accounts: Array.isArray(data) ? data : (data?.accounts || []) };
    } catch (e) {
        return { success: false, accounts: [], error: e.message || '加载失败' };
    }
}

// OAuth 登录（返回跳转 URL 或直接完成登录）
export async function signInWithSocial(provider, callbackURL) {
    try {
        const target = callbackURL || `${window.location.origin}${window.location.pathname}${window.location.hash || '#/account'}`;
        const data = await request('/sign-in/social', {
            method: 'POST',
            body: JSON.stringify({ provider, callbackURL: target, disableRedirect: true }),
        });
        if (data?.url) return { success: true, redirectUrl: data.url };
        if (data?.user) {
            return completeAuthenticatedSession(data.user);
        }
        return { success: false, error: zhError(data, 'OAuth 登录失败') };
    } catch (e) {
        return { success: false, error: e.message || 'OAuth 登录失败' };
    }
}

// 获取已配置的 OAuth 提供商
export async function fetchSocialProviders() {
    try {
        const res = await fetch(`${AUTH_BASE}/social-providers`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        return Array.isArray(data?.providers) ? data.providers : [];
    } catch {
        return [];
    }
}

// —— 双因素认证（Better Auth twoFactor 插件）——

export async function enableTwoFactor(password) {
    try {
        const data = await request('/two-factor/enable', {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
        if (data?.totpURI) {
            return { success: true, totpURI: data.totpURI, backupCodes: data.backupCodes || [] };
        }
        return { success: false, error: zhError(data, '开启失败') };
    } catch (e) {
        return { success: false, error: e.message || '开启失败' };
    }
}

export async function verifyTwoFactorTotp(code, trustDevice = true) {
    try {
        const data = await request('/two-factor/verify-totp', {
            method: 'POST',
            body: JSON.stringify({ code, trustDevice }),
        });
        if (data?.user) {
            return completeAuthenticatedSession(data.user);
        }
        if (data?.status === true || (data && !authCode(data) && !data.message)) {
            if (user.value) return completeAuthenticatedSession(user.value);
            return { success: false, error: zhError(data, '验证码错误') };
        }
    } catch (e) {
        return { success: false, error: e.message || '验证失败' };
    }
}

export async function verifyTwoFactorBackupCode(code, trustDevice = true) {
    try {
        const data = await request('/two-factor/verify-backup-code', {
            method: 'POST',
            body: JSON.stringify({ code, trustDevice }),
        });
        if (data?.user) {
            return completeAuthenticatedSession(data.user);
        }
        if (data?.status === true || (data && !authCode(data) && !data.message)) {
            if (user.value) return completeAuthenticatedSession(user.value);
            return { success: false, error: zhError(data, '备用码无效') };
        }
    } catch (e) {
        return { success: false, error: e.message || '验证失败' };
    }
}

export async function disableTwoFactor(password) {
    try {
        const data = await request('/two-factor/disable', {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
        if (data?.status === true || (data && !authCode(data) && !data.message)) {
            if (user.value) user.value = { ...user.value, twoFactorEnabled: false };
            return { success: true };
        }
        return { success: false, error: zhError(data, '关闭失败') };
    } catch (e) {
        return { success: false, error: e.message || '关闭失败' };
    }
}

export async function regenerateBackupCodes(password) {
    try {
        const data = await request('/two-factor/generate-backup-codes', {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
        if (Array.isArray(data?.backupCodes)) {
            return { success: true, backupCodes: data.backupCodes };
        }
        return { success: false, error: zhError(data, '生成失败') };
    } catch (e) {
        return { success: false, error: e.message || '生成失败' };
    }
}

async function fetchSessionState() {
    if (sessionStatePromise) return sessionStatePromise;
    sessionStatePromise = doFetchSessionState().finally(() => {
        sessionStatePromise = null;
    });
    return sessionStatePromise;
}

async function doFetchSessionState() {
    const res = await fetchBusiness('/me/sessions');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || '会话加载失败');
    return data || {};
}

// 请求封装
async function request(path, options = {}) {
    const { rawResponse = false, ...fetchOptions } = options;
    // 加超时，避免网络挂起导致按钮永久 loading
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
        res = await fetch(`${AUTH_BASE}${path}`, {
            credentials: 'include', // 携带 cookie
            headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
            signal: controller.signal,
            ...fetchOptions,
        });
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            if (!res.ok && res.status >= 500) {
                throw new Error(`HTTP ${res.status}`);
            }
        }
    }
    if (rawResponse) return { res, data };
    // 4xx 业务错误（含 400/401/422）返回 body，交由上层映射中文 code；
    // 仅 5xx 等服务端异常才抛错，避免把「邮箱已注册」这类业务校验当成崩溃。
    if (!res.ok && res.status >= 500) {
        throw new Error(data?.message || `HTTP ${res.status}`);
    }
    return data;
}

function businessUrls(path) {
    return [`${API_V1_BASE}${path}`];
}

async function fetchBusiness(path, options = {}) {
    const urls = businessUrls(path);
    let firstResponse = null;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
    for (const url of urls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
        let res;
        try {
            res = await fetch(url, {
                credentials: 'include',
                signal: controller.signal,
                ...fetchOptions,
            });
        } finally {
            clearTimeout(timer);
        }
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) return res;
    }
    return firstResponse;
}

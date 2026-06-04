// 用户认证服务 - Better Auth

import { signal } from '../core/signal.js';
import { API_BASE } from './config.js';

const AUTH_BASE = `${API_BASE}/auth`;

// 当前用户状态
export const user = signal(null);      // { id, name, email } | null
export const loading = signal(true);   // 初始加载中

// 初始化：检查当前会话
export async function initAuth() {
    try {
        const session = await request('/get-session');
        user.value = session?.user || null;
    } catch {
        user.value = null;
    } finally {
        loading.value = false;
    }
}

// Better Auth 错误码 → 中文文案（基于真实返回的 code 字段）
const ERROR_MESSAGES = {
    INVALID_EMAIL_OR_PASSWORD: '邮箱或密码错误',
    USER_ALREADY_EXISTS: '该邮箱已被注册',
    EMAIL_ALREADY_EXISTS: '该邮箱已被注册',
    PASSWORD_TOO_SHORT: '密码至少 6 位',
    PASSWORD_TOO_LONG: '密码过长',
    VALIDATION_ERROR: '邮箱或密码格式不正确',
    INVALID_EMAIL: '邮箱格式不正确',
    INVALID_PASSWORD: '当前密码错误',
    USER_NOT_FOUND: '用户不存在',
    TOO_MANY_REQUESTS: '操作过于频繁，请稍后再试',
};

function zhError(data, fallback) {
    if (!data) return fallback;
    if (data.code && ERROR_MESSAGES[data.code]) return ERROR_MESSAGES[data.code];
    return data.message || fallback;
}

// 登录
export async function signIn(email, password) {
    try {
        const data = await request('/sign-in/email', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        if (data?.user) {
            user.value = data.user;
            return { success: true };
        }
        return { success: false, error: zhError(data, '登录失败') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '登录失败') };
    }
}

// 注册
export async function signUp(name, email, password) {
    try {
        const data = await request('/sign-up/email', {
            method: 'POST',
            body: JSON.stringify({ name, email, password }),
        });
        if (data?.user) {
            user.value = data.user;
            return { success: true };
        }
        return { success: false, error: zhError(data, '注册失败') };
    } catch (e) {
        return { success: false, error: e.name === 'AbortError' ? '网络超时，请重试' : (e.message || '注册失败') };
    }
}

// 退出
export async function signOut() {
    // 无论服务端请求成败，都清空本地登录态，避免网络异常导致「退不出去」
    try {
        await request('/sign-out', { method: 'POST' });
    } catch { /* 忽略：本地态仍会被清空 */ }
    user.value = null;
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
        if (data && !data.code && !data.message) return { success: true };
        return { success: false, error: zhError(data, '当前密码错误或修改失败') };
    } catch (e) {
        return { success: false, error: e.message || '修改失败，请稍后重试' };
    }
}

// 更新个人资料（昵称）—— 走业务接口 /me/profile
export async function updateProfile(name) {
    try {
        const res = await fetch(`${API_BASE}/me/profile`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            // 本地用户态同步昵称
            if (user.value) user.value = { ...user.value, name };
            return { success: true };
        }
        return { success: false, error: data?.message || '保存失败' };
    } catch (e) {
        return { success: false, error: e.message || '保存失败' };
    }
}

// 注销账号（软删除）—— 需密码二次确认，成功后清空本地登录态
export async function deleteAccount(password) {
    try {
        const res = await fetch(`${API_BASE}/me`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            user.value = null;
            return { success: true };
        }
        return { success: false, error: data?.message || '注销失败' };
    } catch (e) {
        return { success: false, error: e.message || '注销失败，请稍后重试' };
    }
}

// 列出当前用户的所有登录会话（multiSession 插件）
export async function listSessions() {
    try {
        const data = await request('/list-sessions');
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

// 获取当前会话的 token（用于在会话列表中标记「本设备」）
export async function getCurrentSessionToken() {
    try {
        const data = await request('/get-session');
        return data?.session?.token || null;
    } catch {
        return null;
    }
}

// 撤销指定会话（按 token）
export async function revokeSession(token) {
    try {
        await request('/revoke-session', { method: 'POST', body: JSON.stringify({ token }) });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message || '操作失败' };
    }
}

// 撤销除当前外的所有其他会话
export async function revokeOtherSessions() {
    try {
        await request('/revoke-other-sessions', { method: 'POST' });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message || '操作失败' };
    }
}

// 请求封装
async function request(path, options = {}) {
    // 加超时，避免网络挂起导致按钮永久 loading
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
        res = await fetch(`${AUTH_BASE}${path}`, {
            credentials: 'include', // 携带 cookie
            headers: { 'Content-Type': 'application/json', ...options.headers },
            signal: controller.signal,
            ...options,
        });
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    // 4xx 业务错误（含 400/401/422）返回 body，交由上层映射中文 code；
    // 仅 5xx 等服务端异常才抛错，避免把「邮箱已注册」这类业务校验当成崩溃。
    if (!res.ok && res.status >= 500) {
        throw new Error(data?.message || `HTTP ${res.status}`);
    }
    return data;
}

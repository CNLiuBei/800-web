// VIP 会员服务
// 对接后端真实接口（Cookie 鉴权，Better Auth）：
//   GET  /api/me                      → { role, vipExpiresAt }（用户与会员状态）
//   GET  /api/vip/plans               → [{ id, name, days, price, priceDisplay }]
//   POST /api/vip/create-order        → { orderNo, qrCode }（支付宝二维码）
//   GET  /api/vip/order-status?orderNo=→ { status, vipExpiresAt }

import { signal } from '../core/signal.js';
import { user } from './auth.js';
import { API_BASE } from './config.js';

const API = API_BASE;

// VIP 状态：{ isVip, expireAt: Date|null, role }
export const vipStatus = signal(null);

// 统一请求封装
//   needAuth=true：带 cookie（用户态接口，如 /me、下单、查单）
//   needAuth=false：不带 cookie（公开接口，如 /vip/plans）
//     —— 公开接口不带 credentials，避免后端 ACAO:* 与 credentials 冲突导致 CORS 失败
async function request(path, { needAuth = false, ...options } = {}) {
    const init = { ...options };
    if (needAuth) init.credentials = 'include';
    // 仅在有 body 时设 Content-Type，避免无谓的 CORS 预检
    if (options.body) init.headers = { 'Content-Type': 'application/json', ...options.headers };
    const res = await fetch(`${API}${path}`, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const err = new Error(data?.message || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

/**
 * 检查当前用户 VIP 状态（以 /api/me 为准）
 */
export async function checkVipStatus() {
    if (!user.value) { vipStatus.value = null; return; }
    try {
        const me = await request('/me', { needAuth: true });
        const expireAt = me.vipExpiresAt ? new Date(me.vipExpiresAt) : null;
        const isVip = me.role === 'admin' ||
            (me.role === 'vip' && expireAt && expireAt.getTime() > Date.now());
        vipStatus.value = { isVip, expireAt, role: me.role };
    } catch {
        vipStatus.value = null;
    }
}

/**
 * 获取 VIP 套餐列表
 * @returns {Promise<Array<{id,name,days,price,priceDisplay}>>}
 */
export async function getVipPlans() {
    try {
        const plans = await request('/vip/plans');
        return Array.isArray(plans) ? plans : [];
    } catch {
        return [];
    }
}

/**
 * 创建支付订单
 * @param {string} planId 套餐 id
 * @returns {Promise<{orderNo:string, qrCode:string}>}
 */
export async function createOrder(planId) {
    return request('/vip/create-order', {
        needAuth: true,
        method: 'POST',
        body: JSON.stringify({ planId }),
    });
}

/**
 * 查询订单状态（轮询用）
 * @param {string} orderNo 订单号
 * @returns {Promise<{status:string, vipExpiresAt:string|null, planName?:string}>}
 */
export async function getOrderStatus(orderNo) {
    return request(`/vip/order-status?orderNo=${encodeURIComponent(orderNo)}`, { needAuth: true });
}

// ===== 派生工具 =====

/** 当前用户是否有 VIP 权限 */
export function hasVipAccess() {
    return vipStatus.value?.isVip === true;
}

/** 内容是否需要 VIP（预留业务判断） */
export function requiresVip(meta) {
    return meta?.vipOnly === true;
}

/** VIP 到期剩余天数 */
export function daysUntilExpire() {
    const expireAt = vipStatus.value?.expireAt;
    if (!expireAt) return 0;
    const diff = expireAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
}

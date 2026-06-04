// VIP 套餐页 — 真实对接后端套餐与支付宝下单

import {
    vipStatus, checkVipStatus, daysUntilExpire, hasVipAccess,
    getVipPlans, createOrder, getOrderStatus,
} from '../services/vip.js';
import { user, loading, initAuth } from '../services/auth.js';
import { loadCSS } from '../core/html.js';

const FEATURES = [
    '全站内容无限观看',
    '1080P / 4K 高清画质',
    '无广告',
    '多设备同步',
];

export async function render(container) {
    loadCSS('styles/vip.css'); // 按需加载本页样式
    container.innerHTML = '<div class="page-loading">加载中...</div>';

    if (!user.value && loading.value) {
        initAuth().catch(() => {});
        await waitForAuthReady();
    }

    // 并行拉会员状态与套餐
    const [, plans] = await Promise.all([checkVipStatus(), getVipPlans()]);

    const isVip = hasVipAccess();
    const days = daysUntilExpire();

    const headerHtml = isVip
        ? `<div class="vip-badge active">VIP</div>
           <p class="vip-expire">到期时间：${vipStatus.value.expireAt?.toLocaleDateString('zh-CN')}（剩余 ${days} 天）</p>`
        : `<p class="vip-desc">开通 VIP 享受高清无广告观影体验</p>`;

    // 套餐卡片（中间一档标记推荐）
    const popularIdx = plans.length >= 2 ? 1 : -1;
    const plansHtml = plans.length === 0
        ? `<div class="page-empty">暂无可用套餐</div>`
        : plans.map((p, i) => `
            <div class="vip-plan ${i === popularIdx ? 'popular' : ''}">
                ${i === popularIdx ? '<div class="plan-tag">推荐</div>' : ''}
                <div class="plan-name">${p.name}</div>
                <div class="plan-price">${p.priceDisplay}<span>/${p.days}天</span></div>
                <ul class="plan-features">
                    ${FEATURES.map((f) => `<li>${f}</li>`).join('')}
                </ul>
                <button class="plan-btn" data-plan="${p.id}">${isVip ? '续费' : '开通'}</button>
            </div>
        `).join('');

    container.innerHTML = `
        <div class="vip-page">
            <div class="vip-header">
                <h1 class="vip-title">VIP 会员</h1>
                ${headerHtml}
            </div>
            <div class="vip-plans" id="vip-plans">${plansHtml}</div>
        </div>
    `;

    container.querySelectorAll('.plan-btn').forEach((btn) => {
        btn.addEventListener('click', () => onBuy(btn.dataset.plan, btn));
    });

    // 离开 VIP 页时关闭可能残留的支付弹窗并停止轮询，避免内存泄漏
    return () => { closePayModal(); };
}

function waitForAuthReady(timeoutMs = 8000) {
    if (!loading.value) return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; unsub?.(); clearTimeout(timer); resolve(); };
        const unsub = loading.subscribe?.(() => { if (!loading.value) finish(); });
        const timer = setTimeout(finish, timeoutMs);
    });
}

// 模块级：当前支付弹窗的清理函数（关闭弹窗 + 停止轮询）
let activePayCleanup = null;
function closePayModal() {
    if (activePayCleanup) { activePayCleanup(); activePayCleanup = null; }
}

/** 点击开通：未登录弹登录框，已登录走下单 */
async function onBuy(planId, btn) {
    if (!user.value) {
        const { default: AuthModal } = await import('../components/auth-modal.js');
        AuthModal.open('login');
        return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '生成订单中...';
    try {
        const { orderNo, qrCode } = await createOrder(planId);
        openPayModal(orderNo, qrCode);
    } catch (e) {
        alert(e.message || '创建订单失败，请重试');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/** 支付二维码弹窗 + 轮询查单 */
function openPayModal(orderNo, qrCode) {
    const modal = document.createElement('div');
    modal.className = 'pay-modal';
    // 用公共二维码渲染服务把支付宝 codeUrl 转成图片，避免引入二维码库
    const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrCode)}`;
    modal.innerHTML = `
        <div class="pay-card">
            <button class="pay-close" aria-label="关闭">&times;</button>
            <h3 class="pay-title">支付宝扫码支付</h3>
            <img class="pay-qr" src="${qrImg}" alt="支付二维码" width="220" height="220">
            <p class="pay-tip" id="pay-tip">请使用支付宝扫码完成支付</p>
        </div>
    `;
    document.body.appendChild(modal);

    let timer = null;
    const tip = modal.querySelector('#pay-tip');
    const cleanup = () => {
        if (timer) clearInterval(timer);
        modal.remove();
        if (activePayCleanup === cleanup) activePayCleanup = null;
    };
    // 注册到模块级，供路由离开时统一清理
    activePayCleanup = cleanup;

    modal.querySelector('.pay-close').addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });

    // 每 3 秒轮询订单状态，支付成功后刷新会员状态
    // 最多轮询 100 次（约 5 分钟）后停止，避免页面长期挂着持续触发后端查询支付宝
    let pollCount = 0
    const MAX_POLLS = 100
    timer = setInterval(async () => {
        if (++pollCount > MAX_POLLS) {
            clearInterval(timer);
            tip.textContent = '查询超时，若已支付请刷新页面查看会员状态';
            return;
        }
        try {
            const { status } = await getOrderStatus(orderNo);
            if (status === 'paid') {
                clearInterval(timer);
                tip.textContent = '支付成功！正在更新会员状态...';
                await checkVipStatus();
                setTimeout(async () => {
                    cleanup();
                    // SPA 内重新渲染 VIP 页，避免整页刷新丢失状态
                    const { reloadRoute } = await import('../core/router.js');
                    if (location.hash !== '#/vip') location.hash = '#/vip';
                    else reloadRoute();
                }, 1200);
            } else if (status === 'expired') {
                clearInterval(timer);
                tip.textContent = '订单已过期，请关闭后重试';
            }
        } catch {
            // 轮询出错忽略，下次继续
        }
    }, 3000);
}

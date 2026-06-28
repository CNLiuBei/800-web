// VIP 套餐页 — 真实对接后端套餐与支付宝下单

import {
    vipStatus, checkVipStatus, daysUntilExpire, hasVipAccess,
    getVipPlans, createOrder, getOrderStatus,
} from '../services/vip.js';
import { user, loading, initAuth, waitForAuthReady } from '../services/auth.js';
import { esc, loadCSS } from '../core/html.js';
import { QR_IMAGE_BASE } from '../services/config.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';
import { showSiteNotice } from '../services/site-notice.js';

const FEATURES = [
    '全站内容无限观看',
    '1080P / 4K 高清画质',
    '无广告',
    '多设备同步',
];
const INTENDED_PLAN_KEY = 'vip:intendedPlan';
const AUTO_CHECKOUT_PLAN_KEY = 'vip:autoCheckoutPlan';
const PENDING_ORDER_KEY = 'vip:pendingOrder';
const RETURN_INTENT_KEY = 'vip:returnIntent';
const DEFAULT_DECISION_SOURCE = 'vip_page';
const VIP_PLANS_HASH = '#/vip?section=plans';
const DECISION_SOURCE_LABELS = new Map([
    ['preview_end', '试看结束'],
    ['playback_end', '播放结束'],
    ['playback_return', '播放回流'],
    ['search_recovery', '搜索恢复'],
    ['home_growth', '首页成长'],
    ['resume_intent', '断点续播'],
    ['pending_order', '待支付订单'],
    ['vip_page', 'VIP 页面'],
]);

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
    const returnIntent = syncReturnIntentFromQuery();
    const intendedPlanId = readIntendedPlan();
    const intendedPlan = user.value ? plans.find((p) => p.id === intendedPlanId) : null;
    const pendingOrder = user.value ? readPendingOrder() : null;

    const headerHtml = isVip
        ? `<div class="vip-badge active">VIP</div>
           <p class="vip-expire">${esc(formatVipExpireSummary(days))}</p>`
        : `<p class="vip-desc">开通 VIP 享受高清无广告观影体验</p>`;
    const statusHtml = renderVipStatusPanel({ isVip, days, intendedPlan, pendingOrder, returnIntent });
    const conversionHtml = renderVipConversionPanel({ isVip, days, plans, returnIntent, pendingOrder });

    // 套餐卡片（中间一档标记推荐）
    const popularIdx = recommendPlanIndex(plans);
    const basePlan = plans.find((plan) => Number(plan.price) > 0 && Number(plan.days) > 0) || plans[0];
    const plansHtml = plans.length === 0
        ? `<div class="page-empty">暂无可用套餐</div>`
        : plans.map((p, i) => `
            <div class="vip-plan ${i === popularIdx ? 'popular' : ''} ${intendedPlanId === p.id ? 'selected' : ''}">
                ${intendedPlanId === p.id && user.value ? '<div class="plan-tag plan-tag-continue">继续</div>' : (i === popularIdx ? '<div class="plan-tag">推荐</div>' : '')}
                <div class="plan-name">${esc(p.name)}</div>
                <div class="plan-price">${esc(p.priceDisplay)}<span>/${esc(String(p.days))}天</span></div>
                ${renderPlanEconomics(p, basePlan, i === popularIdx)}
                <ul class="plan-features">
                    ${FEATURES.map((f) => `<li>${esc(f)}</li>`).join('')}
                </ul>
                <button class="plan-btn" data-plan="${esc(p.id)}">${planButtonText({ isVip, planId: p.id, intendedPlanId })}</button>
            </div>
        `).join('');

    container.innerHTML = `
        <div class="vip-page">
            <div class="vip-header">
                <h1 class="vip-title">VIP 会员</h1>
                ${headerHtml}
            </div>
            ${statusHtml}
            ${conversionHtml}
            <div class="vip-plan-feedback hidden" id="vip-plan-feedback" role="status" aria-live="polite"></div>
            <div class="vip-plans" id="vip-plans">${plansHtml}</div>
        </div>
    `;

    container.querySelector('#vip-login')?.addEventListener('click', () => openAuth('login'));
    container.querySelector('#vip-signup')?.addEventListener('click', () => openAuth('signup'));
    container.querySelector('#vip-resume-order')?.addEventListener('click', () => {
        reportVipDecisionClick('resume_order', { returnIntent, pendingOrder: readPendingOrder() });
        const order = readPendingOrder();
        if (order?.orderNo && order?.qrCode) openPayModal(order.orderNo, order.qrCode);
    });
    container.querySelector('#vip-refresh-order')?.addEventListener('click', (event) => {
        reportVipDecisionClick('refresh_order', { returnIntent, pendingOrder: readPendingOrder() });
        refreshPendingOrderStatus(event.currentTarget);
    });
    container.querySelector('#vip-dismiss-order')?.addEventListener('click', () => {
        reportVipDecisionClick('dismiss_order', { returnIntent, pendingOrder: readPendingOrder() });
        clearPendingOrder();
        render(container);
    });
    container.querySelectorAll('.plan-btn').forEach((btn) => {
        btn.addEventListener('click', () => onBuy(btn.dataset.plan, btn, returnIntent));
    });
    reportVipDecisionImpression({ isVip, returnIntent, pendingOrder, plans });
    continueAutoCheckoutAfterLogin(container, plans);
    scrollToPlansIfRequested(container);

    // 离开 VIP 页时关闭可能残留的支付弹窗并停止轮询，避免内存泄漏
    return () => { closePayModal(); };
}

function renderVipConversionPanel({ isVip, days, plans, returnIntent, pendingOrder }) {
    const bestPlan = recommendedPlan(plans);
    const basePlan = plans.find((plan) => Number(plan.price) > 0 && Number(plan.days) > 0) || plans[0];
    const value = vipValueMath(bestPlan, basePlan);
    const source = pendingOrder ? 'pending_order' : decisionSource(returnIntent);
    const title = conversionTitle({ source, title: returnIntent?.title, isVip, days });
    const subtitle = conversionSubtitle({ source, returnIntent, pendingOrder });
    const sourceLabel = DECISION_SOURCE_LABELS.get(source) || DECISION_SOURCE_LABELS.get(DEFAULT_DECISION_SOURCE);
    const cues = [
        conversionPrimaryCue({ source, returnIntent }),
        { value: value.dailyText, label: '推荐档日均' },
        { value: value.saveText, label: '长周期节省' },
        { value: isVip ? (days > 0 ? `${days}天` : '长期') : '多端', label: isVip ? '当前剩余' : '权益同步' },
    ];
    return `
        <section class="vip-conversion-card">
            <div class="vip-conversion-copy">
                <div class="vip-status-kicker">开通决策 · ${esc(sourceLabel)}</div>
                <h2>${esc(title)}</h2>
                <p>${esc(subtitle)}</p>
                ${renderConversionReasons(source)}
            </div>
            <div class="vip-conversion-metrics">
                ${cues.map((cue) => `
                    <span>
                        <strong>${esc(cue.value)}</strong>
                        <small>${esc(cue.label)}</small>
                    </span>
                `).join('')}
            </div>
        </section>
    `;
}

function conversionTitle({ source, title, isVip, days }) {
    if (isVip) return days > 0 ? `VIP 剩余 ${Math.max(0, Number(days) || 0)} 天` : 'VIP 权益已生效';
    if (source === 'preview_end') return title ? `刚才已经看到关键处，开通后继续《${title}》` : '试看已结束，开通后继续观看';
    if (source === 'playback_end') return '看完一部后，继续解锁下一部';
    if (source === 'search_recovery') return '把想看的内容变成可继续观看';
    if (source === 'resume_intent') return title ? `恢复《${title}》的观看进度` : '恢复上次观看进度';
    if (source === 'pending_order') return '这笔订单只差最后一步';
    if (title) return `继续《${title}》之前，先确认权益`;
    return '把选择成本降到最低';
}

function conversionSubtitle({ source, returnIntent, pendingOrder }) {
    if (source === 'pending_order' || pendingOrder) return '你已经做过一次选择，继续完成比重新比较套餐更快。';
    if (source === 'preview_end') return '试看已经证明内容值得继续；支付完成会自动回到播放页，降低中断损耗。';
    if (source === 'playback_end') return '完播后的兴趣最强，会员权益能把一次观看延伸成连续追看。';
    if (source === 'search_recovery') return '搜索后的意图更明确，开通后可直接收藏、续播并同步到多端。';
    if (source === 'resume_intent') return '你不需要重新找内容；开通后直接接上进度继续看。';
    if (returnIntent) return '开通后自动回到播放页，减少中断带来的流失。';
    return '按日均成本、可用场景和回看价值判断套餐，更容易做决定。';
}

function conversionPrimaryCue({ source, returnIntent }) {
    if (source === 'preview_end') return { value: '续看', label: '不中断剧情' };
    if (source === 'playback_end') return { value: '下一部', label: '延长观看链路' };
    if (source === 'search_recovery') return { value: '找片', label: '减少搜索损耗' };
    if (source === 'resume_intent') return { value: '断点', label: '接上进度' };
    if (returnIntent) return { value: '续播', label: '回到刚才内容' };
    return { value: '秒开', label: '减少播放等待' };
}

function renderConversionReasons(source) {
    const reasons = {
        preview_end: ['已投入试看时间', '立刻回到当前内容', '避免重新找资源'],
        playback_end: ['完播兴趣更强', '相似内容连续看', '收藏历史自动同步'],
        search_recovery: ['搜索意图明确', '少比较多观看', '多端保留结果'],
        resume_intent: ['进度不丢失', '跨设备继续看', '减少启动阻力'],
        pending_order: ['订单已生成', '选择成本已发生', '完成后即时生效'],
        vip_page: ['日均成本透明', '多设备同步', '高清无广告'],
    };
    const items = reasons[source] || reasons.vip_page;
    return `<div class="vip-conversion-reasons">${items.map((item) => `<span>${esc(item)}</span>`).join('')}</div>`;
}

function recommendedPlan(plans) {
    const index = recommendPlanIndex(plans);
    return plans[index] || plans.find((plan) => Number(plan.price) > 0 && Number(plan.days) > 0) || plans[0] || null;
}

function vipValueMath(plan, basePlan) {
    const price = normalizedPlanPrice(plan);
    const days = Number(plan?.days) || 0;
    const basePrice = normalizedPlanPrice(basePlan);
    const baseDaily = basePrice > 0 && Number(basePlan?.days) > 0
        ? basePrice / Number(basePlan.days)
        : 0;
    const dailyText = price > 0 && days > 0 ? `¥${(price / days).toFixed(2)}` : '权益';
    const save = price > 0 && days > 0 && baseDaily > 0
        ? Math.max(0, Math.round((1 - (price / days) / baseDaily) * 100))
        : 0;
    return {
        dailyText,
        saveText: save >= 3 ? `${save}%` : '稳定',
    };
}

function reportVipDecisionImpression({ isVip, returnIntent, pendingOrder, plans }) {
    const plan = recommendedPlan(plans);
    reportEngagementEvent('decision_impression', {
        contentId: 'gy:vip-offer',
        source: pendingOrder ? 'pending_order' : decisionSource(returnIntent),
        actionState: isVip ? 'open' : 'on',
        value: Number(plan?.price) || 0,
        label: returnIntent?.title || plan?.name || 'vip offer',
    });
}

function reportVipDecisionClick(action, { planId = '', planName = '', returnIntent = null, pendingOrder = null } = {}) {
    reportEngagementEvent('decision_click', {
        contentId: 'gy:vip-offer',
        targetId: normalizeDecisionTarget(action, planId || pendingOrder?.planId || pendingOrder?.orderNo || ''),
        source: pendingOrder ? 'pending_order' : decisionSource(returnIntent),
        actionState: 'open',
        label: planName || pendingOrder?.planName || returnIntent?.title || action,
    });
}

function normalizeDecisionTarget(action, value) {
    const safeValue = String(value || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
    return safeValue ? `${action}:${safeValue}` : action;
}

// 模块级：当前支付弹窗的清理函数（关闭弹窗 + 停止轮询）
let activePayCleanup = null;
function closePayModal() {
    if (activePayCleanup) { activePayCleanup(); activePayCleanup = null; }
}

/** 点击开通：未登录弹登录框，已登录走下单 */
async function onBuy(planId, btn, returnIntent = readReturnIntent()) {
    const planName = btn?.closest('.vip-plan')?.querySelector('.plan-name')?.textContent?.trim() || '';
    reportVipDecisionClick(user.value ? 'select_plan' : 'login_for_plan', { planId, planName, returnIntent });
    clearVipPlanFeedback(btn);
    if (!user.value) {
        writeIntendedPlan(planId);
        writeAutoCheckoutPlan(planId);
        btn.textContent = '登录后继续';
        const modal = await openAuth('login');
        modal?.addEventListener('closed', (event) => {
            if (event.detail?.reason !== 'authenticated') clearAutoCheckoutPlan();
        }, { once: true });
        return;
    }
    if (readIntendedPlan() === planId) clearIntendedPlan();

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '生成订单中...';
    try {
        const { orderNo, qrCode } = await createOrder(planId);
        if (!orderNo || !qrCode) throw new Error('订单信息不完整，请稍后重试');
        const plan = findPlanById(planId);
        writePendingOrder({
            orderNo,
            qrCode,
            planId,
            planName: plan?.name || '',
            returnTo: readReturnIntent()?.returnTo || '',
            returnTitle: readReturnIntent()?.title || '',
            source: decisionSource(readReturnIntent()),
            createdAt: Date.now(),
        });
        reportVipDecisionClick('order_created', { planId, planName: plan?.name || planName, returnIntent: readReturnIntent() });
        openPayModal(orderNo, qrCode);
    } catch (e) {
        showVipPlanFeedback(btn, e.message || '创建订单失败，请重试', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

function clearVipPlanFeedback(btn) {
    const page = btn?.closest('.vip-page') || document.querySelector('.vip-page');
    const feedback = page?.querySelector('#vip-plan-feedback');
    if (!feedback) return;
    feedback.textContent = '';
    feedback.className = 'vip-plan-feedback hidden';
    page.querySelectorAll('.vip-plan.is-error').forEach((card) => card.classList.remove('is-error'));
}

function showVipPlanFeedback(btn, message, tone = 'error') {
    const page = btn?.closest('.vip-page') || document.querySelector('.vip-page');
    const card = btn?.closest('.vip-plan');
    if (tone === 'error') card?.classList.add('is-error');
    else page?.querySelectorAll('.vip-plan.is-error').forEach((item) => item.classList.remove('is-error'));
    showSiteNotice(message, {
        id: 'vip-notice',
        tone: tone === 'error' ? 'error' : 'info',
    });
}

function renderVipStatusPanel({ isVip, days, intendedPlan, pendingOrder, returnIntent }) {
    if (!user.value) {
        return `
            <section class="vip-status-card vip-status-login">
                <div>
                    <div class="vip-status-kicker">账号权益</div>
                    <h2 class="vip-status-title">登录后开通并同步会员权益</h2>
                    <p class="vip-status-desc">${returnIntent ? `登录开通后可继续播放《${esc(returnIntent.title || '当前内容')}》。` : '会员状态会同步到播放、收藏、历史、第三方客户端和多设备会话。'}</p>
                </div>
                <div class="vip-status-actions">
                    <button class="vip-status-btn" type="button" id="vip-login">登录</button>
                    <button class="vip-status-btn secondary" type="button" id="vip-signup">注册</button>
                </div>
            </section>
        `;
    }

    if (isVip) {
        const expireText = vipStatus.value?.expireAt ? vipStatus.value.expireAt.toLocaleDateString('zh-CN') : '长期有效';
        const urgent = days > 0 && days <= 7;
        return `
            <section class="vip-status-card ${urgent ? 'vip-status-urgent' : 'vip-status-active'}">
                <div>
                    <div class="vip-status-kicker">${urgent ? '即将到期' : '当前权益'}</div>
                    <h2 class="vip-status-title">${urgent ? `VIP 剩余 ${days} 天` : 'VIP 权益已生效'}</h2>
                    <p class="vip-status-desc">到期时间：${esc(expireText)}。续费会自动叠加到当前有效期后。</p>
                </div>
                <div class="vip-status-actions">
                    ${returnIntent ? `<a class="vip-status-link" href="${esc(returnIntent.returnTo)}">继续播放</a>` : ''}
                    <a class="vip-status-link" href="${VIP_PLANS_HASH}">${urgent ? '立即续费' : '续费加时'}</a>
                    <a class="vip-status-link secondary" href="#/account">查看记录</a>
                </div>
            </section>
        `;
    }

    if (pendingOrder) {
        const created = pendingOrder.createdAt ? new Date(pendingOrder.createdAt) : null;
        const createdText = created && !isNaN(created.getTime())
            ? created.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : '刚刚';
        const planText = pendingOrder.planName ? `：${pendingOrder.planName}` : '';
        const remainingText = formatOrderRemaining(pendingOrder);
        const returnText = pendingOrder.returnTitle
            ? `支付后返回《${pendingOrder.returnTitle}》。`
            : (pendingOrder.returnTo ? '支付后会回到原播放页。' : '');
        return `
            <section class="vip-status-card vip-status-pending">
                <div>
                    <div class="vip-status-kicker">待支付订单</div>
                    <h2 class="vip-status-title">继续完成 VIP 开通${esc(planText)}</h2>
                    <p class="vip-status-desc">订单 ${esc(pendingOrder.orderNo)} 创建于 ${esc(createdText)}，${esc(remainingText)}。${esc(returnText)}支付完成后也可手动刷新确认。</p>
                </div>
                <div class="vip-status-actions vip-status-actions-wrap">
                    <button class="vip-status-btn" type="button" id="vip-resume-order">继续支付</button>
                    <button class="vip-status-btn secondary" type="button" id="vip-refresh-order">刷新状态</button>
                    <button class="vip-status-btn ghost" type="button" id="vip-dismiss-order">忽略</button>
                </div>
            </section>
        `;
    }

    if (vipStatus.value?.role === 'vip') {
        const expireText = vipStatus.value?.expireAt ? vipStatus.value.expireAt.toLocaleDateString('zh-CN') : '已过期';
        return `
            <section class="vip-status-card vip-status-expired">
                <div>
                    <div class="vip-status-kicker">会员已过期</div>
                    <h2 class="vip-status-title">续费后可恢复 VIP 权益</h2>
                    <p class="vip-status-desc">${returnIntent ? `重新开通后可继续播放《${esc(returnIntent.title || '当前内容')}》。` : `上次到期时间：${esc(expireText)}。重新开通后可继续观看 VIP 内容并同步多设备权益。`}</p>
                </div>
                <div class="vip-status-actions">
                    <a class="vip-status-link" href="${VIP_PLANS_HASH}">选择套餐</a>
                    <a class="vip-status-link secondary" href="#/account">查看账号</a>
                </div>
            </section>
        `;
    }

    if (intendedPlan) {
        return `
            <section class="vip-status-card vip-status-continue">
                <div>
                    <div class="vip-status-kicker">继续开通</div>
                    <h2 class="vip-status-title">已为你保留 ${esc(intendedPlan.name)}</h2>
                    <p class="vip-status-desc">确认套餐后生成支付订单；下方已标记上次选择的套餐。</p>
                </div>
            </section>
        `;
    }

    return `
        <section class="vip-status-card">
            <div>
                <div class="vip-status-kicker">${returnIntent ? '继续观看' : '当前账号'}</div>
                <h2 class="vip-status-title">${returnIntent ? `开通后继续播放《${esc(returnIntent.title || '当前内容')}》` : '尚未开通 VIP'}</h2>
                <p class="vip-status-desc">${returnIntent ? '选择套餐并完成支付后，会自动带你回到刚才的播放页。' : '选择套餐后可解锁高清画质、VIP 内容和多设备观看权益。'}</p>
            </div>
        </section>
    `;
}

function formatVipExpireSummary(days = daysUntilExpire()) {
    const expireAt = vipStatus.value?.expireAt;
    if (!expireAt) return '到期时间：长期有效';
    return `到期时间：${expireAt.toLocaleDateString('zh-CN')}（剩余 ${Math.max(0, Number(days) || 0)} 天）`;
}

function planButtonText({ isVip, planId, intendedPlanId }) {
    if (isVip) return '续费';
    if (!user.value) return '登录后开通';
    return planId === intendedPlanId ? '继续开通' : '开通';
}

function recommendPlanIndex(plans) {
    if (!Array.isArray(plans) || plans.length === 0) return -1;
    let bestIndex = plans.length >= 2 ? 1 : 0;
    let bestScore = -Infinity;
    plans.forEach((plan, index) => {
        const days = Number(plan.days) || 0;
        const price = Number(plan.price) || 0;
        if (days <= 0 || price <= 0) return;
        const dailyValue = days / price;
        const durationFit = 1 - Math.min(1, Math.abs(days - 90) / 180);
        const score = dailyValue * 100000 + durationFit * 2 + Math.min(days, 365) / 365;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    return bestIndex;
}

function renderPlanEconomics(plan, basePlan, recommended) {
    const price = normalizedPlanPrice(plan);
    const days = Number(plan.days) || 0;
    if (price <= 0 || days <= 0) return '';
    const daily = price / days;
    const basePrice = normalizedPlanPrice(basePlan);
    const baseDaily = basePrice > 0 && Number(basePlan?.days) > 0
        ? basePrice / Number(basePlan.days)
        : 0;
    const savePercent = baseDaily > 0 ? Math.max(0, Math.round((1 - (price / days) / baseDaily) * 100)) : 0;
    const parts = [
        `约 ¥${daily.toFixed(2)}/天`,
        savePercent >= 3 ? `比短周期省 ${savePercent}%` : '',
        recommended ? '适合稳定追剧' : '',
    ].filter(Boolean);
    if (!parts.length) return '';
    return `<div class="plan-economics">${parts.map((text) => `<span>${esc(text)}</span>`).join('')}</div>`;
}

function normalizedPlanPrice(plan) {
    const displayPrice = parsePriceDisplay(plan?.priceDisplay);
    if (displayPrice > 0) return displayPrice;
    const rawPrice = Number(plan?.price) || 0;
    return rawPrice >= 1000 ? rawPrice / 100 : rawPrice;
}

function parsePriceDisplay(value) {
    const match = String(value || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) || 0 : 0;
}

async function openAuth(mode) {
    const { openAuthModal } = await import('../services/auth-modal-loader.js');
    return openAuthModal(mode);
}

function readIntendedPlan() {
    try {
        return sessionStorage.getItem(INTENDED_PLAN_KEY) || '';
    } catch {
        return '';
    }
}

function writeIntendedPlan(planId) {
    try {
        sessionStorage.setItem(INTENDED_PLAN_KEY, planId);
    } catch {}
}

function clearIntendedPlan() {
    try {
        sessionStorage.removeItem(INTENDED_PLAN_KEY);
    } catch {}
}

function readAutoCheckoutPlan() {
    try {
        return sessionStorage.getItem(AUTO_CHECKOUT_PLAN_KEY) || '';
    } catch {
        return '';
    }
}

function writeAutoCheckoutPlan(planId) {
    try {
        sessionStorage.setItem(AUTO_CHECKOUT_PLAN_KEY, planId);
    } catch {}
}

function clearAutoCheckoutPlan() {
    try {
        sessionStorage.removeItem(AUTO_CHECKOUT_PLAN_KEY);
    } catch {}
}

function syncReturnIntentFromQuery() {
    const fromQuery = readReturnIntentFromHash();
    if (fromQuery) {
        writeReturnIntent(fromQuery);
        return fromQuery;
    }
    return readReturnIntent();
}

function readReturnIntentFromHash() {
    const query = String(location.hash || '').split('?')[1] || '';
    if (!query) return null;
    const params = new URLSearchParams(query);
    const returnTo = params.get('return') || '';
    if (!isSafeReturnHash(returnTo)) return null;
    return {
        returnTo,
        title: String(params.get('title') || '').slice(0, 80),
        source: sanitizeDecisionSource(params.get('source') || ''),
    };
}

function readReturnIntent() {
    try {
        const raw = sessionStorage.getItem(RETURN_INTENT_KEY);
        if (!raw) return null;
        const intent = JSON.parse(raw);
        if (!intent || !isSafeReturnHash(intent.returnTo)) return null;
        if (intent.createdAt && Date.now() - Number(intent.createdAt) > 60 * 60 * 1000) {
            clearReturnIntent();
            return null;
        }
        return {
            returnTo: intent.returnTo,
            title: String(intent.title || '').slice(0, 80),
            source: sanitizeDecisionSource(intent.source || ''),
        };
    } catch {
        return null;
    }
}

function writeReturnIntent(intent) {
    try {
        sessionStorage.setItem(RETURN_INTENT_KEY, JSON.stringify({
            returnTo: intent.returnTo,
            title: String(intent.title || '').slice(0, 80),
            source: decisionSource(intent),
            createdAt: Date.now(),
        }));
    } catch {}
}

function clearReturnIntent() {
    try {
        sessionStorage.removeItem(RETURN_INTENT_KEY);
    } catch {}
}

function isSafeReturnHash(value) {
    return /^#\/play\/[^?#]+/i.test(String(value || ''));
}

function currentUserId() {
    return user.value?.id || user.value?.userId || user.value?.email || '';
}

function readPendingOrder() {
    try {
        const raw = localStorage.getItem(PENDING_ORDER_KEY);
        if (!raw) return null;
        const order = JSON.parse(raw);
        if (!order || order.userId !== currentUserId() || !order.orderNo || !order.qrCode) return null;
        if (order.createdAt && Date.now() - Number(order.createdAt) > 30 * 60 * 1000) {
            clearPendingOrder();
            return null;
        }
        return order;
    } catch {
        return null;
    }
}

function writePendingOrder(order) {
    try {
        localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({
            userId: currentUserId(),
            orderNo: order.orderNo,
            qrCode: order.qrCode,
            planId: order.planId || '',
            planName: order.planName || '',
            returnTo: isSafeReturnHash(order.returnTo) ? order.returnTo : '',
            returnTitle: String(order.returnTitle || '').slice(0, 80),
            source: sanitizeDecisionSource(order.source || ''),
            createdAt: order.createdAt || Date.now(),
        }));
    } catch {}
}

function clearPendingOrder() {
    try {
        localStorage.removeItem(PENDING_ORDER_KEY);
    } catch {}
}

function decisionSource(intent) {
    return sanitizeDecisionSource(intent?.source || (intent ? 'playback_return' : DEFAULT_DECISION_SOURCE));
}

function sanitizeDecisionSource(value) {
    const source = String(value || '').trim();
    return DECISION_SOURCE_LABELS.has(source) ? source : DEFAULT_DECISION_SOURCE;
}

function pendingOrderRemainingMs(order) {
    const createdAt = Number(order?.createdAt || 0);
    if (!createdAt) return 0;
    return Math.max(0, 30 * 60 * 1000 - (Date.now() - createdAt));
}

function formatOrderRemaining(order) {
    const remaining = pendingOrderRemainingMs(order);
    if (remaining <= 0) return '订单即将过期';
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    if (minutes <= 0) return `剩余 ${seconds} 秒`;
    return `剩余 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

function findPlanById(planId) {
    const card = document.querySelector(`.plan-btn[data-plan="${cssEscape(planId)}"]`)?.closest('.vip-plan');
    const name = card?.querySelector('.plan-name')?.textContent?.trim();
    return name ? { id: planId, name } : null;
}

async function refreshPendingOrderStatus(btn) {
    const order = readPendingOrder();
    if (!order?.orderNo) return;
    const original = btn?.textContent || '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '查询中...';
    }
    try {
        const result = await getOrderStatus(order.orderNo);
        await handleOrderStatusResult(result, { paidDelay: 300 });
        if (result.status === 'pending' && btn) btn.textContent = '仍待支付';
    } catch {
        if (btn) btn.textContent = '查询失败';
    } finally {
        if (btn) {
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = original || '刷新状态';
            }, 1200);
        }
    }
}

function continueAutoCheckoutAfterLogin(container, plans) {
    if (!user.value || hasVipAccess()) {
        clearAutoCheckoutPlan();
        return;
    }
    const planId = readAutoCheckoutPlan();
    if (!planId || !plans.some((plan) => plan.id === planId)) return;
    clearAutoCheckoutPlan();
    setTimeout(() => {
        const btn = container.querySelector(`.plan-btn[data-plan="${cssEscape(planId)}"]`);
        if (!btn || btn.disabled) return;
        onBuy(planId, btn);
    }, 120);
}

async function handleOrderStatusResult({ status, vipExpiresAt } = {}, { paidDelay = 1200, onPaidText, onExpiredText } = {}) {
    if (status === 'paid') {
        const returnTo = readPendingOrder()?.returnTo || readReturnIntent()?.returnTo || '';
        clearPendingOrder();
        if (onPaidText) onPaidText(formatPaidTip(vipExpiresAt));
        await checkVipStatus();
        setTimeout(async () => {
            closePayModal();
            const { reloadRoute } = await import('../core/router.js');
            if (isSafeReturnHash(returnTo)) {
                clearReturnIntent();
                location.hash = returnTo;
            } else if (location.hash !== '#/vip') location.hash = '#/vip';
            else reloadRoute();
        }, paidDelay);
        return true;
    }
    if (status === 'expired') {
        clearPendingOrder();
        if (onExpiredText) onExpiredText('订单已过期，请关闭后重新选择套餐。');
        else {
            setTimeout(async () => {
                const { reloadRoute } = await import('../core/router.js');
                if (location.hash === '#/vip') reloadRoute();
            }, 300);
        }
        return true;
    }
    return false;
}

function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
}

function scrollToPlansIfRequested(container) {
    let query;
    try {
        query = new URLSearchParams(String(location.hash || '').split('?')[1] || '');
    } catch {
        return;
    }
    if (query.get('section') !== 'plans') return;
    requestAnimationFrame(() => {
        container.querySelector('#vip-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

/** 支付二维码弹窗 + 轮询查单 */
function openPayModal(orderNo, qrCode) {
    closePayModal();
    const order = readPendingOrder();
    const returnTitle = order?.returnTitle || readReturnIntent()?.title || '';
    const returnCopy = returnTitle
        ? `支付成功后将返回《${returnTitle}》继续播放。`
        : (order?.returnTo || readReturnIntent()?.returnTo ? '支付成功后将返回刚才的播放页。' : '支付成功后会自动更新会员状态。');
    const modal = document.createElement('div');
    modal.className = 'pay-modal';
    const qrImg = QR_IMAGE_BASE ? `${QR_IMAGE_BASE}${encodeURIComponent(qrCode)}` : '';
    const openHref = isLikelyUrl(qrCode) ? qrCode : '';
    modal.innerHTML = `
        <div class="pay-card">
            <button class="pay-close" type="button" aria-label="关闭">&times;</button>
            <h3 class="pay-title">支付宝扫码支付</h3>
            <p class="pay-order">订单号：${esc(orderNo)}</p>
            <div class="pay-context">
                <span>${esc(returnCopy)}</span>
                <strong id="pay-remaining">${esc(order ? formatOrderRemaining(order) : '请尽快支付')}</strong>
            </div>
            <div class="pay-qr-wrap" id="pay-qr-wrap">
                ${qrImg ? `<img class="pay-qr" id="pay-qr" src="${esc(qrImg)}" alt="支付二维码" width="220" height="220">` : ''}
                <div class="pay-qr-fallback ${qrImg ? 'hidden' : ''}" id="pay-qr-fallback">
                    <strong>${qrImg ? '二维码加载失败' : '使用支付链接完成付款'}</strong>
                    <span>${qrImg ? '可以复制支付链接后在浏览器或支付宝中打开。' : '当前环境未配置二维码渲染服务，复制或打开支付链接仍可完成支付。'}</span>
                </div>
            </div>
            <p class="pay-tip" id="pay-tip">请使用支付宝扫码完成支付，页面会自动确认订单。</p>
            <div class="pay-actions">
                <button class="pay-secondary" type="button" id="pay-copy">复制支付链接</button>
                ${openHref ? `<a class="pay-secondary pay-open" id="pay-open" href="${esc(openHref)}" target="_blank" rel="noopener">打开支付</a>` : ''}
                <button class="pay-secondary" type="button" id="pay-refresh">刷新状态</button>
            </div>
            <textarea class="pay-link hidden" id="pay-link" readonly>${esc(qrCode)}</textarea>
        </div>
    `;
    document.body.appendChild(modal);

    let timer = null;
    let countdownTimer = null;
    let checking = false;
    let lastStatus = 'pending';
    let pollErrors = 0;
    const tip = modal.querySelector('#pay-tip');
    const copyBtn = modal.querySelector('#pay-copy');
    const refreshBtn = modal.querySelector('#pay-refresh');
    const remainingEl = modal.querySelector('#pay-remaining');
    const qrEl = modal.querySelector('#pay-qr');
    const qrFallback = modal.querySelector('#pay-qr-fallback');
    const linkEl = modal.querySelector('#pay-link');
    const cleanup = () => {
        if (timer) clearInterval(timer);
        if (countdownTimer) clearInterval(countdownTimer);
        modal.remove();
        if (activePayCleanup === cleanup) activePayCleanup = null;
    };
    // 注册到模块级，供路由离开时统一清理
    activePayCleanup = cleanup;

    modal.querySelector('.pay-close').addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
    qrEl?.addEventListener('error', () => {
        qrEl.classList.add('hidden');
        qrFallback.classList.remove('hidden');
        tip.textContent = '二维码图片加载失败，复制支付链接后仍可继续支付。';
    });
    copyBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(qrCode);
        showSiteNotice(ok ? '支付链接已复制' : '复制失败，请手动复制', { tone: ok ? 'success' : 'error', id: 'vip-notice' });
        copyBtn.textContent = ok ? '已复制' : '复制失败';
        tip.textContent = ok ? '支付链接已复制，可粘贴到支付宝或浏览器打开。' : '当前浏览器不支持自动复制，请手动复制支付链接。';
        if (!ok) {
            linkEl.classList.remove('hidden');
            linkEl.focus();
            linkEl.select();
        }
        setTimeout(() => { copyBtn.textContent = '复制支付链接'; }, 1600);
    });
    refreshBtn.addEventListener('click', () => {
        checkOrderStatus({ manual: true });
    });

    // 每 3 秒轮询订单状态，支付成功后刷新会员状态
    // 最多轮询 100 次（约 5 分钟）后停止，避免页面长期挂着持续触发后端查询支付宝
    let pollCount = 0;
    const MAX_POLLS = 100;

    const updateRemaining = () => {
        const current = readPendingOrder();
        if (!remainingEl || !current?.orderNo || current.orderNo !== orderNo) return;
        const remaining = pendingOrderRemainingMs(current);
        remainingEl.textContent = formatOrderRemaining(current);
        if (remaining <= 0 && lastStatus === 'pending') {
            lastStatus = 'expired';
            clearPendingOrder();
            clearInterval(timer);
            clearInterval(countdownTimer);
            refreshBtn.disabled = true;
            tip.textContent = '订单已超过有效时间，请关闭后重新选择套餐。';
        }
    };
    updateRemaining();
    countdownTimer = setInterval(updateRemaining, 1000);

    async function checkOrderStatus({ manual = false } = {}) {
        if (checking || lastStatus !== 'pending') return;
        checking = true;
        if (manual) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '查询中...';
            tip.textContent = '正在查询订单状态...';
        }
        try {
            const result = await getOrderStatus(orderNo);
            const { status } = result;
            pollErrors = 0;
            lastStatus = status || 'pending';
            if (await handleOrderStatusResult(result, {
                onPaidText: (text) => { tip.textContent = text; },
                onExpiredText: (text) => {
                    tip.textContent = text;
                    refreshBtn.disabled = true;
                },
            })) {
                clearInterval(timer);
            } else if (manual) {
                tip.textContent = '订单仍在等待支付，完成支付后可再次刷新。';
            }
        } catch {
            pollErrors += 1;
            if (manual || pollErrors >= 2) {
                tip.textContent = '暂时无法确认订单状态，支付后请稍后刷新或到个人中心查看消费记录。';
            }
        } finally {
            checking = false;
            if (lastStatus === 'pending') {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '刷新状态';
            }
        }
    }

    timer = setInterval(async () => {
        if (++pollCount > MAX_POLLS) {
            clearInterval(timer);
            tip.textContent = '查询超时，若已支付请刷新页面查看会员状态';
            refreshBtn.disabled = false;
            return;
        }
        checkOrderStatus();
    }, 3000);
}

function isLikelyUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

function formatPaidTip(vipExpiresAt) {
    if (!vipExpiresAt) return '支付成功！正在更新会员状态...';
    const expire = new Date(vipExpiresAt);
    if (isNaN(expire.getTime())) return '支付成功！正在更新会员状态...';
    return `支付成功！VIP 有效期至 ${expire.toLocaleDateString('zh-CN')}。`;
}

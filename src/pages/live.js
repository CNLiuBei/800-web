import { esc, loadCSS } from '../core/html.js';
import { setPageMeta } from '../core/head.js';
import { pageHeaderHTML } from '../components/page-header.js';
import { listPublicCreatorLiveSessions } from '../services/api.js';

const LIVE_TABS = [
    ['', '全部直播'],
    ['live', '正在直播'],
    ['scheduled', '预约中'],
];

export async function render(container, params = {}) {
    await loadCSS('styles/layout.css');

    const status = readLiveStatus(params.query);
    setPageMeta({
        title: '直播 - 800影视',
        description: '发现正在直播和即将开始的创作者直播。',
        url: window.location.href,
    });

    container.innerHTML = `
        <section class="catalog-section live-page">
            ${pageHeaderHTML({
                eyebrow: 'Live',
                title: '创作者直播',
                description: '发现正在进行和即将开始的直播，关注创作者动态与社区互动。',
                actions: `
                    <a class="page-secondary-action" href="#/account">我要开播</a>
                    <button class="page-primary-action" id="live-refresh" type="button">刷新</button>
                `,
            })}
            <div class="ranking-tabs" role="tablist" aria-label="直播状态">
                ${LIVE_TABS.map(([value, label]) => `
                    <a class="ranking-tab ${value === status ? 'active' : ''}" href="#/live${value ? `?status=${value}` : ''}" role="tab" aria-selected="${value === status ? 'true' : 'false'}">${esc(label)}</a>
                `).join('')}
            </div>
            <div class="live-status" id="live-status"><div class="spinner-small"></div></div>
            <div class="live-grid" id="live-grid" aria-live="polite"></div>
        </section>
    `;

    container.querySelector('#live-refresh')?.addEventListener('click', () => render(container, params));
    await loadLiveItems(container, status);
}

async function loadLiveItems(container, status) {
    const statusEl = container.querySelector('#live-status');
    const grid = container.querySelector('#live-grid');
    try {
        const data = await listPublicCreatorLiveSessions({ status, limit: 36 });
        const items = data.items || [];
        statusEl.textContent = renderLiveSummary(items, status);
        grid.innerHTML = items.length ? items.map(renderLiveCard).join('') : renderLiveEmpty(status);
    } catch (error) {
        statusEl.innerHTML = `
            <div class="page-error">
                直播列表加载失败
                <button class="retry-btn" id="live-retry" type="button">重试</button>
            </div>
        `;
        grid.innerHTML = '';
        statusEl.querySelector('#live-retry')?.addEventListener('click', () => loadLiveItems(container, status));
    }
}

function renderLiveCard(item) {
    const isLive = item.status === 'live';
    const playbackUrl = safePlaybackHref(item.playback?.url);
    return `
        <article class="live-card ${isLive ? 'is-live' : 'is-scheduled'}">
            <div class="live-card-media" aria-hidden="true">
                <span>${isLive ? 'LIVE' : '预约'}</span>
            </div>
            <div class="live-card-body">
                <div class="live-card-kicker">
                    <span class="live-badge ${isLive ? 'live' : 'scheduled'}">${isLive ? '正在直播' : '预约中'}</span>
                    <span>${esc(formatLiveTime(item))}</span>
                </div>
                <h2>${esc(item.title || '未命名直播')}</h2>
                ${item.description ? `<p>${esc(item.description)}</p>` : '<p>创作者暂未填写直播简介。</p>'}
                <a class="live-channel-link" href="#/creator/${esc(item.channel?.handle || '')}">
                    @${esc(item.channel?.handle || 'creator')} · ${esc(item.channel?.displayName || '创作者频道')}
                </a>
            </div>
            <div class="live-card-actions">
                <a class="page-secondary-action" href="#/live/${esc(item.id)}">详情</a>
                ${playbackUrl
                    ? `<a class="page-primary-action" href="${esc(playbackUrl)}" target="_blank" rel="noopener noreferrer">进入直播</a>`
                    : '<span class="live-card-disabled">等待开播</span>'}
            </div>
        </article>
    `;
}

function renderLiveEmpty(status) {
    const title = status === 'live' ? '暂时没有正在直播' : status === 'scheduled' ? '暂时没有预约直播' : '暂时没有公开直播';
    return `
        <div class="page-empty live-empty">
            <strong>${esc(title)}</strong>
            <span>可以稍后刷新，或前往创作者中心创建新的直播排期。</span>
            <a class="page-secondary-action" href="#/account">创建直播排期</a>
        </div>
    `;
}

function renderLiveSummary(items, status) {
    if (status === 'live') return `正在直播 ${items.length} 场`;
    if (status === 'scheduled') return `预约直播 ${items.length} 场`;
    const liveCount = items.filter((item) => item.status === 'live').length;
    const scheduledCount = items.filter((item) => item.status === 'scheduled').length;
    return `正在直播 ${liveCount} 场 · 预约中 ${scheduledCount} 场`;
}

function readLiveStatus(query) {
    const status = query?.get?.('status') || '';
    return status === 'live' || status === 'scheduled' ? status : '';
}

function formatLiveTime(item) {
    if (item.status === 'live' && item.startedAt) return `开播 ${formatTime(item.startedAt)}`;
    if (item.scheduledStartAt) return `预约 ${formatTime(item.scheduledStartAt)}`;
    return '时间待定';
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间待定';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function safePlaybackHref(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.includes('\x00') || value.includes('uploads/') || value.includes('streamKey=')) return '';
    try {
        const url = new URL(value, location.origin);
        if (value.startsWith('/api/')) return url.href;
        if (url.protocol !== 'https:') return '';
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) return '';
        return url.href;
    } catch {
        return '';
    }
}

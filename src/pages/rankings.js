// 排行榜页

import { getRankings } from '../services/api.js';
import { esc, loadCSS } from '../core/html.js';

const TYPE_TABS = [
    ['', '全部'],
    ['movie', '电影'],
    ['tv', '剧集'],
    ['anime', '动漫'],
];

export async function render(container, params = {}) {
    await loadCSS('styles/layout.css');

    const type = readType(params.query);
    container.innerHTML = `
        <section class="catalog-section rankings-page">
            <div class="ranking-tabs" role="tablist" aria-label="排行榜类型">
                ${TYPE_TABS.map(([value, label]) => `
                    <a class="ranking-tab ${value === type ? 'active' : ''}" href="#/rankings${value ? `?type=${value}` : ''}" role="tab" aria-selected="${value === type ? 'true' : 'false'}">${label}</a>
                `).join('')}
            </div>
            <div class="ranking-status" id="ranking-status"><div class="spinner-small"></div></div>
            <div class="ranking-lists" id="ranking-lists"></div>
        </section>
    `;

    const status = container.querySelector('#ranking-status');
    const listsEl = container.querySelector('#ranking-lists');

    try {
        const data = await getRankings({ type: type || undefined, limit: 20 });
        status.remove();
        listsEl.innerHTML = (data.lists || []).map(renderList).join('');
    } catch {
        status.innerHTML = '<div class="page-error">排行榜加载失败 <button class="retry-btn" id="ranking-retry">重试</button></div>';
        status.querySelector('#ranking-retry')?.addEventListener('click', () => render(container, params));
    }
}

function readType(query) {
    const type = query?.get?.('type') || '';
    return ['movie', 'tv', 'anime'].includes(type) ? type : '';
}

function renderList(list) {
    const items = list.items || [];
    return `
        <section class="ranking-list">
            <div class="ranking-list-head">
                <div>
                    <h2>${esc(list.title || '')}</h2>
                    <p>${esc(list.subtitle || '')}</p>
                </div>
            </div>
            <div class="ranking-items">
                ${items.length ? items.map((item, index) => renderItem(item, index)).join('') : '<div class="page-empty">暂无榜单数据</div>'}
            </div>
        </section>
    `;
}

function renderItem(item, index) {
    const type = item.type === 'movie' ? 'movie' : 'series';
    const rankClass = index < 3 ? 'top' : '';
    const rankingReason = compactRankingReason(item.ranking?.reason, item.imdbRating);
    return `
        <a class="ranking-item" href="#/detail/${type}/${esc(item.id)}">
            <span class="ranking-number ${rankClass}">${index + 1}</span>
            ${item.poster
                ? `<img class="ranking-poster" src="${esc(item.poster)}" alt="" loading="lazy" decoding="async">`
                : '<span class="ranking-poster ranking-poster-empty" aria-hidden="true"></span>'}
            <span class="ranking-copy">
                <strong>${esc(item.name || '')}</strong>
                <span>${item.year ? esc(String(item.year)) : '年份未知'} · ${type === 'movie' ? '电影' : '剧集'}</span>
            </span>
            <span class="ranking-metrics">
                ${item.imdbRating ? `<span>评分 ${esc(String(item.imdbRating))}</span>` : ''}
                <span>${formatViews(item.viewCount)} 播放</span>
                ${rankingReason ? `<span>${esc(rankingReason)}</span>` : ''}
            </span>
        </a>
    `;
}

function compactRankingReason(reason, displayedRating) {
    if (!reason || !displayedRating) return reason || '';
    const rating = Number(displayedRating);
    if (!Number.isFinite(rating) || rating <= 0) return reason;
    return String(reason)
        .replace(new RegExp(`^评分\\s*${escapeRegExp(rating.toFixed(1))}\\s*[，,]\\s*`), '')
        .trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatViews(value) {
    const count = Number(value) || 0;
    if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
    return String(count);
}

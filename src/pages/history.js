// 历史记录页

import { history, clearHistory, removeHistory, restoreHistoryItem } from '../services/library.js';
import { historyPercent, playbackStatusKey, playbackStatusLabel } from '../services/playback-progress.js';
import { emptyState, showLibraryUndoToast } from './favorites.js';
import { esc, loadCSS, onLongPress } from '../core/html.js';
import { pageHeaderHTML } from '../components/page-header.js';
import '../components/poster-grid.js';

export async function render(container) {
    await loadCSS('styles/layout.css');
    const items = history.value;

    if (items.length === 0) {
        container.innerHTML = `
            ${pageHeaderHTML({
                eyebrow: '继续观看',
                title: '观看历史',
                description: '最近播放会自动保存，方便下次从进度处继续。',
                actions: '<a class="page-primary-action" href="#/">去观看</a>',
            })}
            ${emptyState(
                '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
                '还没有观看记录',
                '去首页开始观看'
            )}
        `;
        return;
    }

    container.innerHTML = `
        <section class="catalog-section">
            ${pageHeaderHTML({
                eyebrow: '继续观看',
                title: '观看历史',
                description: '按最近观看时间分组，筛出续播中或已看完内容，快速回到进度。',
                actions: `
                    <a class="page-primary-action" href="${esc(historyPlayHref(items[0]))}">继续最近</a>
                    <button class="page-secondary-action" id="clear-history" type="button">清空记录</button>
                `,
                meta: `<span class="list-count">${items.length}</span>`,
            })}
            ${historyToolbarHTML()}
            <div class="history-groups" id="history-groups"></div>
            <div class="catalog-status" id="history-status"></div>
        </section>
    `;

    bindHistoryTools(container, items);

    container.querySelector('#clear-history').addEventListener('click', () => {
        if (confirm('确定清空所有观看记录？')) {
            clearHistoryWithUndo(container);
        }
    });
}

function historyToolbarHTML() {
    return `
        <div class="catalog-toolbar library-toolbar history-toolbar" role="search">
            <label class="catalog-filter">
                <span>搜索</span>
                <span class="catalog-search-field">
                    <input id="history-filter" type="search" placeholder="片名、年份或剧集" autocomplete="off">
                    <button class="catalog-search-clear hidden" id="history-search-clear" type="button" aria-label="清除搜索词">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                    </button>
                </span>
            </label>
            <label class="catalog-select">
                <span>类型</span>
                <select id="history-type">
                    <option value="all">全部</option>
                    <option value="movie">电影</option>
                    <option value="series">剧集</option>
                </select>
            </label>
            <label class="catalog-select">
                <span>状态</span>
                <select id="history-status-filter">
                    <option value="all">全部状态</option>
                    <option value="watching">续播中</option>
                    <option value="completed">已看完</option>
                </select>
            </label>
            <label class="catalog-sort">
                <span>排序</span>
                <select id="history-sort">
                    <option value="recent">最近观看</option>
                    <option value="progress">进度最高</option>
                    <option value="title">片名 A-Z</option>
                </select>
            </label>
            <div class="catalog-summary" id="history-summary" role="status" aria-live="polite"></div>
        </div>
        <div class="catalog-active-filters hidden" id="history-active-filters" aria-label="当前筛选条件"></div>
    `;
}

function bindHistoryTools(container, items) {
    const filter = container.querySelector('#history-filter');
    const clearSearch = container.querySelector('#history-search-clear');
    const typeSelect = container.querySelector('#history-type');
    const statusSelect = container.querySelector('#history-status-filter');
    const sortSelect = container.querySelector('#history-sort');
    const summary = container.querySelector('#history-summary');
    const groupsEl = container.querySelector('#history-groups');
    const status = container.querySelector('#history-status');
    const activeFilters = container.querySelector('#history-active-filters');
    restoreHistoryFilters({ filter, typeSelect, statusSelect, sortSelect });
    const updateSearchClear = () => {
        clearSearch.classList.toggle('hidden', filter.value.trim().length === 0);
    };
    const apply = () => {
        const query = filter.value.trim().toLowerCase();
        updateSearchClear();
        const type = typeSelect.value;
        const statusFilter = statusSelect.value;
        const sort = sortSelect.value;
        syncHistoryFilterUrl({ filter, typeSelect, statusSelect, sortSelect });
        renderHistoryActiveFilters(activeFilters, { filter, typeSelect, statusSelect, sortSelect });
        let visible = items.filter((item) => {
            const itemType = item.type === 'movie' ? 'movie' : 'series';
            if (type !== 'all' && itemType !== type) return false;
            if (statusFilter !== 'all' && historyStatus(item) !== statusFilter) return false;
            if (!query) return true;
            return `${item.name || ''} ${item.year || ''} ${item.subtitle || ''} ${item.episodeLabel || ''} ${item.episodeTitle || ''}`.toLowerCase().includes(query);
        });
        visible = sortHistoryItems(visible, sort);
        summary.textContent = historySummaryText(items, visible);
        renderHistoryGroups(groupsEl, visible, sort);
        bindHistoryRemove(groupsEl, container);
        if (visible.length === 0) {
            status.innerHTML = `<div class="page-empty library-empty">没有匹配的观看记录 <button class="retry-btn" id="history-clear-filter" type="button">清除筛选</button></div>`;
            status.querySelector('#history-clear-filter')?.addEventListener('click', () => {
                filter.value = '';
                typeSelect.value = 'all';
                statusSelect.value = 'all';
                sortSelect.value = 'recent';
                apply();
                filter.focus();
            });
        } else {
            status.innerHTML = '';
        }
    };
    filter.addEventListener('input', apply);
    filter.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !filter.value.trim()) return;
        event.preventDefault();
        filter.value = '';
        apply();
    });
    clearSearch.addEventListener('click', () => {
        if (!filter.value.trim()) return;
        filter.value = '';
        apply();
        filter.focus();
    });
    typeSelect.addEventListener('change', apply);
    statusSelect.addEventListener('change', apply);
    sortSelect.addEventListener('change', apply);
    activeFilters?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-clear]');
        if (!chip) return;
        clearHistoryFilter(chip.dataset.clear, { filter, typeSelect, statusSelect, sortSelect });
        apply();
        focusHistoryFilter(chip.dataset.clear, { filter, typeSelect, statusSelect, sortSelect });
    });
    apply();
}

function renderHistoryGroups(container, items, sort) {
    if (!items.length) {
        container.innerHTML = '';
        return;
    }
    const groups = sort === 'recent'
        ? groupByWatchedAt(items)
        : [{ key: 'filtered', title: sort === 'progress' ? '按观看进度' : '按片名', items }];
    container.innerHTML = groups.map((group, index) => `
        <section class="history-group">
            <div class="history-group-head">
                <h2 class="history-group-title">${esc(group.title)}</h2>
                <span class="history-group-count">${group.items.length}</span>
            </div>
            <poster-grid id="history-grid-${index}"></poster-grid>
        </section>
    `).join('');
    groups.forEach((group, index) => {
        container.querySelector(`#history-grid-${index}`)?.render(group.items.map(enrichHistoryItem), 'movie', { removeLabel: '删除' });
    });
}

function bindHistoryRemove(root, pageContainer) {
    root.querySelectorAll('.poster-item').forEach((el) => {
        onLongPress(el, () => {
            if (confirm('删除这条记录？')) {
                removeHistoryWithUndo(el.dataset.playbackKey || el.dataset.id, pageContainer);
            }
        });
    });
    root.querySelectorAll('[data-action="remove"]').forEach((el) => {
        const remove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const item = el.closest('.poster-item');
            if (item && confirm('删除这条记录？')) {
                removeHistoryWithUndo(item.dataset.playbackKey || item.dataset.id, pageContainer);
            }
        };
        el.addEventListener('click', remove);
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') remove(event);
        });
    });
}

function removeHistoryWithUndo(id, pageContainer) {
    const removed = findHistoryItem(id);
    removeHistory(id);
    render(pageContainer);
    if (!removed) return;
    showLibraryUndoToast('已删除观看记录', () => {
        restoreHistoryItem(removed);
        render(pageContainer);
    });
}

function clearHistoryWithUndo(pageContainer) {
    const removedItems = [...history.value];
    if (!removedItems.length) return;
    clearHistory();
    render(pageContainer);
    showLibraryUndoToast(`已清空 ${removedItems.length} 条观看记录`, () => {
        [...removedItems].reverse().forEach((item) => restoreHistoryItem(item));
        render(pageContainer);
    });
}

function findHistoryItem(id) {
    return history.value.find((item) => item.playbackKey === id || item.id === id) || null;
}

function renderHistoryActiveFilters(container, controls) {
    if (!container) return;
    const chips = historyActiveFilterChips(controls);
    container.classList.toggle('hidden', chips.length === 0);
    if (chips.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <span class="catalog-active-label">当前条件</span>
        ${chips.map((chip) => `
            <button class="catalog-filter-chip" type="button" data-clear="${esc(chip.key)}">
                ${esc(chip.label)} <span aria-hidden="true">&times;</span>
            </button>
        `).join('')}
        <button class="catalog-filter-clear" type="button" data-clear="all">清除全部</button>
    `;
}

function historyActiveFilterChips({ filter, typeSelect, statusSelect, sortSelect }) {
    const chips = [];
    const query = filter.value.trim();
    if (query) chips.push({ key: 'q', label: `搜索：${query}` });
    if (typeSelect.value !== 'all') chips.push({ key: 'type', label: `类型：${selectText(typeSelect)}` });
    if (statusSelect.value !== 'all') chips.push({ key: 'status', label: `状态：${selectText(statusSelect)}` });
    if (sortSelect.value !== 'recent') chips.push({ key: 'sort', label: `排序：${selectText(sortSelect)}` });
    return chips;
}

function clearHistoryFilter(key, { filter, typeSelect, statusSelect, sortSelect }) {
    if (key === 'q' || key === 'all') filter.value = '';
    if (key === 'type' || key === 'all') typeSelect.value = 'all';
    if (key === 'status' || key === 'all') statusSelect.value = 'all';
    if (key === 'sort' || key === 'all') sortSelect.value = 'recent';
}

function focusHistoryFilter(key, { filter, typeSelect, statusSelect, sortSelect }) {
    const target = {
        q: filter,
        type: typeSelect,
        status: statusSelect,
        sort: sortSelect,
        all: filter,
    }[key] || filter;
    target?.focus?.();
}

function restoreHistoryFilters({ filter, typeSelect, statusSelect, sortSelect }) {
    const params = currentHashParams();
    filter.value = params.get('q') || '';
    setSelectValue(typeSelect, params.get('type') || 'all', 'all');
    setSelectValue(statusSelect, params.get('status') || 'all', 'all');
    setSelectValue(sortSelect, params.get('sort') || 'recent', 'recent');
}

function syncHistoryFilterUrl({ filter, typeSelect, statusSelect, sortSelect }) {
    const params = new URLSearchParams();
    const query = filter.value.trim();
    if (query) params.set('q', query);
    if (typeSelect.value !== 'all') params.set('type', typeSelect.value);
    if (statusSelect.value !== 'all') params.set('status', statusSelect.value);
    if (sortSelect.value !== 'recent') params.set('sort', sortSelect.value);
    const route = currentHashRoute();
    const nextHash = `#${route}${params.toString() ? `?${params}` : ''}`;
    if (location.hash !== nextHash) {
        window.history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
    }
}

function currentHashRoute() {
    const raw = String(location.hash || '#/');
    return (raw.slice(1).split('?')[0] || '/');
}

function currentHashParams() {
    const query = String(location.hash || '').split('?')[1] || '';
    return new URLSearchParams(query);
}

function setSelectValue(select, value, fallback) {
    const allowed = new Set([...select.options].map((option) => option.value));
    select.value = allowed.has(value) ? value : fallback;
}

function selectText(select) {
    return select.selectedOptions?.[0]?.textContent?.trim() || select.value;
}

function historyPlayHref(item) {
    if (!item?.id) return '#/';
    const type = item.type === 'movie' ? 'movie' : 'series';
    if (item.videoId) return `#/play/${type}/${item.id}/${item.videoId}`;
    const hasProgress = Number(item.progress || 0) > 0 || Number(item.percent || 0) > 0;
    if (type === 'movie' && hasProgress) return `#/play/${type}/${item.id}`;
    return `#/detail/${type}/${item.id}`;
}

function sortHistoryItems(items, sort) {
    const list = [...items];
    if (sort === 'progress') {
        return list.sort((a, b) => progressPercent(b) - progressPercent(a));
    }
    if (sort === 'title') {
        return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
    }
    return list.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
}

function progressPercent(item) {
    return historyPercent(item) / 100;
}

function historyStatus(item) {
    return playbackStatusKey(item);
}

function historySummaryText(allItems, visibleItems) {
    const watching = allItems.filter((item) => historyStatus(item) === 'watching').length;
    const completed = allItems.length - watching;
    const base = visibleItems.length === allItems.length ? `${allItems.length} 条` : `显示 ${visibleItems.length} / ${allItems.length}`;
    const parts = [];
    if (watching) parts.push(`${watching} 个续播中`);
    if (completed) parts.push(`${completed} 个已看完`);
    return parts.length ? `${base} · ${parts.join(' · ')}` : base;
}

function enrichHistoryItem(item) {
    const subtitle = historySubtitle(item);
    return {
        ...item,
        subtitle: subtitle || item.subtitle || item.episodeLabel || item.episodeTitle || item.year || '',
    };
}

function historySubtitle(item) {
    const parts = [
        item.episodeLabel || item.episodeTitle || item.year || '',
        progressSummary(item),
        watchedAtText(item.watchedAt),
    ].filter(Boolean);
    return parts.join(' · ');
}

function progressSummary(item) {
    const progress = Number(item.progress || 0);
    const duration = Number(item.duration || 0);
    const status = playbackStatusLabel(item);
    if (playbackStatusKey(item) === 'completed') return status;
    if (progress > 0 && duration > progress) return `剩余约 ${formatDuration(duration - progress)}`;
    return status;
}

function watchedAtText(value) {
    const time = Number(value || 0);
    if (!Number.isFinite(time) || time <= 0) return '';
    const diff = Date.now() - time;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚看过';
    if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.max(1, Math.round((total % 3600) / 60));
    if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`;
    if (hours > 0) return `${hours} 小时`;
    return `${minutes} 分钟`;
}

function groupByWatchedAt(items) {
    const buckets = [
        { key: 'today', title: '今天', items: [] },
        { key: 'yesterday', title: '昨天', items: [] },
        { key: 'week', title: '最近 7 天', items: [] },
        { key: 'older', title: '更早', items: [] },
    ];
    items.forEach((item) => {
        const age = ageInDays(item.watchedAt);
        if (age <= 0) buckets[0].items.push(item);
        else if (age === 1) buckets[1].items.push(item);
        else if (age <= 7) buckets[2].items.push(item);
        else buckets[3].items.push(item);
    });
    return buckets.filter((bucket) => bucket.items.length > 0);
}

function ageInDays(value) {
    const time = Number(value || 0);
    if (!Number.isFinite(time) || time <= 0) return 9999;
    const day = 24 * 60 * 60 * 1000;
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const startItem = new Date(time);
    startItem.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((startToday.getTime() - startItem.getTime()) / day));
}

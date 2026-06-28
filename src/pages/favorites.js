// 收藏页

import { favorites, getResumeProgress, removeFavorite, restoreFavorite } from '../services/library.js';
import { isCompletedHistoryItem, isResumableHistoryItem, playbackStatusKey } from '../services/playback-progress.js';
import { esc, loadCSS, onLongPress } from '../core/html.js';
import { showSiteNotice } from '../services/site-notice.js';
import '../components/poster-grid.js';

export async function render(container) {
    await loadCSS('styles/layout.css');
    const items = favorites.value;

    if (items.length === 0) {
        container.innerHTML = `
            ${emptyState(
                '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
                '还没有收藏内容',
                '去首页发现喜欢的影片'
            )}
        `;
        return;
    }

    container.innerHTML = `
        <section class="catalog-section">
            ${libraryToolbarHTML('fav', { statusFilter: true })}
            <poster-grid id="fav-grid"></poster-grid>
            <div class="catalog-status" id="fav-status"></div>
        </section>
    `;

    const grid = container.querySelector('#fav-grid');
    bindLibraryTools(container, items, grid, 'fav', {
        emptyText: '没有匹配的收藏内容',
        removeConfirm: '从收藏中移除？',
        removeLabel: '移除',
        onRemove: (id) => { removeFavorite(id); },
        onUndo: (item) => { restoreFavorite(item); },
        undoText: '已从收藏移除',
        rerender: () => render(container),
    });
}

// 长按（移动端）/ 右键（桌面）删除单项
function enableRemove(grid, onRemove, confirmText = '移除这项？') {
    grid.querySelectorAll('.poster-item').forEach((el) => {
        onLongPress(el, () => {
            if (confirm(confirmText)) {
                onRemove(el.dataset.id);
            }
        });
    });
    grid.querySelectorAll('[data-action="remove"]').forEach((el) => {
        const remove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const item = el.closest('.poster-item');
            if (item && confirm(confirmText)) {
                onRemove(item.dataset.playbackKey || item.dataset.id);
            }
        };
        el.addEventListener('click', remove);
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') remove(event);
        });
    });
}

// 空状态：图标 + 文案 + 引导按钮
export function emptyState(iconSvg, title, hint) {
    return `
        <div class="empty-state">
            <div class="empty-icon">${iconSvg}</div>
            <div class="empty-title">${title}</div>
            <a href="#/" class="empty-cta">${hint}</a>
        </div>
    `;
}

export function libraryToolbarHTML(prefix, options = {}) {
    return `
        <div class="catalog-toolbar library-toolbar ${options.statusFilter ? 'library-toolbar-with-status' : ''}" role="search">
            <label class="catalog-filter">
                <span>搜索</span>
                <span class="catalog-search-field">
                    <input id="${prefix}-filter" type="search" placeholder="片名、年份或剧集" autocomplete="off">
                    <button class="catalog-search-clear hidden" id="${prefix}-search-clear" type="button" aria-label="清除搜索词">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                    </button>
                </span>
            </label>
            <label class="catalog-select">
                <span>类型</span>
                <select id="${prefix}-type">
                    <option value="all">全部</option>
                    <option value="movie">电影</option>
                    <option value="series">剧集</option>
                </select>
            </label>
            ${options.statusFilter ? `
                <label class="catalog-select">
                    <span>状态</span>
                    <select id="${prefix}-status-filter">
                        <option value="all">全部状态</option>
                        <option value="unwatched">未开始</option>
                        <option value="watching">续播中</option>
                        <option value="completed">已看完</option>
                    </select>
                </label>
            ` : ''}
            <label class="catalog-sort">
                <span>排序</span>
                <select id="${prefix}-sort">
                    <option value="recent">最近加入</option>
                    <option value="title">片名 A-Z</option>
                    <option value="year">年份最新</option>
                </select>
            </label>
            <div class="catalog-summary" id="${prefix}-summary" role="status" aria-live="polite"></div>
        </div>
        <div class="catalog-active-filters hidden" id="${prefix}-active-filters" aria-label="当前筛选条件"></div>
    `;
}

export function bindLibraryTools(container, items, grid, prefix, options = {}) {
    const filter = container.querySelector(`#${prefix}-filter`);
    const clearSearch = container.querySelector(`#${prefix}-search-clear`);
    const typeSelect = container.querySelector(`#${prefix}-type`);
    const statusSelect = container.querySelector(`#${prefix}-status-filter`);
    const sortSelect = container.querySelector(`#${prefix}-sort`);
    const summary = container.querySelector(`#${prefix}-summary`);
    const status = container.querySelector(`#${prefix}-status`);
    const activeFilters = container.querySelector(`#${prefix}-active-filters`);
    restoreLibraryFilters({ filter, typeSelect, statusSelect, sortSelect });
    const updateSearchClear = () => {
        clearSearch?.classList.toggle('hidden', filter.value.trim().length === 0);
    };
    const apply = () => {
        const query = filter.value.trim().toLowerCase();
        updateSearchClear();
        const type = typeSelect.value;
        const playbackState = statusSelect?.value || 'all';
        const sort = sortSelect.value;
        syncLibraryFilterUrl({ filter, typeSelect, statusSelect, sortSelect });
        renderLibraryActiveFilters(activeFilters, { filter, typeSelect, statusSelect, sortSelect });
        let visible = items.filter((item) => {
            const itemType = item.type === 'movie' ? 'movie' : 'series';
            if (type !== 'all' && itemType !== type) return false;
            if (statusSelect && playbackState !== 'all' && libraryPlaybackState(item) !== playbackState) return false;
            if (!query) return true;
            return `${item.name || ''} ${item.year || ''} ${item.subtitle || ''} ${item.episodeLabel || ''}`.toLowerCase().includes(query);
        });
        visible = sortLibraryItems(visible, sort);
        const renderItems = options.enrichItem ? visible.map((item) => options.enrichItem(item)) : visible;
        grid.render(renderItems, 'movie', { removeLabel: options.removeLabel });
        enableRemove(grid, (id) => {
            const removed = findLibraryItem(items, id);
            options.onRemove?.(id);
            options.rerender?.();
            if (removed && options.onUndo) {
                showLibraryUndoToast(options.undoText || '已移除', () => {
                    options.onUndo?.(removed);
                    options.rerender?.();
                });
            }
        }, options.removeConfirm);
        summary.textContent = librarySummaryText(items, visible, { showPlaybackState: Boolean(statusSelect) });
        if (visible.length === 0) {
            status.innerHTML = `<div class="page-empty library-empty">${esc(options.emptyText || '没有匹配内容')} <button class="retry-btn" id="${prefix}-clear" type="button">清除筛选</button></div>`;
            status.querySelector(`#${prefix}-clear`)?.addEventListener('click', () => {
                filter.value = '';
                typeSelect.value = 'all';
                if (statusSelect) statusSelect.value = 'all';
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
    clearSearch?.addEventListener('click', () => {
        if (!filter.value.trim()) return;
        filter.value = '';
        apply();
        filter.focus();
    });
    typeSelect.addEventListener('change', apply);
    statusSelect?.addEventListener('change', apply);
    sortSelect.addEventListener('change', apply);
    activeFilters?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-clear]');
        if (!chip) return;
        clearLibraryFilter(chip.dataset.clear, { filter, typeSelect, statusSelect, sortSelect });
        apply();
        focusLibraryFilter(chip.dataset.clear, { filter, typeSelect, statusSelect, sortSelect });
    });
    apply();
}

function librarySummaryText(allItems, visibleItems, options = {}) {
    const base = visibleItems.length === allItems.length ? `${allItems.length} 条` : `显示 ${visibleItems.length} / ${allItems.length}`;
    if (!options.showPlaybackState) return base;
    const counts = allItems.reduce((acc, item) => {
        acc[libraryPlaybackState(item)] += 1;
        return acc;
    }, { unwatched: 0, watching: 0, completed: 0 });
    const parts = [
        counts.unwatched ? `${counts.unwatched} 个未开始` : '',
        counts.watching ? `${counts.watching} 个续播中` : '',
        counts.completed ? `${counts.completed} 个已看完` : '',
    ].filter(Boolean);
    return parts.length ? `${base} · ${parts.join(' · ')}` : base;
}

function libraryPlaybackState(item) {
    if (isCompletedHistoryItem(item)) return 'completed';
    if (isResumableHistoryItem(item)) return 'watching';
    const resume = getResumeProgress({
        id: item.id,
        videoId: item.videoId,
        movieId: item.movieId,
        episodeId: item.episodeId,
    });
    if (!resume) return 'unwatched';
    return playbackStatusKey({ ...item, progress: resume.progress, duration: resume.duration, percent: resume.percent });
}

function findLibraryItem(items, id) {
    return items.find((item) => item.id === id || item.playbackKey === id) || null;
}

function renderLibraryActiveFilters(container, controls) {
    if (!container) return;
    const chips = libraryActiveFilterChips(controls);
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

function libraryActiveFilterChips({ filter, typeSelect, statusSelect, sortSelect }) {
    const chips = [];
    const query = filter.value.trim();
    if (query) chips.push({ key: 'q', label: `搜索：${query}` });
    if (typeSelect.value !== 'all') chips.push({ key: 'type', label: `类型：${selectText(typeSelect)}` });
    if (statusSelect && statusSelect.value !== 'all') chips.push({ key: 'status', label: `状态：${selectText(statusSelect)}` });
    if (sortSelect.value !== 'recent') chips.push({ key: 'sort', label: `排序：${selectText(sortSelect)}` });
    return chips;
}

function clearLibraryFilter(key, { filter, typeSelect, statusSelect, sortSelect }) {
    if (key === 'q' || key === 'all') filter.value = '';
    if (key === 'type' || key === 'all') typeSelect.value = 'all';
    if (statusSelect && (key === 'status' || key === 'all')) statusSelect.value = 'all';
    if (key === 'sort' || key === 'all') sortSelect.value = 'recent';
}

function focusLibraryFilter(key, { filter, typeSelect, statusSelect, sortSelect }) {
    const target = {
        q: filter,
        type: typeSelect,
        status: statusSelect,
        sort: sortSelect,
        all: filter,
    }[key] || filter;
    target?.focus?.();
}

function restoreLibraryFilters({ filter, typeSelect, statusSelect, sortSelect }) {
    const params = currentHashParams();
    const query = params.get('q') || '';
    const type = params.get('type') || 'all';
    const status = params.get('status') || 'all';
    const sort = params.get('sort') || 'recent';
    filter.value = query;
    setSelectValue(typeSelect, type, 'all');
    if (statusSelect) setSelectValue(statusSelect, status, 'all');
    setSelectValue(sortSelect, sort, 'recent');
}

function syncLibraryFilterUrl({ filter, typeSelect, statusSelect, sortSelect }) {
    const query = filter.value.trim();
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (typeSelect.value !== 'all') params.set('type', typeSelect.value);
    if (statusSelect && statusSelect.value !== 'all') params.set('status', statusSelect.value);
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
    if (!select) return;
    const allowed = new Set([...select.options].map((option) => option.value));
    select.value = allowed.has(value) ? value : fallback;
}

function selectText(select) {
    return select.selectedOptions?.[0]?.textContent?.trim() || select.value;
}

export function showLibraryUndoToast(message, onUndo) {
    showSiteNotice(message, {
        duration: 5000,
        action: {
            label: '撤销',
            onClick: () => onUndo?.(),
        },
    });
}

function sortLibraryItems(items, sort) {
    const list = [...items];
    if (sort === 'title') {
        return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
    }
    if (sort === 'year') {
        return list.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    }
    return list.sort((a, b) => Number(b.addedAt || b.watchedAt || 0) - Number(a.addedAt || a.watchedAt || 0));
}

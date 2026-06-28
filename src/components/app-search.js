import { t } from '../services/i18n.js';
import { esc, loadCSS } from '../core/html.js';

const SEARCH_HISTORY_KEY = 'gy_search_history';
const MAX_SEARCH_HISTORY = 8;
const SEARCH_GROUPS = [
    { key: 'movie', title: '电影', catalogType: 'movie', catalogId: 'guangying-movie', route: 'movie', itemType: 'movie' },
    { key: 'tv', title: '剧集', catalogType: 'series', catalogId: 'guangying-tv', route: 'tv', itemType: 'series' },
    { key: 'anime', title: '动漫', catalogType: 'series', catalogId: 'guangying-anime', route: 'anime', itemType: 'series' },
];
export async function openSearch(shell) {
    await loadCSS('styles/layout.css');
    const { overlay, input, results } = ensureSearchDom(shell);
    shell._searchPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    shell._searchScrollY = window.scrollY || 0;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('search-overlay-open');
    document.body.style.top = `-${shell._searchScrollY}px`;
    bindSearchViewport(shell, overlay);
    updateSearchViewport(shell, overlay);
    input.focus({ preventScroll: true });
    renderSearchHistory(shell, results, input, overlay);
}

function bindSearchViewport(shell, overlay) {
    if (shell._searchViewportBound) return;
    shell._searchViewportBound = true;
    const update = () => updateSearchViewport(shell, overlay);
    shell._searchViewportUpdate = update;
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
}

function updateSearchViewport(shell, overlay) {
    if (overlay.classList.contains('hidden')) return;
    const vv = window.visualViewport;
    if (!vv) {
        overlay.style.removeProperty('--search-keyboard-offset');
        return;
    }
    const offset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (offset > 0) overlay.style.setProperty('--search-keyboard-offset', `${offset}px`);
    else overlay.style.removeProperty('--search-keyboard-offset');
}

function releaseSearchOverlay(shell, overlay) {
    document.documentElement.classList.remove('search-overlay-open');
    document.body.style.top = '';
    overlay.style.removeProperty('--search-keyboard-offset');
    const scrollY = shell._searchScrollY || 0;
    shell._searchScrollY = 0;
    window.scrollTo(0, scrollY);
}

function ensureSearchDom(shell) {
    let overlay = shell.querySelector('#search-overlay');
    if (!overlay) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div id="search-overlay" class="search-overlay hidden" role="dialog" aria-modal="true" aria-label="搜索" aria-hidden="true">
                <div class="search-box">
                    <input id="search-input" type="search" enterkeyhint="search" inputmode="search" placeholder="${t('search.placeholder')}" autocomplete="off">
                    <button id="search-clear" class="search-clear hidden" type="button" aria-label="清除搜索词">&times;</button>
                    <button id="search-close" class="search-close">&times;</button>
                </div>
                <div id="search-results" class="search-results"></div>
            </div>
        `;
        overlay = wrap.firstElementChild;
        shell.insertBefore(overlay, shell.querySelector('#app'));
    }

    const input = shell.querySelector('#search-input');
    const results = shell.querySelector('#search-results');
    const close = shell.querySelector('#search-close');
    const clear = shell.querySelector('#search-clear');

    if (!shell._searchBound) {
        shell._searchSeq = 0;
        shell._searchActiveIndex = -1;
        shell._searchFilter = 'all';
        shell._searchLast = null;
        shell._searchKeyboardPick = false;
        shell._closeSearch = (options = {}) => {
            overlay.classList.add('hidden');
            overlay.setAttribute('aria-hidden', 'true');
            releaseSearchOverlay(shell, overlay);
            input.blur();
            input.value = '';
            clear?.classList.add('hidden');
            results.innerHTML = '';
            shell._searchActiveIndex = -1;
            shell._searchFilter = 'all';
            shell._searchLast = null;
            const restore = options.restoreFocus !== false ? shell._searchPreviousFocus : null;
            shell._searchPreviousFocus = null;
            if (restore instanceof HTMLElement && document.contains(restore)) {
                restore.focus({ preventScroll: true });
            }
        };
        close.addEventListener('click', shell._closeSearch);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) shell._closeSearch(); });
        document.addEventListener('pointerdown', (e) => {
            if (overlay.classList.contains('hidden')) return;
            if (window.matchMedia('(max-width: 640px)').matches) return;
            const target = e.target;
            if (target?.closest?.('.search-box, .search-results')) return;
            e.preventDefault();
            shell._closeSearch();
        }, true);
        overlay.addEventListener('keydown', (e) => {
            if (overlay.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (input.value.trim()) {
                    clearSearchInput(shell, results, input, clear);
                    return;
                }
                shell._closeSearch();
                return;
            }
            if (e.key === 'Tab') trapSearchFocus(e, overlay);
        }, true);

        let composing = false;
        let debounce;
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => {
            composing = false;
            input.dispatchEvent(new Event('input'));
        });
        input.addEventListener('input', () => {
            if (composing) return;
            clearTimeout(debounce);
            const q = input.value.trim();
            clear?.classList.toggle('hidden', !q);
            shell._searchActiveIndex = -1;
            shell._searchFilter = 'all';
            shell._searchLast = null;
            shell._searchKeyboardPick = false;
            if (q.length < 2) {
                renderSearchHistory(shell, results, input);
                if (q.length === 1) {
                    renderSearchPrompt(results, '继续输入至少 2 个字开始搜索');
                    clearActiveSearchItem(shell, results);
                }
                return;
            }
            debounce = setTimeout(() => doSearch(shell, q, results), 300);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (input.value.trim()) {
                    clearSearchInput(shell, results, input, clear);
                    return;
                }
                shell._closeSearch();
            }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const items = searchTargets(results);
                if (items.length === 0) return;
                e.preventDefault();
                shell._searchKeyboardPick = true;
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                const next = shell._searchActiveIndex < 0
                    ? (delta > 0 ? 0 : items.length - 1)
                    : (shell._searchActiveIndex + delta + items.length) % items.length;
                setActiveSearchItem(shell, results, next);
            }
            else if (e.key === 'Enter') {
                clearTimeout(debounce);
                const q = input.value.trim();
                if (q.length >= 2 && !shell._searchKeyboardPick) {
                    e.preventDefault();
                    e.stopPropagation();
                    const typeParam = shell._searchFilter && shell._searchFilter !== 'all'
                        ? `&type=${encodeURIComponent(shell._searchFilter)}`
                        : '';
                    location.hash = `#/search?q=${encodeURIComponent(q)}${typeParam}`;
                    shell._closeSearch?.();
                    shell._searchKeyboardPick = false;
                    return;
                }
                const active = searchTargets(results)[shell._searchActiveIndex];
                if (active) {
                    e.preventDefault();
                    e.stopPropagation();
                    active.click();
                    shell._searchKeyboardPick = false;
                    return;
                }
                if (q.length >= 2) {
                    const typeParam = shell._searchFilter && shell._searchFilter !== 'all'
                        ? `&type=${encodeURIComponent(shell._searchFilter)}`
                        : '';
                    location.hash = `#/search?q=${encodeURIComponent(q)}${typeParam}`;
                    shell._closeSearch?.();
                }
                shell._searchKeyboardPick = false;
            }
        });
        clear?.addEventListener('click', () => {
            clearSearchInput(shell, results, input, clear);
        });
        results.addEventListener('click', (e) => {
            const retry = e.target.closest('.search-retry');
            if (retry) {
                e.preventDefault();
                const q = input.value.trim();
                if (q.length >= 2) doSearch(shell, q, results);
                return;
            }
            const filter = e.target.closest('.search-filter');
            if (!filter || !shell._searchLast) return;
            e.preventDefault();
            e.stopPropagation();
            shell._searchActiveIndex = -1;
            shell._searchFilter = filter.dataset.filter || 'all';
            renderSearchResults(shell, results, shell._searchLast);
            input.focus({ preventScroll: true });
        });
        shell._searchBound = true;
    }

    return { overlay, input, results };
}

function trapSearchFocus(event, overlay) {
    const focusables = [...overlay.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
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
    } else if (!overlay.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        first.focus({ preventScroll: true });
    }
}

function clearSearchInput(shell, results, input, clear) {
    input.value = '';
    clear?.classList.add('hidden');
    shell._searchActiveIndex = -1;
    shell._searchFilter = 'all';
    shell._searchLast = null;
    renderSearchHistory(shell, results, input);
    input.focus({ preventScroll: true });
}

function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
    catch { return []; }
}

function addSearchHistory(q) {
    if (!q) return;
    let list = getSearchHistory().filter((x) => x !== q);
    list.unshift(q);
    list = list.slice(0, MAX_SEARCH_HISTORY);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch {}
}

function clearSearchHistory() {
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch {}
}

function removeSearchHistory(q) {
    const list = getSearchHistory().filter((item) => item !== q);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch {}
    return list;
}

function renderSearchHistory(shell, results, input) {
    const list = getSearchHistory();
    if (list.length === 0) {
        results.innerHTML = renderSearchIdleHint();
        shell._searchActiveIndex = -1;
        return;
    }
    results.innerHTML = `
        <div class="search-history">
            <div class="search-history-head">
                <span>最近搜索</span>
                <button class="search-history-clear" id="sh-clear">清除</button>
            </div>
            ${list.map((q) => `
                <div class="search-history-row">
                    <button class="search-history-item" data-q="${esc(q)}">${esc(q)}</button>
                    <button class="search-history-remove" type="button" data-q="${esc(q)}" aria-label="删除搜索记录：${esc(q)}">&times;</button>
                </div>
            `).join('')}
        </div>
    `;
    results.querySelector('#sh-clear')?.addEventListener('click', () => {
        clearSearchHistory();
        renderSearchHistory(shell, results, input);
    });
    results.querySelectorAll('.search-history-item').forEach((el) => {
        el.addEventListener('click', () => {
            input.value = el.dataset.q;
            shell._searchFilter = 'all';
            doSearch(shell, el.dataset.q, results);
        });
    });
    results.querySelectorAll('.search-history-remove').forEach((el) => {
        el.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            removeSearchHistory(el.dataset.q || '');
            renderSearchHistory(shell, results, input);
        });
    });
    setActiveSearchItem(shell, results, 0);
}

function renderSearchIdleHint() {
    return '<div class="search-short-hint">输入至少 2 个字开始搜索</div>';
}

function renderSearchPrompt(results, message) {
    const history = results.querySelector('.search-history');
    const prompt = `<div class="search-short-hint">${esc(message)}</div>`;
    if (history) history.insertAdjacentHTML('afterbegin', prompt);
    else results.innerHTML = prompt;
}

async function doSearch(shell, query, results) {
    if (query.length < 2) { results.innerHTML = ''; return; }
    const seq = ++shell._searchSeq;
    results.innerHTML = '<div class="search-loading"><div class="spinner-small"></div></div>';

    const { getCatalog, getUnifiedSearch } = await import('../services/api.js');
    let groupResults = {};
    try {
        const data = await getUnifiedSearch({ search: query, type: 'all', pageSize: 8, force: true });
        groupResults = Object.fromEntries((data.groups || []).map((group) => {
            const def = SEARCH_GROUPS.find((item) => item.key === group.key);
            return [group.key, (group.items || []).map((item) => ({ ...item, _type: def?.itemType || item.type || 'movie', _group: group.key }))];
        }));
        if (!Object.keys(groupResults).length) throw new Error('empty unified search')
    } catch {
        try {
            const rows = await Promise.all(SEARCH_GROUPS.map(async (group) => {
                const items = await getCatalog(group.catalogType, group.catalogId, { search: query });
                return [group.key, (items || []).map((item) => ({ ...item, _type: group.itemType, _group: group.key }))];
            }));
            groupResults = Object.fromEntries(rows);
        } catch {
            if (seq === shell._searchSeq) renderSearchFailure(shell, results, query);
            return;
        }
    }

    if (seq !== shell._searchSeq) return;
    const groups = SEARCH_GROUPS.map((group) => ({
        ...group,
        items: groupResults[group.key] || [],
    }));
    const all = groups.flatMap((group) => group.items);

    if (all.length === 0) {
        addSearchHistory(query);
        results.innerHTML = renderSearchEmptyQuery(query);
        bindSearchResultInteractions(shell, results);
        shell._searchActiveIndex = -1;
        shell._searchKeyboardPick = false;
        setActiveSearchItem(shell, results, 0);
        dismissSearchInputKeyboard(shell);
        return;
    }

    addSearchHistory(query);
    shell._searchLast = { query, groups, total: all.length };
    renderSearchResults(shell, results, shell._searchLast);
    dismissSearchInputKeyboard(shell);
}

function dismissSearchInputKeyboard(shell) {
    shell.querySelector('#search-input')?.blur();
}

function renderSearchFailure(shell, results, query) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    results.innerHTML = `
        <div class="search-empty search-error-panel">
            <div>${offline ? '当前离线，无法搜索最新内容' : '搜索失败，请稍后重试'}</div>
            <div class="search-empty-hint">${offline ? '可以先浏览已缓存页面，联网后再继续搜索。' : '可能是网络波动或服务暂时不可用。'}</div>
            <button class="search-empty-link search-retry search-target" type="button">重试搜索「${esc(query)}」</button>
        </div>
    `;
    shell._searchActiveIndex = -1;
    setActiveSearchItem(shell, results, 0);
}

function renderSearchResults(shell, results, payload) {
    const { query, groups, total } = payload;
    const activeFilter = shell._searchFilter || 'all';
    const visibleGroups = activeFilter === 'all'
        ? groups
        : groups.filter((group) => group.key === activeFilter);
    const filteredTotal = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);

    results.innerHTML = `
        ${renderFilters(groups, total, activeFilter)}
        ${renderSearchCatalogAction(query, activeFilter, filteredTotal)}
        ${filteredTotal > 0
            ? visibleGroups.map((group) => renderResultGroup(group, group.items.slice(0, 6), group.items.length, query)).join('')
            : `<div class="search-empty">当前分类没有结果</div>`}
    `;

    bindSearchResultInteractions(shell, results);
    setActiveSearchItem(shell, results, 0);
    shell._searchKeyboardPick = false;
}

function bindSearchResultInteractions(shell, results) {
    results.querySelectorAll('.search-target').forEach((el) => {
        el.addEventListener('mouseenter', () => {
            const index = searchTargets(results).indexOf(el);
            if (index >= 0) setActiveSearchItem(shell, results, index);
        });
        el.addEventListener('click', () => shell._closeSearch?.());
    });
    results.querySelectorAll('.search-poster').forEach((img) => {
        img.addEventListener('error', () => {
            img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%23222"/%3E%3C/svg%3E';
        }, { once: true });
    });
}

function renderFilters(groups, total, activeFilter) {
    const rows = [
        { key: 'all', title: '全部', count: total },
        ...groups.map((group) => ({ key: group.key, title: group.title, count: group.items.length })),
    ];
    return `
        <div class="search-filters" role="tablist" aria-label="搜索结果筛选">
            ${rows.map((row) => `
                <button class="search-filter ${row.key === activeFilter ? 'active' : ''}" type="button" role="tab" aria-selected="${row.key === activeFilter}" data-filter="${row.key}">
                    <span>${esc(row.title)}</span>
                    <strong>${esc(String(row.count))}</strong>
                </button>
            `).join('')}
        </div>
    `;
}

function renderSearchCatalogAction(query, activeFilter, count) {
    const typeParam = activeFilter === 'all' ? '' : `&type=${encodeURIComponent(activeFilter)}`;
    const label = activeFilter === 'all' ? '打开完整搜索页' : `只看${SEARCH_GROUPS.find((group) => group.key === activeFilter)?.title || '当前分类'}`;
    const countText = count ? `当前预览 ${count} 条结果` : '当前分类暂无预览结果';
    return `
        <a class="search-catalog-action search-target" href="#/search?q=${encodeURIComponent(query)}${typeParam}">
            <span>
                <strong>${esc(label)}</strong>
                <small>${esc(countText)}，可刷新、返回和分享给别人</small>
            </span>
            <span aria-hidden="true">↵</span>
        </a>
    `;
}

function renderResultGroup(group, items, total, query) {
    if (total === 0) return '';
    const more = total > items.length
        ? `<a href="#/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(group.key)}" class="search-view-all search-target">查看全部 ${total} 条</a>`
        : '';
    return `
        <section class="search-group">
            <div class="search-group-head">
                <span>${esc(group.title)}</span>
                <span>${total}</span>
            </div>
            ${items.map((item) => `
        <a href="#/detail/${item._type}/${esc(item.id)}" class="search-item search-target">
            <img src="${esc(item.poster || '')}" class="search-poster" loading="lazy" alt="">
            <div class="search-info">
                <div class="search-name">${highlightQuery(item.name || '未命名内容', query)}</div>
                <div class="search-meta">
                    <span>${esc(group.title)}</span>
                    ${item.year ? `<span>${esc(String(item.year))}</span>` : ''}
                    ${item.imdbRating ? `<span>评分 ${esc(String(item.imdbRating))}</span>` : ''}
                </div>
                ${searchDescription(item, query)}
            </div>
        </a>
            `).join('')}
            ${more}
        </section>
    `;
}

function highlightQuery(text, query) {
    const source = String(text || '');
    const needle = String(query || '').trim();
    if (!needle) return esc(source);
    const lower = source.toLowerCase();
    const target = needle.toLowerCase();
    const index = lower.indexOf(target);
    if (index < 0) return esc(source);
    return `${esc(source.slice(0, index))}<mark>${esc(source.slice(index, index + needle.length))}</mark>${esc(source.slice(index + needle.length))}`;
}

function searchDescription(item, query) {
    const raw = item.description || item.overview || item.subtitle || '';
    const text = String(raw).trim();
    if (!text) return '';
    const snippet = snippetAroundQuery(text, query, 72);
    return `<div class="search-desc">${highlightQuery(snippet, query)}</div>`;
}

function snippetAroundQuery(text, query, maxLength) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (source.length <= maxLength) return source;
    const needle = String(query || '').trim().toLowerCase();
    const index = needle ? source.toLowerCase().indexOf(needle) : -1;
    if (index < 0) return `${source.slice(0, maxLength - 1)}…`;
    const half = Math.floor(maxLength / 2);
    const start = Math.max(0, Math.min(index - half, source.length - maxLength));
    const end = Math.min(source.length, start + maxLength);
    return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

function renderSearchEmptyQuery(query) {
    return `
        <div class="search-empty search-empty-panel">
            <div>${t('search.empty')}</div>
            <div class="search-empty-hint">可以换个关键词，或到指定片库继续扩大范围。</div>
            <div class="search-empty-actions">
                ${SEARCH_GROUPS.map((group) => `
                    <a href="#/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(group.key)}" class="search-empty-link search-target">
                        搜 ${esc(group.title)}
                    </a>
                `).join('')}
            </div>
        </div>
    `;
}

function searchTargets(results) {
    return [...results.querySelectorAll('.search-target, .search-item, .search-history-item')]
        .filter((item) => !item.closest('.hidden'));
}

function setActiveSearchItem(shell, results, index) {
    const items = searchTargets(results);
    shell._searchActiveIndex = items.length > 0 ? Math.max(0, Math.min(index, items.length - 1)) : -1;
    items.forEach((item, i) => {
        const active = i === shell._searchActiveIndex;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
        if (active) item.scrollIntoView({ block: 'nearest' });
    });
}

function clearActiveSearchItem(shell, results) {
    shell._searchActiveIndex = -1;
    searchTargets(results).forEach((item) => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
    });
}

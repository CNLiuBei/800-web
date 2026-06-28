// 分类页 - 无限滚动 + 本地筛选排序 + 错误重试 + 空状态

import { getCatalog } from '../services/api.js';
import { esc, loadCSS } from '../core/html.js';
import '../components/poster-grid.js';

const CATALOG_MAP = {
    movie: { type: 'movie', id: 'guangying-movie', title: '电影' },
    tv: { type: 'series', id: 'guangying-tv', title: '剧集' },
    anime: { type: 'series', id: 'guangying-anime', title: '动漫' },
};

const YEAR_OPTIONS = [
    ['', '全部年代'],
    ['2026', '2026'],
    ['2025', '2025'],
    ['2024', '2024'],
    ['2023', '2023'],
    ['2022', '2022'],
    ['2021', '2021'],
    ['2020', '2020'],
    ['90年代', '90年代'],
    ['更早', '更早'],
];

const REGION_OPTIONS = [
    ['', '全部地区'],
    ['CN', '华语'],
    ['US', '欧美'],
    ['JP', '日本'],
    ['KR', '韩国'],
    ['IN', '印度'],
    ['TH', '泰国'],
];

const CATALOG_STATE_MAX = 8;
const catalogStateCache = new Map();

export async function render(container, params) {
    const catalog = CATALOG_MAP[params.category];
    if (!catalog) { container.innerHTML = '<div class="page-empty">未知分类</div>'; return; }
    const initialQuery = readCatalogQuery(params.query);
    const initialStateKey = catalogStateKey(params.category, initialQuery);
    const restoredState = catalogStateCache.get(initialStateKey);
    // 不走 View Transition 的页面：非返回恢复时同步归零滚动，避免旧列表位置泄露到新分类。
    if (!restoredState) {
        container.scrollTop = 0;
        document.getElementById('app')?.scrollTo?.({ top: 0 });
    }

    await loadCSS('styles/layout.css');

    container.innerHTML = `
        <section class="catalog-section">
            <div class="catalog-toolbar" role="search">
                <label class="catalog-filter">
                    <span>筛选</span>
                    <span class="catalog-search-field">
                        <input id="catalog-filter" type="search" placeholder="搜索片名、演员或导演" autocomplete="off" aria-controls="catalog-grid">
                        <button class="catalog-search-clear hidden" id="catalog-search-clear" type="button" aria-label="清除搜索词">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                        </button>
                    </span>
                </label>
                <button class="catalog-filter-toggle" id="catalog-filter-toggle" type="button" aria-expanded="false" aria-controls="catalog-advanced">
                    筛选<span class="catalog-filter-toggle-count hidden" id="catalog-filter-toggle-count" aria-hidden="true">0</span>
                </button>
                <div class="catalog-advanced is-collapsed" id="catalog-advanced">
                    <label class="catalog-sort">
                        <span>排序</span>
                        <select id="catalog-sort">
                            <option value="latest">最新上架</option>
                            <option value="rating">评分最高</option>
                        </select>
                    </label>
                    <label class="catalog-select">
                        <span>年代</span>
                        <select id="catalog-year">
                            ${YEAR_OPTIONS.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="catalog-select">
                        <span>地区</span>
                        <select id="catalog-region">
                            ${REGION_OPTIONS.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="catalog-summary" id="catalog-summary" role="status" aria-live="polite">正在加载</div>
            </div>
            <div class="catalog-ranking-explain" id="catalog-ranking-explain" aria-live="polite"></div>
            <div class="catalog-active-filters hidden" id="catalog-active-filters" aria-label="当前筛选条件"></div>
            <poster-grid id="catalog-grid"></poster-grid>
            <div class="catalog-status" id="status"></div>
        </section>
    `;

    const grid = container.querySelector('#catalog-grid');
    const status = container.querySelector('#status');
    const filterInput = container.querySelector('#catalog-filter');
    const clearSearch = container.querySelector('#catalog-search-clear');
    const filterToggle = container.querySelector('#catalog-filter-toggle');
    const filterToggleCount = container.querySelector('#catalog-filter-toggle-count');
    const advancedFilters = container.querySelector('#catalog-advanced');
    const sortSelect = container.querySelector('#catalog-sort');
    const yearSelect = container.querySelector('#catalog-year');
    const regionSelect = container.querySelector('#catalog-region');
    const summary = container.querySelector('#catalog-summary');
    const rankingExplain = container.querySelector('#catalog-ranking-explain');
    const activeFilters = container.querySelector('#catalog-active-filters');
    filterInput.value = initialQuery.keyword;
    sortSelect.value = initialQuery.sort;
    yearSelect.value = initialQuery.year;
    regionSelect.value = initialQuery.region;
    if (hasAdvancedFilters()) {
        advancedFilters.classList.remove('is-collapsed');
        filterToggle.setAttribute('aria-expanded', 'true');
    }
    grid.showSkeleton(16);

    let skip = restoredState?.skip ?? 0;
    let loading = false;
    let ended = restoredState?.ended ?? false;
    let itemsAll = restoredState?.items ?? [];
    let loadVersion = 0;
    let activeSearchQuery = restoredState?.activeSearchQuery ?? initialQuery.keyword;
    let sortExplanation = restoredState?.sortExplanation ?? null;
    let forceNextLoad = false;
    const seen = new Set(itemsAll.map((it) => it.id)); // 去重，防后端分页错位重复渲染

    const setStatus = (html) => { status.innerHTML = html; };
    const setSummary = () => {
        const shown = getVisibleItems().length;
        const keyword = activeSearchQuery.trim();
        updateSearchClear();
        renderActiveFilters();
        renderSortExplanation();
        if (keyword) {
            summary.textContent = ended
                ? `搜索「${keyword}」 · ${shown} 条`
                : `正在搜索「${keyword}」 · 已加载 ${itemsAll.length}`;
            return;
        }
        summary.textContent = ended ? `已显示 ${shown} / 已加载 ${itemsAll.length}` : `已加载 ${itemsAll.length}`;
    };
    const updateSearchClear = () => {
        clearSearch.classList.toggle('hidden', filterInput.value.trim().length === 0);
    };
    const updateFilterToggle = () => {
        const count = advancedFilterCount();
        filterToggleCount.textContent = String(count);
        filterToggleCount.classList.toggle('hidden', count === 0);
        filterToggle.setAttribute('aria-label', count ? `筛选，已选 ${count} 项` : '展开筛选条件');
    };

    const getVisibleItems = () => {
        const keyword = filterInput.value.trim().toLowerCase();
        const sorter = sortSelect.value;
        const shouldFilterLocally = keyword && keyword !== activeSearchQuery.trim().toLowerCase();
        let visible = shouldFilterLocally
            ? itemsAll.filter((it) => `${it.name || ''} ${it.year || ''}`.toLowerCase().includes(keyword))
            : [...itemsAll];
        if (sorter === 'rating') visible.sort((a, b) => Number(b.imdbRating || 0) - Number(a.imdbRating || 0));
        return visible;
    };

    const renderVisible = () => {
        const visible = getVisibleItems();
        grid.render(visible, catalog.type);
        setSummary();
        if (itemsAll.length > 0 && visible.length === 0) {
            setStatus(`
                <div class="page-empty catalog-empty">
                    没有匹配「${esc(filterInput.value.trim())}」的内容
                    <div class="catalog-empty-actions">
                        <button class="retry-btn secondary" id="clear-local-search" type="button">清除搜索词</button>
                    </div>
                </div>
            `);
            status.querySelector('#clear-local-search')?.addEventListener('click', () => {
                filterInput.value = '';
                reloadCatalog();
                syncUrl();
                filterInput.focus();
            });
        } else if (itemsAll.length === 0 && ended && hasActiveFilters()) {
            setStatus(`
                <div class="page-empty catalog-empty">
                    <div>${esc(emptyResultTitle())}</div>
                    <div class="page-error-hint">${esc(emptySearchHint())}</div>
                    <div class="catalog-empty-actions">
                        ${activeSearchQuery ? '<button class="retry-btn" id="clear-search" type="button">清除搜索词</button>' : ''}
                        <button class="retry-btn secondary" id="clear-all-filters" type="button">清除全部条件</button>
                    </div>
                </div>
            `);
            status.querySelector('#clear-search')?.addEventListener('click', () => {
                filterInput.value = '';
                reloadCatalog();
                syncUrl();
                filterInput.focus();
            });
            status.querySelector('#clear-all-filters')?.addEventListener('click', clearAllFilters);
        } else if (ended) {
            setStatus('<div class="load-end">没有更多了</div>');
        } else {
            setStatus('');
        }
    };

    const saveCatalogState = () => {
        const state = {
            items: itemsAll,
            skip,
            ended,
            activeSearchQuery,
            sortExplanation,
            scrollTop: document.getElementById('app')?.scrollTop ?? 0,
            savedAt: Date.now(),
        };
        const key = catalogStateKey(params.category, currentQueryState());
        catalogStateCache.set(key, state);
        trimCatalogStateCache();
    };

    const restoreScrollPosition = () => {
        if (!restoredState) return;
        requestAnimationFrame(() => {
            document.getElementById('app')?.scrollTo?.({ top: restoredState.scrollTop || 0 });
        });
    };

    const renderLoadError = (err) => {
        const offline = isOfflineError(err);
        const hasLoadedItems = itemsAll.length > 0;
        const title = offline
            ? (hasLoadedItems ? '当前离线，已保留已加载内容' : '当前离线，片库暂时无法加载')
            : (hasLoadedItems ? '后续内容加载失败，已保留当前结果' : '加载失败');
        const hint = offline
            ? '联网后可继续加载和筛选最新内容。'
            : '服务暂时不可用，请稍后重试。';
        if (hasLoadedItems) {
            renderVisible();
        } else {
            grid.render([], catalog.type);
            setSummary();
        }
        setStatus(`
            <div class="page-error catalog-recoverable">
                <div>${esc(title)}</div>
                <div class="page-error-hint">${esc(hint)}</div>
                <button class="retry-btn" id="retry" type="button">重试</button>
            </div>
        `);
    };

    const syncUrl = () => {
        const keyword = filterInput.value.trim();
        const sorter = sortSelect.value;
        const year = yearSelect.value;
        const region = regionSelect.value;
        const search = new URLSearchParams();
        if (keyword) search.set('q', keyword);
        if (sorter !== 'latest') search.set('sort', sorter);
        if (year) search.set('year', year);
        if (region) search.set('region', region);
        const nextHash = `#/${params.category}${search.toString() ? `?${search}` : ''}`;
        if (location.hash !== nextHash) {
            history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
        }
    };

    function renderActiveFilters() {
        const chips = [];
        const keyword = filterInput.value.trim();
        const yearLabel = labelFor(YEAR_OPTIONS, yearSelect.value);
        const regionLabel = labelFor(REGION_OPTIONS, regionSelect.value);
        if (keyword) chips.push({ key: 'q', label: `搜索：${keyword}` });
        if (sortSelect.value === 'rating') chips.push({ key: 'sort', label: '评分最高' });
        if (yearSelect.value) chips.push({ key: 'year', label: yearLabel });
        if (regionSelect.value) chips.push({ key: 'region', label: regionLabel });
        updateFilterToggle();

        activeFilters.classList.toggle('hidden', chips.length === 0);
        if (chips.length === 0) {
            activeFilters.innerHTML = '';
            return;
        }
        activeFilters.innerHTML = `
            <span class="catalog-active-label">当前条件</span>
            ${chips.map((chip) => `
                <button class="catalog-filter-chip" type="button" data-clear="${esc(chip.key)}">
                    ${esc(chip.label)}<span aria-hidden="true">&times;</span><span class="sr-only">，点击移除</span>
                </button>
            `).join('')}
            <button class="catalog-filter-clear" type="button" data-clear="all">清除全部</button>
        `;
        activeFilters.querySelectorAll('[data-clear]').forEach((btn) => {
            btn.addEventListener('click', () => {
                clearFilter(btn.dataset.clear || 'all');
            });
        });
    }

    function clearFilter(key) {
        if (key === 'all') {
            clearAllFilters();
            return;
        }
        if (key === 'q') filterInput.value = '';
        if (key === 'sort') sortSelect.value = 'latest';
        if (key === 'year') yearSelect.value = '';
        if (key === 'region') regionSelect.value = '';
        reloadCatalog();
        syncUrl();
        if (key === 'q' || key === 'all') filterInput.focus();
    }

    function clearAllFilters() {
        filterInput.value = '';
        sortSelect.value = 'latest';
        yearSelect.value = '';
        regionSelect.value = '';
        reloadCatalog();
        syncUrl();
    }

    function emptySearchHint() {
        const extra = [];
        if (sortSelect.value === 'rating') extra.push('评分排序');
        if (yearSelect.value) extra.push(labelFor(YEAR_OPTIONS, yearSelect.value));
        if (regionSelect.value) extra.push(labelFor(REGION_OPTIONS, regionSelect.value));
        if (extra.length === 0) return '可以换个关键词，或返回片库浏览最新内容。';
        return `当前还叠加了 ${extra.join('、')} 条件，可以清除部分条件后再试。`;
    }

    function emptyResultTitle() {
        const keyword = activeSearchQuery.trim();
        return keyword ? `没有找到「${keyword}」` : '没有找到符合条件的内容';
    }

    function hasActiveFilters() {
        return !!filterInput.value.trim() || sortSelect.value !== 'latest' || !!yearSelect.value || !!regionSelect.value;
    }

    function hasAdvancedFilters() {
        return sortSelect.value !== 'latest' || !!yearSelect.value || !!regionSelect.value;
    }

    function advancedFilterCount() {
        return [sortSelect.value !== 'latest', !!yearSelect.value, !!regionSelect.value].filter(Boolean).length;
    }

    async function loadPage() {
        if (loading || ended) return;
        loading = true;
        const version = loadVersion;
        const keyword = filterInput.value.trim();
        activeSearchQuery = keyword;
        if (skip > 0) setStatus('<div class="spinner-small"></div>');

        try {
            const result = await getCatalog(catalog.type, catalog.id, {
                skip: skip > 0 ? skip : undefined,
                search: keyword || undefined,
                sort: sortSelect.value,
                year: yearSelect.value,
                region: regionSelect.value,
                force: forceNextLoad && skip === 0,
                withExplanation: true,
            });
            const items = result.items || [];
            sortExplanation = result.explanation || sortExplanation || fallbackSortExplanation(sortSelect.value);
            forceNextLoad = false;
            if (version !== loadVersion) return;

            // 第一页空 → 空状态
            if (skip === 0 && items.length === 0) {
                grid.render([], catalog.type);
                ended = true;
                setSummary();
                renderVisible();
                return;
            }

            // 去重后追加
            const fresh = items.filter((it) => !seen.has(it.id));
            fresh.forEach((it) => seen.add(it.id));
            itemsAll = [...itemsAll, ...fresh];

            renderVisible();

            skip += items.length;

            // 后端返回不足一页（20）或本页无新内容 → 到底
            if (items.length < 20 || fresh.length === 0) {
                ended = true;
                renderVisible();
            } else {
                setStatus('');
                setSummary();
            }
            saveCatalogState();
        } catch (err) {
            if (version !== loadVersion) return;
            renderLoadError(err);
            status.querySelector('#retry')?.addEventListener('click', () => {
                setStatus('');
                loadPage();
            });
        } finally {
            if (version === loadVersion) loading = false;
        }
    }

    if (restoredState && itemsAll.length > 0) {
        renderVisible();
        setStatus('<div class="catalog-restore-note">已恢复上次浏览位置</div>');
        restoreScrollPosition();
    } else {
        await loadPage();
    }

    let urlSyncTimer = null;
    let searchReloadTimer = null;
    filterInput.addEventListener('input', () => {
        const keyword = filterInput.value.trim();
        updateSearchClear();
        if (keyword !== activeSearchQuery) {
            setStatus('<div class="spinner-small"></div>');
            summary.textContent = keyword ? `准备搜索「${keyword}」` : '准备加载片库';
        } else {
            renderVisible();
        }
        clearTimeout(urlSyncTimer);
        urlSyncTimer = setTimeout(syncUrl, 180);
        clearTimeout(searchReloadTimer);
        searchReloadTimer = setTimeout(() => {
            reloadCatalog();
            syncUrl();
        }, 360);
    });
    filterInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !filterInput.value.trim()) return;
        event.preventDefault();
        filterInput.value = '';
        updateSearchClear();
        reloadCatalog();
        syncUrl();
    });
    clearSearch.addEventListener('click', () => {
        if (!filterInput.value.trim()) return;
        filterInput.value = '';
        updateSearchClear();
        reloadCatalog();
        syncUrl();
        filterInput.focus();
    });
    filterToggle.addEventListener('click', () => {
        const expanded = filterToggle.getAttribute('aria-expanded') === 'true';
        filterToggle.setAttribute('aria-expanded', String(!expanded));
        advancedFilters.classList.toggle('is-collapsed', expanded);
    });
    sortSelect.addEventListener('change', () => {
        updateFilterToggle();
        reloadCatalog();
        syncUrl();
    });
    yearSelect.addEventListener('change', () => {
        updateFilterToggle();
        reloadCatalog();
        syncUrl();
    });
    regionSelect.addEventListener('change', () => {
        updateFilterToggle();
        reloadCatalog();
        syncUrl();
    });
    function reloadCatalog(options = {}) {
        loadVersion += 1;
        loading = false;
        skip = 0;
        ended = false;
        itemsAll = [];
        sortExplanation = null;
        activeSearchQuery = filterInput.value.trim();
        forceNextLoad = options.force === true;
        seen.clear();
        grid.showSkeleton(16);
        setSummary();
        loadPage();
    }

    function renderSortExplanation() {
        const shouldExplain = sortSelect.value !== 'latest' || !!yearSelect.value || !!regionSelect.value;
        if (!shouldExplain) {
            rankingExplain.innerHTML = '';
            return;
        }
        const explanation = sortExplanation || fallbackSortExplanation(sortSelect.value);
        if (!explanation) {
            rankingExplain.innerHTML = '';
            return;
        }
        rankingExplain.innerHTML = `
            <div class="catalog-ranking-card">
                <span class="catalog-ranking-label">${esc(explanation.label || '排序依据')}</span>
                <span class="catalog-ranking-summary">${esc(explanation.summary || '')}</span>
                <span class="catalog-ranking-signals">
                    ${(explanation.signals || []).map((signal) => `<span>${esc(signal)}</span>`).join('')}
                </span>
            </div>
        `;
    }

    updateSearchClear();
    updateFilterToggle();

    // 无限滚动（#app 是滚动容器）
    const app = document.getElementById('app');
    let ticking = false;
    let saveScrollTimer = null;
    const onScroll = () => {
        clearTimeout(saveScrollTimer);
        saveScrollTimer = setTimeout(saveCatalogState, 120);
        if (ended || loading || ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            if (app.scrollHeight - app.scrollTop - app.clientHeight < 400) loadPage();
            ticking = false;
        });
    };
    app.addEventListener('scroll', onScroll, { passive: true });

    return () => {
        clearTimeout(urlSyncTimer);
        clearTimeout(searchReloadTimer);
        clearTimeout(saveScrollTimer);
        saveCatalogState();
        app.removeEventListener('scroll', onScroll);
    };

    function currentQueryState() {
        return {
            keyword: filterInput.value.trim(),
            sort: sortSelect.value,
            year: yearSelect.value,
            region: regionSelect.value,
        };
    }
}

function fallbackSortExplanation(sort) {
    if (sort === 'rating') {
        return {
            label: '评分最高',
            summary: '按评分优先展示，同分时由服务端稳定排序。',
            signals: ['评分', '发布状态'],
        };
    }
    return {
        label: '最新上架',
        summary: '按最近入库时间展示符合条件的内容。',
        signals: ['入库时间', '筛选条件'],
    };
}

function labelFor(options, value) {
    return options.find(([optionValue]) => optionValue === value)?.[1] || value;
}

function isOfflineError(err) {
    return err?.offline || navigator.onLine === false;
}

function readCatalogQuery(query) {
    const sorter = query?.get?.('sort') || 'latest';
    const year = query?.get?.('year') || '';
    const region = query?.get?.('region') || '';
    return {
        keyword: query?.get?.('q') || '',
        sort: ['latest', 'rating'].includes(sorter) ? sorter : 'latest',
        year: YEAR_OPTIONS.some(([value]) => value === year) ? year : '',
        region: REGION_OPTIONS.some(([value]) => value === region) ? region : '',
    };
}

function catalogStateKey(category, query) {
    const params = new URLSearchParams();
    if (query.keyword) params.set('q', query.keyword);
    if (query.sort && query.sort !== 'latest') params.set('sort', query.sort);
    if (query.year) params.set('year', query.year);
    if (query.region) params.set('region', query.region);
    return `${category}?${params.toString()}`;
}

function trimCatalogStateCache() {
    if (catalogStateCache.size <= CATALOG_STATE_MAX) return;
    const stale = [...catalogStateCache.entries()]
        .sort((a, b) => (a[1].savedAt || 0) - (b[1].savedAt || 0))
        .slice(0, catalogStateCache.size - CATALOG_STATE_MAX);
    stale.forEach(([key]) => catalogStateCache.delete(key));
}

// TODO: 下一轮为片库增加可收起的高级筛选栏。

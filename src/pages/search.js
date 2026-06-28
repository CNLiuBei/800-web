import { getCatalog, getUnifiedSearch } from '../services/api.js';
import { reportSearchEvent } from '../services/search-analytics.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';
import { esc, loadCSS } from '../core/html.js';
import { navigate, reloadRoute } from '../core/router.js';
import { setPageMeta } from '../core/head.js';
import '../components/poster-grid.js';

const SEARCH_GROUPS = [
    { key: 'all', title: '全部' },
    { key: 'movie', title: '电影', catalogType: 'movie', catalogId: 'guangying-movie', itemType: 'movie' },
    { key: 'tv', title: '剧集', catalogType: 'series', catalogId: 'guangying-tv', itemType: 'series' },
    { key: 'anime', title: '动漫', catalogType: 'series', catalogId: 'guangying-anime', itemType: 'series' },
];

const SEARCHABLE_GROUPS = SEARCH_GROUPS.filter((group) => group.key !== 'all');
const SEARCH_HISTORY_KEY = 'gy_search_history';
const MAX_SEARCH_HISTORY = 8;
const SEARCH_PAGE_SIZE = 20;
const FILTER_OPTIONS = {
    sort: [
        { value: 'relevance', label: '综合排序' },
        { value: 'rating', label: '评分优先' },
        { value: 'year', label: '年份最新' },
    ],
    year: [
        { value: 'all', label: '全部年份' },
        { value: '2026', label: '2026' },
        { value: '2025', label: '2025' },
        { value: '2024', label: '2024' },
        { value: '2023', label: '2023' },
        { value: '2020s', label: '2020年代' },
        { value: '2010s', label: '2010年代' },
    ],
    region: [
        { value: 'all', label: '全部地区' },
        { value: 'CN', label: '大陆' },
        { value: 'HK', label: '香港' },
        { value: 'TW', label: '台湾' },
        { value: 'US', label: '美国' },
        { value: 'JP', label: '日本' },
        { value: 'KR', label: '韩国' },
    ],
};

export async function render(container, params = {}) {
    await loadCSS('styles/layout.css?v=search-compact-v2');

    const query = readSearchQuery(params.query);
    setPageMeta({
        title: query.q ? `搜索 ${query.q} - 800影视` : '搜索 - 800影视',
        description: query.q ? `搜索 ${query.q} 相关的电影、剧集和动漫。` : '搜索电影、剧集和动漫。',
        url: window.location.href,
    });

    container.innerHTML = `
        <section class="search-page">
            <form class="search-page-form" id="search-page-form" role="search">
                <label class="search-page-field">
                    <span class="sr-only">搜索关键词</span>
                    <input id="search-page-input" type="search" enterkeyhint="search" inputmode="search" value="${esc(query.q)}" placeholder="输入片名、演员或关键词" autocomplete="off">
                </label>
                <button class="page-primary-action" type="submit">搜索</button>
            </form>
            <div class="search-page-controls">
                <div class="search-page-tabs" role="tablist" aria-label="搜索分类">
                    ${SEARCH_GROUPS.map((group) => `
                        <button class="search-page-tab ${query.type === group.key ? 'active' : ''}" type="button" role="tab" aria-selected="${query.type === group.key}" data-type="${group.key}">
                            ${esc(group.title)}
                        </button>
                    `).join('')}
                </div>
                <div class="search-page-filters" aria-label="搜索筛选">
                    ${renderSearchSelect('sort', '排序', query.sort, FILTER_OPTIONS.sort)}
                    ${renderSearchSelect('year', '年份', query.year, FILTER_OPTIONS.year)}
                    ${renderSearchSelect('region', '地区', query.region, FILTER_OPTIONS.region)}
                    ${hasActiveRefinements(query) ? '<button class="search-page-filter-reset" id="search-page-filter-reset" type="button">重置</button>' : ''}
                </div>
            </div>
            <div class="search-page-summary" id="search-page-summary" role="status" aria-live="polite" hidden></div>
            <div class="search-page-results" id="search-page-results"></div>
        </section>
    `;

    bindSearchPageControls(container, query);

    const results = container.querySelector('#search-page-results');
    const summary = container.querySelector('#search-page-summary');

    if (query.q.length < 2) {
        renderSearchLanding(results, summary);
        return;
    }

    results.innerHTML = renderSearchSkeleton();
    setSearchSummary(summary, `正在搜索「${query.q}」…`);

    const payload = await loadSearchResults(query);
    renderSearchResults(container, payload, query);
}

function bindSearchPageControls(container, query) {
    const form = container.querySelector('#search-page-form');
    const input = container.querySelector('#search-page-input');
    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const next = input?.value?.trim() || '';
        if (next.length < 2) {
            input?.focus();
            return;
        }
        input?.blur();
        goToSearch({ q: next, type: query.type });
    });
    container.querySelectorAll('.search-page-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            goToSearch({ ...query, q: input?.value?.trim() || query.q, type: tab.dataset.type || 'all', page: 1 });
        });
    });
    container.querySelectorAll('.search-page-select').forEach((select) => {
        select.addEventListener('change', () => {
            goToSearch({
                ...query,
                q: input?.value?.trim() || query.q,
                sort: container.querySelector('#search-page-sort')?.value || 'relevance',
                year: container.querySelector('#search-page-year')?.value || 'all',
                region: container.querySelector('#search-page-region')?.value || 'all',
                page: 1,
            });
        });
    });
    container.querySelector('#search-page-filter-reset')?.addEventListener('click', () => {
        goToSearch({ q: input?.value?.trim() || query.q, type: query.type, page: 1 });
    });
}

function renderSearchLanding(results, summary) {
    const history = getSearchHistory();
    setSearchSummary(summary, '');
    results.innerHTML = `
        <div class="search-page-empty">
            <h2>找电影、剧集和动漫</h2>
            <p>可以搜索片名、演员、导演或题材。搜索结果页会保留在地址栏，方便刷新、返回和分享。</p>
            ${history.length ? `
                <div class="search-page-history">
                    <div class="search-page-history-head">
                        <span>最近搜索</span>
                        <button id="search-page-clear-history" type="button">清除</button>
                    </div>
                    <div class="search-page-suggestions">
                        ${history.map((q) => `<a href="${esc(searchHref({ q, type: 'all' }))}">${esc(q)}</a>`).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    results.querySelector('#search-page-clear-history')?.addEventListener('click', () => {
        clearSearchHistory();
        renderSearchLanding(results, summary);
    });
}

async function loadSearchResults(query) {
    const unified = await loadUnifiedSearchResults(query).catch(() => null);
    if (unified) return unified;
    return loadLegacySearchResults(query);
}

async function loadUnifiedSearchResults(query) {
    const data = await getUnifiedSearch({
        search: query.q,
        type: query.type,
        page: query.page,
        pageSize: SEARCH_PAGE_SIZE,
        year: yearParam(query.year),
        region: query.region === 'all' ? undefined : query.region,
        force: true,
    });
    const groups = SEARCHABLE_GROUPS.map((group) => {
        const result = (data.groups || []).find((item) => item.key === group.key);
        const searched = query.type === 'all' || query.type === group.key;
        const items = searched ? (result?.items || []) : [];
        return {
            ...group,
            ok: true,
            unified: true,
            skipped: !searched,
            items: items.map((item) => ({ ...item, type: group.itemType, _group: group.key })),
            lastPageCount: searched ? items.length : 0,
        };
    });
    return {
        groups,
        total: groups.reduce((sum, group) => sum + group.items.length, 0),
        failed: [],
        searchedCount: query.type === 'all' ? SEARCHABLE_GROUPS.length : 1,
        strategy: data.strategy || null,
    };
}

async function loadLegacySearchResults(query) {
    const groupsToSearch = query.type === 'all'
        ? SEARCHABLE_GROUPS
        : SEARCHABLE_GROUPS.filter((group) => group.key === query.type);
    const groups = await Promise.all(groupsToSearch.map(async (group) => {
        try {
            const pageCount = query.type === 'all' ? 1 : query.page;
            const pages = group.key === 'creator'
                ? [await getCatalog(group.catalogType, group.catalogId, {
                    search: query.q,
                    limit: pageCount * SEARCH_PAGE_SIZE,
                })]
                : await Promise.all(Array.from({ length: pageCount }, (_, index) => (
                    getCatalog(group.catalogType, group.catalogId, {
                        search: query.q,
                        sort: query.sort === 'rating' ? 'rating' : undefined,
                        year: yearParam(query.year),
                        region: query.region === 'all' ? undefined : query.region,
                        skip: index * SEARCH_PAGE_SIZE,
                    })
                )));
            const items = sortSearchItems(pages.flat(), query.sort);
            return {
                ...group,
                ok: true,
                items: (items || []).map((item) => ({ ...item, type: group.itemType, _group: group.key })),
                lastPageCount: pages[pages.length - 1]?.length || 0,
            };
        } catch (error) {
            return { ...group, ok: false, error, items: [], lastPageCount: 0 };
        }
    }));
    const mergedGroups = query.type === 'all'
        ? groups
        : SEARCHABLE_GROUPS.map((group) => groups.find((item) => item.key === group.key) || {
            ...group,
            ok: true,
            items: [],
            lastPageCount: 0,
            skipped: true,
        });
    return {
        groups: mergedGroups,
        total: mergedGroups.reduce((sum, group) => sum + group.items.length, 0),
        failed: mergedGroups.filter((group) => !group.ok),
        searchedCount: groupsToSearch.length,
    };
}

function renderSearchResults(container, payload, query) {
    const results = container.querySelector('#search-page-results');
    const summary = container.querySelector('#search-page-summary');
    const visibleGroups = query.type === 'all'
        ? payload.groups
        : payload.groups.filter((group) => group.key === query.type);
    const visibleItems = sortSearchItems(visibleGroups.flatMap((group) => group.items), query.sort);

    updateSearchTabs(container, payload, query);
    addSearchHistory(query.q);

    if (!payload.total && payload.failed.length === payload.searchedCount) {
        setSearchSummary(summary, '搜索服务暂时不可用');
        reportSearchEvent('search', {
            query: query.q,
            filter: query.type,
            resultCount: 0,
            failedCount: payload.failed.length,
            success: false,
        });
        results.innerHTML = `
            <div class="page-error search-page-recoverable">
                <div>${navigator.onLine === false ? '当前离线，无法搜索最新内容' : '搜索失败'}</div>
                <div class="page-error-hint">可以稍后重试，或先进入排行榜和本地历史。</div>
                <div class="catalog-empty-actions">
                    <button class="retry-btn" id="search-page-retry" type="button">重试</button>
                    <a class="retry-btn secondary" href="#/rankings">排行榜</a>
                    <a class="retry-btn secondary" href="#/history">观看历史</a>
                </div>
                ${renderSearchRescueDeck(query, payload, 'failed')}
            </div>
        `;
        results.querySelector('#search-page-retry')?.addEventListener('click', () => reloadRoute());
        bindSearchRecovery(container, results, query, payload);
        return;
    }

    const failedHint = payload.failed.length
        ? `，${payload.failed.map((group) => group.title).join('、')} 暂时加载失败`
        : '';
    const refinementText = activeRefinementText(query);
    if (failedHint || refinementText) {
        setSearchSummary(summary, `${payload.total} 条结果${refinementText}${failedHint}`);
    } else {
        setSearchSummary(summary, '');
    }
    reportSearchEvent('search', {
        query: query.q,
        filter: query.type,
        resultCount: payload.total,
        failedCount: payload.failed.length,
        success: payload.failed.length < payload.groups.length,
    });

    if (!visibleItems.length) {
        results.innerHTML = renderSearchRecovery(query, payload);
        bindSearchRecovery(container, results, query, payload);
        return;
    }

    if (query.type === 'all') {
        const groupsWithItems = visibleGroups.filter((group) => group.items.length);
        const singleGroup = groupsWithItems.length === 1;
        results.innerHTML = groupsWithItems
            .map((group) => renderSearchGroupSection(group, query, { compact: singleGroup }))
            .join('');
        bindSearchRecovery(container, results, query, payload);
        visibleGroups.forEach((group) => {
            const grid = results.querySelector(`#search-grid-${group.key}`);
            grid?.render(group.items.slice(0, 12), group.itemType);
        });
        bindSearchResultAnalytics(results, query, payload.total);
        return;
    }

    const activeGroup = visibleGroups[0];
    const canLoadMore = activeGroup?.lastPageCount >= SEARCH_PAGE_SIZE;
    results.innerHTML = `
        <poster-grid id="search-grid-filtered"></poster-grid>
        <div class="search-page-more">
            ${canLoadMore
                ? `<a class="page-secondary-action" href="${esc(searchHref({ ...query, page: query.page + 1 }))}">加载更多</a>`
                : '<span>已显示当前筛选下可加载的结果</span>'}
        </div>
    `;
    bindSearchRecovery(container, results, query, payload);
    results.querySelector('#search-grid-filtered')?.render(visibleItems, visibleGroups[0]?.itemType || 'movie');
    bindSearchResultAnalytics(results, query, payload.total);
}

function bindSearchResultAnalytics(results, query, total) {
    results.querySelectorAll('.poster-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            reportSearchEvent('click', {
                query: query.q,
                filter: query.type,
                resultCount: total,
                targetId: item.dataset.id || '',
                targetType: item.dataset.type || '',
                position: index + 1,
            });
        }, { once: true });
    });
}

function renderSearchRecovery(query, payload) {
    const hasOtherResults = query.type !== 'all' && payload.total > 0;
    const suggestions = recoverySuggestions(query);
    const resetHref = searchHref({ q: query.q, type: 'all' });
    const clearFilterHref = searchHref({ q: query.q, type: query.type });
    return `
        <div class="search-page-empty search-page-recovery">
            <div class="search-page-recovery-kicker">${hasOtherResults ? '分类无结果' : '暂未命中'}</div>
            <h2>${hasOtherResults ? '其它分类里有可看的内容' : '换个入口继续找'}</h2>
            <p>${hasOtherResults ? '当前分类没有命中，先切回全部结果更容易找到可播放内容。' : '把搜索词缩短、换成题材或去排行榜，通常能更快进入播放。'}</p>
            <div class="search-page-recovery-actions">
                ${hasOtherResults ? `<a class="retry-btn" href="${esc(resetHref)}" data-search-recovery="all">查看全部 ${esc(String(payload.total))} 条</a>` : ''}
                ${hasActiveRefinements(query) ? `<a class="retry-btn secondary" href="${esc(clearFilterHref)}" data-search-recovery="clear-filter">清除筛选</a>` : ''}
                <button class="retry-btn secondary" id="search-page-refocus" type="button" data-search-recovery="refocus">修改关键词</button>
                <a class="retry-btn secondary" href="#/rankings" data-search-recovery="rankings">排行榜</a>
                <a class="retry-btn secondary" href="#/history" data-search-recovery="history">观看历史</a>
            </div>
            <div class="search-page-recovery-panel">
                <div>
                    <strong>相近搜索</strong>
                    <span>降低精确匹配压力</span>
                </div>
                <div class="search-page-suggestions">
                    ${suggestions.map((item) => `<a href="${esc(searchHref({ q: item, type: 'all' }))}" data-search-recovery="suggestion" data-recovery-target="${esc(item)}">${esc(item)}</a>`).join('')}
                </div>
            </div>
            ${renderSearchRescueDeck(query, payload, hasOtherResults ? 'category-empty' : 'empty')}
        </div>
    `;
}

function bindSearchRecovery(container, results, query, payload) {
    const input = container.querySelector('#search-page-input');
    results.querySelectorAll('[data-search-recovery]').forEach((element) => {
        element.addEventListener('click', () => {
            const action = element.dataset.searchRecovery || 'unknown';
            reportSearchEvent('click', {
                query: query.q,
                filter: query.type,
                resultCount: payload.total,
                targetId: `gy:search-recovery-${action}`,
                position: 0,
            });
            reportEngagementEvent('decision_click', {
                contentId: 'gy:search-recovery',
                source: 'search_recovery',
                targetId: `search:${metricToken(action)}`,
                actionState: 'open',
                label: element.textContent?.replace(/\s+/g, ' ').trim() || action,
                value: payload.total,
            });
        }, { once: true });
    });
    results.querySelectorAll('#search-page-refocus').forEach((button) => {
        button.addEventListener('click', () => {
            input?.focus();
            input?.select();
        });
    });
}

function renderSearchRescueDeck(query, payload, reason) {
    const suggestions = recoverySuggestions(query);
    const cards = [
        {
            id: 'broad',
            title: '扩大范围',
            text: query.type !== 'all' ? '切到全部分类，避免被单一频道卡住。' : '减少关键词长度，让命中率先回来。',
            href: query.type !== 'all' ? searchHref({ q: query.q, type: 'all' }) : searchHref({ q: suggestions[0] || query.q, type: 'all' }),
        },
        {
            id: 'rankings',
            title: '用热门接住',
            text: '从排行榜进入，减少不知道看什么的选择压力。',
            href: '#/rankings',
        },
        {
            id: 'history',
            title: '回到已投入',
            text: '观看历史和稍后看能把中断搜索转成继续消费。',
            href: '#/history',
        },
    ];
    return `
        <div class="search-rescue-deck" data-search-rescue="${esc(reason)}">
            ${cards.map((card) => `
                <a class="search-rescue-card" href="${esc(card.href)}" data-search-recovery="rescue-${esc(card.id)}">
                    <strong>${esc(card.title)}</strong>
                    <span>${esc(card.text)}</span>
                </a>
            `).join('')}
        </div>
    `;
}

function metricToken(value) {
    const token = String(value || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
    return token || 'unknown';
}

function recoverySuggestions(query) {
    const raw = String(query.q || '').trim();
    const compact = raw.replace(/\s+/g, '');
    const candidates = [
        compact.length > 2 ? compact.slice(0, Math.max(2, Math.min(4, compact.length - 1))) : '',
        compact.replace(/[第季集部篇版上下]/g, ''),
    ]
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item !== raw);
    return [...new Set(candidates)].slice(0, 6);
}

function goToSearch(query) {
    const href = searchHref(query);
    if (location.hash === href) {
        reloadRoute();
        return;
    }
    navigate(href);
}

function getSearchHistory() {
    try {
        const value = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
        return Array.isArray(value) ? value.filter(Boolean).slice(0, MAX_SEARCH_HISTORY) : [];
    } catch {
        return [];
    }
}

function addSearchHistory(q) {
    const value = String(q || '').trim();
    if (value.length < 2) return;
    const list = [value, ...getSearchHistory().filter((item) => item !== value)].slice(0, MAX_SEARCH_HISTORY);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch {}
}

function clearSearchHistory() {
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch {}
}

function renderSearchGroupSection(group, query, options = {}) {
    const head = options.compact ? '' : `
        <div class="search-page-group-head">
            <h2>${esc(group.title)}<span class="search-page-group-count">${group.items.length}</span></h2>
            <a href="${esc(searchHref({ ...query, type: group.key, page: 1 }))}">更多</a>
        </div>
    `;
    return `
        <section class="search-page-group${options.compact ? ' search-page-group-compact' : ''}">
            ${head}
            <poster-grid id="search-grid-${esc(group.key)}"></poster-grid>
        </section>
    `;
}

function setSearchSummary(summary, text) {
    if (!summary) return;
    const value = String(text || '').trim();
    summary.textContent = value;
    summary.hidden = !value;
}

function updateSearchTabs(container, payload, query) {
    const counts = new Map(payload.groups.map((group) => [group.key, group.items.length]));
    counts.set('all', payload.total);
    container.querySelectorAll('.search-page-tab').forEach((tab) => {
        const active = tab.dataset.type === query.type;
        const count = counts.get(tab.dataset.type) || 0;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        const suffix = tab.dataset.type === query.type || query.type === 'all' ? ` ${count}` : '';
        tab.textContent = `${SEARCH_GROUPS.find((group) => group.key === tab.dataset.type)?.title || '全部'}${suffix}`;
    });
}

function renderSearchSkeleton() {
    return `
        <div class="search-page-skeleton">
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
        </div>
    `;
}

function readSearchQuery(queryParams) {
    const params = queryParams instanceof URLSearchParams ? queryParams : new URLSearchParams();
    const q = (params.get('q') || '').trim();
    const rawType = params.get('type') || 'all';
    const type = SEARCH_GROUPS.some((group) => group.key === rawType) ? rawType : 'all';
    const rawSort = params.get('sort') || 'relevance';
    const sort = FILTER_OPTIONS.sort.some((item) => item.value === rawSort) ? rawSort : 'relevance';
    const rawYear = params.get('year') || 'all';
    const year = FILTER_OPTIONS.year.some((item) => item.value === rawYear) ? rawYear : 'all';
    const rawRegion = params.get('region') || 'all';
    const region = FILTER_OPTIONS.region.some((item) => item.value === rawRegion) ? rawRegion : 'all';
    const page = Math.min(10, Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1));
    return { q, type, sort, year, region, page };
}

function searchHref({ q, type = 'all', sort = 'relevance', year = 'all', region = 'all', page = 1 }) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type && type !== 'all') params.set('type', type);
    if (sort && sort !== 'relevance') params.set('sort', sort);
    if (year && year !== 'all') params.set('year', year);
    if (region && region !== 'all') params.set('region', region);
    if (Number(page) > 1) params.set('page', String(page));
    return `#/search${params.toString() ? `?${params}` : ''}`;
}

function renderSearchSelect(id, label, value, options) {
    return `
        <label class="search-page-filter">
            <span class="sr-only">${esc(label)}</span>
            <select class="search-page-select" id="search-page-${esc(id)}" aria-label="${esc(label)}">
                ${options.map((item) => `
                    <option value="${esc(item.value)}" ${item.value === value ? 'selected' : ''}>${esc(item.label)}</option>
                `).join('')}
            </select>
        </label>
    `;
}

function hasActiveRefinements(query) {
    return query.sort !== 'relevance' || query.year !== 'all' || query.region !== 'all';
}

function activeRefinementText(query) {
    const parts = [];
    if (query.sort !== 'relevance') parts.push(labelFor(FILTER_OPTIONS.sort, query.sort));
    if (query.year !== 'all') parts.push(labelFor(FILTER_OPTIONS.year, query.year));
    if (query.region !== 'all') parts.push(labelFor(FILTER_OPTIONS.region, query.region));
    return parts.length ? `，${parts.join(' · ')}` : '';
}

function labelFor(options, value) {
    return options.find((item) => item.value === value)?.label || value;
}

function yearParam(value) {
    if (value === '2020s') return '2020';
    if (value === '2010s') return '2010';
    return value === 'all' ? undefined : value;
}

function sortSearchItems(items, sort) {
    const list = [...items];
    if (sort === 'rating') {
        return list.sort((a, b) => Number(b.imdbRating || 0) - Number(a.imdbRating || 0));
    }
    if (sort === 'year') {
        return list.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    }
    return list;
}

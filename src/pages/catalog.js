// 分类页 - 无限滚动 + 本地筛选排序 + 错误重试 + 空状态

import { getCatalog } from '../services/api.js';
import { esc, loadCSS } from '../core/html.js';
import { pageHeaderHTML } from '../components/page-header.js';
import '../components/poster-grid.js';

const CATALOG_MAP = {
    movie: { type: 'movie', id: 'guangying-movie', title: '电影' },
    tv: { type: 'series', id: 'guangying-tv', title: '剧集' },
    anime: { type: 'series', id: 'guangying-anime', title: '动漫' },
};

export async function render(container, params) {
    // 不走 View Transition 的页面：在替换内容前同步归零滚动（与 innerHTML 同一任务，无中间帧）
    container.scrollTop = 0;
    const catalog = CATALOG_MAP[params.category];
    if (!catalog) { container.innerHTML = '<div class="page-empty">未知分类</div>'; return; }

    await loadCSS('styles/layout.css');

    container.innerHTML = `
        <section class="catalog-section">
            ${pageHeaderHTML({
                eyebrow: '片库',
                title: catalog.title,
                description: '自动加载更多内容，支持已加载内容内快速筛选与排序。',
                actions: `
                    <a class="page-secondary-action" href="#/history">继续观看</a>
                    <button class="page-primary-action" id="catalog-refresh" type="button">刷新</button>
                `,
            })}
            <div class="catalog-toolbar" role="search">
                <label class="catalog-filter">
                    <span>筛选</span>
                    <input id="catalog-filter" type="search" placeholder="输入片名或年份" autocomplete="off">
                </label>
                <label class="catalog-sort">
                    <span>排序</span>
                    <select id="catalog-sort">
                        <option value="default">默认推荐</option>
                        <option value="year-desc">年份最新</option>
                        <option value="name-asc">片名 A-Z</option>
                    </select>
                </label>
                <div class="catalog-summary" id="catalog-summary">正在加载</div>
            </div>
            <poster-grid id="catalog-grid"></poster-grid>
            <div class="catalog-status" id="status"></div>
        </section>
    `;

    const grid = container.querySelector('#catalog-grid');
    const status = container.querySelector('#status');
    const filterInput = container.querySelector('#catalog-filter');
    const sortSelect = container.querySelector('#catalog-sort');
    const summary = container.querySelector('#catalog-summary');
    const refresh = container.querySelector('#catalog-refresh');
    grid.showSkeleton(16);

    let skip = 0;
    let loading = false;
    let ended = false;
    let itemsAll = [];
    const seen = new Set(); // 去重，防后端分页错位重复渲染

    const setStatus = (html) => { status.innerHTML = html; };
    const setSummary = () => {
        const shown = getVisibleItems().length;
        summary.textContent = ended
            ? `已显示 ${shown} / 已加载 ${itemsAll.length}`
            : `已加载 ${itemsAll.length}`;
    };

    const getVisibleItems = () => {
        const keyword = filterInput.value.trim().toLowerCase();
        const sorter = sortSelect.value;
        let visible = keyword
            ? itemsAll.filter((it) => `${it.name || ''} ${it.year || ''}`.toLowerCase().includes(keyword))
            : [...itemsAll];

        if (sorter === 'year-desc') {
            visible.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
        } else if (sorter === 'name-asc') {
            visible.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
        }
        return visible;
    };

    const renderVisible = () => {
        const visible = getVisibleItems();
        grid.render(visible, catalog.type);
        setSummary();
        if (itemsAll.length > 0 && visible.length === 0) {
            setStatus(`<div class="page-empty">没有匹配「${esc(filterInput.value.trim())}」的内容</div>`);
        } else if (ended) {
            setStatus('<div class="load-end">没有更多了</div>');
        } else {
            setStatus('');
        }
    };

    async function loadPage() {
        if (loading || ended) return;
        loading = true;
        if (skip > 0) setStatus('<div class="spinner-small"></div>');

        try {
            const items = await getCatalog(catalog.type, catalog.id, { skip: skip > 0 ? skip : undefined });

            // 第一页空 → 空状态
            if (skip === 0 && items.length === 0) {
                grid.render([], catalog.type);
                setStatus('<div class="page-empty">暂无内容</div>');
                summary.textContent = '暂无内容';
                ended = true;
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
        } catch {
            // 真·重试按钮
            setStatus('<div class="page-error">加载失败 <button class="retry-btn" id="retry">重试</button></div>');
            status.querySelector('#retry')?.addEventListener('click', () => {
                setStatus('');
                loadPage();
            });
        } finally {
            loading = false;
        }
    }

    await loadPage();

    filterInput.addEventListener('input', renderVisible);
    sortSelect.addEventListener('change', renderVisible);
    refresh.addEventListener('click', () => {
        skip = 0;
        ended = false;
        itemsAll = [];
        seen.clear();
        filterInput.value = '';
        sortSelect.value = 'default';
        grid.showSkeleton(16);
        setSummary();
        loadPage();
    });

    // 无限滚动（#app 是滚动容器）
    const app = document.getElementById('app');
    let ticking = false;
    const onScroll = () => {
        if (ended || loading || ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            if (app.scrollHeight - app.scrollTop - app.clientHeight < 400) loadPage();
            ticking = false;
        });
    };
    app.addEventListener('scroll', onScroll, { passive: true });

    return () => app.removeEventListener('scroll', onScroll);
}

// TODO: 下一轮将分类筛选同步到 URL，支持分享带筛选条件的片库链接。

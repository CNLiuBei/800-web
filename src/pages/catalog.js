// 分类页 - 无限滚动 + 错误重试 + 空状态

import { getCatalog } from '../services/api.js';
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

    container.innerHTML = `
        <section class="catalog-section">
            <h2 class="section-title">${catalog.title}</h2>
            <poster-grid id="catalog-grid"></poster-grid>
            <div class="catalog-status" id="status"></div>
        </section>
    `;

    const grid = container.querySelector('#catalog-grid');
    const status = container.querySelector('#status');
    grid.showSkeleton(16);

    let skip = 0;
    let loading = false;
    let ended = false;
    const seen = new Set(); // 去重，防后端分页错位重复渲染

    const setStatus = (html) => { status.innerHTML = html; };

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
                ended = true;
                return;
            }

            // 去重后追加
            const fresh = items.filter((it) => !seen.has(it.id));
            fresh.forEach((it) => seen.add(it.id));

            if (skip === 0) grid.render(fresh, catalog.type);
            else if (fresh.length) grid.append(fresh, catalog.type);

            skip += items.length;

            // 后端返回不足一页（20）或本页无新内容 → 到底
            if (items.length < 20 || fresh.length === 0) {
                ended = true;
                setStatus(skip > 0 ? '<div class="load-end">没有更多了</div>' : '');
            } else {
                setStatus('');
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

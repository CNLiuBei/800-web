// 收藏页

import { favorites, removeFavorite } from '../services/library.js';
import { onLongPress } from '../core/html.js';
import '../components/poster-grid.js';

export function render(container) {
    const items = favorites.value;

    if (items.length === 0) {
        container.innerHTML = emptyState(
            '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
            '还没有收藏内容',
            '去首页发现喜欢的影片'
        );
        return;
    }

    container.innerHTML = `
        <section class="catalog-section">
            <div class="list-head">
                <h2 class="section-title">我的收藏</h2>
                <span class="list-count">${items.length}</span>
            </div>
            <poster-grid id="fav-grid"></poster-grid>
        </section>
    `;

    const grid = container.querySelector('#fav-grid');
    grid.render(items, 'movie'); // 每项自带 type，混合列表也正确
    enableRemove(grid, container, (id) => { removeFavorite(id); });
}

// 长按（移动端）/ 右键（桌面）删除单项
function enableRemove(grid, container, onRemove) {
    grid.querySelectorAll('.poster-item').forEach((el) => {
        onLongPress(el, () => {
            if (confirm('从收藏中移除？')) {
                onRemove(el.dataset.id);
                render(container);
            }
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

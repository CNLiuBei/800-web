// 历史记录页

import { history, clearHistory, removeHistory } from '../services/library.js';
import { emptyState } from './favorites.js';
import { onLongPress } from '../core/html.js';
import '../components/poster-grid.js';

export function render(container) {
    const items = history.value;

    if (items.length === 0) {
        container.innerHTML = emptyState(
            '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
            '还没有观看记录',
            '去首页开始观看'
        );
        return;
    }

    container.innerHTML = `
        <section class="catalog-section">
            <div class="list-head">
                <div class="list-head-left">
                    <h2 class="section-title">观看历史</h2>
                    <span class="list-count">${items.length}</span>
                </div>
                <button class="clear-history-btn" id="clear-history">清空</button>
            </div>
            <poster-grid id="history-grid"></poster-grid>
        </section>
    `;

    const grid = container.querySelector('#history-grid');
    grid.render(items, 'movie'); // 每项自带 type

    // 单项删除（长按 / 右键）
    grid.querySelectorAll('.poster-item').forEach((el) => {
        onLongPress(el, () => {
            if (confirm('删除这条记录？')) {
                removeHistory(el.dataset.id);
                render(container);
            }
        });
    });

    container.querySelector('#clear-history').addEventListener('click', () => {
        if (confirm('确定清空所有观看记录？')) {
            clearHistory();
            render(container);
        }
    });
}

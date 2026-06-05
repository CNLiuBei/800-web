// 历史记录页

import { history, clearHistory, removeHistory } from '../services/library.js';
import { emptyState } from './favorites.js';
import { loadCSS, onLongPress } from '../core/html.js';
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
                description: '长按或右键单个海报可以删除记录。',
                actions: '<button class="page-secondary-action" id="clear-history" type="button">清空记录</button>',
                meta: `<span class="list-count">${items.length}</span>`,
            })}
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

// TODO: 下一轮按最近观看时间分组展示历史记录。

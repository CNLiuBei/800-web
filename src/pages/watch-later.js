// 稍后看页面

import { getResumeProgress, watchLater, removeWatchLater, restoreWatchLater } from '../services/library.js';
import { playbackStatusKey, playbackStatusLabel } from '../services/playback-progress.js';
import { bindLibraryTools, emptyState, libraryToolbarHTML } from './favorites.js';
import { loadCSS } from '../core/html.js';
import { pageHeaderHTML } from '../components/page-header.js';
import '../components/poster-grid.js';

export async function render(container) {
    await loadCSS('styles/layout.css');
    const items = watchLater.value;

    if (items.length === 0) {
        container.innerHTML = `
            ${pageHeaderHTML({
                eyebrow: '稍后看',
                title: '待看片单',
                description: '浏览时先加入稍后看，之后再集中选择播放。',
                actions: '<a class="page-primary-action" href="#/">去发现</a>',
            })}
            ${emptyState(
                '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
                '稍后看还是空的',
                '去首页添加内容'
            )}
        `;
        return;
    }

    container.innerHTML = `
        <section class="catalog-section">
            ${pageHeaderHTML({
                eyebrow: '稍后看',
                title: '待看片单',
                description: '按类型和观看状态筛出内容，未开始与续播中一眼可见。',
                actions: '<a class="page-secondary-action" href="#/history">观看历史</a>',
                meta: `<span class="list-count">${items.length}</span>`,
            })}
            ${libraryToolbarHTML('watch-later', { statusFilter: true })}
            <poster-grid id="watch-later-grid"></poster-grid>
            <div class="catalog-status" id="watch-later-status"></div>
        </section>
    `;

    const grid = container.querySelector('#watch-later-grid');
    bindLibraryTools(container, items, grid, 'watch-later', {
        emptyText: '没有匹配的待看内容',
        removeConfirm: '从稍后看移除？',
        removeLabel: '移除',
        onRemove: (id) => { removeWatchLater(id); },
        onUndo: (item) => { restoreWatchLater(item); },
        undoText: '已从稍后看移除',
        enrichItem: enrichWatchLaterItem,
        rerender: () => render(container),
    });
}

function enrichWatchLaterItem(item) {
    const state = watchLaterPlaybackState(item);
    const parts = [
        item.episodeLabel || item.episodeTitle || item.year || '',
        state.label,
        addedAtText(item.addedAt),
    ].filter(Boolean);
    return {
        ...item,
        subtitle: parts.join(' · '),
    };
}

function watchLaterPlaybackState(item) {
    const resume = getResumeProgress({
        id: item.id,
        videoId: item.videoId,
        movieId: item.movieId,
        episodeId: item.episodeId,
    });
    const merged = resume
        ? { ...item, progress: resume.progress, duration: resume.duration, percent: resume.percent }
        : item;
    return {
        key: playbackStatusKey(merged),
        label: playbackStatusLabel(merged),
    };
}

function addedAtText(value) {
    const time = Number(value || 0);
    if (!Number.isFinite(time) || time <= 0) return '';
    const diff = Date.now() - time;
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) return '今天加入';
    if (diff < 2 * day) return '昨天加入';
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前加入`;
    return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' 加入';
}

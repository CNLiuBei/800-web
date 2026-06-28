// 海报网格组件 - 预加载、续播进度、图片淡入、XSS 安全

import { preload } from '../services/api.js';
import { esc } from '../core/html.js';
import { showSiteNotice } from '../services/site-notice.js';
import { bindTmdbImageFallback } from '../services/media-images.js';
import { getResumeProgress, isWatchLater, toggleWatchLater } from '../services/library.js';

// 1x1 透明占位（图片加载失败时的兜底，避免破图）
const FALLBACK = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%23222"/%3E%3C/svg%3E';

class PosterGrid extends HTMLElement {
    connectedCallback() {
        this.classList.add('poster-grid');
    }

    disconnectedCallback() {
        this._preloadObserver?.disconnect();
        this._preloadObserver = null;
    }

    /**
     * 渲染海报列表
     * @param {Array} items 影片项
     * @param {string} type movie | series
     * @param {Object} [opts] { layout: 'grid' | 'row' } 默认 grid（换行网格）
     */
    render(items, type, opts = {}) {
        this._preloadObserver?.disconnect();
        this._preloadObserver = null;
        this.classList.toggle('poster-row', opts.layout === 'row');
        this.innerHTML = items.map((item) => this._itemHtml(item, type, opts)).join('');
        this._itemsById = buildItemMap(items, type);
        this._setupPreload();
        this._setupImages();
        this._setupQuickActions();
    }

    append(items, type, opts = {}) {
        this.insertAdjacentHTML('beforeend', items.map((item) => this._itemHtml(item, type, opts)).join(''));
        this._itemsById = new Map([...(this._itemsById || new Map()), ...buildItemMap(items, type)]);
        this._setupPreload();
        this._setupImages();
        this._setupQuickActions();
    }

    /** 单个海报项 HTML（全部字段转义，防 XSS） */
    _itemHtml(item, type, opts = {}) {
        const id = esc(item.id);
        const name = esc(item.name);
        const poster = esc(item.poster || '');
        // 优先用项自身的 type（收藏/历史是电影+剧集混合列表），回退到传入的统一 type
        const itemType = esc(item.type || type);
        const typeLabel = itemType === 'movie' ? '电影' : itemType === 'creator' ? '创作' : '剧集';
        const subtitle = item.subtitle || item.episodeLabel || item.year || '';
        const subtitleText = subtitle ? esc(String(subtitle)) : '';
        const playbackKey = esc(item.playbackKey || '');
        const actionLabel = opts.removeLabel ? esc(opts.removeLabel) : '';
        const actionTitle = actionLabel ? `${actionLabel}：${name}` : '';
        const quickLater = opts.quickWatchLater !== false && !actionLabel;
        const laterActive = quickLater && isWatchLater(item.id);
        const laterLabel = laterActive ? '移出稍后看' : '稍后看';
        const playback = opts.showResume === false ? null : getPosterPlayback(item);
        let progressBar = '';
        let progressLabel = '';
        let resumePercent = 0;
        let playbackClass = '';
        if (playback?.kind === 'watching' && playback.percent > 0) {
            resumePercent = Math.min(99, Math.max(1, Math.round(playback.percent)));
            progressBar = `<div class="poster-progress"><div class="poster-progress-bar" style="width:${resumePercent}%"></div></div>`;
            progressLabel = `<div class="poster-progress-label">${esc(playback.label)}</div>`;
            playbackClass = 'has-resume';
        }
        const resumeVideoId = playback?.kind === 'watching' && playback.videoId ? `/${esc(playback.videoId)}` : '';
        const href = playback?.kind === 'watching'
            ? `#/play/${itemType}/${id}${resumeVideoId}`
            : `#/detail/${itemType}/${id}`;
        const itemAria = playback?.kind === 'watching' && resumePercent > 0
            ? `继续观看：${name}，${playback.label}`
            : `查看：${name}`;
        return `
            <a href="${href}" class="poster-item ${playbackClass}" data-id="${id}" data-type="${itemType}" data-playback-key="${playbackKey}" aria-label="${esc(itemAria)}">
                <div class="poster-img-wrap">
                    <img class="poster-img" src="${poster}" alt="${name}" loading="lazy" decoding="async">
                    <div class="poster-badge">${typeLabel}</div>
                    ${progressLabel}
                    ${progressBar}
                    ${quickLater ? quickLaterHTML({ active: laterActive, label: laterLabel, name }) : ''}
                    ${actionLabel ? `<span class="poster-card-action" role="button" tabindex="0" aria-label="${actionTitle}" title="${actionTitle}" data-action="remove">${actionLabel}</span>` : ''}
                </div>
                <div class="poster-title">${name}</div>
                ${subtitleText ? `<div class="poster-subtitle">${subtitleText}</div>` : ''}
            </a>
        `;
    }

    /** 图片淡入 + 失败兜底 */
    _setupImages() {
        this.querySelectorAll('.poster-img:not([data-bound])').forEach((img) => {
            img.dataset.bound = '1';
            const done = () => img.classList.add('loaded');
            if (img.complete && img.naturalWidth > 0) done();
            else img.addEventListener('load', done, { once: true });

            bindTmdbImageFallback(img, () => {
                img.src = FALLBACK;
                img.classList.add('loaded', 'poster-img-failed');
            });
        });
    }

    _setupQuickActions() {
        this.querySelectorAll('[data-action="watch-later"]:not([data-bound])').forEach((el) => {
            el.dataset.bound = '1';
            const toggle = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const card = el.closest('.poster-item');
                const item = this._itemsById?.get(card?.dataset.id);
                if (!item) return;
                const added = toggleWatchLater(item);
                updateQuickLaterButton(el, item.name, added);
                showPosterToast(added ? '已加入稍后看' : '已移出稍后看', {
                    label: '撤销',
                    onClick: () => {
                        const restored = toggleWatchLater(item);
                        updateQuickLaterButton(el, item.name, restored);
                    },
                    secondary: added ? { label: '查看片单', href: '#/watch-later' } : null,
                });
            };
            el.addEventListener('click', toggle);
            el.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') toggle(event);
            });
        });
    }

    /** 接近视口、鼠标悬浮或触摸按下时预取详情数据 */
    _setupPreload() {
        this.querySelectorAll('.poster-item:not([data-preload])').forEach((itemElement) => {
            itemElement.dataset.preload = '1';
            const fire = () => this._preloadItem(itemElement);
            itemElement.addEventListener('mouseenter', fire, { once: true });
            itemElement.addEventListener('pointerdown', fire, { once: true });
            this._getPreloadObserver().observe(itemElement);
        });
    }

    _getPreloadObserver() {
        if (this._preloadObserver) return this._preloadObserver;
        if (!('IntersectionObserver' in window)) {
            return {
                observe: (itemElement) => {
                    window.requestIdleCallback?.(() => this._preloadItem(itemElement), { timeout: 1600 }) ||
                        setTimeout(() => this._preloadItem(itemElement), 600);
                },
                disconnect: () => {},
                unobserve: () => {},
            };
        }
        this._preloadObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const itemElement = entry.target;
                this._preloadObserver?.unobserve(itemElement);
                this._preloadItem(itemElement);
            });
        }, {
            root: null,
            rootMargin: '360px 180px',
            threshold: 0.01,
        });
        return this._preloadObserver;
    }

    _preloadItem(itemElement) {
        if (!itemElement?.dataset || itemElement.dataset.preloaded === '1') return;
        itemElement.dataset.preloaded = '1';
        preload(itemElement.dataset.type, itemElement.dataset.id);
    }

    showSkeleton(count = 8, opts = {}) {
        this.classList.toggle('poster-row', opts.layout === 'row');
        this.innerHTML = Array(count).fill(
            '<div class="poster-item"><div class="poster-img-wrap"><div class="poster-img skeleton"></div></div></div>'
        ).join('');
    }
}

function getPosterPlayback(item) {
    const resume = getResumeProgress({
        id: item.id,
        videoId: item.videoId,
        movieId: item.movieId,
        episodeId: item.episodeId,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
    });
    if (!resume) return null;
    const percent = Math.round(resume.percent);
    const videoId = item.videoId || resume.entry?.videoId || '';
    return {
        kind: 'watching',
        label: `续播中 ${percent}%`,
        percent,
        progress: resume.progress,
        videoId,
    };
}

function buildItemMap(items, type) {
    const map = new Map();
    items.forEach((item) => {
        if (!item?.id) return;
        map.set(String(item.id), {
            ...item,
            id: item.id,
            type: item.type || type,
            name: item.name,
            poster: item.poster,
            year: item.year,
            movieId: item.movieId,
        });
    });
    return map;
}

function quickLaterHTML({ active, label, name }) {
    return `
        <span class="poster-quick-later ${active ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${active ? 'true' : 'false'}" aria-label="${esc(label)}：${name}" title="${esc(label)}" data-action="watch-later">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </span>
    `;
}

function updateQuickLaterButton(el, name, active) {
    const label = active ? '移出稍后看' : '稍后看';
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
    el.setAttribute('aria-label', `${label}：${name || ''}`);
    el.setAttribute('title', label);
}

function showPosterToast(message, action = null) {
    const options = { duration: 3600 };
    if (action?.onClick) {
        options.action = { label: action.label || '撤销', onClick: action.onClick };
    } else if (action?.href) {
        options.action = { label: action.label, href: action.href };
    }
    if (action?.secondary?.href) {
        options.secondaryAction = { label: action.secondary.label, href: action.secondary.href };
    }
    showSiteNotice(message, options);
}

customElements.define('poster-grid', PosterGrid);
export default PosterGrid;

// TODO: 下一轮为大屏电视焦点态增加方向键可见焦点环。

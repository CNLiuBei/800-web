// 海报网格组件 - 预加载、续播进度、图片淡入、XSS 安全

import { preload } from '../services/api.js';
import { esc } from '../core/html.js';

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
        this.innerHTML = items.map((item) => this._itemHtml(item, type)).join('');
        this._setupPreload();
        this._setupImages();
    }

    append(items, type) {
        this.insertAdjacentHTML('beforeend', items.map((item) => this._itemHtml(item, type)).join(''));
        this._setupPreload();
        this._setupImages();
    }

    /** 单个海报项 HTML（全部字段转义，防 XSS） */
    _itemHtml(item, type) {
        const id = esc(item.id);
        const name = esc(item.name);
        const poster = esc(item.poster || '');
        // 优先用项自身的 type（收藏/历史是电影+剧集混合列表），回退到传入的统一 type
        const itemType = esc(item.type || type);
        const typeLabel = itemType === 'movie' ? '电影' : '剧集';
        const year = item.year ? esc(String(item.year)) : '';
        // 续播进度（继续观看场景）：progress/duration 有值时显示底部进度条
        let progressBar = '';
        if (item.progress > 0 && item.duration > 0) {
            const pct = Math.min(100, Math.round((item.progress / item.duration) * 100));
            progressBar = `<div class="poster-progress"><div class="poster-progress-bar" style="width:${pct}%"></div></div>`;
        }
        // 继续观看直接跳播放页，否则进详情页
        const href = item.videoId
            ? `#/play/${itemType}/${id}/${esc(item.videoId)}`
            : `#/detail/${itemType}/${id}`;
        return `
            <a href="${href}" class="poster-item" data-id="${id}" data-type="${itemType}">
                <div class="poster-img-wrap">
                    <img class="poster-img" src="${poster}" alt="${name}" loading="lazy" decoding="async">
                    <div class="poster-badge">${typeLabel}</div>
                    ${progressBar}
                </div>
                <div class="poster-title">${name}</div>
                ${year ? `<div class="poster-subtitle">${year}</div>` : ''}
            </a>
        `;
    }

    /** 图片淡入 + 失败兜底 */
    _setupImages() {
        this.querySelectorAll('.poster-img:not([data-bound])').forEach((img) => {
            img.dataset.bound = '1';
            const done = () => img.classList.add('loaded');
            if (img.complete && img.naturalWidth > 0) done();
            else {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', () => {
                    img.src = FALLBACK;
                    img.classList.add('loaded', 'poster-img-failed');
                }, { once: true });
            }
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

customElements.define('poster-grid', PosterGrid);
export default PosterGrid;

// TODO: 下一轮为大屏电视焦点态增加方向键可见焦点环。

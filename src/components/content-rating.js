import { user } from '../services/auth.js';
import { showSiteNotice } from '../services/site-notice.js';
import { API_V1_BASE } from '../services/config.js';

class ContentRating extends HTMLElement {
    connectedCallback() {
        this._movieId = Number(this.getAttribute('movie-id'));
        this._tmdbId = Number(this.getAttribute('tmdb-id'));
        this._mediaType = this.getAttribute('media-type') === 'movie' ? 'movie' : this.getAttribute('media-type') === 'tv' ? 'tv' : '';
        this._state = { average: 0, count: 0, myScore: null };
        this._loading = true;
        this._submitting = false;
        this._previewScore = null;
        this._render();
        this._load();
    }

    _displayScore() {
        return this._previewScore ?? this._state.myScore ?? 0;
    }

    _render() {
        const score = this._state.myScore || 0;
        const displayScore = this._displayScore();
        const disabled = this._loading || this._submitting;
        this.innerHTML = `
            <section class="content-rating ${this._loading ? 'is-loading' : ''} ${this._submitting ? 'is-submitting' : ''}" aria-label="内容评分">
                <div class="content-rating-summary">
                    <div class="content-rating-kicker">社区评分</div>
                    <div class="content-rating-score">
                        <strong>${this._loading ? '...' : (this._state.average ? Number(this._state.average).toFixed(1) : '暂无')}</strong>
                        <span>${this._loading ? '正在读取评分' : (this._state.count ? `${formatCount(this._state.count)} 人评分` : '成为第一个评分的人')}</span>
                    </div>
                </div>
                <div class="content-rating-actions" role="radiogroup" aria-label="我的评分">
                    ${[1, 2, 3, 4, 5].map((star) => {
                        const value = star * 2;
                        const lit = displayScore >= value;
                        return `
                            <button class="rating-star ${lit ? 'active' : ''} ${this._previewScore === value ? 'preview' : ''}" type="button" data-score="${value}" aria-checked="${score === value ? 'true' : 'false'}" role="radio" title="${value} 分" ${disabled ? 'disabled' : ''}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                            </button>
                        `;
                    }).join('')}
                    <span class="content-rating-mine">${this._submitting ? '正在保存...' : (displayScore ? `我的评分 ${displayScore}` : (user.value ? '点星评分' : '登录后评分'))}</span>
                </div>
                <div class="content-rating-hint hidden"></div>
            </section>
        `;

        const actions = this.querySelector('.content-rating-actions');
        actions?.addEventListener('mouseleave', () => {
            if (this._previewScore == null) return;
            this._previewScore = null;
            this._updateStarHighlight();
        });

        this.querySelectorAll('.rating-star').forEach((btn) => {
            const value = Number(btn.dataset.score);
            btn.addEventListener('click', () => this._rate(value));
            btn.addEventListener('mouseenter', () => {
                if (disabled) return;
                this._previewScore = value;
                this._updateStarHighlight();
            });
        });
    }

    _updateStarHighlight() {
        const displayScore = this._displayScore();
        this.querySelectorAll('.rating-star').forEach((btn) => {
            const value = Number(btn.dataset.score);
            btn.classList.toggle('active', displayScore >= value);
            btn.classList.toggle('preview', this._previewScore === value);
        });
        const mine = this.querySelector('.content-rating-mine');
        if (!mine || this._submitting) return;
        mine.textContent = displayScore
            ? `我的评分 ${displayScore}`
            : (user.value ? '点星评分' : '登录后评分');
    }

    async _load() {
        const query = ratingQuery(this._tmdbId, this._mediaType, this._movieId);
        if (!query) {
            this._loading = false;
            this._render();
            this._setHint('暂无评分数据');
            return;
        }
        try {
            const res = await fetchApi(`/ratings?${query}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this._state = await res.json();
            this._emitChange();
            this._loading = false;
            this._render();
        } catch {
            this._loading = false;
            this._render();
            this._setHint('评分暂时不可用');
        }
    }

    async _rate(score) {
        if (this._submitting || this._loading) return;
        if (!user.value) {
            const { openAuthModal } = await import('../services/auth-modal-loader.js');
            const modal = await openAuthModal('login');
            modal?.addEventListener('authenticated', () => this._rate(score), { once: true });
            this._setHint('登录后即可保存评分');
            return;
        }
        const previous = { ...this._state };
        this._previewScore = null;
        this._state.myScore = score;
        this._submitting = true;
        this._render();
        try {
            const target = ratingBody(this._tmdbId, this._mediaType, this._movieId);
            const res = await fetchApi('/ratings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...target, score }),
            });
            if (res.status === 401) {
                const { openAuthModal } = await import('../services/auth-modal-loader.js');
                const modal = await openAuthModal('login');
                modal?.addEventListener('authenticated', () => this._rate(score), { once: true });
                throw new Error('请重新登录后评分');
            }
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.message || `HTTP ${res.status}`);
            }
            this._state = await res.json();
            this._submitting = false;
            this._render();
            this._emitChange();
            this._setHint('评分已保存');
        } catch (error) {
            this._state = previous;
            this._submitting = false;
            this._render();
            this._setHint(error.message || '评分失败，请稍后再试');
        }
    }

    _emitChange() {
        this.dispatchEvent(new CustomEvent('content-rating-change', {
            bubbles: true,
            composed: true,
            detail: { ...this._state },
        }));
    }

    _setHint(text) {
        const inlineOnly = !text || /^(正在读取|正在)/.test(text);
        if (text && !inlineOnly) {
            let tone = 'info';
            if (/失败|不可用|重新登录|请/.test(text)) tone = 'error';
            else if (/已保存|成功/.test(text)) tone = 'success';
            showSiteNotice(text, { tone, id: 'rating-notice' });
        }
        const hint = this.querySelector('.content-rating-hint');
        if (!hint) return;
        hint.textContent = inlineOnly ? (text || '') : '';
        hint.classList.toggle('hidden', !inlineOnly || !text);
        if (inlineOnly && text) {
            setTimeout(() => {
                if (hint.textContent === text) hint.classList.add('hidden');
            }, 1800);
        }
    }
}

function ratingQuery(tmdbId, mediaType, movieId) {
    if (Number.isInteger(tmdbId) && tmdbId > 0 && mediaType) {
        const params = new URLSearchParams({ tmdbId: String(tmdbId), mediaType });
        return params.toString();
    }
    if (Number.isInteger(movieId) && movieId > 0) return `movieId=${encodeURIComponent(movieId)}`;
    return '';
}

function ratingBody(tmdbId, mediaType, movieId) {
    if (Number.isInteger(tmdbId) && tmdbId > 0 && mediaType) return { tmdbId, mediaType };
    return { movieId };
}

function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
    return String(count);
}

function apiUrls(path) {
    return [`${API_V1_BASE}${path}`];
}

async function fetchApi(path, options = {}) {
    const urls = apiUrls(path);
    let firstResponse = null;
    for (const url of urls) {
        const res = await fetch(url, {
            credentials: 'include',
            ...options,
        });
        if (!firstResponse) firstResponse = res;
        if (res.status !== 404 || url === urls[urls.length - 1]) return res;
    }
    return firstResponse;
}

customElements.define('content-rating', ContentRating);
export default ContentRating;

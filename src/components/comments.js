// 评论组件

import { user } from '../services/auth.js';
import { effect } from '../core/signal.js';
import { esc } from '../core/html.js';
import { showSiteNotice } from '../services/site-notice.js';
import { API_V1_BASE } from '../services/config.js';

const REPORT_REASONS = [
    ['spam', '垃圾广告'],
    ['abuse', '辱骂攻击'],
    ['spoiler', '剧透'],
    ['illegal', '违规'],
    ['other', '其他'],
];
const COMMENT_DRAFT_PREFIX = 'gy_comment_draft:';

class CommentSection extends HTMLElement {
    connectedCallback() {
        this._videoId = this.getAttribute('video-id') || '';
        this._comments = [];
        this._page = 1;
        this._loading = false;
        this._ended = false;
        this._submitting = false;
        this._sort = 'latest';
        this._canFeature = false;
        this._reportMenuCleanup = null;
        this._destroyed = false;
        this._render();
        this._userEffectCleanup = effect(() => {
            if (this._destroyed) return;
            this._syncAuthState(!!user.value);
        });
        this._loadComments();
    }

    disconnectedCallback() {
        this._destroyed = true;
        this._userEffectCleanup?.();
        this._closeReportMenus();
    }

    _render() {
        const draft = this._loadDraft();
        this.innerHTML = `
            <div class="comments-section">
                <div class="comments-head">
                    <h3 class="comments-title">评论</h3>
                    <span class="comments-count" id="comments-count"></span>
                    <div class="comments-tools" aria-label="评论工具">
                        <div class="comments-sort" role="tablist" aria-label="评论排序">
                            <button class="comments-sort-btn active" type="button" role="tab" aria-selected="true" data-sort="latest">最新</button>
                            <button class="comments-sort-btn" type="button" role="tab" aria-selected="false" data-sort="hot">最热</button>
                        </div>
                        <button class="comments-refresh" id="refresh-comments" type="button">刷新</button>
                    </div>
                </div>
                <div class="comment-compose-card${user.value ? '' : ' is-guest'}" id="comment-compose-card">
                    <div class="comment-compose-body">
                        <label class="sr-only" for="comment-input">评论内容</label>
                        <textarea class="comment-input" id="comment-input" placeholder="${user.value ? '写下你的评论…' : '可以先写下想法，登录后一键发送'}" rows="2" maxlength="1000" enterkeyhint="send">${esc(draft)}</textarea>
                    </div>
                    <div class="comment-compose-footer">
                        <div class="comment-compose-meta">
                            <span class="comment-draft-state hidden" id="comment-draft-state"></span>
                            <span class="comment-counter" id="comment-counter">0/1000</span>
                        </div>
                        <div class="comment-compose-buttons">
                            <button class="comment-clear-draft hidden" id="comment-clear-draft" type="button">清空</button>
                            <button class="comment-submit" id="comment-submit" type="button">发送</button>
                        </div>
                    </div>
                    <div class="comment-guest-bar${user.value ? ' hidden' : ''}" id="comment-guest-bar">
                        <p class="comment-guest-text">登录后可发表评论、点赞与举报</p>
                        <button type="button" class="comment-login-btn" id="comment-login-btn">登录 / 注册</button>
                    </div>
                    <details class="comment-guidelines" id="comment-guidelines">
                        <summary class="comment-guidelines-summary">
                            <span class="comment-guidelines-label">社区准则</span>
                            <span class="comment-guidelines-teaser">友善讨论，避免剧透与人身攻击</span>
                        </summary>
                        <p class="comment-guidelines-text">友善讨论，避免剧透、人身攻击和广告刷屏。被多人举报的评论会自动折叠并进入审核队列。</p>
                    </details>
                </div>
                <div class="comment-hint" id="comment-hint" role="status" aria-live="polite">正在加载评论...</div>
                <button class="comments-retry hidden" id="retry-comments" type="button">重新加载</button>
                <div class="comments-list" id="comments-list"></div>
                <button class="comments-load-more hidden" id="load-more-comments">加载更多</button>
            </div>
        `;

        this.querySelector('#comment-submit').addEventListener('click', () => this._submit());
        this.querySelector('#comment-login-btn')?.addEventListener('click', () => this._openLogin());
        this.querySelector('#comment-clear-draft').addEventListener('click', () => this._clearDraft());
        const input = this.querySelector('#comment-input');
        input.addEventListener('input', () => this._updateComposerState());
        input.addEventListener('focus', () => this._scrollComposerIntoView());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
        });
        this.querySelector('#load-more-comments').addEventListener('click', () => this._loadComments());
        this.querySelector('#retry-comments').addEventListener('click', () => this._retryLoad());
        this.querySelector('#refresh-comments').addEventListener('click', () => this._refreshComments());
        this.querySelectorAll('.comments-sort-btn').forEach((btn) => {
            btn.addEventListener('click', () => this._setSort(btn.dataset.sort || 'latest'));
        });
        const guidelines = this.querySelector('#comment-guidelines');
        if (guidelines && !window.matchMedia('(max-width: 640px)').matches) {
            guidelines.setAttribute('open', '');
        }
        this._updateComposerState();
    }

    async _loadComments() {
        if (this._loading || this._ended) return;
        this._loading = true;
        this._setRetryVisible(false);
        this._setLoadMoreLoading(true);
        this._setRefreshLoading(this._page === 1 && this._comments.length === 0);
        this._setHint(this._comments.length ? '' : '正在加载评论...');
        try {
            const params = new URLSearchParams({
                videoId: this._videoId,
                page: String(this._page),
                sort: this._sort,
            });
            const res = await fetchApi(`/comments?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const comments = data.comments || [];
            this._canFeature = !!data.canFeature;

            if (comments.length > 0) {
                this._comments.push(...comments);
                this._page++;
                this._renderComments();
                this._updateCount();
                if (comments.length < 20) {
                    this.querySelector('#load-more-comments').classList.add('hidden');
                } else {
                    this.querySelector('#load-more-comments').classList.remove('hidden');
                }
            } else {
                this._ended = true;
                this.querySelector('#load-more-comments').classList.add('hidden');
                this._updateCount();
                if (this._comments.length === 0) this._setHint('还没有评论，来写第一条吧。');
            }
        } catch {
            this._setHint(this._comments.length ? '后续评论加载失败，可以重试' : '评论暂时不可用，请稍后重试');
            this._setRetryVisible(true);
        } finally {
            this._loading = false;
            this._setLoadMoreLoading(false);
            this._setRefreshLoading(false);
        }
    }

    _retryLoad() {
        if (this._loading) return;
        this._setRetryVisible(false);
        this._loadComments();
    }

    _refreshComments() {
        if (this._loading) return;
        this._page = 1;
        this._comments = [];
        this._ended = false;
        this._setHint('正在刷新评论...');
        this.querySelector('#comments-list').innerHTML = '';
        this._updateCount();
        this._loadComments();
    }

    _setSort(sort) {
        if (!['latest', 'hot'].includes(sort) || this._sort === sort) return;
        this._sort = sort;
        this.querySelectorAll('.comments-sort-btn').forEach((btn) => {
            const active = btn.dataset.sort === sort;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this._page = 1;
        this._comments = [];
        this._ended = false;
        this.querySelector('#comments-list').innerHTML = '';
        this.querySelector('#load-more-comments')?.classList.add('hidden');
        this._updateCount();
        this._setHint(sort === 'hot' ? '正在加载最热评论...' : '正在加载最新评论...');
        this._loadComments();
    }

    _renderComments() {
        const list = this.querySelector('#comments-list');
        list.innerHTML = this._visibleComments().map(c => {
            const name = esc(c.userName || '匿名');
            const initial = esc((c.userName || '匿名').trim().charAt(0).toUpperCase() || '?');
            const collapsed = c.reported && !c.reportRevealed;
            const reportedReason = c.reportReason ? this._reportReasonLabel(c.reportReason) : '';
            return `
            <div class="comment-item ${c.pending ? 'is-pending' : ''} ${collapsed ? 'is-reported' : ''}" data-comment-id="${esc(c.id || c.tempId || '')}">
                <div class="comment-avatar">${initial}</div>
                <div class="comment-body">
                    <div class="comment-meta">
                        <span class="comment-name">${name}</span>
                        <span class="comment-time">${esc(this._formatTime(c.createdAt))}</span>
                        ${c.pending ? '<span class="comment-pending">发送中</span>' : ''}
                        ${c.isFeatured ? '<span class="comment-featured-badge">精选</span>' : ''}
                        ${c.id ? `
                            <button class="comment-like ${c.liked ? 'active' : ''}" data-id="${esc(c.id)}" type="button" aria-pressed="${c.liked ? 'true' : 'false'}">
                                <span aria-hidden="true">赞</span>
                                <span class="comment-like-count">${Number(c.likeCount || 0)}</span>
                            </button>
                            ${this._canFeature ? `<button class="comment-feature ${c.isFeatured ? 'active' : ''}" data-id="${esc(c.id)}" type="button" aria-pressed="${c.isFeatured ? 'true' : 'false'}">${c.isFeatured ? '取消精选' : '设为精选'}</button>` : ''}
                            <button class="comment-report ${c.reported ? 'active' : ''}" data-id="${esc(c.id)}" type="button" ${c.reported ? 'disabled aria-disabled="true"' : ''}>${c.reported ? '已举报' : '举报'}</button>
                        ` : ''}
                    </div>
                    ${collapsed ? `
                        <div class="comment-reported-note">
                            <span>
                                <strong>已举报，评论内容已折叠</strong>
                                <small>${esc(reportedReason ? `原因：${reportedReason} · ` : '')}已进入社区审核队列</small>
                            </span>
                            <button class="comment-reveal" data-id="${esc(c.id || '')}" type="button">仍要查看</button>
                        </div>
                    ` : `<div class="comment-text">${esc(c.content)}</div>`}
                </div>
            </div>
        `;
        }).join('');
        list.querySelectorAll('.comment-report').forEach((btn) => {
            btn.addEventListener('click', () => this._openReportMenu(btn));
        });
        list.querySelectorAll('.comment-like').forEach((btn) => {
            btn.addEventListener('click', () => this._toggleLike(btn));
        });
        list.querySelectorAll('.comment-feature').forEach((btn) => {
            btn.addEventListener('click', () => this._toggleFeatured(btn));
        });
        list.querySelectorAll('.comment-reveal').forEach((btn) => {
            btn.addEventListener('click', () => this._revealReportedComment(btn.dataset.id));
        });
        this._setHint('');
        this._updateCount();
    }

    _visibleComments() {
        const comments = [...this._comments];
        comments.sort((a, b) => Number(!!b.isFeatured) - Number(!!a.isFeatured));
        if (this._sort === 'hot') {
            comments.sort((a, b) => {
                if (a.pending !== b.pending) return a.pending ? -1 : 1;
                if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1;
                const likes = Number(b.likeCount || 0) - Number(a.likeCount || 0);
                if (likes !== 0) return likes;
                return timeValue(b.createdAt) - timeValue(a.createdAt);
            });
        }
        return comments;
    }

    async _submit() {
        const input = this.querySelector('#comment-input');
        const text = input.value.trim();
        if (!text) {
            this._setHint('先写点内容再发送');
            return;
        }

        if (!user.value) {
            this._openLogin({
                onAuthenticated: () => {
                    this._setHint('登录成功，正在发布评论…');
                    setTimeout(() => this._submit(), 0);
                },
                hint: '登录后将自动发布这条评论',
            });
            return;
        }

        if (this._submitting) return;

        const btn = this.querySelector('#comment-submit');
        this._submitting = true;
        this._updateComposerState();

        const tempId = `pending-${Date.now()}`;
        const optimistic = {
            id: '',
            tempId,
            userName: user.value.name || user.value.email || '我',
            content: text,
            createdAt: new Date().toISOString(),
            likeCount: 0,
            liked: false,
            pending: true,
        };
        this._comments.unshift(optimistic);
        this._renderComments();
        input.value = '';
        this._saveDraft('');
        this._updateComposerState();

        try {
            const res = await fetchApi('/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId: this._videoId, content: text }),
            });

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                const saved = data.comment || {
                    userName: user.value.name || user.value.email,
                    content: text,
                    createdAt: new Date().toISOString(),
                };
                this._comments = this._comments.map((comment) =>
                    comment.tempId === tempId ? saved : comment
                );
                this._renderComments();
                this._setHint('评论已发布');
            } else if (res.status === 429) {
                this._removePending(tempId);
                const data = await res.json().catch(() => ({}));
                this._restoreDraftAfterFailure(text);
                this._setHint(data?.message || '评论过于频繁，请稍后再试');
            } else if (res.status === 401) {
                this._removePending(tempId);
                this._restoreDraftAfterFailure(text);
                this._setHint('登录状态已过期，请重新登录');
                const { openAuthModal } = await import('../services/auth-modal-loader.js');
                openAuthModal('login');
            } else {
                this._removePending(tempId);
                this._restoreDraftAfterFailure(text);
                this._setHint('发送失败，请稍后再试');
            }
        } catch {
            this._removePending(tempId);
            this._restoreDraftAfterFailure(text);
            this._setHint('发送失败，请检查网络');
        } finally {
            this._submitting = false;
            this._updateComposerState();
        }
    }

    _openReportMenu(btn) {
        if (!user.value) {
            import('../services/auth-modal-loader.js').then(({ openAuthModal }) => openAuthModal('login'));
            this._setHint('登录后即可举报不当评论');
            return;
        }
        const id = btn.dataset.id;
        if (!id || btn.disabled) return;
        const itemState = this._comments.find((comment) => comment.id === id);
        if (itemState?.reported) {
            this._setHint('你已举报过这条评论');
            return;
        }

        const item = btn.closest('.comment-item');
        const existing = item?.querySelector('.comment-report-menu');
        if (existing) {
            this._closeReportMenus();
            return;
        }
        this._closeReportMenus();

        const menu = document.createElement('div');
        menu.className = 'comment-report-menu';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', '选择举报原因');
        menu.innerHTML = `
            <div class="comment-report-title">选择举报原因</div>
            <div class="comment-report-options">
                ${REPORT_REASONS.map(([value, label]) => `
                    <button type="button" data-reason="${esc(value)}">${esc(label)}</button>
                `).join('')}
            </div>
        `;
        menu.querySelectorAll('button').forEach((option) => {
            option.addEventListener('click', () => this._report(btn, option.dataset.reason || 'other'));
        });
        item?.querySelector('.comment-body')?.appendChild(menu);
        this._bindReportMenuLifecycle(menu, btn);
    }

    _bindReportMenuLifecycle(menu, trigger) {
        const focusables = () => [...menu.querySelectorAll('button:not(:disabled)')];
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this._closeReportMenus({ restoreFocus: trigger });
                return;
            }
            if (event.key !== 'Tab') return;
            event.stopPropagation();
            const items = focusables();
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        const onPointerDown = (event) => {
            if (menu.contains(event.target) || trigger?.contains?.(event.target)) return;
            this._closeReportMenus();
        };
        menu.addEventListener('keydown', onKeydown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        this._reportMenuCleanup = () => {
            menu.removeEventListener('keydown', onKeydown, true);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
        setTimeout(() => focusables()[0]?.focus({ preventScroll: true }), 0);
    }

    _closeReportMenus(options = {}) {
        this._reportMenuCleanup?.();
        this._reportMenuCleanup = null;
        this.querySelectorAll('.comment-report-menu').forEach((menu) => menu.remove());
        const target = options.restoreFocus;
        if (target instanceof HTMLElement && document.contains(target)) {
            target.focus({ preventScroll: true });
        }
    }

    async _report(btn, reason) {
        const id = btn.dataset.id;
        if (!id || btn.disabled) return;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '提交中';
        try {
            const res = await fetchApi(`/comments/${encodeURIComponent(id)}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json().catch(() => ({}));
            this._applyReportState(id, btn, data?.reported !== false, reason);
            this._closeReportMenus();
            this._setHint(`举报已提交：${this._reportReasonLabel(reason)}，这条评论已折叠并进入审核队列`);
        } catch {
            btn.disabled = false;
            btn.textContent = originalText || '举报';
            this._setHint('举报失败，请稍后再试');
        }
    }

    async _toggleLike(btn) {
        if (!user.value) {
            const { openAuthModal } = await import('../services/auth-modal-loader.js');
            openAuthModal('login');
            this._setHint('登录后即可点赞评论');
            return;
        }
        const id = btn.dataset.id;
        const item = this._comments.find((comment) => comment.id === id);
        if (!id || !item || btn.disabled) return;

        const wasLiked = !!item.liked;
        const prevCount = Number(item.likeCount || 0);
        const nextLiked = !wasLiked;
        const nextCount = Math.max(0, prevCount + (nextLiked ? 1 : -1));
        btn.disabled = true;
        this._applyLikeState(item, btn, nextLiked, nextCount);
        this._rerenderHotComments(id);

        try {
            const res = await fetchApi(`/comments/${encodeURIComponent(id)}/reaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: nextLiked ? 'like' : 'unlike' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json().catch(() => ({}));
            this._applyLikeState(item, btn, !!data.liked, Number(data.likeCount ?? nextCount));
            this._rerenderHotComments(id);
        } catch {
            this._applyLikeState(item, btn, wasLiked, prevCount);
            this._rerenderHotComments(id);
            this._setHint('点赞失败，请稍后再试');
        } finally {
            const currentBtn = this.querySelector(`.comment-like[data-id="${CSS.escape(id)}"]`);
            if (currentBtn) currentBtn.disabled = false;
        }
    }

    async _toggleFeatured(btn) {
        const id = btn.dataset.id;
        const item = this._comments.find((comment) => comment.id === id);
        if (!id || !item || btn.disabled || !this._canFeature) return;

        const previous = !!item.isFeatured;
        const next = !previous;
        btn.disabled = true;
        item.isFeatured = next;
        this._renderComments();
        this._setHint(next ? '已设为精选，评论会优先展示' : '已取消精选');

        try {
            const res = await fetchApi(`/comments/${encodeURIComponent(id)}/feature`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featured: next }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json().catch(() => ({}));
            item.isFeatured = !!data.featured;
            item.featuredAt = data.featuredAt || null;
            this._renderComments();
        } catch {
            item.isFeatured = previous;
            this._renderComments();
            this._setHint('精选操作失败，请稍后再试');
        } finally {
            const currentBtn = this.querySelector(`.comment-feature[data-id="${CSS.escape(id)}"]`);
            if (currentBtn) currentBtn.disabled = false;
        }
    }

    _applyLikeState(item, btn, liked, likeCount) {
        item.liked = liked;
        item.likeCount = Math.max(0, Number(likeCount) || 0);
        btn.classList.toggle('active', liked);
        btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
        const count = btn.querySelector('.comment-like-count');
        if (count) count.textContent = String(item.likeCount);
    }

    _applyReportState(id, btn, reported, reason = '') {
        const item = this._comments.find((comment) => comment.id === id);
        if (item) {
            item.reported = reported;
            if (reported) {
                item.reportRevealed = false;
                item.reportReason = reason;
            }
        }
        btn.classList.toggle('active', reported);
        btn.disabled = reported;
        btn.setAttribute('aria-disabled', reported ? 'true' : 'false');
        btn.textContent = reported ? '已举报' : '举报';
        if (reported) this._renderComments();
    }

    _reportReasonLabel(reason) {
        return REPORT_REASONS.find(([value]) => value === reason)?.[1] || '其他';
    }

    _revealReportedComment(id) {
        const item = this._comments.find((comment) => comment.id === id);
        if (!item) return;
        item.reportRevealed = true;
        this._renderComments();
        const target = this.querySelector(`.comment-item[data-comment-id="${CSS.escape(id)}"] .comment-text`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    _rerenderHotComments(id) {
        if (this._sort !== 'hot') return;
        this._renderComments();
        const btn = this.querySelector(`.comment-like[data-id="${CSS.escape(id)}"]`);
        btn?.focus({ preventScroll: true });
    }

    _removePending(tempId) {
        this._comments = this._comments.filter((comment) => comment.tempId !== tempId);
        this._renderComments();
    }

    _scrollComposerIntoView() {
        if (!window.matchMedia('(max-width: 640px)').matches) return;
        const card = this.querySelector('#comment-compose-card');
        if (!card) return;
        requestAnimationFrame(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    _syncAuthState(loggedIn) {
        const card = this.querySelector('#comment-compose-card');
        const guestBar = this.querySelector('#comment-guest-bar');
        const input = this.querySelector('#comment-input');
        card?.classList.toggle('is-guest', !loggedIn);
        guestBar?.classList.toggle('hidden', loggedIn);
        if (input) {
            input.placeholder = loggedIn ? '写下你的评论…' : '可以先写下想法，登录后一键发送';
        }
        this._updateComposerState();
    }

    async _openLogin(options = {}) {
        const { openAuthModal } = await import('../services/auth-modal-loader.js');
        const modal = (await openAuthModal('login')) || document.querySelector('auth-modal');
        if (options.hint) this._setHint(options.hint);
        modal?.addEventListener('authenticated', () => {
            this.querySelector('#comment-input')?.focus({ preventScroll: true });
            options.onAuthenticated?.();
        }, { once: true });
    }

    _updateComposerState() {
        const input = this.querySelector('#comment-input');
        const btn = this.querySelector('#comment-submit');
        const clearBtn = this.querySelector('#comment-clear-draft');
        const counter = this.querySelector('#comment-counter');
        const draftState = this.querySelector('#comment-draft-state');
        if (!input || !btn || !counter) return;
        const length = input.value.length;
        counter.textContent = `${length}/1000`;
        counter.classList.toggle('is-warning', length > 900);
        counter.classList.toggle('is-limit', length >= 1000);
        const canSend = length > 0 && !this._submitting;
        btn.disabled = !canSend;
        btn.textContent = !user.value && length > 0 ? '登录并发送' : (this._submitting ? '发送中' : '发送');
        clearBtn?.classList.toggle('hidden', length === 0);
        clearBtn?.toggleAttribute('disabled', this._submitting || length === 0);
        this._saveDraft(input.value);
        if (draftState) {
            draftState.textContent = input.value.trim() ? '草稿已保存' : '';
            draftState.classList.toggle('hidden', !input.value.trim());
        }
    }

    _updateCount() {
        const el = this.querySelector('#comments-count');
        if (!el) return;
        const count = this._comments.filter((comment) => !comment.pending).length;
        el.textContent = count ? `${count} 条` : '';
        el.classList.toggle('hidden', count === 0);
    }

    _setHint(text) {
        const inlineOnly = !text || /^(正在|还没有评论)/.test(text);
        if (text && !inlineOnly) {
            let tone = 'info';
            if (/失败|不可用|过期|频繁|请先|违规/.test(text)) tone = 'error';
            else if (/已|成功|发布|提交|清空|精选|举报已/.test(text)) tone = 'success';
            showSiteNotice(text, { tone, id: 'comments-notice' });
        }
        const hint = this.querySelector('#comment-hint');
        if (!hint) return;
        hint.textContent = inlineOnly ? (text || '') : '';
        hint.classList.toggle('hidden', !inlineOnly || !text);
        hint.classList.toggle('is-empty', text === '还没有评论，来写第一条吧。');
        hint.classList.toggle('is-error', inlineOnly && /失败|不可用|过期|频繁/.test(text || ''));
    }

    _setRetryVisible(visible) {
        this.querySelector('#retry-comments')?.classList.toggle('hidden', !visible);
    }

    _setLoadMoreLoading(loading) {
        const btn = this.querySelector('#load-more-comments');
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? '加载中...' : '加载更多';
    }

    _setRefreshLoading(loading) {
        const btn = this.querySelector('#refresh-comments');
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? '刷新中' : '刷新';
    }

    _formatTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60) return '刚刚';
        if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
        return d.toLocaleDateString('zh-CN');
    }

    _draftKey() {
        return `${COMMENT_DRAFT_PREFIX}${this._videoId || 'default'}`;
    }

    _loadDraft() {
        try {
            return localStorage.getItem(this._draftKey()) || '';
        } catch {
            return '';
        }
    }

    _saveDraft(value) {
        try {
            const text = String(value || '').slice(0, 1000);
            if (text.trim()) localStorage.setItem(this._draftKey(), text);
            else localStorage.removeItem(this._draftKey());
        } catch {}
    }

    _restoreDraftAfterFailure(text) {
        const input = this.querySelector('#comment-input');
        if (!input) {
            this._saveDraft(text);
            return;
        }
        input.value = text;
        this._saveDraft(text);
        this._updateComposerState();
    }

    _clearDraft() {
        const input = this.querySelector('#comment-input');
        if (!input || !input.value) return;
        input.value = '';
        this._saveDraft('');
        this._updateComposerState();
        this._setHint('草稿已清空');
        input.focus({ preventScroll: true });
    }
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

function timeValue(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
}

customElements.define('comment-section', CommentSection);
export default CommentSection;

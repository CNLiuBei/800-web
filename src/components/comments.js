// 评论组件

import { user } from '../services/auth.js';
import { t } from '../services/i18n.js';
import { esc } from '../core/html.js';
import { API_BASE } from '../services/config.js';

class CommentSection extends HTMLElement {
    connectedCallback() {
        this._videoId = this.getAttribute('video-id') || '';
        this._comments = [];
        this._page = 1;
        this._render();
        this._loadComments();
    }

    _render() {
        this.innerHTML = `
            <div class="comments-section">
                <h3 class="comments-title">评论</h3>
                <div class="comment-input-wrap" id="comment-input-wrap">
                    <textarea class="comment-input" id="comment-input" placeholder="写下你的评论..." rows="2"></textarea>
                    <button class="comment-submit" id="comment-submit">发送</button>
                </div>
                <div class="comments-list" id="comments-list"></div>
                <button class="comments-load-more hidden" id="load-more-comments">加载更多</button>
            </div>
        `;

        this.querySelector('#comment-submit').addEventListener('click', () => this._submit());
        this.querySelector('#comment-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
        });
        this.querySelector('#load-more-comments').addEventListener('click', () => this._loadComments());
    }

    async _loadComments() {
        try {
            const res = await fetch(`${API_BASE}/comments?videoId=${this._videoId}&page=${this._page}`, {
                credentials: 'include',
            });
            if (!res.ok) return;
            const data = await res.json();
            const comments = data.comments || [];

            if (comments.length > 0) {
                this._comments.push(...comments);
                this._page++;
                this._renderComments();
                if (comments.length < 20) {
                    this.querySelector('#load-more-comments').classList.add('hidden');
                } else {
                    this.querySelector('#load-more-comments').classList.remove('hidden');
                }
            } else {
                this.querySelector('#load-more-comments').classList.add('hidden');
            }
        } catch {
            // API 可能还没实现，静默失败
        }
    }

    _renderComments() {
        const list = this.querySelector('#comments-list');
        list.innerHTML = this._comments.map(c => {
            const name = esc(c.userName || '匿名');
            const initial = esc((c.userName || '匿名').trim().charAt(0).toUpperCase() || '?');
            return `
            <div class="comment-item">
                <div class="comment-avatar">${initial}</div>
                <div class="comment-body">
                    <div class="comment-meta">
                        <span class="comment-name">${name}</span>
                        <span class="comment-time">${esc(this._formatTime(c.createdAt))}</span>
                    </div>
                    <div class="comment-text">${esc(c.content)}</div>
                </div>
            </div>
        `;
        }).join('');
    }

    async _submit() {
        if (!user.value) {
            const { default: AuthModal } = await import('./auth-modal.js');
            AuthModal.open('login');
            return;
        }

        const input = this.querySelector('#comment-input');
        const text = input.value.trim();
        if (!text) return;

        const btn = this.querySelector('#comment-submit');
        btn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/comments`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId: this._videoId, content: text }),
            });

            if (res.ok) {
                // 乐观更新
                this._comments.unshift({
                    userName: user.value.name || user.value.email,
                    content: text,
                    createdAt: new Date().toISOString(),
                });
                this._renderComments();
                input.value = '';
            }
        } catch {} finally {
            btn.disabled = false;
        }
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
}

customElements.define('comment-section', CommentSection);
export default CommentSection;

import { esc, loadCSS } from '../core/html.js';
import { setPageMeta } from '../core/head.js';
import { followCreatorChannel, getShortsFeed } from '../services/api.js';
import { reportEngagementEvent } from '../services/engagement-analytics.js';

let observer = null;
const SHORTS_FEEDBACK_KEY = 'gy_shorts_feedback_v1';

export async function render(container) {
    await loadCSS('styles/shorts.css');
    await loadCSS('styles/detail.css');
    setPageMeta({
        title: '短视频 - 800影视',
        description: '竖滑浏览创作者短视频，按近期播放、互动和新鲜度轻量推荐。',
        url: window.location.href,
    });

    cleanup();
    container.innerHTML = `
        <section class="shorts-page" aria-label="短视频 Feed">
            <div class="shorts-topbar">
                <div>
                    <span class="shorts-kicker">Shorts</span>
                    <h1>短视频</h1>
                </div>
                <button class="shorts-refresh" id="shorts-refresh" type="button">刷新</button>
            </div>
            <div class="shorts-feed" id="shorts-feed" aria-live="polite">
                <div class="shorts-loading"><div class="spinner-small"></div><span>加载短视频推荐…</span></div>
            </div>
        </section>
    `;

    container.querySelector('#shorts-refresh')?.addEventListener('click', () => render(container));
    await loadFeed(container);
}

async function loadFeed(container) {
    const feed = container.querySelector('#shorts-feed');
    try {
        const data = await getShortsFeed({ limit: 12, force: true });
        const items = data.items || [];
        feed.innerHTML = items.length ? items.map(renderShortCard).join('') : renderEmpty();
        mountShortsPlayback(feed);
        bindShortActions(feed);
    } catch (error) {
        feed.innerHTML = `
            <div class="shorts-error">
                <strong>短视频加载失败</strong>
                <span>${error?.offline ? '当前离线，可稍后重试。' : '请稍后重试，推荐服务会降级到最新短视频。'}</span>
                <button class="shorts-refresh" id="shorts-retry" type="button">重试</button>
            </div>
        `;
        feed.querySelector('#shorts-retry')?.addEventListener('click', () => loadFeed(container));
    }
}

function renderShortCard(item) {
    const title = item.name || '未命名短视频';
    const channel = item.channel?.displayName || item.subtitle || '创作者';
    const handle = item.channel?.handle || '';
    const reason = item.recommendation?.reason || '最新短视频';
    const score = Number(item.recommendation?.score || 0);
    const playbackUrl = safePlaybackUrl(item.playback?.url || item.creatorPlayback?.url);
    const feedback = getShortFeedback(item.analyticsVideoId || item.id);
    const liked = feedback.like === true;
    const hidden = feedback.notInterested === true;
    return `
        <article class="short-card ${hidden ? 'is-muted' : ''}" data-id="${esc(item.id)}" data-content-id="${esc(item.analyticsVideoId || item.id)}" data-channel-handle="${esc(handle)}" data-content-type="short">
            <div class="short-media">
                ${playbackUrl
                    ? `<video src="${esc(playbackUrl)}" poster="${esc(item.poster || '')}" playsinline loop muted preload="metadata"></video>`
                    : `<div class="short-placeholder">${item.poster ? `<img src="${esc(item.poster)}" alt="">` : '<span>暂无播放源</span>'}</div>`}
            </div>
            <div class="short-gradient" aria-hidden="true"></div>
            <div class="short-copy">
                <div class="short-reason">${esc(reason)}${score ? ` · ${Math.round(score)} 分` : ''}</div>
                <h2>${esc(title)}</h2>
                <p>${esc(item.description || '')}</p>
                <a class="short-channel" href="${item.channel?.handle ? `#/creator/${esc(item.channel.handle)}` : '#/account'}">@${esc(channel)}</a>
            </div>
            <div class="short-actions">
                <button type="button" data-short-action="play">播放</button>
                <button type="button" class="${liked ? 'active' : ''}" aria-pressed="${liked ? 'true' : 'false'}" data-short-action="like">${liked ? '已赞' : '喜欢'}</button>
                <button type="button" data-short-action="comments">评论</button>
                ${handle ? `<button type="button" data-short-action="follow">关注</button>` : ''}
                <a href="#/detail/creator/${esc(item.id)}" data-short-action="detail">详情</a>
                <button type="button" data-short-action="share">分享</button>
                <button type="button" class="${hidden ? 'active' : ''}" aria-pressed="${hidden ? 'true' : 'false'}" data-short-action="not-interested">${hidden ? '已减少' : '不感兴趣'}</button>
            </div>
            <div class="short-comments-panel hidden" data-short-comments-panel></div>
        </article>
    `;
}

function mountShortsPlayback(feed) {
    cleanup();
    observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const card = entry.target;
            const video = card.querySelector('video');
            if (!video) continue;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.66) {
                pauseOtherVideos(feed, video);
                video.play().catch(() => {});
                reportShortEvent('decision_impression', card);
            } else {
                video.pause();
            }
        }
    }, { root: feed, threshold: [0, 0.66, 0.9] });
    feed.querySelectorAll('.short-card').forEach((card) => observer.observe(card));
}

function bindShortActions(feed) {
    feed.querySelectorAll('[data-short-action="play"]').forEach((button) => {
        button.addEventListener('click', () => {
            const card = button.closest('.short-card');
            const video = card?.querySelector('video');
            if (!video) return;
            if (video.paused) video.play().catch(() => {});
            else video.pause();
            reportShortEvent('play_click', card);
        });
    });
    feed.querySelectorAll('[data-short-action="detail"]').forEach((link) => {
        link.addEventListener('click', () => reportShortEvent('decision_click', link.closest('.short-card'), { targetType: 'creator' }));
    });
    feed.querySelectorAll('[data-short-action="like"]').forEach((button) => {
        button.addEventListener('click', () => {
            const card = button.closest('.short-card');
            const contentId = card?.dataset?.contentId || '';
            if (!contentId) return;
            const feedback = getShortFeedback(contentId);
            const liked = feedback.like !== true;
            setShortFeedback(contentId, { ...feedback, like: liked, notInterested: liked ? false : feedback.notInterested });
            button.classList.toggle('active', liked);
            button.setAttribute('aria-pressed', liked ? 'true' : 'false');
            button.textContent = liked ? '已赞' : '喜欢';
            card?.classList.remove('is-muted');
            const dislikeButton = card?.querySelector('[data-short-action="not-interested"]');
            if (liked && dislikeButton) {
                dislikeButton.classList.remove('active');
                dislikeButton.setAttribute('aria-pressed', 'false');
                dislikeButton.textContent = '不感兴趣';
            }
            reportShortEvent('short_like', card, { actionState: liked ? 'on' : 'off', value: liked ? 1 : 0 });
        });
    });
    feed.querySelectorAll('[data-short-action="comments"]').forEach((button) => {
        button.addEventListener('click', () => toggleShortComments(button));
    });
    feed.querySelectorAll('[data-short-action="follow"]').forEach((button) => {
        button.addEventListener('click', async () => {
            const card = button.closest('.short-card');
            const handle = card?.dataset?.channelHandle || '';
            if (!handle) return;
            button.disabled = true;
            button.textContent = '关注中…';
            reportShortEvent('short_follow_click', card, { targetId: handle, targetType: 'channel', actionState: 'open' });
            try {
                await followCreatorChannel(handle, 'follow');
                button.textContent = '已关注';
                button.classList.add('active');
                button.setAttribute('aria-pressed', 'true');
                reportShortEvent('short_follow_click', card, { targetId: handle, targetType: 'channel', actionState: 'success', value: 1 });
            } catch (error) {
                button.disabled = false;
                button.textContent = '关注';
                if (error?.status === 401) {
                    window.dispatchEvent(new CustomEvent('gy:auth-required', { detail: { reason: 'follow_creator' } }));
                    return;
                }
                button.title = '关注失败，请稍后重试';
                reportShortEvent('short_follow_click', card, { targetId: handle, targetType: 'channel', actionState: 'failed' });
            }
        });
    });
    feed.querySelectorAll('[data-short-action="share"]').forEach((button) => {
        button.addEventListener('click', async () => {
            const card = button.closest('.short-card');
            const title = card?.querySelector('h2')?.textContent || '短视频';
            const url = `${location.origin}${location.pathname}${location.search}#/shorts`;
            try {
                if (navigator.share) await navigator.share({ title, url });
                else await navigator.clipboard?.writeText(url);
                button.textContent = '已分享';
                setTimeout(() => { button.textContent = '分享'; }, 1600);
                reportShortEvent('share', card);
            } catch {}
        });
    });
    feed.querySelectorAll('[data-short-action="not-interested"]').forEach((button) => {
        button.addEventListener('click', () => {
            const card = button.closest('.short-card');
            const contentId = card?.dataset?.contentId || '';
            if (!contentId) return;
            const feedback = getShortFeedback(contentId);
            const hidden = feedback.notInterested !== true;
            setShortFeedback(contentId, { ...feedback, notInterested: hidden, like: hidden ? false : feedback.like });
            button.classList.toggle('active', hidden);
            button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
            button.textContent = hidden ? '已减少' : '不感兴趣';
            card?.classList.toggle('is-muted', hidden);
            const likeButton = card?.querySelector('[data-short-action="like"]');
            if (hidden && likeButton) {
                likeButton.classList.remove('active');
                likeButton.setAttribute('aria-pressed', 'false');
                likeButton.textContent = '喜欢';
            }
            reportShortEvent('short_not_interested', card, { actionState: hidden ? 'on' : 'off', value: hidden ? 1 : 0 });
        });
    });
}

async function toggleShortComments(button) {
    const card = button.closest('.short-card');
    const panel = card?.querySelector('[data-short-comments-panel]');
    const contentId = card?.dataset?.contentId || '';
    if (!card || !panel || !contentId) return;

    const willOpen = panel.classList.contains('hidden');
    card.closest('.shorts-feed')?.querySelectorAll('.short-comments-panel:not(.hidden)').forEach((openPanel) => {
        if (openPanel !== panel) {
            openPanel.classList.add('hidden');
            openPanel.closest('.short-card')?.querySelector('[data-short-action="comments"]')?.classList.remove('active');
        }
    });

    if (!willOpen) {
        panel.classList.add('hidden');
        button.classList.remove('active');
        return;
    }

    if (!panel.querySelector('comment-section')) {
        await import('../components/comments.js');
        const comments = document.createElement('comment-section');
        comments.setAttribute('video-id', contentId);
        comments.className = 'short-comments';
        panel.replaceChildren(comments);
    }
    panel.classList.remove('hidden');
    button.classList.add('active');
    panel.querySelector('#comment-input')?.focus();
    reportShortEvent('discussion', card, { targetType: 'comments', actionState: 'open', value: 1 });
}

function reportShortEvent(eventType, card, extra = {}) {
    const contentId = card?.dataset?.contentId || '';
    if (!contentId) return;
    reportEngagementEvent(eventType, {
        contentId,
        contentType: 'short',
        source: 'shorts_feed',
        ...extra,
    });
}

function pauseOtherVideos(feed, active) {
    feed.querySelectorAll('video').forEach((video) => {
        if (video !== active) {
            if (!video.paused) reportShortEvent('short_skip', video.closest('.short-card'));
            video.pause();
        }
    });
}

function getShortFeedback(contentId) {
    const state = readShortFeedback();
    return state[contentId] || {};
}

function setShortFeedback(contentId, feedback) {
    const state = readShortFeedback();
    state[contentId] = {
        like: feedback.like === true,
        notInterested: feedback.notInterested === true,
        updatedAt: Date.now(),
    };
    try {
        localStorage.setItem(SHORTS_FEEDBACK_KEY, JSON.stringify(state));
    } catch {}
}

function readShortFeedback() {
    try {
        const raw = JSON.parse(localStorage.getItem(SHORTS_FEEDBACK_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function safePlaybackUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value, location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        return url.href;
    } catch {
        return '';
    }
}

function renderEmpty() {
    return `
        <div class="shorts-empty">
            <strong>暂无公开短视频</strong>
            <span>创作者发布并通过审核后，会出现在这里。</span>
            <a href="#/account">去创作者中心发布</a>
        </div>
    `;
}

function cleanup() {
    if (observer) observer.disconnect();
    observer = null;
}

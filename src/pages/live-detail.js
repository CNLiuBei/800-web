import { esc, loadCSS } from '../core/html.js';
import { setPageMeta } from '../core/head.js';
import { pageHeaderHTML } from '../components/page-header.js';
import {
    banCreatorLiveMessageAuthor,
    followCreatorChannel,
    getPublicCreatorLiveInteractions,
    getPublicCreatorLiveSession,
    heartbeatPublicCreatorLive,
    moderateCreatorLiveMessage,
    muteCreatorLiveMessageAuthor,
    reactPublicCreatorLive,
    reportPublicCreatorLive,
    sendPublicCreatorLiveMessage,
} from '../services/api.js';

const LIVE_VIEWER_ID_KEY = 'gy_live_viewer_id';
const LIVE_DANMAKU_ENABLED_KEY = 'gy_live_danmaku_enabled';

export async function render(container, params = {}) {
    await loadCSS('styles/layout.css');

    const id = String(params.id || '').trim();
    if (!id) {
        renderError(container, '直播不存在', '缺少直播场次 ID。');
        return;
    }

    container.innerHTML = '<div class="page-loading"><div class="spinner-small"></div><span>加载直播间...</span></div>';

    try {
        const data = await getPublicCreatorLiveSession(id);
        if (!data.session) {
            renderError(container, '直播不存在', '这场直播可能已结束、取消或不再公开。');
            return;
        }
        renderLiveDetail(container, data.session);
    } catch (error) {
        renderError(container, '直播加载失败', error?.message || '请稍后重试。', () => render(container, params));
    }
}

function renderLiveDetail(container, session) {
    const isLive = session.status === 'live';
    const playbackUrl = safePlaybackHref(session.playback?.url);
    setPageMeta({
        title: `${session.title || '直播'} - 800影视`,
        description: session.description || `${session.channel?.displayName || '创作者'} 的公开直播。`,
        url: window.location.href,
    });

    container.innerHTML = `
        <section class="live-detail-page">
            ${pageHeaderHTML({
                eyebrow: isLive ? '正在直播' : '直播预约',
                title: session.title || '未命名直播',
                description: session.description || '创作者暂未填写直播简介。',
                actions: '<a class="page-secondary-action" href="#/live">返回直播</a>',
            })}
            <div class="live-detail-layout">
                <main class="live-room-card">
                    <div class="live-player-shell ${isLive ? 'is-live' : 'is-waiting'}">
                        ${isLive && playbackUrl
                            ? renderPlaybackEmbed(playbackUrl, session.title)
                            : renderWaitingRoom(session)}
                        ${isLive ? '<div class="live-danmaku-layer" id="live-danmaku-layer" aria-hidden="true"></div>' : ''}
                    </div>
                    <div class="live-room-meta">
                        <span class="live-badge ${isLive ? 'live' : 'scheduled'}">${isLive ? '正在直播' : '预约中'}</span>
                        <span>${esc(formatLiveTime(session))}</span>
                        <span>${esc(session.playback ? 'HLS 播放已接入' : '等待推流接入')}</span>
                    </div>
                    ${session.pinnedNotice ? `<div class="live-pinned-notice"><strong>主播公告</strong><span>${esc(session.pinnedNotice)}</span></div>` : ''}
                    <div class="live-room-actions">
                        <a class="page-secondary-action" href="#/creator/${esc(session.channel?.handle || '')}">进入频道</a>
                        ${playbackUrl ? `<a class="page-primary-action" href="${esc(playbackUrl)}" target="_blank" rel="noopener noreferrer">外部播放器打开</a>` : ''}
                    </div>
                </main>
                <aside class="live-side-panel">
                    <section class="live-channel-card">
                        <strong>${esc(session.channel?.displayName || '创作者频道')}</strong>
                        <a href="#/creator/${esc(session.channel?.handle || '')}">@${esc(session.channel?.handle || 'creator')}</a>
                        <p>${esc(session.channel?.bio || '关注创作者，获取后续直播与公开视频更新。')}</p>
                        ${session.channel?.handle ? `<button class="page-secondary-action" id="live-follow-btn" type="button">${session.channel?.isFollowing ? '已关注' : '关注开播提醒'}</button>` : ''}
                    </section>
                    <section class="live-interaction-card">
                        <div class="live-interaction-head">
                            <strong>直播互动</strong>
                            <button class="live-text-button" id="live-report-btn" type="button">举报</button>
                        </div>
                        <div class="live-interaction-summary" id="live-interaction-summary">加载互动...</div>
                        <div class="live-chat-list" id="live-chat-list"></div>
                        <form class="live-chat-form" id="live-chat-form">
                            <input id="live-chat-input" type="text" maxlength="200" placeholder="发送一条友善的弹幕/聊天">
                            <button class="page-primary-action" type="submit">发送</button>
                        </form>
                        <div class="live-room-actions compact">
                            <button class="page-secondary-action" id="live-like-btn" type="button">点赞</button>
                            <button class="page-secondary-action" id="live-danmaku-toggle" type="button">弹幕上屏</button>
                            <button class="page-secondary-action" id="live-refresh-interactions" type="button">刷新互动</button>
                        </div>
                        <small class="live-interaction-note">聊天、点赞、举报、主播隐藏消息、置顶公告和弹幕上屏已接入；更完整房管能力会继续迭代。</small>
                    </section>
                </aside>
            </div>
        </section>
    `;
    bindLiveInteractionControls(container, session);
    updateLiveDanmakuToggle(container);
    loadLiveInteractions(container, session.id);
    startLivePresence(container, session);
}

function renderPlaybackEmbed(playbackUrl, title) {
    return `
        <video class="live-player" controls autoplay playsinline src="${esc(playbackUrl)}" title="${esc(title || '直播播放器')}"></video>
    `;
}

function bindLiveInteractionControls(container, session) {
    const form = container.querySelector('#live-chat-form');
    const input = container.querySelector('#live-chat-input');
    const likeButton = container.querySelector('#live-like-btn');
    const refreshButton = container.querySelector('#live-refresh-interactions');
    const danmakuToggle = container.querySelector('#live-danmaku-toggle');
    const reportButton = container.querySelector('#live-report-btn');
    const followButton = container.querySelector('#live-follow-btn');
    const list = container.querySelector('#live-chat-list');

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const content = input?.value?.trim() || '';
        if (!content) return;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            await sendPublicCreatorLiveMessage(session.id, content);
            input.value = '';
            await loadLiveInteractions(container, session.id);
        } catch (error) {
            showInteractionStatus(container, error?.status === 401 ? '请先登录后再发言' : (error?.message || '发送失败'));
        } finally {
            submit.disabled = false;
        }
    });

    likeButton?.addEventListener('click', async () => {
        const liked = likeButton.dataset.liked === 'true';
        likeButton.disabled = true;
        try {
            await reactPublicCreatorLive(session.id, liked ? 'unlike' : 'like');
            await loadLiveInteractions(container, session.id);
        } catch (error) {
            showInteractionStatus(container, error?.status === 401 ? '请先登录后再点赞' : (error?.message || '操作失败'));
        } finally {
            likeButton.disabled = false;
        }
    });

    refreshButton?.addEventListener('click', () => loadLiveInteractions(container, session.id));
    danmakuToggle?.addEventListener('click', () => {
        setLiveDanmakuEnabled(!getLiveDanmakuEnabled());
        updateLiveDanmakuToggle(container);
        loadLiveInteractions(container, session.id).catch(() => {});
    });
    list?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-live-message-action]');
        if (!button) return;
        const action = button.dataset.liveMessageAction;
        const messageId = button.dataset.liveMessageId;
        if (!messageId) return;
        button.disabled = true;
        try {
            if (action === 'hide') {
                await moderateCreatorLiveMessage(messageId, 'hide');
                await loadLiveInteractions(container, session.id);
            } else if (action === 'mute') {
                const reason = window.prompt('禁言原因（可留空）', '') || '';
                await muteCreatorLiveMessageAuthor(messageId, { durationSeconds: 10 * 60, reason });
                showInteractionStatus(container, '已禁言该用户 10 分钟，并隐藏该消息');
                await loadLiveInteractions(container, session.id);
            } else if (action === 'ban') {
                const reason = window.prompt('长期封禁原因（可留空）', '') || '';
                await banCreatorLiveMessageAuthor(messageId, { reason });
                showInteractionStatus(container, '已长期封禁该用户，并隐藏该消息');
                await loadLiveInteractions(container, session.id);
            } else if (action === 'report') {
                const reason = window.prompt('请简要说明举报原因（可留空）', '') || '';
                await reportPublicCreatorLive(session.id, `message:${messageId} ${reason}`.trim());
                showInteractionStatus(container, '已收到消息举报');
            }
        } catch (error) {
            showInteractionStatus(container, action === 'hide'
                ? (error?.status === 401 ? '请先登录创作者账号' : '只有主播可隐藏消息')
                : action === 'mute'
                    ? (error?.status === 401 ? '请先登录创作者账号' : (error?.message || '只有主播可禁言用户'))
                : action === 'ban'
                    ? (error?.status === 401 ? '请先登录创作者账号' : (error?.message || '只有主播可长期封禁用户'))
                : (error?.status === 401 ? '请先登录后再举报' : (error?.message || '操作失败')));
        } finally {
            button.disabled = false;
        }
    });
    reportButton?.addEventListener('click', async () => {
        if (reportButton.dataset.reported === 'true') {
            showInteractionStatus(container, '你已举报过这场直播，运营会尽快处理');
            return;
        }
        const reason = window.prompt('请简要说明举报原因（可留空）', '') || '';
        reportButton.disabled = true;
        try {
            await reportPublicCreatorLive(session.id, reason);
            await loadLiveInteractions(container, session.id);
            showInteractionStatus(container, '已收到举报，我们会尽快处理');
        } catch (error) {
            showInteractionStatus(container, error?.status === 401 ? '请先登录后再举报' : (error?.message || '举报失败'));
        } finally {
            reportButton.disabled = reportButton.dataset.reported === 'true';
        }
    });

    followButton?.addEventListener('click', async () => {
        const handle = session.channel?.handle;
        if (!handle) return;
        const following = session.channel?.isFollowing === true;
        followButton.disabled = true;
        try {
            const data = await followCreatorChannel(handle, following ? 'unfollow' : 'follow');
            session.channel = { ...session.channel, ...(data.channel || {}) };
            followButton.textContent = session.channel.isFollowing ? '已关注' : '关注开播提醒';
            showInteractionStatus(container, session.channel.isFollowing ? '已关注该创作者，后续开播会收到站内提醒' : '已取消关注');
        } catch (error) {
            showInteractionStatus(container, error?.status === 401 ? '请先登录后再关注创作者' : (error?.message || '关注操作失败'));
        } finally {
            followButton.disabled = false;
        }
    });
}

async function loadLiveInteractions(container, sessionId) {
    const summary = container.querySelector('#live-interaction-summary');
    const list = container.querySelector('#live-chat-list');
    const likeButton = container.querySelector('#live-like-btn');
    const reportButton = container.querySelector('#live-report-btn');
    try {
        const data = await getPublicCreatorLiveInteractions(sessionId, { limit: 40 });
        const info = data.summary || {};
        if (summary) summary.textContent = `热度 ${compactNumber(info.heatScore)} · 在线 ${compactNumber(info.onlineCount)} · 点赞 ${compactNumber(info.likeCount)} · 聊天 ${compactNumber(info.messageCount)}`;
        if (likeButton) {
            likeButton.dataset.liked = info.liked ? 'true' : 'false';
            likeButton.textContent = info.liked ? '已点赞' : '点赞';
        }
        if (reportButton) {
            reportButton.dataset.reported = info.reported ? 'true' : 'false';
            reportButton.textContent = info.reported ? '已举报' : '举报';
            reportButton.disabled = Boolean(info.reported);
        }
        if (list) list.innerHTML = renderLiveMessages(data.messages || [], Boolean(info.canModerate));
        renderLiveDanmaku(container, data.messages || []);
    } catch (error) {
        showInteractionStatus(container, error?.message || '互动加载失败');
        if (list) list.innerHTML = renderLiveMessages([]);
        renderLiveDanmaku(container, []);
    }
}

function renderLiveMessages(messages, canModerate = false) {
    if (!messages.length) return '<div class="live-chat-empty">还没有聊天，来发第一条友善弹幕吧。</div>';
    return messages.map((message) => `
        <div class="live-chat-message">
            <div class="live-chat-message-head">
                <strong>${esc(message.userName || '用户')}</strong>
                <span>
                    <button class="live-text-button" type="button" data-live-message-action="report" data-live-message-id="${esc(message.id)}">举报</button>
                    ${canModerate ? `
                        <button class="live-text-button" type="button" data-live-message-action="hide" data-live-message-id="${esc(message.id)}">隐藏</button>
                        <button class="live-text-button" type="button" data-live-message-action="mute" data-live-message-id="${esc(message.id)}">禁言</button>
                        <button class="live-text-button" type="button" data-live-message-action="ban" data-live-message-id="${esc(message.id)}">长期封禁</button>
                    ` : ''}
                </span>
            </div>
            <span>${esc(message.content || '')}</span>
        </div>
    `).join('');
}

function renderLiveDanmaku(container, messages) {
    const layer = container.querySelector('#live-danmaku-layer');
    if (!layer) return;
    if (!getLiveDanmakuEnabled()) {
        layer.innerHTML = '';
        layer.classList.add('is-disabled');
        return;
    }
    layer.classList.remove('is-disabled');
    const safeMessages = messages.slice(-12).filter((message) => message?.content);
    layer.innerHTML = safeMessages.map((message, index) => {
        const lane = index % 6;
        const delay = (index % 4) * 0.8;
        const duration = 11 + (index % 5);
        return `<span style="--lane:${lane};--delay:${delay}s;--duration:${duration}s">${esc(message.content || '')}</span>`;
    }).join('');
}

function updateLiveDanmakuToggle(container) {
    const button = container.querySelector('#live-danmaku-toggle');
    const layer = container.querySelector('#live-danmaku-layer');
    const enabled = getLiveDanmakuEnabled();
    if (button) {
        button.classList.toggle('active', enabled);
        button.textContent = enabled ? '弹幕已开' : '弹幕上屏';
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
    layer?.classList.toggle('is-disabled', !enabled);
}

function getLiveDanmakuEnabled() {
    try {
        return localStorage.getItem(LIVE_DANMAKU_ENABLED_KEY) !== '0';
    } catch {
        return true;
    }
}

function setLiveDanmakuEnabled(enabled) {
    try {
        localStorage.setItem(LIVE_DANMAKU_ENABLED_KEY, enabled ? '1' : '0');
    } catch {}
}

function startLivePresence(container, session) {
    if (session.status !== 'live') return;
    let stopped = false;
    const beat = async () => {
        if (stopped || !document.contains(container)) {
            stopped = true;
            return;
        }
        try {
            await heartbeatPublicCreatorLive(session.id, getLiveViewerId());
            await loadLiveInteractions(container, session.id);
        } catch {}
        if (!stopped) setTimeout(beat, 30000);
    };
    beat();
}

function getLiveViewerId() {
    try {
        let value = localStorage.getItem(LIVE_VIEWER_ID_KEY);
        if (!value) {
            value = `viewer-${crypto.randomUUID()}`;
            localStorage.setItem(LIVE_VIEWER_ID_KEY, value);
        }
        return value;
    } catch {
        return `viewer-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    }
}

function showInteractionStatus(container, message) {
    const summary = container.querySelector('#live-interaction-summary');
    if (summary) summary.textContent = message;
}

function renderWaitingRoom(session) {
    return `
        <div class="live-waiting-room">
            <span>${session.status === 'scheduled' ? '预约直播' : '直播准备中'}</span>
            <strong>${esc(session.scheduledStartAt ? `预计 ${formatLiveTime(session)}` : '主播还没有开始推流')}</strong>
            <p>你可以先进入创作者频道查看往期内容；真实推流、预约提醒和直播聊天将在后续迭代接入。</p>
        </div>
    `;
}

function renderError(container, title, message, retry) {
    setPageMeta({
        title: `${title} - 800影视`,
        description: message,
        url: window.location.href,
    });
    container.innerHTML = `
        <section class="catalog-section">
            ${pageHeaderHTML({
                eyebrow: 'Live',
                title,
                description: message,
                actions: '<a class="page-secondary-action" href="#/live">返回直播</a>',
            })}
            <div class="page-error live-detail-error">
                ${esc(message)}
                ${retry ? '<button class="retry-btn" id="live-detail-retry" type="button">重试</button>' : ''}
            </div>
        </section>
    `;
    if (retry) container.querySelector('#live-detail-retry')?.addEventListener('click', retry);
}

function formatLiveTime(session) {
    if (session.status === 'live' && session.startedAt) return `开播 ${formatTime(session.startedAt)}`;
    if (session.scheduledStartAt) return `预约 ${formatTime(session.scheduledStartAt)}`;
    return '时间待定';
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间待定';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function compactNumber(value) {
    const number = Number(value) || 0;
    if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
    return String(number);
}

function safePlaybackHref(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.includes('\x00') || value.includes('uploads/') || value.includes('streamKey=')) return '';
    try {
        const url = new URL(value, location.origin);
        if (value.startsWith('/api/')) return url.href;
        if (url.protocol !== 'https:') return '';
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) return '';
        return url.href;
    } catch {
        return '';
    }
}

import { followCreatorChannel, getCreatorChannel } from '../services/api.js';
import { esc, loadCSS } from '../core/html.js';
import '../components/poster-grid.js';

export async function render(container, params = {}) {
    const handle = String(params.handle || '').replace(/^@+/, '').trim().toLowerCase();
    loadCSS('styles/home.css');
    if (!handle) {
        container.innerHTML = '<div class="page-empty">创作者频道不存在</div>';
        return;
    }

    container.innerHTML = '<div class="page-loading">正在加载创作者频道...</div>';
    const data = await getCreatorChannel(handle).catch(() => null);
    if (!data?.channel) {
        container.innerHTML = '<div class="page-empty">创作者频道不存在或暂未公开</div>';
        return;
    }

    let { channel, videos, pinnedVideo, collections } = data;
    const renderPage = () => {
        const orderedVideos = pinnedVideo
            ? [pinnedVideo, ...(videos || []).filter((item) => item.id !== pinnedVideo.id)]
            : (videos || []);
        container.innerHTML = `
        <section class="catalog-section">
            <div class="continue-head">
                <div>
                    <h1 class="section-title">@${esc(channel.handle || handle)}</h1>
                    <div class="continue-count">${esc(channel.displayName || '创作者频道')} · ${Number(channel.publicVideos || videos.length || 0)} 个公开作品 · ${Number(channel.followerCount || 0).toLocaleString()} 人关注</div>
                </div>
                <div class="hero-actions">
                    <button class="primary-action follow-channel-btn ${channel.isFollowing ? 'active' : ''}" aria-pressed="${channel.isFollowing ? 'true' : 'false'}">
                        ${channel.isFollowing ? '已关注' : '关注频道'}
                    </button>
                    <a class="secondary-action" href="#/subscriptions">订阅更新</a>
                </div>
            </div>
            ${channel.bio ? `<p class="catalog-status">${esc(channel.bio)}</p>` : ''}
            ${channel.announcement ? `<div class="creator-channel-announcement"><strong>频道公告</strong><span>${esc(channel.announcement)}</span></div>` : ''}
            ${pinnedVideo ? `<div class="creator-channel-pinned"><strong>置顶作品</strong><span>${esc(pinnedVideo.title || '未命名作品')}</span></div>` : ''}
            ${renderCreatorCollections(collections || [])}
            <poster-grid id="creator-channel-grid"></poster-grid>
        </section>
    `;
        container.querySelector('#creator-channel-grid')?.render(orderedVideos, 'creator', { layout: 'grid' });
        bindFollowButton();
    };

    const bindFollowButton = () => {
        const button = container.querySelector('.follow-channel-btn');
        if (!button) return;
        button.addEventListener('click', async () => {
            const nextAction = channel.isFollowing ? 'unfollow' : 'follow';
            button.disabled = true;
            button.textContent = nextAction === 'follow' ? '关注中…' : '取消中…';
            try {
                const result = await followCreatorChannel(channel.handle || handle, nextAction);
                if (result?.channel) channel = result.channel;
                renderPage();
            } catch (error) {
                button.disabled = false;
                button.textContent = channel.isFollowing ? '已关注' : '关注频道';
                if (error?.status === 401) {
                    window.dispatchEvent(new CustomEvent('gy:auth-required', { detail: { reason: 'follow_creator' } }));
                    return;
                }
                button.title = '操作失败，请稍后重试';
            }
        });
    };

    renderPage();
}

function renderCreatorCollections(items) {
    if (!items.length) return '';
    return `
        <div class="creator-channel-collections">
            <strong>频道合集</strong>
            <div class="creator-channel-collection-list">
                ${items.map((item) => `
                    <article class="creator-channel-collection">
                        <span>${esc(item.title || '未命名合集')}</span>
                        <small>${Number(item.itemCount || 0)} 个作品${item.description ? ` · ${esc(item.description)}` : ''}</small>
                    </article>
                `).join('')}
            </div>
        </div>
    `;
}

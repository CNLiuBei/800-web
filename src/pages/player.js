// 播放页 — 接入独立 gy-player 播放器
// 职责：取流、剧集联动（上/下一集、自动连播）、把进度写回观看历史

import { getMeta, getStream } from '../services/api.js';
import { addHistory } from '../services/library.js';

const PLAYER_MODULE_URL = '/player/gy-player.js';
let playerModulePromise = null;

function loadPlayerModule() {
    if (!playerModulePromise) {
        playerModulePromise = import(PLAYER_MODULE_URL);
    }
    return playerModulePromise;
}

export async function render(container, params) {
    await loadPlayerModule();

    const { type, id, videoId } = params;

    const streamId = videoId || id;

    // 先取 meta（公开），再取流（需登录）。分开处理以便对「未登录/无权限」给出友好引导。
    const meta = await getMeta(type, id).catch(() => null);

    let streams;
    try {
        streams = await getStream(type, streamId);
    } catch (err) {
        // 未登录：提示并引导登录
        if (err?.needLogin) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <div class="empty-title">登录后即可观看</div>
                    <button class="empty-cta" id="player-login">登录 / 注册</button>
                    <a href="#/detail/${type}/${id}" class="empty-cta" style="background:transparent;border:1px solid var(--border);color:var(--fg);">返回详情</a>
                </div>
            `;
            container.querySelector('#player-login')?.addEventListener('click', async () => {
                const { default: AuthModal } = await import('../components/auth-modal.js');
                const modal = AuthModal.open('login');
                // 登录成功后重新进入播放页加载视频
                modal?.addEventListener('authenticated', async () => {
                    const { reloadRoute } = await import('../core/router.js');
                    reloadRoute();
                });
            });
            return;
        }
        // 无权限（如时长用尽）：提示
        if (err?.forbidden) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
                    </div>
                    <div class="empty-title">${err.message || '暂无观看权限'}</div>
                    <a href="#/vip" class="empty-cta">开通 VIP</a>
                </div>
            `;
            return;
        }
        // 其它错误：交给路由错误边界
        throw err;
    }

    if (!streams || streams.length === 0) {
        const { t } = await import('../services/i18n.js');
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10 8 6 4-6 4V8Z"/><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="3" y1="5" x2="21" y2="19"/></svg>
                </div>
                <div class="empty-title">${t('player.no_source')}</div>
                <a href="#/detail/${type}/${id}" class="empty-cta">返回详情</a>
            </div>
        `;
        return;
    }

    const title = meta?.name || '';
    const videos = meta?.videos || [];

    // 创建播放器（全屏覆盖）
    const player = document.createElement('gy-player');
    player.style.cssText = 'position:fixed;inset:0;z-index:300;';
    document.body.appendChild(player);

    // 加载态 logo：剧集 logo 优先，无则用网站 logo
    player.setLogo(meta?.logo || '/icons/logo.svg');

    // 当前播放的剧集索引（电影无 videos 时为 -1）
    let currentVid = videoId || null;

    // 把后端字幕格式 {id,url,lang,name} 映射为播放器格式 {url,lang,label,default}
    const mapSubtitles = (subs = []) => subs.map((s, i) => ({
        url: s.url,
        lang: s.lang,
        label: s.name || s.lang,
        default: i === 0,
    }));

    // 标题：剧集显示「剧名 · S1E1 · 集名」（紧凑格式，集号可达数千位也不冗长）
    const titleFor = (vid) => {
        if (!vid || videos.length === 0) return title;
        const v = videos.find((x) => x.id === vid);
        if (!v) return title;
        const parts = [title];
        // 季集编号：有季用 S{季}E{集}，无季仅 E{集}
        let code = '';
        if (v.season != null) code += `S${v.season}`;
        if (v.episode != null) code += `E${v.episode}`;
        if (code) parts.push(code);
        if (v.title) parts.push(v.title);
        return parts.join(' · ');
    };

    // 取某集的数字 episodeId（用于服务端历史按集追踪）
    const episodeIdFor = (vid) => {
        if (!vid || videos.length === 0) return null;
        return videos.find((x) => x.id === vid)?.episodeId ?? null;
    };

    // 加载某条流到播放器
    const loadInto = (stream, vid) => {
        player.loadStream(stream.url, {
            title: titleFor(vid),
            videoId: vid || id,
            poster: meta?.background || meta?.poster || '',
            subtitles: mapSubtitles(stream.subtitles),
        });
        updateEpisodeButtons(vid);
        player.setCurrentEpisode(vid); // 同步选集面板高亮
        // 记录观看历史
        if (meta) {
            addHistory({
                id, type, name: meta.name, poster: meta.poster, year: meta.year,
                videoId: vid, movieId: meta.movieId, episodeId: episodeIdFor(vid),
            });
        }
    };

    // 根据当前集刷新上一集/下一集按钮显隐
    const updateEpisodeButtons = (vid) => {
        if (videos.length === 0 || !vid) {
            player.showPrevButton(false);
            player.showNextButton(false);
            return;
        }
        const idx = videos.findIndex((v) => v.id === vid);
        player.showPrevButton(idx > 0);
        player.showNextButton(idx >= 0 && idx < videos.length - 1);
    };

    // 切换到相邻集（dir: +1 下一集 / -1 上一集）
    const switchEpisode = async (dir) => {
        if (videos.length === 0 || !currentVid) return;
        const idx = videos.findIndex((v) => v.id === currentVid);
        const target = videos[idx + dir];
        if (!target) return;
        await playEpisodeById(target.id);
    };

    // 按 id 直接切集（选集面板用）
    const playEpisodeById = async (vid) => {
        if (vid === currentVid) return;
        try {
            const nextStreams = await getStream(type, vid);
            if (nextStreams && nextStreams.length > 0) {
                currentVid = vid;
                loadInto(nextStreams[0], vid);
                history.replaceState(null, '', `#/play/${type}/${id}/${vid}`);
            } else {
                player.showHint?.('该集暂无播放源');
            }
        } catch (err) {
            // 切集时 session 可能已过期：提示用户，需要时引导重新登录
            if (err?.needLogin) {
                player.showHint?.('登录已过期，请重新登录');
                const { default: AuthModal } = await import('../components/auth-modal.js');
                AuthModal.open('login');
            } else if (err?.forbidden) {
                player.showHint?.(err.message || '无观看权限');
            } else {
                player.showHint?.('切换剧集失败，请重试');
            }
        }
    };

    // 首次加载
    loadInto(streams[0], currentVid);

    // 把剧集列表交给播放器（启用内置选集面板），并监听选集事件
    if (videos.length > 0) {
        player.setEpisodes(videos, currentVid);
        player.addEventListener('selectepisode', (e) => playEpisodeById(e.detail.id));
    }

    // 事件联动
    player.addEventListener('next', () => switchEpisode(1));
    player.addEventListener('prev', () => switchEpisode(-1));
    player.addEventListener('ended', () => switchEpisode(1)); // 自动连播
    player.addEventListener('back', () => history.back());

    // 进度写回观看历史（节流由播放器内部处理，默认每 5 秒）
    player.addEventListener('progress', (e) => {
        const { currentTime, duration, percent } = e.detail;
        if (meta) {
            addHistory({
                id, type, name: meta.name, poster: meta.poster, year: meta.year,
                videoId: currentVid, movieId: meta.movieId, episodeId: episodeIdFor(currentVid),
                progress: currentTime, duration, percent,
            });
        }
    });

    // 离开播放页时清理：销毁引擎 + 移除全屏覆盖层元素
    return () => {
        player.destroy();
        player.remove();
    };
}

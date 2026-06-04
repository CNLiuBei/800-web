// 详情页 —— Stremio 风格：全屏背景 + 左下信息 + 右侧剧集面板

import { getMeta, peekMeta } from '../services/api.js';
import { navigate, transition } from '../core/router.js';
import { esc, loadCSS } from '../core/html.js';
import { t } from '../services/i18n.js';
import { isFavorite, toggleFavorite } from '../services/library.js';
import { user, loading, initAuth } from '../services/auth.js';
import { dIcons } from './detail-icons.js';

// 播放前登录守卫：未登录则弹登录框并返回 false，已登录返回 true
async function ensureLogin() {
    if (user.value) return true;
    if (loading.value) {
        initAuth().catch(() => {});
        await waitForAuthReady();
        if (user.value) return true;
    }
    const { default: AuthModal } = await import('../components/auth-modal.js');
    AuthModal.open('login');
    return false;
}

function waitForAuthReady(timeoutMs = 8000) {
    if (!loading.value) return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; unsub?.(); clearTimeout(timer); resolve(); };
        const unsub = loading.subscribe?.(() => { if (!loading.value) finish(); });
        const timer = setTimeout(finish, timeoutMs);
    });
}

const EP_SEG_SIZE = 60; // 剧集分段容量（超过则分段，扛千集）

export async function render(container, params) {
    const { type, id } = params;
    loadCSS('styles/detail.css');

    // 命中预取缓存则同步返回（meta 已在内存），可跳过加载态直接整页渲染。
    const cached = peekMeta(type, id);

    // 未命中缓存：先在一次 View Transition 内切到详情页加载态，给出即时反馈，
    // 避免「点击后卡在旧页 / 被滚到顶部、几秒后才进详情」的假死观感。
    if (!cached) {
        await transition(() => {
            container.innerHTML = '<div class="detail-loading"><div class="spinner-small"></div></div>';
        });
    }

    // 取数据（命中缓存时瞬时返回）
    const meta = cached || await getMeta(type, id).catch(() => null);
    if (!meta) {
        await transition(() => { container.innerHTML = '<div class="page-empty">' + t('detail.notfound') + '</div>'; });
        return;
    }

    const hasEpisodes = meta.videos && meta.videos.length > 0;
    const faved = isFavorite(id);

    // 命中缓存：一次 View Transition 内从旧页直接整体渲染详情，平滑无中间态。
    // 未命中：上面已切到加载态，这里直接替换内容（同一详情页内，不再触发整页过渡，避免二次闪烁）。
    const renderDetail = () => { container.innerHTML = `
        <div class="detail-page ${hasEpisodes ? 'has-episodes' : ''}">
            <!-- 全屏背景 -->
            <div class="detail-bg">
                ${meta.background ? `<img src="${esc(meta.background)}" alt="" loading="eager" decoding="async">` : ''}
            </div>

            <!-- 移动端返回按钮（PWA 独立模式无浏览器返回键时可用）-->
            <button class="detail-back" id="detail-back" aria-label="返回">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>

            <!-- 沉浸首屏：左下信息 + 右侧剧集面板 -->
            <div class="detail-stage">
                <section class="detail-hero">
                    ${meta.logo ? `<img class="detail-logo" src="${esc(meta.logo)}" alt="${esc(meta.name)}">` : `<h1 class="detail-title">${esc(meta.name)}</h1>`}
                    <div class="detail-meta">
                        ${meta.year ? `<span>${esc(String(meta.year))}</span>` : ''}
                        ${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}
                        ${meta.imdbRating ? `<span class="detail-rating">${dIcons.star} ${esc(String(meta.imdbRating))}</span>` : ''}
                    </div>
                    ${meta.genres ? `<div class="detail-genres">${meta.genres.slice(0, 6).map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>` : ''}
                    ${meta.description ? `<p class="detail-desc">${esc(meta.description)}</p>` : ''}
                    <div class="detail-actions">
                        ${!hasEpisodes ? `<button class="play-btn" id="play-movie">${dIcons.play}<span>${t('detail.play')}</span></button>` : ''}
                        <button class="icon-btn fav-btn ${faved ? 'active' : ''}" id="fav-btn" aria-pressed="${faved}">
                            <span class="fav-icon">${faved ? dIcons.heartFilled : dIcons.heart}</span>
                            <span class="fav-label">${faved ? '已收藏' : '收藏'}</span>
                        </button>
                        <button class="icon-btn share-btn" id="share-btn">${dIcons.share}<span>分享</span></button>
                    </div>
                </section>

                ${hasEpisodes ? `<aside class="detail-side">${renderEpisodes(meta.videos)}</aside>` : ''}
            </div>

            <!-- 下方滚动区：演员 / 资料 / 评论 -->
            <div class="detail-below">
                ${renderCast(meta.cast)}
                ${renderInfo(meta)}
                <div class="detail-comments-anchor"></div>
            </div>
        </div>
    `; };

    // 命中缓存：整页 View Transition；未命中：已在加载态详情页内，直接替换内容
    if (cached) await transition(renderDetail);
    else renderDetail();

    // 背景图淡入（失败也标记 loaded，避免卡透明导致背景空白）
    const bgImg = container.querySelector('.detail-bg img');
    if (bgImg) {
        if (bgImg.complete && bgImg.naturalWidth > 0) bgImg.classList.add('loaded');
        else {
            bgImg.addEventListener('load', () => bgImg.classList.add('loaded'), { once: true });
            bgImg.addEventListener('error', () => bgImg.classList.add('loaded'), { once: true });
        }
    }
    // 详情 logo 加载失败则隐藏，避免破图
    const detailLogo = container.querySelector('.detail-logo');
    if (detailLogo) detailLogo.addEventListener('error', () => { detailLogo.style.display = 'none'; }, { once: true });

    // 返回按钮：有上一页则返回，否则回首页（兜底防止 PWA 独立模式卡死）
    container.querySelector('#detail-back')?.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigate('#/');
    });

    // 收藏
    const favBtn = container.querySelector('#fav-btn');
    favBtn.addEventListener('click', () => {
        const added = toggleFavorite({ id, type, name: meta.name, poster: meta.poster, year: meta.year, movieId: meta.movieId });
        favBtn.classList.toggle('active', added);
        favBtn.setAttribute('aria-pressed', added);
        favBtn.querySelector('.fav-icon').innerHTML = added ? dIcons.heartFilled : dIcons.heart;
        favBtn.querySelector('.fav-label').textContent = added ? '已收藏' : '收藏';
    });

    // 分享
    container.querySelector('#share-btn').addEventListener('click', async () => {
        const url = window.location.href;
        if (navigator.share) {
            navigator.share({ title: meta.name, url }).catch(() => {});
        } else {
            await navigator.clipboard.writeText(url).catch(() => {});
            const label = container.querySelector('#share-btn span:last-child');
            if (label) { const old = label.textContent; label.textContent = '已复制'; setTimeout(() => { label.textContent = old; }, 1500); }
        }
    });

    // 播放（电影）—— 未登录先引导登录
    if (!hasEpisodes) {
        container.querySelector('#play-movie')?.addEventListener('click', async () => {
            if (await ensureLogin()) navigate(`#/play/${type}/${id}`);
        });
    }

    // 剧集：季切换 + 分段 + 搜索 + 点击播放
    if (hasEpisodes) bindEpisodes(container, type, id, meta.videos);

    // 评论区：滚动到附近再加载
    lazyLoadComments(container, id);
}

// 右侧剧集面板骨架（季导航 + 搜索 + 分段容器 + 列表容器）
// 实际集号内容由 bindEpisodes 按「当前季当前段」填充，扛十几季几千集而 DOM 受控
function renderEpisodes(videos) {
    const seasons = {};
    videos.forEach(v => {
        const s = v.season || 1;
        (seasons[s] ||= []).push(v);
    });
    const seasonKeys = Object.keys(seasons).sort((a, b) => a - b);
    const multiSeason = seasonKeys.length > 1;

    return `
        <div class="side-head">
            <div class="season-nav">
                <button class="season-arrow" data-dir="-1" aria-label="上一季" ${multiSeason ? '' : 'disabled'}>${dIcons.chevronLeft || '‹'}</button>
                <button class="season-current" id="season-current" ${multiSeason ? '' : 'disabled'}>
                    <span class="season-label">${t('detail.season', { n: seasonKeys[0] })}</span>
                    ${multiSeason ? `<span class="season-caret">${dIcons.chevronDown || '⌄'}</span>` : ''}
                </button>
                <button class="season-arrow" data-dir="1" aria-label="下一季" ${multiSeason ? '' : 'disabled'}>${dIcons.chevronRight || '›'}</button>
            </div>
            <div class="side-search">
                <input type="search" class="side-search-input" placeholder="搜索剧集" aria-label="搜索剧集">
                <span class="side-search-icon">${dIcons.search || ''}</span>
            </div>
            <!-- 季下拉菜单（多季时）-->
            <div class="season-dropdown hidden" id="season-dropdown" role="listbox">
                ${seasonKeys.map(s => `<button class="season-option ${s === seasonKeys[0] ? 'active' : ''}" data-season="${s}" role="option">${t('detail.season', { n: s })}</button>`).join('')}
            </div>
        </div>
        <div class="episodes-segments hidden" role="tablist"></div>
        <div class="episodes-list" id="episodes-list"></div>
    `;
}

// 下方：演员（名字首字母头像卡片）
function renderCast(cast) {
    if (!cast || cast.length === 0) return '';
    const list = cast.slice(0, 12);
    return `
        <section class="detail-cast-section">
            <h2 class="detail-section-title">演员</h2>
            <div class="cast-grid">
                ${list.map(name => {
                    const n = esc(name);
                    const initial = esc((name || '?').trim().charAt(0).toUpperCase());
                    return `
                        <div class="cast-card" title="${n}">
                            <div class="cast-avatar">${initial}</div>
                            <div class="cast-name">${n}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

// 再下方：影视资料表
function renderInfo(meta) {
    const rows = [];
    if (meta.director?.length) rows.push(['导演', meta.director.map(esc).join('、')]);
    if (meta.cast?.length) rows.push(['主演', meta.cast.slice(0, 8).map(esc).join('、')]);
    if (meta.genres?.length) rows.push(['类型', meta.genres.map(esc).join('、')]);
    if (meta.year) rows.push(['年份', esc(String(meta.year))]);
    if (meta.runtime) rows.push(['时长', esc(meta.runtime)]);
    if (meta.imdbRating) rows.push(['评分', esc(String(meta.imdbRating))]);
    if (rows.length === 0) return '';
    return `
        <section class="detail-info-section">
            <h2 class="detail-section-title">影视资料</h2>
            <dl class="info-list">
                ${rows.map(([k, v]) => `<div class="info-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
            </dl>
        </section>
    `;
}

// 剧集交互：季切换（下拉/箭头）+ 搜索过滤 + 分段 + 当前段渲染（扛千集）
function bindEpisodes(container, type, id, videos) {
    const segWrap = container.querySelector('.episodes-segments');
    const listWrap = container.querySelector('.episodes-list');
    if (!segWrap || !listWrap) return;

    // 按季分组并排序
    const seasons = {};
    videos.forEach(v => { const s = v.season || 1; (seasons[s] ||= []).push(v); });
    Object.keys(seasons).forEach(s => seasons[s].sort((a, b) => (a.episode || 0) - (b.episode || 0)));
    const seasonKeys = Object.keys(seasons).sort((a, b) => a - b);

    const state = { season: seasonKeys[0], seg: 0, query: '' };

    const labelEl = container.querySelector('.season-label');
    const dropdown = container.querySelector('#season-dropdown');
    const searchInput = container.querySelector('.side-search-input');

    // 单集项 HTML
    const itemHtml = (ep) => `
        <button class="episode-item ${ep.available ? 'has-source' : ''}" data-video-id="${esc(ep.id)}">
            <div class="episode-line">
                <span class="episode-num">${ep.episode || ''}.</span>
                <span class="episode-title">${esc(ep.title || `第${ep.episode}集`)}</span>
                ${ep.available ? '<span class="episode-dot" title="可播放"></span>' : ''}
            </div>
            ${ep.released ? `<span class="episode-date">${formatDate(ep.released)}</span>` : ''}
        </button>
    `;

    // 渲染当前季当前段（无搜索时）/ 搜索结果（有搜索时）
    function renderItems() {
        const all = seasons[state.season] || [];
        let list;
        if (state.query) {
            const q = state.query.toLowerCase();
            list = all.filter(ep =>
                String(ep.episode).includes(q) ||
                (ep.title || '').toLowerCase().includes(q)
            ).slice(0, 200); // 搜索结果上限，防超大列表
        } else {
            const from = state.seg * EP_SEG_SIZE;
            list = all.slice(from, from + EP_SEG_SIZE);
        }
        listWrap.innerHTML = list.length
            ? list.map(itemHtml).join('')
            : '<div class="episodes-empty">没有匹配的剧集</div>';
        listWrap.scrollTop = 0;
    }

    // 渲染当前季的分段 chip（搜索时隐藏，不足一段时隐藏）
    function renderSegments() {
        const all = seasons[state.season] || [];
        const segCount = Math.ceil(all.length / EP_SEG_SIZE);
        if (state.query || segCount <= 1) {
            segWrap.classList.add('hidden');
            segWrap.innerHTML = '';
            return;
        }
        segWrap.classList.remove('hidden');
        let html = '';
        for (let i = 0; i < segCount; i++) {
            const f = i * EP_SEG_SIZE;
            const tIdx = Math.min(f + EP_SEG_SIZE, all.length);
            const a = all[f]?.episode ?? (f + 1);
            const b = all[tIdx - 1]?.episode ?? tIdx;
            html += `<button class="episodes-seg ${i === state.seg ? 'active' : ''}" data-seg="${i}" role="tab">${a}-${b}</button>`;
        }
        segWrap.innerHTML = html;
    }

    // 切季
    function switchSeason(season) {
        if (season === state.season || !seasons[season]) return;
        state.season = season;
        state.seg = 0;
        if (labelEl) labelEl.textContent = t('detail.season', { n: season });
        if (dropdown) dropdown.querySelectorAll('.season-option').forEach(o => o.classList.toggle('active', o.dataset.season === season));
        renderSegments();
        renderItems();
    }

    // 初始渲染
    renderSegments();
    renderItems();

    // 季下拉开关
    const seasonBtn = container.querySelector('#season-current');
    if (seasonBtn && dropdown) {
        seasonBtn.addEventListener('click', () => dropdown.classList.toggle('hidden'));
        dropdown.addEventListener('click', (e) => {
            const opt = e.target.closest('.season-option');
            if (!opt) return;
            switchSeason(opt.dataset.season);
            dropdown.classList.add('hidden');
        });
        // 点外部关闭
        document.addEventListener('click', (e) => {
            if (!seasonBtn.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
        });
    }

    // 上/下一季箭头
    container.querySelectorAll('.season-arrow').forEach(arrow => {
        arrow.addEventListener('click', () => {
            const idx = seasonKeys.indexOf(state.season);
            const next = seasonKeys[idx + parseInt(arrow.dataset.dir, 10)];
            if (next) switchSeason(next);
        });
    });

    // 搜索（防抖）
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                state.query = searchInput.value.trim();
                renderSegments();
                renderItems();
            }, 150);
        });
    }

    // 分段 chip 切换
    segWrap.addEventListener('click', (e) => {
        const seg = e.target.closest('.episodes-seg');
        if (!seg) return;
        const idx = parseInt(seg.dataset.seg, 10);
        if (idx === state.seg) return;
        state.seg = idx;
        segWrap.querySelectorAll('.episodes-seg').forEach(c => c.classList.toggle('active', c === seg));
        renderItems();
    });

    // 选某集 → 跳转播放（未登录先引导登录）
    listWrap.addEventListener('click', async (e) => {
        const item = e.target.closest('.episode-item');
        if (!item) return;
        if (await ensureLogin()) navigate(`#/play/${type}/${id}/${item.dataset.videoId}`);
    });
}

function lazyLoadComments(container, id) {
    const anchor = container.querySelector('.detail-comments-anchor');
    if (!anchor) return;
    const load = () => {
        import('../components/comments.js').then(() => {
            const comments = document.createElement('comment-section');
            comments.setAttribute('video-id', id);
            anchor.replaceWith(comments);
        });
    };
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) { io.disconnect(); load(); }
        }, { rootMargin: '300px' });
        io.observe(anchor);
    } else {
        load();
    }
}

function formatDate(d) {
    try { return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch { return ''; }
}

// 首页

import { getCatalog, getMeta } from '../services/api.js';
import { t } from '../services/i18n.js';
import { getRecentHistory } from '../services/history-lite.js';
import { esc } from '../core/html.js';
import { navigate } from '../core/router.js';
import '../components/poster-grid.js';

const idle = (task, timeout = 1200) => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout });
    else setTimeout(task, 0);
};

export async function render(container) {
    const recentHistory = getRecentHistory(5);

    container.innerHTML = `
        <div class="home-hero hero-loading" id="home-hero" aria-hidden="true"></div>
        ${recentHistory.length > 0 ? `
            <section class="catalog-section">
                <h2 class="section-title">继续观看</h2>
                <poster-grid id="grid-continue"></poster-grid>
            </section>
        ` : ''}
        <section class="catalog-section">
            <h2 class="section-title">${t('home.movie')}</h2>
            <poster-grid id="grid-movie"></poster-grid>
        </section>
        <section class="catalog-section">
            <h2 class="section-title">${t('home.tv')}</h2>
            <poster-grid id="grid-tv"></poster-grid>
        </section>
        <section class="catalog-section">
            <h2 class="section-title">${t('home.anime')}</h2>
            <poster-grid id="grid-anime"></poster-grid>
        </section>
    `;

    // 骨架屏（横向滑动行）
    container.querySelector('#grid-movie').showSkeleton(10, { layout: 'row' });
    container.querySelector('#grid-tv').showSkeleton(10, { layout: 'row' });
    container.querySelector('#grid-anime').showSkeleton(10, { layout: 'row' });

    // 继续观看
    if (recentHistory.length > 0) {
        container.querySelector('#grid-continue').render(recentHistory, recentHistory[0]?.type || 'movie', { layout: 'row' });
    }

    // 并行加载（容错：单个分类失败不影响其他，离线时尽量展示已缓存内容）
    const [moviesR, tvsR, animesR] = await Promise.allSettled([
        getCatalog('movie', 'guangying-movie'),
        getCatalog('series', 'guangying-tv'),
        getCatalog('series', 'guangying-anime'),
    ]);
    const movies = moviesR.status === 'fulfilled' ? moviesR.value : [];
    const tvs = tvsR.status === 'fulfilled' ? tvsR.value : [];
    const animes = animesR.status === 'fulfilled' ? animesR.value : [];

    // 三个分类都失败（通常是离线且无缓存）→ 抛错走路由错误页统一兜底
    if (!movies.length && !tvs.length && !animes.length) {
        throw new Error('内容加载失败');
    }

    container.querySelector('#grid-movie').render(movies.slice(0, 12), 'movie', { layout: 'row' });
    container.querySelector('#grid-tv').render(tvs.slice(0, 12), 'series', { layout: 'row' });
    container.querySelector('#grid-anime').render(animes.slice(0, 12), 'series', { layout: 'row' });

    // Hero：精选影片沉浸式轮播（混合电影+剧集前几部）
    const heroEl = container.querySelector('#home-hero');
    const featured = [...movies.slice(0, 3), ...tvs.slice(0, 2)].filter(Boolean).slice(0, 5);
    renderHero(heroEl, await hydrateFirstHeroItem(featured));

    // 离开首页时停止轮播定时器，避免后台空跑
    return () => { heroEl?._heroStop?.(); };
}

async function hydrateFirstHeroItem(items) {
    if (!items.length) return items;
    const [first, ...rest] = items;
    const type = first.type === 'series' ? 'series' : 'movie';
    const meta = await getMeta(type, first.id).catch(() => null);
    if (!meta) return items;
    return [{ ...first, ...meta, type }, ...rest];
}

// 精选影片沉浸式轮播 Hero
async function renderHero(el, items) {
    if (!el || items.length === 0) { el?.remove(); return; }
    el.removeAttribute('aria-hidden');
    el.classList.remove('hero-loading');

    const slides = items.map((item) => {
        const type = item.type === 'series' ? 'series' : 'movie';
        return {
            id: item.id,
            type,
            name: item.name,
            bg: item.background || item.poster || '',
            logo: item.logo || '',
            desc: item.description || '',
            year: item.year || '',
            rating: item.imdbRating || '',
        };
    });

    el.innerHTML = `
        <div class="hero-slides">
            ${slides.map((s, i) => `
                <div class="hero-slide ${i === 0 ? 'active' : ''}" data-i="${i}">
                    <div class="hero-bg"><img src="${esc(s.bg)}" alt="" decoding="async" ${i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}></div>
                    <div class="hero-content">
                        ${s.logo
                            ? `<img class="hero-logo" src="${esc(s.logo)}" alt="${esc(s.name)}">`
                            : `<h1 class="hero-title">${esc(s.name)}</h1>`}
                        <div class="hero-meta">
                            ${s.year ? `<span>${esc(String(s.year))}</span>` : ''}
                            ${s.rating ? `<span class="hero-rating">★ ${esc(String(s.rating))}</span>` : ''}
                            <span class="hero-type">${s.type === 'series' ? '剧集' : '电影'}</span>
                        </div>
                        ${s.desc ? `<p class="hero-desc">${esc(s.desc)}</p>` : ''}
                        <button class="hero-play" data-id="${esc(s.id)}" data-type="${s.type}">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.74l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>
                            <span>立即观看</span>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
        ${slides.length > 1 ? `<div class="hero-dots">${slides.map((_, i) => `<button class="hero-dot ${i === 0 ? 'active' : ''}" data-i="${i}" aria-label="第${i + 1}个"></button>`).join('')}</div>` : ''}
    `;

    // 首图淡入（失败也标记 loaded，避免卡在透明导致首屏空白）
    const firstImg = el.querySelector('.hero-slide.active .hero-bg img');
    if (firstImg) {
        markHeroImageReady(firstImg);
    }

    // 点击播放 → 进详情
    el.querySelectorAll('.hero-play').forEach((btn) => {
        btn.addEventListener('click', () => navigate(`#/detail/${btn.dataset.type}/${btn.dataset.id}`));
    });

    // logo 图加载失败则隐藏，避免破图占位
    el.querySelectorAll('.hero-logo').forEach((logo) => {
        logo.addEventListener('error', () => { logo.style.display = 'none'; }, { once: true });
    });

    idle(() => enrichHero(el, slides), 1600);

    if (slides.length <= 1) return;

    // 轮播逻辑
    const slideEls = [...el.querySelectorAll('.hero-slide')];
    const dotEls = [...el.querySelectorAll('.hero-dot')];
    let cur = 0;
    let timer = null;

    const goTo = (i) => {
        if (i === cur) return;
        slideEls[cur].classList.remove('active');
        dotEls[cur].classList.remove('active');
        cur = i;
        slideEls[cur].classList.add('active');
        dotEls[cur].classList.add('active');
        // 懒加载当前图并淡入（失败也标记 loaded，避免卡透明）
        const img = slideEls[cur].querySelector('.hero-bg img');
        if (img && !img.classList.contains('loaded')) {
            markHeroImageReady(img);
        }
    };
    const next = () => goTo((cur + 1) % slideEls.length);
    const start = () => { stop(); timer = setInterval(next, 6000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    dotEls.forEach((dot, i) => {
        dot.addEventListener('click', () => { goTo(i); start(); });
    });
    // 鼠标悬停暂停轮播
    el.addEventListener('mouseenter', stop);
    el.addEventListener('mouseleave', start);
    // 触屏：手指触摸时暂停，松开后恢复（避免阅读简介时被切走）
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchend', start, { passive: true });

    // 触屏左右滑动切换 Hero（横向滑动达阈值时切上/下一张）
    let swipeX = 0, swipeY = 0, swiping = false;
    el.addEventListener('touchstart', (e) => {
        const tp = e.touches[0];
        swipeX = tp.clientX; swipeY = tp.clientY; swiping = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const tp = e.changedTouches[0];
        const dx = tp.clientX - swipeX;
        const dy = tp.clientY - swipeY;
        // 横向位移足够大且明显大于纵向（排除竖向滚动）才触发
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            goTo(dx < 0 ? (cur + 1) % slideEls.length : (cur - 1 + slideEls.length) % slideEls.length);
            start();
        }
    }, { passive: true });

    start();

    // 页面离开时清理定时器（用 IntersectionObserver 检测移出视口也停）
    el._heroStop = stop;
}

async function enrichHero(el, slides) {
    if (!el?.isConnected) return;
    await Promise.all(slides.map(async (slide, i) => {
        const meta = await getMeta(slide.type, slide.id).catch(() => null);
        if (!meta || !el.isConnected) return;
        const slideEl = el.querySelector(`.hero-slide[data-i="${i}"]`);
        if (slideEl?.classList.contains('active')) return;
        const bg = meta.background || meta.poster;
        if (bg) {
            const img = slideEl?.querySelector('.hero-bg img');
            if (img && img.getAttribute('src') !== bg) {
                await preloadHeroImage(bg);
                if (!el.isConnected) return;
                if (slideEl?.classList.contains('active')) return;
                img.src = bg;
                img.classList.add('loaded');
            }
        }
        const logo = meta.logo;
        const title = slideEl?.querySelector('.hero-title');
        if (logo && title) {
            const img = Object.assign(document.createElement('img'), {
                className: 'hero-logo',
                src: logo,
                alt: slide.name,
            });
            img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
            title.replaceWith(img);
        }
        const desc = meta.description;
        const content = slideEl?.querySelector('.hero-content');
        if (desc && content && !content.querySelector('.hero-desc')) {
            const p = document.createElement('p');
            p.className = 'hero-desc';
            p.textContent = desc;
            const play = content.querySelector('.hero-play');
            content.insertBefore(p, play);
        }
    }));
}

function preloadHeroImage(src) {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = async () => {
            try {
                if (image.decode) await image.decode();
            } catch {}
            resolve();
        };
        image.onerror = () => resolve();
        image.src = src;
    });
}

async function markHeroImageReady(img) {
    if (!img) return;
    try {
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        }
        if (img.decode && img.naturalWidth > 0) await img.decode();
    } catch {}
    img.classList.add('loaded');
}

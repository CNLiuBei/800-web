// 求片页面 —— 提交想看的影视、为他人求片投票、查看处理进度

import { esc, loadCSS } from '../core/html.js';
import { pageHeaderHTML } from '../components/page-header.js';
import { setPageMeta } from '../core/head.js';
import { user } from '../services/auth.js';
import { showSiteNotice } from '../services/site-notice.js';
import { getUnifiedSearch, getMeta } from '../services/api.js';
import {
    listMovieRequests,
    listMyMovieRequests,
    submitMovieRequest,
    voteMovieRequest,
    unvoteMovieRequest,
    withdrawMovieRequest,
    parseTmdbInput,
    looksLikeTmdbInput,
    buildMovieRequestUrl,
    tmdbSearchUrl,
    tmdbDetailUrl,
    REQUEST_STATUS_LABEL,
    mediaTypeLabel,
} from '../services/requests.js';

const TABS = [
    { key: 'votes', label: '热门求片' },
    { key: 'latest', label: '最新求片' },
    { key: 'mine', label: '我的求片', auth: true },
];
const PAGE_SIZE = 20;

export async function render(container, params = {}) {
    await loadCSS('styles/layout.css');
    await loadCSS('styles/requests.css');

    setPageMeta({
        title: '求片 - 800影视',
        description: '提交想看的电影或剧集，为他人求片投票，热度越高越优先收录。',
        url: window.location.href,
    });

    const state = {
        tab: 'votes',
        loading: false,
        page: 1,
        items: [],
        hasMore: false,
        tmdb: null, // { tmdbId, mediaType, title, year }
        tmdbLookupSeq: 0,
        searchSeq: 0,
    };

    container.innerHTML = `
        <section class="catalog-section requests-page">
            ${pageHeaderHTML({
                eyebrow: '求片',
                title: '想看却没有？发起求片',
                description: '提交你想看的电影或剧集，热度越高越优先收录。填写 TMDB ID 可更准确去重与匹配。',
            })}
            <div class="requests-intro" aria-label="求片说明">
                <div class="requests-intro-item"><strong>1</strong><span>填写片名，或粘贴 TMDB 链接自动识别</span></div>
                <div class="requests-intro-item"><strong>2</strong><span>他人可为你 +1 想看，热度越高越优先</span></div>
                <div class="requests-intro-item"><strong>3</strong><span>收录后会通知，可在「我的求片」查看进度</span></div>
            </div>
            <div class="requests-form-shell" id="req-form-shell">
                <button class="requests-form-summary" id="req-form-toggle" type="button" aria-expanded="true" aria-controls="req-form">发起求片</button>
                <div class="requests-form-card" id="req-form">
                <div class="requests-form-row">
                    <div class="requests-title-wrap">
                        <input class="requests-input requests-input-title" id="req-title" type="text" maxlength="120" autocomplete="off" placeholder="片名（必填）— 输入可联想匹配影片" />
                        <div class="requests-suggest" id="req-suggest" hidden></div>
                    </div>
                    <input class="requests-input requests-input-year" id="req-year" type="number" inputmode="numeric" placeholder="年份" />
                    <select class="requests-input requests-input-type" id="req-type">
                        <option value="">类型</option>
                        <option value="movie">电影</option>
                        <option value="tv">剧集</option>
                    </select>
                </div>
                <div class="requests-form-row requests-tmdb-row">
                    <div class="requests-tmdb-input-wrap">
                        <input class="requests-input requests-input-tmdb" id="req-tmdb" type="text" autocomplete="off" placeholder="粘贴 TMDB 链接或 ID，自动识别片名/年份/类型" />
                        <button class="requests-tmdb-paste" id="req-tmdb-paste" type="button" title="从剪贴板粘贴 TMDB 链接">粘贴</button>
                    </div>
                    <details class="requests-tmdb-help">
                        <summary>如何查询 TMDB ID？</summary>
                        <div class="requests-tmdb-help-body">
                            <p>TMDB 是公开影视数据库，填写 ID 后我们能更准确识别影片、合并重复求片。</p>
                            <ol>
                                <li>打开 <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">themoviedb.org</a>，搜索你要的片名。</li>
                                <li>进入详情页后，看浏览器地址栏里的数字即为 ID。</li>
                                <li>电影链接形如 <code>themoviedb.org/movie/27205</code> → ID 是 27205。</li>
                                <li>剧集链接形如 <code>themoviedb.org/tv/1396</code> → ID 是 1396，类型选「剧集」。</li>
                            </ol>
                            <p class="requests-tmdb-help-tip">可直接粘贴完整链接到上方输入框，或点「粘贴」读取剪贴板；若只填数字，请手动选择电影/剧集。</p>
                            <a class="requests-tmdb-search" id="req-tmdb-search" href="https://www.themoviedb.org/search" target="_blank" rel="noopener noreferrer" hidden>在 TMDB 搜索</a>
                        </div>
                    </details>
                </div>
                <div class="requests-linked" id="req-linked" hidden></div>
                <textarea class="requests-input requests-input-note" id="req-note" maxlength="500" rows="2" placeholder="补充说明（可选）：导演、主演、上映信息等，方便确认"></textarea>
                <div class="requests-form-foot">
                    <span class="requests-form-msg" id="req-msg"></span>
                    <span class="requests-note-count" id="req-note-count">0/500</span>
                    <button class="requests-submit" id="req-submit" type="button">提交求片</button>
                </div>
                </div>
            </div>
            <div class="requests-tabs" id="req-tabs">
                ${TABS.map((tab) => `<button class="requests-tab${tab.key === state.tab ? ' active' : ''}" data-tab="${tab.key}" type="button">${esc(tab.label)}</button>`).join('')}
            </div>
            <div class="requests-list" id="req-list"></div>
            <div class="requests-more" id="req-more" hidden>
                <button class="requests-more-btn" id="req-more-btn" type="button">加载更多</button>
            </div>
        </section>
    `;

    bindForm(container, state);
    bindFormShell(container);
    bindTabs(container, state);
    bindLoadMore(container, state);
    bindEmptyActions(container, state);
    applyRoutePrefill(container, state, params);
    await loadList(container, state);

    // 离开页面时关闭联想下拉的全局监听
    const onDocClick = (e) => {
        if (!e.target.closest('.requests-title-wrap')) hideSuggest(container);
    };
    document.addEventListener('click', onDocClick);
    return () => {
        document.removeEventListener('click', onDocClick);
        if (state._titleDebounce) clearTimeout(state._titleDebounce);
        if (state._tmdbDebounce) clearTimeout(state._tmdbDebounce);
        state.searchSeq += 1;
    };
}

function bindFormShell(container) {
    const shell = container.querySelector('#req-form-shell');
    const toggle = container.querySelector('#req-form-toggle');
    const mq = window.matchMedia('(max-width: 640px)');

    const syncShell = () => {
        const mobile = mq.matches;
        shell?.classList.toggle('is-mobile', mobile);
        if (!mobile) {
            shell?.classList.add('is-open');
            toggle?.setAttribute('aria-expanded', 'true');
        } else if (!shell?.classList.contains('is-open')) {
            toggle?.setAttribute('aria-expanded', 'false');
        }
    };

    syncShell();
    mq.addEventListener?.('change', syncShell);

    toggle?.addEventListener('click', () => {
        if (!mq.matches) return;
        const open = shell?.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
}

function setRequestFormOpen(container, open) {
    const shell = container.querySelector('#req-form-shell');
    const toggle = container.querySelector('#req-form-toggle');
    if (!shell) return;
    if (window.matchMedia('(max-width: 640px)').matches) {
        shell.classList.toggle('is-open', open);
        toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
    } else {
        shell.classList.add('is-open');
        toggle?.setAttribute('aria-expanded', 'true');
    }
}

// ---- 提交表单 ----

function bindForm(container, state) {
    const titleInput = container.querySelector('#req-title');
    const noteInput = container.querySelector('#req-note');
    const tmdbInput = container.querySelector('#req-tmdb');
    const typeSelect = container.querySelector('#req-type');
    const pasteBtn = container.querySelector('#req-tmdb-paste');
    const submitBtn = container.querySelector('#req-submit');

    // 备注字数
    noteInput?.addEventListener('input', () => {
        const count = container.querySelector('#req-note-count');
        if (count) count.textContent = `${noteInput.value.length}/500`;
    });

    // 片名联想（防抖）
    titleInput?.addEventListener('input', () => {
        updateTmdbHelpSearchLink(container);
        const q = titleInput.value.trim();
        if (state._titleDebounce) clearTimeout(state._titleDebounce);
        if (q.length < 2) { hideSuggest(container); return; }
        state._titleDebounce = setTimeout(() => searchSuggest(container, state, q), 280);
    });
    titleInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn?.click(); }
        if (e.key === 'Escape') hideSuggest(container);
    });
    titleInput?.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text')?.trim();
        if (!text || !looksLikeTmdbInput(text)) return;
        e.preventDefault();
        if (tmdbInput) tmdbInput.value = text;
        applyTmdbInput(container, state, { autofill: true });
    });

    // TMDB ID / 链接输入
    tmdbInput?.addEventListener('input', () => {
        if (state._tmdbDebounce) clearTimeout(state._tmdbDebounce);
        state._tmdbDebounce = setTimeout(() => applyTmdbInput(container, state), 320);
    });
    tmdbInput?.addEventListener('paste', () => {
        if (state._tmdbDebounce) clearTimeout(state._tmdbDebounce);
        setTimeout(() => applyTmdbInput(container, state, { autofill: true }), 0);
    });
    tmdbInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn?.click(); }
    });

    typeSelect?.addEventListener('change', () => {
        const raw = tmdbInput?.value.trim();
        if (!raw) return;
        applyTmdbInput(container, state);
    });

    pasteBtn?.addEventListener('click', async () => {
        if (!tmdbInput) return;
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (!text) { setMsg(container, '剪贴板为空', 'err'); return; }
            tmdbInput.value = text;
            applyTmdbInput(container, state, { autofill: true });
            setMsg(container, '');
        } catch {
            setMsg(container, '无法读取剪贴板，请手动粘贴到输入框', 'err');
        }
    });

    submitBtn?.addEventListener('click', () => handleSubmit(container, state));
}

function applyRoutePrefill(container, state, params = {}) {
    const query = params.query || new URLSearchParams();
    const title = query.get('title');
    const year = query.get('year');
    const type = query.get('type') || query.get('mediaType');
    const tmdbRaw = query.get('tmdbId') || query.get('tmdbRef');
    const tab = query.get('tab');

    if (title) container.querySelector('#req-title').value = title;
    if (year) container.querySelector('#req-year').value = year;
    if (type === 'movie' || type === 'tv') container.querySelector('#req-type').value = type;
    if (tmdbRaw) container.querySelector('#req-tmdb').value = tmdbRaw;
    if (tab && TABS.some((item) => item.key === tab)) {
        state.tab = tab;
        container.querySelectorAll('.requests-tab').forEach((el) => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
    }

    updateTmdbHelpSearchLink(container);
    if (tmdbRaw) applyTmdbInput(container, state);

    if (title || tmdbRaw) {
        setRequestFormOpen(container, true);
        container.querySelector('#req-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function updateTmdbHelpSearchLink(container) {
    const title = container.querySelector('#req-title')?.value.trim();
    const link = container.querySelector('#req-tmdb-search');
    if (!link) return;
    if (!title) {
        link.hidden = true;
        return;
    }
    link.href = tmdbSearchUrl(title);
    link.textContent = `在 TMDB 搜索「${title.length > 24 ? `${title.slice(0, 24)}…` : title}」`;
    link.hidden = false;
}

async function searchSuggest(container, state, q) {
    const box = container.querySelector('#req-suggest');
    if (!box) return;
    const seq = ++state.searchSeq;
    try {
        const data = await getUnifiedSearch({ type: 'all', search: q, page: 1 });
        if (seq !== state.searchSeq) return; // 已有更新的输入
        const items = (data.groups || []).flatMap((g) => g.items || []).slice(0, 6);
        if (!items.length) { hideSuggest(container); return; }
        box.innerHTML = items.map((item) => {
            const mediaType = item.type === 'movie' ? 'movie' : 'tv';
            return `
                <button class="requests-suggest-item" type="button"
                    data-tmdb="${esc(String(item.tmdbId))}"
                    data-mtype="${mediaType}"
                    data-title="${esc(item.name)}"
                    data-year="${esc(String(item.year || ''))}">
                    <span class="requests-suggest-name">${esc(item.name)}</span>
                    <span class="requests-suggest-meta">${esc([mediaTypeLabel(mediaType), item.year, item.tmdbId ? `TMDB ${item.tmdbId}` : ''].filter(Boolean).join(' · '))}</span>
                </button>`;
        }).join('');
        box.hidden = false;
        if (window.matchMedia('(max-width: 640px)').matches) {
            box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        box.querySelectorAll('.requests-suggest-item').forEach((btn) => {
            btn.addEventListener('click', () => pickSuggest(container, state, btn.dataset));
        });
    } catch {
        hideSuggest(container);
    }
}

function pickSuggest(container, state, ds) {
    const tmdbId = Number(ds.tmdb) || null;
    const mediaType = ds.mtype === 'movie' ? 'movie' : 'tv';
    state.tmdb = tmdbId ? { tmdbId, mediaType, title: ds.title, year: ds.year } : null;
    container.querySelector('#req-title').value = ds.title || '';
    if (ds.year) container.querySelector('#req-year').value = ds.year;
    container.querySelector('#req-type').value = mediaType;
    const tmdbInput = container.querySelector('#req-tmdb');
    if (tmdbInput && tmdbId) tmdbInput.value = String(tmdbId);
    hideSuggest(container);
    renderLinkedChip(container, state);
}

function applyTmdbInput(container, state, { autofill = false } = {}) {
    const tmdbInput = container.querySelector('#req-tmdb');
    const typeSelect = container.querySelector('#req-type');
    const raw = tmdbInput?.value.trim() || '';
    if (!raw) {
        state.tmdb = null;
        renderLinkedChip(container, state);
        return;
    }

    const parsed = parseTmdbInput(raw);
    if (!parsed) {
        state.tmdb = null;
        renderLinkedChip(container, state, 'TMDB 格式不正确，请粘贴 themoviedb.org 链接或数字 ID');
        return;
    }

    const fromLink = /themoviedb\.org/i.test(raw) || /^tmdb:/i.test(raw);
    const mediaType = parsed.mediaType || (typeSelect?.value === 'movie' || typeSelect?.value === 'tv' ? typeSelect.value : null);
    if (!mediaType) {
        state.tmdb = { tmdbId: parsed.tmdbId, mediaType: null, title: '', year: '' };
        renderLinkedChip(container, state, '已识别 ID，请选择类型（电影/剧集）以完成关联');
        return;
    }

    if (parsed.mediaType && typeSelect && typeSelect.value !== parsed.mediaType) {
        typeSelect.value = parsed.mediaType;
    }
    if (tmdbInput && fromLink) {
        tmdbInput.value = String(parsed.tmdbId);
    }

    state.tmdb = { tmdbId: parsed.tmdbId, mediaType, title: state.tmdb?.title || '', year: state.tmdb?.year || '' };
    renderLinkedChip(container, state, '正在识别 TMDB 信息…');
    lookupTmdbMeta(container, state, parsed.tmdbId, mediaType, { overwrite: autofill || fromLink });
}

async function lookupTmdbMeta(container, state, tmdbId, mediaType, { overwrite = false } = {}) {
    const seq = ++state.tmdbLookupSeq;
    try {
        const pageType = mediaType === 'movie' ? 'movie' : 'series';
        const meta = await getMeta(pageType, `tmdb:${mediaType}:${tmdbId}`);
        if (seq !== state.tmdbLookupSeq || !meta || state.tmdb?.tmdbId !== tmdbId) return;

        state.tmdb = {
            tmdbId,
            mediaType,
            title: meta.name || state.tmdb?.title || '',
            year: meta.year || state.tmdb?.year || '',
        };

        const titleInput = container.querySelector('#req-title');
        const yearInput = container.querySelector('#req-year');
        const typeSelect = container.querySelector('#req-type');
        if (titleInput && meta.name && (overwrite || !titleInput.value.trim())) titleInput.value = meta.name;
        if (yearInput && meta.year && (overwrite || !yearInput.value.trim())) yearInput.value = String(meta.year);
        if (typeSelect && mediaType) typeSelect.value = mediaType;
        renderLinkedChip(container, state);
        if (meta.name) {
            showSiteNotice(`已识别：${meta.name}${meta.year ? `（${meta.year}）` : ''}`, {
                tone: 'success',
                id: 'requests-notice',
                duration: 2800,
            });
        }
    } catch {
        if (seq === state.tmdbLookupSeq && state.tmdb?.tmdbId === tmdbId) {
            renderLinkedChip(container, state, '未能从 TMDB 拉取详情，请确认 ID 与类型是否正确');
            showSiteNotice('TMDB 详情拉取失败，请确认链接与类型', { tone: 'error', id: 'requests-notice' });
        }
    }
}

function renderLinkedChip(container, state, hint = '') {
    const linked = container.querySelector('#req-linked');
    if (!linked) return;

    if (!state.tmdb?.tmdbId) {
        linked.hidden = true;
        linked.innerHTML = hint ? `<span class="requests-linked-hint">${esc(hint)}</span>` : '';
        linked.hidden = !hint;
        return;
    }

    const typeText = state.tmdb.mediaType ? mediaTypeLabel(state.tmdb.mediaType) : '待选类型';
    const label = state.tmdb.title
        ? `${state.tmdb.title}${state.tmdb.year ? `（${state.tmdb.year}）` : ''}`
        : `TMDB ${state.tmdb.tmdbId}`;

    linked.hidden = false;
    linked.innerHTML = `
        <span class="requests-linked-chip">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            已关联：${esc(label)} · ${esc(typeText)} · ID ${esc(String(state.tmdb.tmdbId))}
            <button class="requests-linked-clear" id="req-linked-clear" type="button" aria-label="取消关联">×</button>
        </span>
        ${hint ? `<span class="requests-linked-hint">${esc(hint)}</span>` : ''}`;
    linked.querySelector('#req-linked-clear')?.addEventListener('click', () => clearLinked(container, state, true));
}

function clearLinked(container, state, resetType = false) {
    if (!state.tmdb && !container.querySelector('#req-tmdb')?.value && container.querySelector('#req-linked')?.hidden) return;
    state.tmdb = null;
    state.tmdbLookupSeq += 1;
    const tmdbInput = container.querySelector('#req-tmdb');
    if (tmdbInput) tmdbInput.value = '';
    const linked = container.querySelector('#req-linked');
    if (linked) { linked.hidden = true; linked.innerHTML = ''; }
    if (resetType) container.querySelector('#req-type').value = '';
}

function hideSuggest(container) {
    const box = container.querySelector('#req-suggest');
    if (box) { box.hidden = true; box.innerHTML = ''; }
}

async function handleSubmit(container, state) {
    if (!(await ensureLogin())) return;
    const submitBtn = container.querySelector('#req-submit');

    const title = container.querySelector('#req-title').value.trim();
    const yearRaw = container.querySelector('#req-year').value.trim();
    let mediaType = container.querySelector('#req-type').value || undefined;
    const note = container.querySelector('#req-note').value.trim() || undefined;
    const tmdbRaw = container.querySelector('#req-tmdb')?.value.trim() || '';

    if (!title) { setMsg(container, '请填写片名', 'err'); return; }
    const year = yearRaw ? Number(yearRaw) : undefined;
    if (yearRaw && !Number.isInteger(year)) { setMsg(container, '年份格式不正确', 'err'); return; }

    let tmdbId;
    let tmdbRef;
    if (tmdbRaw) {
        const parsed = parseTmdbInput(tmdbRaw);
        if (!parsed) { setMsg(container, 'TMDB 格式不正确，请填写数字或 themoviedb.org 链接', 'err'); return; }
        if (parsed.mediaType) mediaType = parsed.mediaType;
        else if (!mediaType) { setMsg(container, '填写 TMDB ID 后请选择类型（电影/剧集）', 'err'); return; }
        if (/themoviedb\.org/i.test(tmdbRaw) || /^tmdb:/i.test(tmdbRaw)) {
            tmdbRef = tmdbRaw;
        } else {
            tmdbId = parsed.tmdbId;
        }
    } else if (state.tmdb?.tmdbId) {
        tmdbId = state.tmdb.tmdbId;
        if (state.tmdb.mediaType) mediaType = state.tmdb.mediaType;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    setMsg(container, '');
    try {
        const payload = { title, year, mediaType, note };
        if (tmdbRef) payload.tmdbRef = tmdbRef;
        else if (tmdbId) payload.tmdbId = tmdbId;
        const res = await submitMovieRequest(payload);
        const merged = res?.id && res?.voteCount > 1 && res?.status === 'pending';
        setMsg(container, merged ? '已有相同求片，已为你 +1 想看' : '求片已提交，感谢支持', 'ok');
        resetForm(container, state);
        setRequestFormOpen(container, false);
        if (state.tab === 'mine') await loadList(container, state);
        else switchTab(container, state, 'latest');
        if (merged && res?.id) highlightRequestCard(container, res.id);
    } catch (error) {
        setSubmitError(container, error);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交求片';
    }
}

function resetForm(container, state) {
    container.querySelector('#req-title').value = '';
    container.querySelector('#req-year').value = '';
    container.querySelector('#req-type').value = '';
    container.querySelector('#req-tmdb').value = '';
    container.querySelector('#req-note').value = '';
    const count = container.querySelector('#req-note-count');
    if (count) count.textContent = '0/500';
    clearLinked(container, state);
}

function setSubmitError(container, error) {
    const msg = container.querySelector('#req-msg');
    if (msg) {
        msg.textContent = '';
        msg.className = 'requests-form-msg hidden';
    }

    if (error?.status === 409 && error?.movieId) {
        const mediaType = container.querySelector('#req-type')?.value;
        const detailType = mediaType === 'tv' ? 'series' : 'movie';
        showSiteNotice('该影片已上线', {
            id: 'requests-notice',
            tone: 'success',
            action: { label: '去观看', href: `#/detail/${detailType}/${error.movieId}` },
        });
        return;
    }
    showSiteNotice(submitErrorText(error), { id: 'requests-notice', tone: 'error' });
}

function submitErrorText(error) {
    if (error?.status === 401) return '请先登录后再提交';
    if (error?.status === 409) return '该影片已上线，去搜索看看吧';
    if (error?.reason === 'blocked_term') return '内容包含违规词，请修改后重试';
    if (error?.status === 429) return error.message || '提交过于频繁，请稍后再试';
    return error?.message || '提交失败，请稍后重试';
}

// ---- 标签与列表 ----

function bindTabs(container, state) {
    container.querySelector('#req-tabs')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.requests-tab');
        if (!btn) return;
        const tab = btn.dataset.tab;
        if (tab === state.tab) return;
        if (tab === 'mine' && !user.value) {
            if (!(await ensureLogin())) return;
        }
        switchTab(container, state, tab);
    });
}

function bindLoadMore(container, state) {
    container.querySelector('#req-more-btn')?.addEventListener('click', () => loadList(container, state, true));
}

function switchTab(container, state, tab) {
    state.tab = tab;
    container.querySelectorAll('.requests-tab').forEach((el) => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    loadList(container, state);
}

async function loadList(container, state, append = false) {
    const list = container.querySelector('#req-list');
    if (!list || state.loading) return;
    state.loading = true;

    if (append) {
        state.page += 1;
    } else {
        state.page = 1;
        state.items = [];
        list.innerHTML = skeletonHTML();
    }
    toggleMore(container, false);

    try {
        const data = state.tab === 'mine'
            ? await listMyMovieRequests({ page: state.page })
            : await listMovieRequests({ status: 'pending', sort: state.tab, page: state.page });
        const batch = data.items || [];
        state.items = append ? state.items.concat(batch) : batch;
        state.hasMore = batch.length >= PAGE_SIZE;
        renderList(container, state);
    } catch (error) {
        list.innerHTML = errorState(error?.message || '加载失败，请稍后重试', { retry: true });
        list.querySelector('[data-retry-list]')?.addEventListener('click', () => loadList(container, state));
    } finally {
        state.loading = false;
    }
}

function renderList(container, state) {
    const list = container.querySelector('#req-list');
    if (!list) return;

    if (!state.items.length) {
        list.innerHTML = emptyState(
            state.tab === 'mine' ? '你还没有发起过求片' : '还没有求片，发起第一个吧',
            { showFormCta: state.tab !== 'mine' },
        );
        bindEmptyActions(container, state);
        toggleMore(container, false);
        return;
    }

    const showMine = state.tab === 'mine';
    list.innerHTML = state.items.map((item) => cardHTML(item, showMine)).join('');

    list.querySelectorAll('[data-vote]').forEach((btn) => {
        btn.addEventListener('click', () => handleVote(container, btn));
    });
    list.querySelectorAll('[data-withdraw]').forEach((btn) => {
        btn.addEventListener('click', () => handleWithdraw(container, state, btn));
    });
    toggleMore(container, state.hasMore);
}

function toggleMore(container, show) {
    const more = container.querySelector('#req-more');
    if (more) more.hidden = !show;
}

function cardHTML(item, showMine) {
    const typeText = mediaTypeLabel(item.mediaType);
    const metaParts = [typeText, item.year].filter(Boolean);
    const tmdbUrl = item.tmdbId && item.mediaType ? tmdbDetailUrl(item.mediaType, item.tmdbId) : '';
    const tmdbLink = tmdbUrl
        ? `<a class="requests-tmdb-link" href="${esc(tmdbUrl)}" target="_blank" rel="noopener noreferrer">TMDB ${esc(String(item.tmdbId))}</a>`
        : (item.tmdbId ? `<span>TMDB ${esc(String(item.tmdbId))}</span>` : '');
    const metaLine = [...metaParts, tmdbLink].filter(Boolean).join(' · ');
    const statusKey = item.status || 'pending';
    const statusBadge = `<span class="requests-status requests-status-${statusKey}">${esc(REQUEST_STATUS_LABEL[statusKey] || statusKey)}</span>`;
    const fulfilledLink = statusKey === 'fulfilled' && item.fulfilledMovieId
        ? `<a class="requests-go" href="#/detail/${item.mediaType === 'tv' ? 'series' : 'movie'}/${esc(String(item.fulfilledMovieId))}">去观看</a>`
        : '';
    const timeText = formatRelativeTime(item.createdAt);
    const rejectNote = showMine && statusKey === 'rejected' && item.adminNote
        ? `<div class="requests-card-reject">驳回理由：${esc(item.adminNote)}</div>`
        : '';
    const canWithdraw = showMine && statusKey === 'pending';
    const voteActive = item.voted ? ' active' : '';

    return `
        <article class="requests-card" data-id="${esc(String(item.id))}">
            <div class="requests-card-main">
                <div class="requests-card-title">${esc(item.title)}</div>
                <div class="requests-card-meta">
                    ${metaLine ? `<span>${metaLine}</span>` : ''}
                    ${timeText ? `<span class="requests-card-time">${esc(timeText)}</span>` : ''}
                    ${statusBadge}
                </div>
                ${item.note ? `<div class="requests-card-note">${esc(item.note)}</div>` : ''}
                ${rejectNote}
            </div>
            <div class="requests-card-actions">
                ${fulfilledLink}
                <button class="requests-vote${voteActive}" data-vote data-voted="${item.voted ? '1' : '0'}" type="button" aria-label="想看" aria-pressed="${item.voted ? 'true' : 'false'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>
                    <span class="requests-vote-count">${Number(item.voteCount || 0)}</span>
                </button>
                ${canWithdraw ? '<button class="requests-withdraw" data-withdraw type="button">撤回</button>' : ''}
            </div>
        </article>
    `;
}

async function handleVote(container, btn) {
    if (!(await ensureLogin())) return;
    const card = btn.closest('.requests-card');
    const id = card?.dataset.id;
    if (!id) return;
    const voted = btn.dataset.voted === '1';
    btn.disabled = true;
    try {
        const res = voted ? await unvoteMovieRequest(id) : await voteMovieRequest(id);
        updateVoteButton(btn, res);
    } catch (error) {
        setMsg(container, error?.status === 401 ? '请先登录' : (error?.message || '操作失败'), 'err');
    } finally {
        btn.disabled = false;
    }
}

function updateVoteButton(btn, res) {
    const voted = !!res?.voted;
    btn.dataset.voted = voted ? '1' : '0';
    btn.classList.toggle('active', voted);
    btn.setAttribute('aria-pressed', voted ? 'true' : 'false');
    const count = btn.querySelector('.requests-vote-count');
    if (count) count.textContent = String(Number(res?.voteCount || 0));
}

async function handleWithdraw(container, state, btn) {
    const card = btn.closest('.requests-card');
    const id = card?.dataset.id;
    if (!id) return;
    if (!confirm('确定撤回这条求片？')) return;
    btn.disabled = true;
    btn.textContent = '...';
    try {
        await withdrawMovieRequest(id);
        state.items = state.items.filter((item) => String(item.id) !== String(id));
        renderList(container, state);
    } catch (error) {
        btn.disabled = false;
        btn.textContent = '撤回';
        setMsg(container, error?.message || '撤回失败', 'err');
    }
}

// ---- 通用片段 ----

async function ensureLogin() {
    if (user.value) return true;
    const { openAuthModal } = await import('../services/auth-modal-loader.js');
    await openAuthModal('login');
    return false;
}

function setMsg(container, text, type = '') {
    const msg = container.querySelector('#req-msg');
    if (msg) {
        msg.textContent = '';
        msg.className = 'requests-form-msg hidden';
    }
    if (!text) return;
    showSiteNotice(text, {
        id: 'requests-notice',
        tone: type === 'err' ? 'error' : type === 'ok' ? 'success' : 'info',
    });
}

function skeletonHTML() {
    return Array.from({ length: 5 }).map(() => '<div class="requests-skeleton"></div>').join('');
}

function bindEmptyActions(container, state) {
    container.querySelectorAll('[data-open-request-form]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setRequestFormOpen(container, true);
            container.querySelector('#req-title')?.focus({ preventScroll: true });
            container.querySelector('#req-form-shell')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });
}

function highlightRequestCard(container, id) {
    const card = container.querySelector(`.requests-card[data-id="${CSS.escape(String(id))}"]`);
    if (!card) return;
    card.classList.add('is-highlight');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => card.classList.remove('is-highlight'), 2400);
}

function formatRelativeTime(timestamp) {
    const sec = Number(timestamp);
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
    const date = new Date(sec * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyState(text, { showFormCta = false } = {}) {
    return `
        <div class="requests-empty">
            <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h12"/></svg>
            <span>${esc(text)}</span>
            ${showFormCta ? '<button class="requests-empty-cta" type="button" data-open-request-form>发起求片</button>' : ''}
        </div>`;
}

function errorState(text, { retry = false } = {}) {
    return `
        <div class="requests-empty">
            <span>${esc(text)}</span>
            ${retry ? '<button class="requests-empty-cta" type="button" data-retry-list>重试</button>' : ''}
        </div>`;
}

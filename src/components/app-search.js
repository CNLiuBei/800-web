import { t } from '../services/i18n.js';
import { esc, loadCSS } from '../core/html.js';

const SEARCH_HISTORY_KEY = 'gy_search_history';
const MAX_SEARCH_HISTORY = 8;

export async function openSearch(shell) {
    await loadCSS('styles/layout.css');
    const { overlay, input, results } = ensureSearchDom(shell);
    overlay.classList.remove('hidden');
    input.focus();
    renderSearchHistory(shell, results, input, overlay);
}

function ensureSearchDom(shell) {
    let overlay = shell.querySelector('#search-overlay');
    if (!overlay) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div id="search-overlay" class="search-overlay hidden">
                <div class="search-box">
                    <input id="search-input" type="text" placeholder="${t('search.placeholder')}" autocomplete="off">
                    <button id="search-close" class="search-close">&times;</button>
                </div>
                <div id="search-results" class="search-results"></div>
            </div>
        `;
        overlay = wrap.firstElementChild;
        shell.insertBefore(overlay, shell.querySelector('#app'));
    }

    const input = shell.querySelector('#search-input');
    const results = shell.querySelector('#search-results');
    const close = shell.querySelector('#search-close');

    if (!shell._searchBound) {
        shell._searchSeq = 0;
        shell._closeSearch = () => {
            overlay.classList.add('hidden');
            input.value = '';
            results.innerHTML = '';
        };
        close.addEventListener('click', shell._closeSearch);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) shell._closeSearch(); });

        let composing = false;
        let debounce;
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => {
            composing = false;
            input.dispatchEvent(new Event('input'));
        });
        input.addEventListener('input', () => {
            if (composing) return;
            clearTimeout(debounce);
            const q = input.value.trim();
            if (q.length < 2) {
                renderSearchHistory(shell, results, input, overlay);
                return;
            }
            debounce = setTimeout(() => doSearch(shell, q, results), 300);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') shell._closeSearch();
            else if (e.key === 'Enter') {
                clearTimeout(debounce);
                const q = input.value.trim();
                if (q.length >= 2) doSearch(shell, q, results);
            }
        });
        shell._searchBound = true;
    }

    return { overlay, input, results };
}

function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
    catch { return []; }
}

function addSearchHistory(q) {
    if (!q) return;
    let list = getSearchHistory().filter((x) => x !== q);
    list.unshift(q);
    list = list.slice(0, MAX_SEARCH_HISTORY);
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch {}
}

function clearSearchHistory() {
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch {}
}

function renderSearchHistory(shell, results, input) {
    const list = getSearchHistory();
    if (list.length === 0) { results.innerHTML = ''; return; }
    results.innerHTML = `
        <div class="search-history">
            <div class="search-history-head">
                <span>最近搜索</span>
                <button class="search-history-clear" id="sh-clear">清除</button>
            </div>
            ${list.map((q) => `<button class="search-history-item" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
    `;
    results.querySelector('#sh-clear')?.addEventListener('click', () => {
        clearSearchHistory();
        results.innerHTML = '';
    });
    results.querySelectorAll('.search-history-item').forEach((el) => {
        el.addEventListener('click', () => {
            input.value = el.dataset.q;
            doSearch(shell, el.dataset.q, results);
        });
    });
}

async function doSearch(shell, query, results) {
    if (query.length < 2) { results.innerHTML = ''; return; }
    const seq = ++shell._searchSeq;
    results.innerHTML = '<div class="search-loading"><div class="spinner-small"></div></div>';

    const { getCatalog } = await import('../services/api.js');
    let movies = [], tvs = [];
    try {
        [movies, tvs] = await Promise.all([
            getCatalog('movie', 'guangying-movie', { search: query }),
            getCatalog('series', 'guangying-tv', { search: query }),
        ]);
    } catch {
        if (seq === shell._searchSeq) results.innerHTML = '<div class="search-empty">搜索失败，请重试</div>';
        return;
    }

    if (seq !== shell._searchSeq) return;
    const all = [
        ...(movies || []).map((m) => ({ ...m, _type: 'movie' })),
        ...(tvs || []).map((m) => ({ ...m, _type: 'series' })),
    ];

    if (all.length === 0) {
        results.innerHTML = `<div class="search-empty">${t('search.empty')}</div>`;
        return;
    }

    addSearchHistory(query);
    results.innerHTML = all.map((item) => `
        <a href="#/detail/${item._type}/${esc(item.id)}" class="search-item">
            <img src="${esc(item.poster || '')}" class="search-poster" loading="lazy" alt="">
            <div class="search-info">
                <div class="search-name">${esc(item.name)}</div>
                <div class="search-year">${item.year ? esc(String(item.year)) : ''}</div>
            </div>
        </a>
    `).join('');

    results.querySelectorAll('.search-item').forEach((el) => {
        el.addEventListener('click', () => shell._closeSearch?.());
    });
    results.querySelectorAll('.search-poster').forEach((img) => {
        img.addEventListener('error', () => {
            img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"%3E%3Crect width="2" height="3" fill="%23222"/%3E%3C/svg%3E';
        }, { once: true });
    });
}

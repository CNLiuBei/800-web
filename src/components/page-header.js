import { esc } from '../core/html.js';

export function pageHeaderHTML({
    eyebrow = '',
    title,
    description = '',
    actions = '',
    meta = '',
} = {}) {
    return `
        <header class="page-header">
            <div class="page-header-copy">
                ${eyebrow ? `<div class="page-eyebrow">${esc(eyebrow)}</div>` : ''}
                <h1 class="page-title">${esc(title || '')}</h1>
                ${description ? `<p class="page-description">${esc(description)}</p>` : ''}
                ${meta ? `<div class="page-meta">${meta}</div>` : ''}
            </div>
            ${actions ? `<div class="page-actions">${actions}</div>` : ''}
        </header>
    `;
}

// TODO: 下一轮将 pageHeaderHTML 扩展为可复用的面包屑与分享入口。

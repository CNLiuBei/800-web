// 主题服务

import { signal } from '../core/signal.js';

export const theme = signal(getInitialTheme());

// 初始主题：优先本地存储，其次跟随系统偏好（首次访问更贴合用户环境）
function getInitialTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 同步浏览器状态栏/地址栏颜色（移动端可见）
function syncThemeColor(t) {
    const color = t === 'dark' ? '#000000' : '#ffffff';
    // 移除带 media 的静态声明，统一用单个动态 meta 控制，避免冲突
    document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => {
        if (i === 0) m.setAttribute('content', color);
        else m.remove();
    });
}

function applyTheme(nextTheme) {
    theme.value = nextTheme;
    localStorage.setItem('theme', theme.value);
    document.documentElement.dataset.theme = theme.value;
    syncThemeColor(theme.value);
}

function getTransitionCenter(source) {
    const rect = source?.getBoundingClientRect?.();
    if (rect) {
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function getRevealRadius(x, y) {
    return Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );
}

function pulseSource(source) {
    source?.animate?.(
        [
            { transform: 'scale(1)' },
            { transform: 'scale(0.86)', offset: 0.28 },
            { transform: 'scale(1.08)', offset: 0.64 },
            { transform: 'scale(1)' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
}

function revealWithOverlay(nextTheme, x, y, radius) {
    const overlay = document.createElement('div');
    overlay.className = 'theme-ripple-overlay';
    overlay.style.background = nextTheme === 'dark' ? '#000' : '#fff';
    document.body.appendChild(overlay);

    const reveal = overlay.animate(
        {
            clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(42px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
            ],
            opacity: [0.98, 0.98, 1],
        },
        {
            duration: 680,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both',
        }
    );

    setTimeout(() => applyTheme(nextTheme), 360);
    reveal.finished
        .then(() => overlay.animate(
            { opacity: [1, 0] },
            { duration: 180, easing: 'ease-out', fill: 'forwards' }
        ).finished)
        .catch(() => {})
        .finally(() => overlay.remove());
}

export function toggleTheme(event) {
    const nextTheme = theme.value === 'light' ? 'dark' : 'light';
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const source = event?.currentTarget || event?.target;
    const { x, y } = getTransitionCenter(source);
    const radius = getRevealRadius(x, y);

    if (prefersReducedMotion) {
        applyTheme(nextTheme);
        return;
    }

    pulseSource(source);

    if (!document.startViewTransition) {
        revealWithOverlay(nextTheme, x, y, radius);
        return;
    }

    const root = document.documentElement;
    root.classList.add('theme-reveal-transition');

    const transition = document.startViewTransition(() => {
        applyTheme(nextTheme);
    });

    transition.ready.then(() => {
        root.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(44px at ${x}px ${y}px)`,
                    `circle(${radius}px at ${x}px ${y}px)`,
                ],
                opacity: [0.96, 0.99, 1],
            },
            {
                duration: 760,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                pseudoElement: '::view-transition-new(root)',
            }
        );
        root.animate(
            {
                opacity: [1, 0.96],
                filter: ['brightness(1)', 'brightness(0.96)'],
            },
            {
                duration: 760,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                pseudoElement: '::view-transition-old(root)',
            }
        );
    }).catch(() => {});

    transition.finished.finally(() => {
        root.classList.remove('theme-reveal-transition');
    });
}

export function toggleThemeInstant() {
    applyTheme(theme.value === 'light' ? 'dark' : 'light');
}

export function initTheme() {
    document.documentElement.dataset.theme = theme.value;
    syncThemeColor(theme.value);
}

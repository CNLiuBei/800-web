// gy-player 使用 Shadow DOM，外部 CSS 无法穿透。
// 通过注入样式关闭进度条上跟随鼠标的时间气泡（.gyp-progress-tip）。

const STYLE_ID = 'gy-web-ui-overrides';

const OVERRIDE_CSS = `
.gyp-progress-tip,
.gyp-progress:hover .gyp-progress-tip,
.gyp-progress.dragging .gyp-progress-tip {
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
}
:host(.gyp-layout-fullscreen:not(.gyp-immersed)) .gyp-top,
:host(.gyp-fs-active:not(.gyp-immersed)) .gyp-top {
    display: flex !important;
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
}
`;

function injectStyle(player) {
    const root = player?.shadowRoot;
    if (!root || root.getElementById(STYLE_ID)) return Boolean(root);

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = OVERRIDE_CSS;
    root.appendChild(style);
    return true;
}

/** 关闭播放器进度条 hover 跟随时间提示。 */
export function applyGyPlayerUiOverrides(player) {
    if (!player) return;
    if (injectStyle(player)) return;
    requestAnimationFrame(() => injectStyle(player));
}

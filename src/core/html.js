// 模板工具 - 安全的 HTML 渲染

// 转义 HTML 防 XSS
export function esc(str) {
    if (typeof str !== 'string') return str ?? '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 创建 DOM 元素
export function el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key === 'class') element.className = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(element.style, val);
        else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), val);
        else element.setAttribute(key, val);
    }
    for (const child of children) {
        if (typeof child === 'string') element.appendChild(document.createTextNode(child));
        else if (child instanceof Node) element.appendChild(child);
    }
    return element;
}

// 高效列表渲染 - 只更新变化的项
export function renderList(container, items, keyFn, renderFn) {
    const existingMap = new Map();
    for (const child of container.children) {
        const key = child.dataset.key;
        if (key) existingMap.set(key, child);
    }

    const fragment = document.createDocumentFragment();
    const newKeys = new Set();

    for (const item of items) {
        const key = keyFn(item);
        newKeys.add(key);

        if (existingMap.has(key)) {
            fragment.appendChild(existingMap.get(key));
        } else {
            const el = renderFn(item);
            el.dataset.key = key;
            fragment.appendChild(el);
        }
    }

    // 移除不再存在的项
    for (const [key, el] of existingMap) {
        if (!newKeys.has(key)) el.remove();
    }

    container.appendChild(fragment);
}

// 按需加载 CSS（幂等，同一文件只加载一次）
// 用于把非首屏样式（如 detail/vip）从首屏阻塞中移出，进对应页面时再加载
const loadedCSS = new Set();

export function loadCSS(href) {
    if (loadedCSS.has(href)) return Promise.resolve();
    loadedCSS.add(href);
    return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => resolve(); // 失败也放行，不阻塞渲染
        document.head.appendChild(link);
    });
}

// 长按手势：触屏长按 + 桌面右键统一触发回调（移动端无右键的替代方案）
// el: 目标元素；onLongPress: (event) => void；duration: 触发时长 ms
export function onLongPress(el, onLongPress, duration = 500) {
    let timer = null;
    let startX = 0, startY = 0;
    let triggered = false;

    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

    el.addEventListener('touchstart', (e) => {
        triggered = false;
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        timer = setTimeout(() => {
            triggered = true;
            if (navigator.vibrate) navigator.vibrate(15); // 触感反馈
            onLongPress(e);
        }, duration);
    }, { passive: true });

    // 手指移动超过阈值视为滚动，取消长按
    el.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) clear();
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
        clear();
        // 长按已触发则阻止后续 click（避免长按删除后又跳转）
        if (triggered) { e.preventDefault(); }
    });
    el.addEventListener('touchcancel', clear);

    // 桌面右键保留
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); onLongPress(e); });
}

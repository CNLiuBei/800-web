// Hash Router + View Transitions + 预加载

import { signal } from './signal.js';

export const route = signal({ path: '/', parts: [], params: {} });

const routes = [];
let currentCleanup = null;

export function defineRoute(pattern, handler) {
    routes.push({ pattern, handler });
}

export function navigate(path) {
    location.hash = path;
}

export function init() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
}

// 重新执行当前路由（用于登录态变化后刷新依赖用户数据的页面）
export function reloadRoute() {
    handleRoute();
}

function handleRoute() {
    const hash = location.hash.slice(1) || '/';
    const parts = hash.split('/').filter(Boolean);
    const params = {};

    // 匹配路由
    let matched = null;
    for (const r of routes) {
        const m = matchRoute(r.pattern, parts);
        if (m) {
            matched = r;
            Object.assign(params, m);
            break;
        }
    }

    route.value = { path: hash, parts, params };

    // 清理上一个页面
    if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
    }

    if (matched) {
        try {
            const result = matched.handler(params);
            // handler 可能是 async，等待结果获取 cleanup 函数
            if (result && typeof result.then === 'function') {
                result
                    .then(cleanup => {
                        if (typeof cleanup === 'function') currentCleanup = cleanup;
                    })
                    .catch(err => showRouteError(err)); // 异步错误兜底，防白屏
            } else if (typeof result === 'function') {
                currentCleanup = result;
            }
        } catch (err) {
            showRouteError(err); // 同步错误兜底
        }
    }
}

// 路由级错误边界：页面加载/渲染失败时显示统一错误页，避免白屏
function showRouteError(err) {
    console.error('页面加载失败:', err);
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
        <div class="route-error">
            <div class="route-error-icon">
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
            </div>
            <div class="route-error-title">加载失败</div>
            <div class="route-error-hint">网络异常或服务暂时不可用</div>
            <div class="route-error-actions">
                <button class="route-error-btn" id="route-retry">重试</button>
                <a href="#/" class="route-error-link">返回首页</a>
            </div>
        </div>
    `;
    app.querySelector('#route-retry')?.addEventListener('click', () => handleRoute());
}

function matchRoute(pattern, parts) {
    const patternParts = pattern.split('/').filter(Boolean);

    // 通配符匹配
    if (patternParts.length !== parts.length) {
        // 允许可选参数（以 ? 结尾）
        const required = patternParts.filter(p => !p.endsWith('?'));
        if (parts.length < required.length || parts.length > patternParts.length) return null;
    }

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i].replace('?', '');
        if (p.startsWith(':')) {
            params[p.slice(1)] = parts[i] || null;
        } else if (p !== parts[i]) {
            return null;
        }
    }
    return params;
}

// 预加载：鼠标悬浮时提前获取数据
const prefetchCache = new Map();

export function prefetch(url) {
    if (prefetchCache.has(url)) return prefetchCache.get(url);
    const promise = fetch(url).then(r => r.json()).catch(() => null);
    prefetchCache.set(url, promise);
    // 5 分钟后过期
    setTimeout(() => prefetchCache.delete(url), 5 * 60 * 1000);
    return promise;
}

export function getPrefetched(url) {
    return prefetchCache.get(url) || null;
}

// View Transition 包装。返回 Promise，reject 时可被路由层捕获（全局错误边界）。
// 注意：startViewTransition 的回调是异步执行的，且会吞掉回调内的 rejection，
// 因此这里用独立 Promise 显式桥接 render 的成功/失败。
//
// 滚动归零放在 VT 回调内（fn 替换内容前）执行：此时 old 快照已捕获并冻结显示，
// 对真实 DOM 的 scrollTop 修改不会单独绘制，新内容从顶部开始，避免「旧页跳到顶部再切换」的闪烁。
export function transition(fn) {
    const resetScroll = () => {
        const app = document.getElementById('app');
        if (app) app.scrollTop = 0;
    };
    if (document.startViewTransition) {
        return new Promise((resolve, reject) => {
            document.startViewTransition(() => {
                resetScroll();
                // 回调内执行 render，并把其结果桥接到外层 Promise
                return Promise.resolve()
                    .then(fn)
                    .then(resolve, reject);
            });
        });
    }
    return Promise.resolve().then(() => { resetScroll(); return fn(); });
}

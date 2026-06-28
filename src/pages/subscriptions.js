import { getCreatorSubscriptions } from '../services/api.js';
import { esc, loadCSS } from '../core/html.js';
import '../components/poster-grid.js';

export async function render(container) {
    loadCSS('styles/home.css');
    container.innerHTML = '<div class="page-loading">正在加载订阅更新...</div>';

    let data = null;
    try {
        data = await getCreatorSubscriptions({ limit: 36 });
    } catch (error) {
        if (error?.status === 401) {
            container.innerHTML = `
                <section class="catalog-section">
                    <h1 class="section-title">订阅更新</h1>
                    <div class="page-empty">登录后即可查看已关注创作者的新作品。</div>
                </section>
            `;
            window.dispatchEvent(new CustomEvent('gy:auth-required', { detail: { reason: 'creator_subscriptions' } }));
            return;
        }
        container.innerHTML = '<div class="page-empty">订阅更新加载失败，请稍后重试。</div>';
        return;
    }

    const items = data?.items || [];
    container.innerHTML = `
        <section class="catalog-section">
            <div class="continue-head">
                <div>
                    <h1 class="section-title">订阅更新</h1>
                    <div class="continue-count">${esc(String(items.length))} 条来自已关注创作者的公开视频</div>
                </div>
                <a class="secondary-action" href="#/">返回首页</a>
            </div>
            ${items.length ? '<poster-grid id="subscriptions-grid"></poster-grid>' : '<div class="page-empty">还没有订阅更新。去创作者频道点一下关注，后续新作品会出现在这里。</div>'}
        </section>
    `;
    container.querySelector('#subscriptions-grid')?.render(items, 'creator', { layout: 'grid' });
}

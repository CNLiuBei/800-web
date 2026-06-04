// 404 页面

export function render(container) {
    container.innerHTML = `
        <div class="notfound-page">
            <div class="notfound-code">404</div>
            <div class="notfound-text">页面不存在</div>
            <a href="#/" class="notfound-link">返回首页</a>
        </div>
    `;
}

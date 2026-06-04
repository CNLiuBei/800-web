// 后端地址统一配置
//
// 安全与部署策略：
//   - 生产环境（guangying.org 及其子域）：使用同域相对路径，
//     所有后端请求走 guangying.org/api/*，由 Cloudflare 路由到同一个 Worker。
//     同域请求不触发 CORS，cookie 可保持最严格的 SameSite=Lax，安全性最高。
//   - 本地开发 / 其他主机：相对路径会打到本地静态服务器（无后端），
//     因此回退到跨域绝对地址 hono.guangying.org，方便本地联调。
//
// 路径约定（重要）：
//   同域下只有 /api/* 会路由到 Worker，/addon、/r2 等裸路径会被前端 SPA 兜底拦截，
//   所以同域模式下所有后端路径统一带 /api 前缀。

// 是否为生产同域环境：部署域名为 guangying.org 或其子域
function isSameOriginDeploy() {
    const host = location.hostname;
    return host === 'guangying.org' || host.endsWith('.guangying.org');
}

// 跨域回退地址（本地开发用）
const CROSS_ORIGIN = 'https://hono.guangying.org';

// API 根地址：生产同域用 '/api'，本地开发用绝对地址 + '/api'
export const API_BASE = isSameOriginDeploy() ? '/api' : `${CROSS_ORIGIN}/api`;

// Addon 协议根地址（Stremio addon），同域下也走 /api 前缀
export const ADDON_BASE = isSameOriginDeploy() ? '/api/addon' : `${CROSS_ORIGIN}/addon`;

// R2 静态资源根地址（图片、字幕、视频等）
export const R2_BASE = isSameOriginDeploy() ? '/api/r2' : `${CROSS_ORIGIN}/r2`;

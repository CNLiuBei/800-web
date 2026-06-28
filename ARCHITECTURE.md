# 800影视 - 前端架构文档

## 设计原则

- 零框架依赖，全部使用浏览器原生 API
- 极致性能：首屏 < 100ms，交互 < 16ms
- 代码即文档，每个文件不超过 200 行
- 渐进增强，核心功能不依赖 JS 以外的运行时

---

## 技术栈

| 技术 | 用途 | 替代了什么 |
|------|------|-----------|
| ES Modules | 代码拆分、按需加载 | webpack/vite 打包 |
| Web Components | UI 组件封装 | React/Vue 组件 |
| Signals | 响应式状态管理 | Redux/Pinia/Context |
| Hash Router | 客户端路由 | react-router/vue-router |
| View Transitions API | 页面切换动画 | framer-motion/GSAP |
| Service Worker | 离线缓存、API 缓存 | workbox |
| hls.js | HLS 视频播放 | video.js/stremio-video |
| 原生 CSS | 样式 | Tailwind/Less/Sass |

---

## 目录结构

```
frontend/web/
├── index.html              # 入口 HTML（唯一的 HTML 文件）
├── styles/                 # 全局样式、页面样式和关键 CSS
├── sw.js                   # Service Worker
├── ARCHITECTURE.md         # 本文档
└── src/
    ├── main.js             # 应用入口：路由注册、初始化
    ├── core/               # 核心库（不依赖业务）
    │   ├── signal.js       # 响应式原语：signal、computed、effect、bind
    │   ├── router.js       # Hash Router + View Transitions + 预加载
    │   └── html.js         # DOM 工具：el()、esc()、renderList()
    ├── components/         # Web Components（可复用 UI 块）
    │   ├── app-shell.js    # 顶层容器
    │   ├── app-search.js   # 搜索入口
    │   ├── app-user.js     # 用户入口
    │   ├── auth-modal.js   # 登录弹窗
    │   └── poster-grid.js  # 海报网格
    ├── pages/              # 页面（路由对应的渲染函数）
    │   ├── home.js         # 首页：三分区 catalog
    │   ├── catalog.js      # 分类页：完整列表
    │   ├── detail.js       # 详情页：meta 信息 + 剧集
    │   └── player.js       # 播放页：加载流 + 自动下一集
    └── services/           # 服务层（数据 + 业务逻辑）
        ├── api.js          # API 请求 + 内存缓存
        ├── auth.js         # 认证状态
        ├── history-lite.js # 本地历史/续播轻量服务
        ├── i18n.js         # 多语言
        ├── library.js      # 片库数据
        ├── network-status.js # 网络状态
        ├── pwa-install.js  # PWA 安装
        ├── theme.js        # 主题切换
        └── vip.js          # VIP/订单状态
```

播放器源码在 `packages/gy-player/`。主站从 CDN 加载：
`https://cdn.guangying.org/static/player/gy-player.js`。

---

## 核心架构

### 1. 响应式系统（Signals）

```
signal(value) → 创建响应式值
effect(fn)    → 自动追踪依赖，值变时重新执行
computed(fn)  → 派生值，自动缓存
bind(el, prop, signal) → 绑定 signal 到 DOM
```

数据流：`API → signal → effect → DOM 更新`

不需要虚拟 DOM diff，精确更新变化的 DOM 节点。

### 2. 路由系统

```
URL 变化 → hashchange 事件 → 匹配路由 → 动态 import 页面模块 → 渲染
```

特性：
- 路由懒加载（页面代码按需加载）
- View Transitions（页面切换动画）
- 预加载（mouseenter 时提前请求数据）
- 路由守卫（cleanup 函数清理上一页状态）

### 3. 组件系统（Web Components）

```js
class MyComponent extends HTMLElement {
    connectedCallback() { /* 挂载 */ }
    disconnectedCallback() { /* 卸载 */ }
    attributeChangedCallback() { /* 属性变化 */ }
}
customElements.define('my-component', MyComponent);
```

使用场景：
- 有独立生命周期的 UI 块（播放器、海报网格）
- 需要复用的组件

不使用场景：
- 简单的页面内容（用函数式渲染 innerHTML）

### 4. 渲染策略

| 场景 | 方式 | 原因 |
|------|------|------|
| 页面切换 | innerHTML 全量替换 | 简单高效，页面间无共享状态 |
| 列表更新 | renderList() key diff | 避免重建已有 DOM |
| 高频更新（进度条） | 直接 DOM API | 精确修改单个属性 |
| 组件内部 | Web Component 封装 | 生命周期管理 |

### 5. 缓存策略

三层缓存：

```
浏览器 HTTP 缓存（CDN）
    ↓ miss
Service Worker 缓存（离线可用）
    ↓ miss
内存缓存（5 分钟 TTL）
    ↓ miss
网络请求
```

API 缓存策略：
- 静态资源：缓存优先（Cache First）
- API 数据：网络优先（Network First），失败回退缓存

---

## 性能指标

| 指标 | 目标 | 实现方式 |
|------|------|---------|
| 首屏加载 | < 1s | 零框架、CDN、预连接 |
| JS 总大小 | < 20KB gzip | 无框架、ES Modules 按需加载 |
| 页面切换 | < 100ms | 预加载 + 内存缓存 |
| 播放启动 | < 2s | HLS 分片加载 |
| 交互响应 | < 16ms | 无虚拟 DOM 开销 |

---

## 数据流

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  用户操作    │ ──→ │  Router      │ ──→ │  Page       │
│  (点击/输入) │     │  (路由匹配)   │     │  (渲染函数)  │
└─────────────┘     └──────────────┘     └─────┬───────┘
                                                │
                                                ↓
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  DOM 更新    │ ←── │  Signal      │ ←── │  API Service│
│  (精确修改)  │     │  (响应式值)   │     │  (请求+缓存) │
└─────────────┘     └──────────────┘     └─────────────┘
```

---

## API 接口

基础地址：`https://hono.guangying.org/addon`

| 接口 | 方法 | 返回 |
|------|------|------|
| `/catalog/{type}/{id}.json` | GET | `{ metas: [...] }` |
| `/catalog/{type}/{id}.json?search=xxx` | GET | 搜索结果 |
| `/meta/{type}/{id}.json` | GET | `{ meta: {...} }` |
| `/stream/{type}/{id}.json` | GET | `{ streams: [...] }` |

类型：`movie`、`series`
Catalog ID：`guangying-movie`、`guangying-tv`、`guangying-anime`

---

## 部署

纯静态文件，部署到 Cloudflare Workers Static Assets：

```bash
npx wrangler deploy
```

无需构建步骤。

---

## 扩展计划

### 近期
- [ ] 用户登录/注册（调用 hono.guangying.org 认证 API）
- [ ] 收藏/历史记录（存 localStorage + 同步到服务端）
- [ ] 播放记忆（续播位置）
- [ ] 倍速播放
- [ ] 键盘快捷键完善

### 中期
- [ ] 虚拟滚动（大列表性能优化）
- [ ] 离线播放（Service Worker + Cache API）
- [ ] PWA 安装
- [ ] 推送通知（新剧更新）

### 远期
- [ ] 多语言
- [ ] 弹幕
- [ ] 社交功能（评论、评分）
- [ ] 推荐算法

---

## 设计决策记录

### 为什么不用 React/Vue？
影视站的核心交互是「列表 → 详情 → 播放」，没有复杂的状态联动。框架带来的虚拟 DOM diff 开销和打包体积（React 40KB+、Vue 30KB+）对这个场景是浪费。

### 为什么不用 TypeScript？
零构建是核心目标。TypeScript 需要编译步骤。用 JSDoc 注释可以获得 IDE 类型提示而不需要编译。

### 为什么用 Hash Router 而不是 History API？
部署到 Workers Static Assets 时，Hash Router 不需要服务端配置 fallback。所有路由都在 `index.html` 内处理。

### 为什么用 innerHTML 而不是全程 DOM API？
页面切换时整块替换内容，innerHTML 比逐个 createElement 更快（浏览器的 HTML 解析器是 C++ 实现的，比 JS 操作 DOM 快）。只在高频更新时才用精确 DOM 操作。

### 为什么 hls.js 用 CDN 而不是本地？
hls.js 是唯一的第三方依赖（~60KB），用 CDN 可以利用浏览器缓存（用户可能在其他网站已经加载过），且不需要本地 node_modules。

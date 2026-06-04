// 零依赖开发服务器 — 热更新 / Live Reload
//
// 特性：
//   - 监听 src/ styles/ index.html 变化，自动通知浏览器
//   - CSS 改动：热替换 <link>，不整页刷新（保留页面状态）
//   - JS/HTML 改动：整页刷新
//   - 强制 no-cache + 注销 Service Worker，避免缓存导致改动不生效
//   - 仅开发用，不修改任何业务代码（reload 脚本运行时注入）
//
// 用法：node dev-server.mjs  （默认端口 5173）

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

// 注入到 HTML 的 live-reload 客户端脚本
const RELOAD_SNIPPET = `
<script>
(() => {
  let es;
  let reloading = false; // 防止短时间内多次 reload 堆叠卡死标签页
  const doReload = () => {
    if (reloading) return;
    reloading = true;
    try { es && es.close(); } catch {}
    location.reload();
  };
  const connect = () => {
    es = new EventSource('/__livereload');
    es.onmessage = (e) => {
      if (reloading) return;
      if (e.data === 'reload') doReload();
      else if (e.data.startsWith('css:')) hotSwapCSS(e.data.slice(4));
    };
    es.onerror = () => { es.close(); if (!reloading) setTimeout(connect, 1000); }; // 断线重连
  };
  const hotSwapCSS = (file) => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')];
    const link = links.find(l => l.getAttribute('href')?.split('?')[0].endsWith(file));
    if (link) {
      const clone = link.cloneNode();
      clone.href = link.getAttribute('href').split('?')[0] + '?t=' + Date.now();
      clone.onload = () => link.remove();
      link.parentNode.insertBefore(clone, link.nextSibling);
      console.log('[hot] CSS 已更新:', file);
    } else {
      doReload(); // 该 CSS 当前未加载（按需），整页刷新
    }
  };
  connect();
  console.log('[dev] live-reload 已连接');
})();
</script>
`;

// 注入到 <head> 最前的 SW 清理脚本（同步执行，先于任何模块加载）
// 解决「旧 Service Worker 缓存导致页面空白/旧代码」的开发痛点
const SW_KILL_SNIPPET = `
<script>
(() => {
  if (!('serviceWorker' in navigator)) return;
  // 标记位：避免无限刷新循环
  if (sessionStorage.getItem('__sw_killed')) return;
  navigator.serviceWorker.getRegistrations().then(async (rs) => {
    if (rs.length === 0) return;
    await Promise.all(rs.map(r => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    sessionStorage.setItem('__sw_killed', '1'); // 只自愈刷新一次
    console.log('[dev] 已注销旧 Service Worker 并清理缓存，刷新中...');
    location.reload();
  });
})();
</script>
`;

// SSE 客户端集合
const clients = new Set();

function broadcast(message) {
    for (const res of clients) {
        res.write(`data: ${message}\n\n`);
    }
}

// 防抖，避免编辑器保存触发多次
let debounceTimer = null;
function scheduleReload(filename) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (filename && filename.endsWith('.css')) {
            const base = filename.split(/[\\/]/).pop();
            console.log(`\x1b[36m[hot]\x1b[0m ${filename} → 热替换 CSS`);
            broadcast('css:' + base);
        } else {
            console.log(`\x1b[33m[reload]\x1b[0m ${filename} → 整页刷新`);
            broadcast('reload');
        }
    }, 150);
}

// 递归监听目录变化
function watchDir(dir) {
    try {
        watch(dir, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            if (filename.includes('node_modules') || filename.startsWith('.')) return;
            scheduleReload(filename);
        });
    } catch (e) {
        console.warn('监听失败:', dir, e.message);
    }
}

const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    // SSE 端点
    if (urlPath === '/__livereload') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('retry: 1000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    // 路径解析（防目录穿越）
    let filePath = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    try {
        const info = await stat(filePath).catch(() => null);
        // SPA 兜底：找不到的路径回退 index.html（hash 路由其实不需要，但兜底更稳）
        if (!info || info.isDirectory()) {
            filePath = join(ROOT, 'index.html');
        }

        let body = await readFile(filePath);
        const ext = extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';

        // HTML 注入：SW 清理脚本放 <head> 最前，live-reload 放 </body> 前
        if (ext === '.html') {
            let html = body.toString('utf8');
            html = html.includes('<head>')
                ? html.replace('<head>', '<head>' + SW_KILL_SNIPPET)
                : SW_KILL_SNIPPET + html;
            html = html.includes('</body>')
                ? html.replace('</body>', RELOAD_SNIPPET + '</body>')
                : html + RELOAD_SNIPPET;
            body = Buffer.from(html, 'utf8');
        }

        res.writeHead(200, {
            'Content-Type': mime,
            // 开发模式：禁用一切缓存
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
        });
        res.end(body);
    } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
    }
});

// 监听目录
watchDir(join(ROOT, 'src'));
watchDir(join(ROOT, 'styles'));
watch(join(ROOT, 'index.html'), () => scheduleReload('index.html'));

server.listen(PORT, () => {
    console.log(`\n\x1b[32m✓ 开发服务器已启动\x1b[0m`);
    console.log(`  本地访问: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
    console.log(`  热更新: CSS 热替换，JS/HTML 自动刷新`);
    console.log(`  按 Ctrl+C 停止\n`);
});

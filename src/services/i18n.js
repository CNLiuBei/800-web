// 多语言服务 - 轻量 i18n

import { signal } from '../core/signal.js';

// 语言包
const messages = {
    'zh-CN': {
        // 导航
        'nav.home': '首页',
        'nav.movie': '电影',
        'nav.tv': '剧集',
        'nav.anime': '动漫',
        'nav.search': '搜索',
        'nav.theme': '切换主题',

        // 搜索
        'search.placeholder': '搜索电影、剧集...',
        'search.empty': '无结果',

        // 首页
        'home.movie': '电影',
        'home.tv': '剧集',
        'home.anime': '动漫',

        // 详情
        'detail.play': '播放',
        'detail.cast': '演员',
        'detail.director': '导演',
        'detail.episodes': '剧集',
        'detail.season': '第{n}季',
        'detail.notfound': '未找到',

        // 播放器
        'player.play': '播放',
        'player.pause': '暂停',
        'player.fullscreen': '全屏',
        'player.exit_fullscreen': '退出全屏',
        'player.next': '下一集',
        'player.speed': '倍速',
        'player.subtitle': '字幕',
        'player.no_source': '无可用播放源',

        // 通用
        'loading': '加载中...',
        'error': '出错了',
        'retry': '重试',
        'back': '返回',
    },
    'en': {
        'nav.home': 'Home',
        'nav.movie': 'Movies',
        'nav.tv': 'TV Shows',
        'nav.anime': 'Anime',
        'nav.search': 'Search',
        'nav.theme': 'Toggle Theme',

        'search.placeholder': 'Search movies, shows...',
        'search.empty': 'No results',

        'home.movie': 'Movies',
        'home.tv': 'TV Shows',
        'home.anime': 'Anime',

        'detail.play': 'Play',
        'detail.cast': 'Cast',
        'detail.director': 'Director',
        'detail.episodes': 'Episodes',
        'detail.season': 'Season {n}',
        'detail.notfound': 'Not Found',

        'player.play': 'Play',
        'player.pause': 'Pause',
        'player.fullscreen': 'Fullscreen',
        'player.exit_fullscreen': 'Exit Fullscreen',
        'player.next': 'Next Episode',
        'player.speed': 'Speed',
        'player.subtitle': 'Subtitles',
        'player.no_source': 'No available source',

        'loading': 'Loading...',
        'error': 'Something went wrong',
        'retry': 'Retry',
        'back': 'Back',
    },
    'zh-TW': {
        'nav.home': '首頁',
        'nav.movie': '電影',
        'nav.tv': '劇集',
        'nav.anime': '動漫',
        'nav.search': '搜尋',
        'nav.theme': '切換主題',

        'search.placeholder': '搜尋電影、劇集...',
        'search.empty': '無結果',

        'home.movie': '電影',
        'home.tv': '劇集',
        'home.anime': '動漫',

        'detail.play': '播放',
        'detail.cast': '演員',
        'detail.director': '導演',
        'detail.episodes': '劇集',
        'detail.season': '第{n}季',
        'detail.notfound': '未找到',

        'player.play': '播放',
        'player.pause': '暫停',
        'player.fullscreen': '全螢幕',
        'player.exit_fullscreen': '退出全螢幕',
        'player.next': '下一集',
        'player.speed': '倍速',
        'player.subtitle': '字幕',
        'player.no_source': '無可用播放源',

        'loading': '載入中...',
        'error': '出錯了',
        'retry': '重試',
        'back': '返回',
    },
};

// 当前语言
export const locale = signal(detectLocale());

// 翻译函数
export function t(key, params = {}) {
    const lang = locale.value;
    const msg = messages[lang]?.[key] || messages['zh-CN']?.[key] || key;
    // 替换模板变量 {n} {name} 等
    return msg.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

// 切换语言
export function setLocale(lang) {
    if (messages[lang]) {
        locale.value = lang;
        localStorage.setItem('locale', lang);
        document.documentElement.lang = lang;
    }
}

// 获取支持的语言列表
export function getLocales() {
    return [
        { code: 'zh-CN', name: '简体中文' },
        { code: 'zh-TW', name: '繁體中文' },
        { code: 'en', name: 'English' },
    ];
}

// 检测用户语言
function detectLocale() {
    const saved = localStorage.getItem('locale');
    if (saved && messages[saved]) return saved;

    const browser = navigator.language || 'zh-CN';
    if (messages[browser]) return browser;
    if (browser.startsWith('zh')) return 'zh-CN';
    if (browser.startsWith('en')) return 'en';
    return 'zh-CN';
}

// 初始化
export function initI18n() {
    document.documentElement.lang = locale.value;
}

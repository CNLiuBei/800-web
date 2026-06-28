function normalizeSubtitleLang(lang = '') {
    return String(lang).trim().replace(/_/g, '-').toLowerCase();
}

function isTraditionalChineseSubtitle(sub = {}) {
    const lang = normalizeSubtitleLang(sub.lang);
    const label = String(sub.name || sub.label || '').trim().toLowerCase();
    if (['zht', 'cht', 'yue', 'can'].includes(lang)) return true;
    if (lang.startsWith('zh-hant') || lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.startsWith('zh-mo')) {
        return true;
    }
    return label.includes('繁体') || label.includes('繁體') || label.includes('粤语') || label.includes('粵語');
}

function isSimplifiedChineseSubtitle(sub = {}) {
    if (isTraditionalChineseSubtitle(sub)) return false;
    const lang = normalizeSubtitleLang(sub.lang);
    const label = String(sub.name || sub.label || '').trim().toLowerCase();
    if (lang === 'zhs' || lang === 'cmn-hans') return true;
    if (['zh', 'chi', 'zho', 'cmn'].includes(lang)) return true;
    if (lang.startsWith('zh-hans') || lang.startsWith('zh-cn') || lang.startsWith('zh-sg')) return true;
    if (lang.startsWith('zh') && !lang.includes('hant')) return true;
    return label.includes('简体') || label.includes('中文') || label.includes('chinese');
}

function isChineseSubtitle(sub = {}) {
    return isSimplifiedChineseSubtitle(sub) || isTraditionalChineseSubtitle(sub);
}

function subtitlePreferenceRank(sub = {}) {
    if (isSimplifiedChineseSubtitle(sub)) return 0;
    if (isTraditionalChineseSubtitle(sub)) return 1;
    if (isChineseSubtitle(sub)) return 2;
    return 3;
}

export function sortSubtitlesChineseFirst(subs = []) {
    return [...subs].sort((a, b) => subtitlePreferenceRank(a) - subtitlePreferenceRank(b));
}

/** 把后端字幕格式 {id,url,lang,name} 映射为播放器格式 {url,lang,label,default} */
export function mapSubtitles(subs = []) {
    const sorted = sortSubtitlesChineseFirst(subs);
    const defaultIndex = sorted.findIndex(isSimplifiedChineseSubtitle);
    return sorted.map((s, i) => ({
        url: s.url,
        lang: s.lang,
        label: s.name || s.lang,
        default: defaultIndex >= 0 ? i === defaultIndex : false,
    }));
}

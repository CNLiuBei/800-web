// 播放进度判定 — 续播 / 继续观看 / 看完 的单一事实源
//
// 背景：续播阈值、看完判定此前分散在 library.js、player.js、gy-player 三处，
// magic number 口径不一。这里集中所有常量与纯函数，便于统一调整与单测。
// 对标大厂（YouTube/Netflix/B 站）：心跳节流上报 + 接近片尾视为看完。

/** 进度本地保存 / 心跳间隔（秒） */
export const PROGRESS_SAVE_INTERVAL_SECONDS = 5;
/** 服务端进度上报节流窗口（毫秒）：窗口内只保留最后一次，降低写入频率 */
export const HISTORY_SYNC_THROTTLE_MS = 10000;
/** 低于此秒数不记续播（误触/片头跳过不打扰） */
export const RESUME_MIN_SECONDS = 10;
/** 距片尾不足此秒数不再提示续播（已接近看完） */
export const RESUME_END_GUARD_SECONDS = 20;
/** 达到此百分比视为「已看完」，移出继续观看 */
export const COMPLETION_PERCENT = 90;
/** 距片尾不足此秒数即按看完处理（进度归零，避免下次从结尾续播） */
export const NEAR_END_SECONDS = 10;

/**
 * 百分比夹紧到 [0, 100]
 * @param {number} value 原始百分比
 * @returns {number} 0~100
 */
export function clampPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(100, Math.max(0, num));
}

/**
 * 计算续播百分比：优先用 进度/时长，否则回退到存储的 percent
 * @param {number} progress 已播秒数
 * @param {number} duration 总时长秒数
 * @param {number} [storedPercent] 存储的百分比兜底
 * @returns {number} 0~100
 */
export function computeResumePercent(progress, duration, storedPercent = 0) {
    const safeProgress = Number(progress) || 0;
    const safeDuration = Number(duration) || 0;
    if (safeDuration > 0 && safeProgress > 0) {
        return Math.min(100, (safeProgress / safeDuration) * 100);
    }
    const explicit = Number(storedPercent);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(100, explicit);
    return 0;
}

/**
 * 解析续播时长：优先 resume.duration，再 entry.duration，最后回退参数
 * @param {{duration?:number,entry?:{duration?:number}}} resume 续播对象
 * @param {number} [fallbackDurationSeconds] 回退时长
 * @returns {number} 时长秒数
 */
export function resolveResumeDuration(resume, fallbackDurationSeconds = 0) {
    const fromResume = Number(resume?.duration ?? resume?.entry?.duration ?? 0);
    if (fromResume > 0) return fromResume;
    const fallback = Number(fallbackDurationSeconds) || 0;
    return fallback > 0 ? fallback : 0;
}

/**
 * 历史条目的有效观看百分比
 * @param {{progress?:number,duration?:number,percent?:number}} item 历史条目
 * @returns {number} 0~100
 */
export function historyPercent(item = {}) {
    const progress = Number(item.progress || 0);
    const duration = Number(item.duration || 0);
    const explicit = clampPercent(Number(item.percent || 0));
    if (progress <= 0 && explicit >= COMPLETION_PERCENT) return explicit;
    return duration > 0 && progress > 0 ? clampPercent((progress / duration) * 100) : explicit;
}

/**
 * 是否已看完（达到 COMPLETION_PERCENT）
 * @param {object} item 历史条目
 * @returns {boolean} 看完返回 true
 */
export function isCompletedHistoryItem(item = {}) {
    return historyPercent(item) >= COMPLETION_PERCENT;
}

/** 是否应上报服务端（跳过片头归零心跳，保留完成态） */
export function shouldSyncHistoryProgress(item = {}) {
    const progress = Number(item.progress) || 0;
    if (progress > 0) return true;
    return isCompletedHistoryItem(item);
}

/**
 * 是否可继续观看（有进度且未看完）
 * @param {object} item 历史条目
 * @returns {boolean} 可续播返回 true
 */
export function isResumableHistoryItem(item = {}) {
    if (isCompletedHistoryItem(item)) return false;
    const progress = Number(item.progress || 0);
    const percent = historyPercent(item);
    if (progress > 0 && progress < RESUME_MIN_SECONDS) return false;
    return (progress >= RESUME_MIN_SECONDS || percent > 0) && percent < COMPLETION_PERCENT;
}

/**
 * 是否接近片尾（按看完处理）
 * @param {number} currentTime 当前秒数
 * @param {number} duration 总时长秒数
 * @returns {boolean} 接近片尾返回 true
 */
export function isNearEnd(currentTime, duration) {
    const total = Number(duration) || 0;
    const at = Number(currentTime) || 0;
    return total > 0 && total - at < NEAR_END_SECONDS;
}

/**
 * 保存进度归一化：片头误触或接近片尾归零，否则原值
 * @param {number} currentTime 当前秒数
 * @param {number} duration 总时长秒数
 * @returns {number} 应保存的进度秒数
 */
export function progressForSave(currentTime, duration) {
    const at = Number(currentTime) || 0;
    if (at < RESUME_MIN_SECONDS) return 0;
    if (isNearEnd(at, duration)) return 0;
    return at;
}

/**
 * 保存百分比归一化：近片尾视为 100%，片头误触归零
 * @param {number} currentTime 当前秒数
 * @param {number} duration 总时长秒数
 * @param {number} [computedPercent] 当前计算出的百分比
 * @returns {number} 应保存的百分比
 */
export function percentForSave(currentTime, duration, computedPercent = 0) {
    const at = Number(currentTime) || 0;
    const total = Number(duration) || 0;
    if (at < RESUME_MIN_SECONDS) return 0;
    if (isNearEnd(at, total)) return 100;
    if (total > 0 && at > 0) return clampPercent((at / total) * 100);
    return clampPercent(computedPercent);
}

/**
 * 写入历史的进度三元组（progress / duration / percent）
 * @param {number} currentTime 当前秒数
 * @param {number} duration 总时长秒数
 * @param {number} [computedPercent] 当前计算出的百分比
 * @returns {{progress:number,duration:number,percent:number}}
 */
export function historyProgressPayload(currentTime, duration, computedPercent = 0) {
    const total = Number(duration) || 0;
    return {
        progress: progressForSave(currentTime, total),
        duration: total,
        percent: percentForSave(currentTime, total, computedPercent),
    };
}

/**
 * 播放状态键：completed | watching | unwatched
 * @param {object} item 历史条目
 * @returns {'completed'|'watching'|'unwatched'}
 */
export function playbackStatusKey(item = {}) {
    if (isCompletedHistoryItem(item)) return 'completed';
    if (isResumableHistoryItem(item)) return 'watching';
    return 'unwatched';
}

/**
 * 列表/筛选用状态文案
 * @param {object} item 历史条目
 * @param {{watchingPrefix?:string,unwatchedLabel?:string}} [options]
 * @returns {string}
 */
export function playbackStatusLabel(item = {}, options = {}) {
    const watchingPrefix = options.watchingPrefix ?? '续播中';
    const percent = Math.round(historyPercent(item));
    if (isCompletedHistoryItem(item)) return '已看完';
    if (playbackStatusKey(item) === 'watching') {
        return percent > 0 ? `${watchingPrefix} ${percent}%` : watchingPrefix;
    }
    return options.unwatchedLabel ?? '未开始';
}

/**
 * 紧凑进度文案（账号历史卡片等）
 * @param {object} item 历史条目
 * @returns {string}
 */
export function playbackProgressShortLabel(item = {}) {
    if (isCompletedHistoryItem(item)) return '已看完';
    const percent = Math.round(historyPercent(item));
    if (percent > 0) return `${percent}%`;
    return '续播';
}

/**
 * 剧集/电影聚合观看状态文案（首页、海报等）
 * @param {{status?:string,isSeries?:boolean,completedCount?:number,resumePercent?:number,totalEpisodes?:number}} summary
 * @returns {string}
 */
export function seriesWatchStatusLabel(summary = {}) {
    const status = summary.status || 'unwatched';
    const isSeries = summary.isSeries === true;
    const completedCount = Number(summary.completedCount) || 0;
    const resumePercent = Math.round(Number(summary.resumePercent) || 0);
    const totalEpisodes = Number(summary.totalEpisodes) || 0;

    switch (status) {
    case 'completed':
        if (isSeries && totalEpisodes > 0) {
            return `已全部看完 · ${completedCount}/${totalEpisodes} 集`;
        }
        return '已看完';
    case 'watching':
        if (isSeries && completedCount > 0) {
            return resumePercent > 0
                ? `已看 ${completedCount} 集 · 续播中 ${resumePercent}%`
                : `已看 ${completedCount} 集 · 续播中`;
        }
        return resumePercent > 0 ? `续播中 ${resumePercent}%` : '续播中';
    case 'partial':
        return `已看 ${completedCount} 集`;
    default:
        return '';
    }
}

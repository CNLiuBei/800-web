import { favorites, getRecentHistory, getResumeProgress, history, watchLater } from './library.js';
import { hasVipAccess, daysUntilExpire } from './vip.js';
import { buildCommunityShareUrl, getCommunityGrowthStats, getReferralChallenge } from './community-growth.js';

const WEEK_GOAL = 3;
const MAX_SCORE = 100;

export function getGrowthLoopSnapshot(options = {}) {
    const hist = Array.isArray(history.value) ? history.value : [];
    const favs = Array.isArray(favorites.value) ? favorites.value : [];
    const later = Array.isArray(watchLater.value) ? watchLater.value : [];
    const resumes = getRecentHistory(30)
        .map((item) => ({ item, resume: resumeFor(item) }))
        .filter((entry) => entry.resume);
    const shareStats = getCommunityGrowthStats();
    const referralChallenge = getReferralChallenge(shareStats);
    const dayStats = viewingDayStats(hist);
    const isVip = hasVipAccess();
    const score = growthScore({ dayStats, resumes, favs, later, shareStats, isVip });
    const level = growthLevel(score);
    const weekProgress = Math.min(WEEK_GOAL, dayStats.thisWeek);
    const intent = intentSignals({ resumes, favs, later, shareStats, dayStats });
    const tasks = growthTasks({
        resumes,
        favs,
        later,
        shareStats,
        isVip,
        weekProgress,
        catalogCount: Number(options.catalogCount || 0),
        intent,
    });
    const nextAction = bestNextAction({ resumes, favs, later, shareStats, dayStats, isVip, weekProgress, intent });

    return {
        score,
        level,
        streak: dayStats.streak,
        weekGoal: WEEK_GOAL,
        weekProgress,
        resumeCount: resumes.length,
        savedCount: favs.length + later.length,
        shareCount: shareStats.shareCount,
        referralCode: shareStats.referralCode,
        referralChallenge,
        isVip,
        vipDays: isVip ? daysUntilExpire() : 0,
        intent,
        nextAction,
        valueNudges: valueNudges({ resumes, favs, later, shareStats, dayStats, isVip, intent }),
        tasks,
        headline: growthHeadline({ level, dayStats, resumes, isVip }),
        insight: growthInsight({ dayStats, resumes, favs, later, shareStats, isVip, intent }),
    };
}

function resumeFor(item) {
    return getResumeProgress({
        id: item.id,
        videoId: item.videoId,
        movieId: item.movieId,
        episodeId: item.episodeId,
    });
}

function viewingDayStats(items) {
    const days = new Set();
    const now = new Date();
    const weekStart = startOfDay(now);
    weekStart.setDate(weekStart.getDate() - 6);

    items.forEach((item) => {
        const ts = Number(item.watchedAt || item.updatedAt || item.addedAt || 0);
        if (!ts) return;
        const date = new Date(ts > 1e12 ? ts : ts * 1000);
        if (Number.isNaN(date.getTime())) return;
        days.add(dayKey(date));
    });

    let streak = 0;
    const cursor = startOfDay(now);
    while (days.has(dayKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    return {
        total: days.size,
        thisWeek: [...days].filter((key) => new Date(`${key}T00:00:00`).getTime() >= weekStart.getTime()).length,
        streak,
    };
}

function growthScore({ dayStats, resumes, favs, later, shareStats, isVip }) {
    const score =
        dayStats.streak * 9 +
        dayStats.thisWeek * 8 +
        Math.min(4, resumes.length) * 12 +
        Math.min(10, favs.length) * 3 +
        Math.min(10, later.length) * 3 +
        Math.min(6, shareStats.shareCount) * 7 +
        (isVip ? 10 : 0);
    return Math.min(MAX_SCORE, Math.round(score));
}

function intentSignals({ resumes, favs, later, shareStats, dayStats }) {
    const saved = favs.length + later.length;
    const resumePressure = resumes.reduce((sum, entry) => sum + Math.max(0, 100 - Number(entry.resume.percent || 0)), 0);
    const choiceDebt = Math.min(12, later.length) * 6 + Math.min(12, favs.length) * 4;
    const socialProof = Math.min(7, shareStats.shareCount || 0) * 8;
    const habit = Math.min(7, dayStats.streak || 0) * 10 + Math.min(WEEK_GOAL, dayStats.thisWeek || 0) * 8;
    const score = Math.min(100, Math.round(resumePressure / 12 + choiceDebt + socialProof + habit));
    return {
        score,
        saved,
        openLoops: resumes.length,
        choiceDebt,
        socialProof,
        habit,
    };
}

function growthLevel(score) {
    if (score >= 86) return { name: '核心影迷', hint: '高粘性' };
    if (score >= 62) return { name: '深度观影', hint: '习惯稳定' };
    if (score >= 36) return { name: '兴趣成型', hint: '继续培养' };
    return { name: '探索阶段', hint: '降低选择成本' };
}

function growthHeadline({ level, dayStats, resumes, isVip }) {
    if (resumes.length) return `你有 ${resumes.length} 部内容可以接着看`;
    if (dayStats.streak >= 2) return `连续 ${dayStats.streak} 天观影，节奏保持得不错`;
    if (isVip) return 'VIP 权益已生效，先挑一部高完成率内容';
    return `${level.name} · 先完成一个轻任务`;
}

function growthInsight({ dayStats, resumes, favs, later, shareStats, isVip, intent }) {
    if (resumes.length) return '从断点续播开始，完成成本最低，最容易形成下一次打开。';
    if (later.length >= 3) return '稍后看片单已经够用，下一步是把收藏转成实际播放。';
    if ((intent?.score || 0) >= 62 && !isVip) return '观看意愿已经足够强，适合把会员权益放在当前决策点。';
    if (favs.length >= 3 && !isVip) return '收藏偏好已经明显，会员权益更适合在高意愿时触发。';
    if (shareStats.shareCount > 0) return '分享动作已经发生，继续用朋友反馈带动回访和讨论。';
    if (dayStats.thisWeek > 0) return '本周已经有观看行为，补一个收藏或分享能增强回访线索。';
    return '先给用户一个很小的下一步，减少选择压力，再逐步引导收藏、分享和开通。';
}

function bestNextAction({ resumes, favs, later, shareStats, dayStats, isVip, weekProgress, intent }) {
    const resume = resumes[0];
    if (resume) {
        const percent = Math.round(Number(resume.resume.percent || 0)) || 1;
        return {
            id: 'resume',
            label: '接着看',
            title: `从 ${percent}% 继续，最省力`,
            detail: resume.item.name || '完成一个未闭环内容',
            href: playHref(resume.item),
        };
    }
    if (!isVip && (intent?.score || 0) >= 62) {
        return {
            id: 'vip',
            label: '解锁权益',
            title: '你已经有足够强的观看意愿',
            detail: '收藏、稍后看和本周观看会让会员价值更容易兑现',
            href: '#/vip?source=growth_intent',
        };
    }
    if (later.length) {
        return {
            id: 'watch-later',
            label: '清空待看',
            title: `待看片单还有 ${later.length} 部`,
            detail: '先播放一部，把选择成本转成实际观看',
            href: '#/watch-later',
        };
    }
    if (weekProgress < WEEK_GOAL && dayStats.thisWeek > 0) {
        return {
            id: 'week',
            label: '完成本周',
            title: `再看 ${WEEK_GOAL - weekProgress} 天达成本周目标`,
            detail: '小目标会提高下次打开的概率',
            href: '#/rankings',
        };
    }
    const challenge = getReferralChallenge(shareStats);
    if (challenge.remaining > 0 && shareStats.shareCount > 0) {
        return {
            id: 'invite',
            label: '扩大圈层',
            title: challenge.status,
            detail: challenge.reward,
            href: buildCommunityShareUrl('#/'),
            copy: true,
        };
    }
    return {
        id: 'discover',
        label: '开始探索',
        title: '先选一部高热内容',
        detail: '从排行榜进入，减少不知道看什么的阻力',
        href: '#/rankings',
    };
}

function valueNudges({ resumes, favs, later, shareStats, dayStats, isVip, intent }) {
    const nudges = [];
    if (resumes.length) nudges.push({ label: '未完成', value: `${resumes.length} 部`, tone: 'warm' });
    if (later.length || favs.length) nudges.push({ label: '已投入', value: `${later.length + favs.length} 个选择`, tone: 'info' });
    if (dayStats.thisWeek > 0) nudges.push({ label: '本周进度', value: `${Math.min(WEEK_GOAL, dayStats.thisWeek)}/${WEEK_GOAL}`, tone: 'success' });
    if (shareStats.shareCount > 0) nudges.push({ label: '社区扩散', value: `${shareStats.shareCount} 次`, tone: 'social' });
    if (!isVip && (intent?.score || 0) >= 62) nudges.push({ label: '转化时机', value: '高意愿', tone: 'vip' });
    if (isVip) nudges.push({ label: '权益状态', value: daysUntilExpire() > 0 ? `${daysUntilExpire()} 天` : '已生效', tone: 'vip' });
    return nudges.slice(0, 4);
}

function growthTasks({ resumes, favs, later, shareStats, isVip, weekProgress, catalogCount, intent }) {
    const tasks = [];
    const resume = resumes[0];
    if (resume) {
        tasks.push({
            id: 'resume',
            label: '完成断点续播',
            value: `${Math.round(Number(resume.resume.percent || 0)) || 1}%`,
            detail: resume.item.name || '继续上次内容',
            href: playHref(resume.item),
            weight: 0.95,
        });
    } else {
        tasks.push({
            id: 'discover',
            label: '选择一部内容',
            value: catalogCount ? `${catalogCount}` : '新',
            detail: '先从推荐或排行榜里选一部',
            href: '#/rankings',
            weight: 0.72,
        });
    }

    tasks.push({
        id: 'week',
        label: '本周观影目标',
        value: `${weekProgress}/${WEEK_GOAL}`,
        detail: weekProgress >= WEEK_GOAL ? '本周目标已完成' : `再完成 ${WEEK_GOAL - weekProgress} 天观看`,
        href: '#/history',
        weight: weekProgress / WEEK_GOAL,
    });

    tasks.push({
        id: 'save',
        label: later.length ? '消化稍后看' : '建立待看片单',
        value: String(later.length || favs.length),
        detail: later.length ? '把待看内容转成播放' : '收藏或加入稍后看，降低下次选择成本',
        href: later.length ? '#/watch-later' : '#/rankings',
        weight: Math.min(1, (later.length + favs.length) / 6),
    });

    tasks.push({
        id: 'invite',
        label: '邀请朋友一起看',
        value: String(shareStats.shareCount),
        detail: inviteTaskDetail(shareStats),
        href: buildCommunityShareUrl('#/'),
        copy: true,
        weight: Math.min(1, shareStats.shareCount / 3),
    });

    if (!isVip) {
        tasks.push({
            id: 'vip',
            label: '解锁会员权益',
            value: 'VIP',
            detail: (intent?.score || 0) >= 62 ? '当前观看意愿高，适合开通后连续消费' : '在有收藏和续播意愿时开通更自然',
            href: '#/vip?source=growth_task',
            weight: Math.min(1, (favs.length + later.length + resumes.length) / 8),
        });
    }

    return tasks.slice(0, 5);
}

function inviteTaskDetail(shareStats) {
    const challenge = getReferralChallenge(shareStats);
    if (challenge.remaining > 0) return `${challenge.status} · ${challenge.reward}`;
    return `${challenge.label} · 继续扩大社区回流`;
}

function playHref(item) {
    const type = item.type === 'movie' ? 'movie' : 'series';
    if (item.videoId) return `#/play/${type}/${item.id}/${item.videoId}`;
    if (type === 'movie') return `#/play/${type}/${item.id}`;
    return `#/detail/${type}/${item.id}`;
}

function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

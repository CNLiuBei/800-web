// playback-session 决策逻辑 — 与 playback-session.js 保持一致

import {
    buildEpisodeTitle,
    dolbyCodecPlaybackMessage,
    formatPlaybackClock,
    normalizePlaybackProgress,
    shouldClearRecoveryAfterLoad,
    shouldClearRecoveryOnLoadStart,
    sourcePreferenceValue,
    streamSourcesForPlayer,
    usesSafariNativeHls,
} from '../src/services/playback-session.js';

let pass = 0;
let fail = 0;

function eq(actual, expected, name) {
    if (actual === expected) {
        pass++;
        return;
    }
    fail++;
    console.log(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function deepEq(actual, expected, name) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) {
        pass++;
        return;
    }
    fail++;
    console.log(`FAIL ${name}: got ${a}, want ${b}`);
}

eq(formatPlaybackClock(0), '0:00', 'zero seconds');
eq(formatPlaybackClock(65), '1:05', 'minutes');
eq(formatPlaybackClock(3661), '1:01:01', 'hours');

deepEq(normalizePlaybackProgress(30, 120, 25), {
    currentTime: 30,
    duration: 120,
    percent: 25,
}, 'normalize explicit percent');

deepEq(normalizePlaybackProgress(60, 120), {
    currentTime: 60,
    duration: 120,
    percent: 50,
}, 'normalize derived percent');

eq(sourcePreferenceValue({ quality: '1080P' }), '1080p', 'source preference lowercases');
eq(buildEpisodeTitle('Demo', { id: 'v1' }, [{ id: 'v1', season: 1, episode: 2, title: 'Pilot' }]),
    'Demo · S1E2 · Pilot',
    'episode title');

eq(streamSourcesForPlayer([{ url: 'u', title: 'HD', subtitles: [] }])[0].label, 'HD', 'stream label');
eq(typeof dolbyCodecPlaybackMessage('ec-3'), 'string', 'dolby message');
eq(typeof usesSafariNativeHls(), 'boolean', 'safari detect returns boolean');

eq(shouldClearRecoveryOnLoadStart({ keepRecoveryLock: true }), false, 'keep lock on load start');
eq(shouldClearRecoveryOnLoadStart({}), true, 'clear lock by default on load start');
eq(shouldClearRecoveryAfterLoad({ keepRecoveryLock: true }), true, 'clear lock after load when kept');
eq(shouldClearRecoveryAfterLoad({}), false, 'no after-load clear without keep lock');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);

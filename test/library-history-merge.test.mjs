import { mergeHistoryEntries } from '../src/services/library.js';

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

const ep1 = {
    id: 'tmdb:tv:1',
    videoId: 'tmdb:tv:1:1:1',
    movieId: 10,
    episodeId: 101,
    seasonNumber: 1,
    episodeNumber: 1,
    progress: 500,
    duration: 3600,
    percent: 14,
    watchedAt: 1000,
};

const ep1Stale = {
    ...ep1,
    progress: 100,
    duration: 3600,
    percent: 3,
    watchedAt: 2000,
};

const merged = mergeHistoryEntries(ep1, ep1Stale);
eq(merged.progress, 500, 'keep max progress when server entry is newer but lower progress');
eq(merged.watchedAt, 2000, 'keep newest watchedAt');

const completed = mergeHistoryEntries(
    { ...ep1, progress: 3500, duration: 3600, percent: 97, watchedAt: 2500 },
    { ...ep1, progress: 0, duration: 3600, percent: 100, watchedAt: 3000 },
);
eq(completed.progress, 0, 'newer completed entry wins over in-progress');
eq(completed.percent, 100, 'completed percent preserved');

const replayStart = mergeHistoryEntries(
    { ...ep1, progress: 1800, duration: 3600, percent: 50, watchedAt: 5000 },
    { ...ep1, progress: 0, percent: 0, watchedAt: 6000 },
);
eq(replayStart.progress, 1800, 'replay heartbeat at 0s must not wipe saved progress');
eq(replayStart.watchedAt, 6000, 'replay still bumps watchedAt');

const rewatch = mergeHistoryEntries(
    { ...ep1, progress: 0, duration: 3600, percent: 100, watchedAt: 7000 },
    { ...ep1, progress: 900, duration: 3600, percent: 25, watchedAt: 8000 },
);
eq(rewatch.progress, 900, 'rewatch after completion resumes in-progress');
eq(rewatch.percent, 25, 'rewatch percent preserved');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);

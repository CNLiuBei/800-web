import {
    shouldSyncHistoryProgress,
    historyProgressPayload,
    isCompletedHistoryItem,
} from '../src/services/playback-progress.js';

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

eq(shouldSyncHistoryProgress({ progress: 120, duration: 3600 }), true, 'sync in-progress');
eq(shouldSyncHistoryProgress({ progress: 0, percent: 100, duration: 3600 }), true, 'sync completed');
eq(shouldSyncHistoryProgress({ progress: 0, percent: 0, duration: 3600 }), false, 'skip片头 zero');

const nearEnd = historyProgressPayload(3595, 3600);
eq(nearEnd.progress, 0, 'near end saves zero progress');
eq(nearEnd.percent, 100, 'near end saves 100 percent');
eq(isCompletedHistoryItem(nearEnd), true, 'near end counts as completed');

const early = historyProgressPayload(5, 3600);
eq(early.progress, 0, 'early playback zero progress');
eq(shouldSyncHistoryProgress(early), false, 'early playback not synced');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);

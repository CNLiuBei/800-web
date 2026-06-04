const HISTORY_KEY = 'gy_history';

export function getRecentHistory(count = 10) {
    try {
        const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(data) ? data.slice(0, count) : [];
    } catch {
        return [];
    }
}

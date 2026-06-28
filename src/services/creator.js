import { API_V1_BASE } from './config.js';

const REQUEST_TIMEOUT_MS = 12000;

function requestUrls(path) {
    return [`${API_V1_BASE}${path}`];
}

async function request(path, { timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
    const init = { credentials: 'include', ...options };
    if (options.body) init.headers = { 'Content-Type': 'application/json', ...options.headers };

    let lastError = null;
    for (const url of requestUrls(path)) {
        const controller = typeof AbortController !== 'undefined' && !init.signal ? new AbortController() : null;
        let timer = null;
        const requestInit = { ...init };
        if (controller) {
            requestInit.signal = controller.signal;
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
            const response = await fetch(url, requestInit);
            const text = await response.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = null; }
            if (!response.ok) {
                const error = new Error(data?.message || text || `HTTP ${response.status}`);
                error.status = response.status;
                error.data = data;
                if (response.status === 404 && url !== requestUrls(path)[requestUrls(path).length - 1]) {
                    lastError = error;
                    continue;
                }
                throw error;
            }
            return data;
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('请求超时，请稍后重试');
            lastError = error;
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    throw lastError || new Error('请求失败');
}

export async function getCreatorStudio() {
    return request('/creator/studio');
}

export async function getCreatorAnalyticsOverview({ days = 30, limit = 10 } = {}) {
    const params = new URLSearchParams({
        days: String(days),
        limit: String(limit),
    });
    return request(`/creator/analytics/overview?${params}`);
}

export async function getCreatorRevenueSummary({ days = 30 } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    return request(`/creator/revenue/summary?${params}`);
}

export async function getCreatorRevenueLedger({ days = 30 } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    return request(`/creator/revenue/ledger?${params}`);
}

export async function downloadCreatorRevenueBill({ days = 30 } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    const path = `/creator/revenue/bill/export?${params}`;
    let lastError = null;
    for (const url of requestUrls(path)) {
        try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                const error = new Error(text || `HTTP ${response.status}`);
                error.status = response.status;
                if (response.status === 404 && url !== requestUrls(path)[requestUrls(path).length - 1]) {
                    lastError = error;
                    continue;
                }
                throw error;
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `creator-revenue-bill-${days}d.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            return true;
        } catch (error) {
            lastError = error;
            throw error;
        }
    }
    throw lastError || new Error('账单导出失败');
}

export async function listCreatorPayoutRequests() {
    return request('/creator/revenue/payout-requests');
}

export async function createCreatorPayoutRequest({ amountCents, note } = {}) {
    return request('/creator/revenue/payout-requests', {
        method: 'POST',
        body: JSON.stringify({ amountCents, note }),
    });
}

export async function listCreatorLiveSessions() {
    return request('/creator/live/sessions');
}

export async function createCreatorLiveSession({ title, description, scheduledStartAt, visibility }) {
    return request('/creator/live/sessions', {
        method: 'POST',
        body: JSON.stringify({ title, description, scheduledStartAt, visibility }),
    });
}

export async function updateCreatorLiveSession(id, { status }) {
    return request(`/creator/live/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
    });
}

export async function updateCreatorLivePinnedNotice(id, pinnedNotice) {
    return request(`/creator/live/sessions/${encodeURIComponent(id)}/pinned-notice`, {
        method: 'PUT',
        body: JSON.stringify({ pinnedNotice: pinnedNotice || null }),
    });
}

export async function getCreatorLiveStats(id) {
    return request(`/creator/live/sessions/${encodeURIComponent(id)}/stats`);
}

export async function listCreatorLiveMutes(id) {
    return request(`/creator/live/sessions/${encodeURIComponent(id)}/mutes`);
}

export async function unmuteCreatorLiveUser(id, userId) {
    return request(`/creator/live/sessions/${encodeURIComponent(id)}/mutes/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
    });
}

export async function saveCreatorChannel({ handle, displayName, bio, announcement }) {
    return request('/creator/channel', {
        method: 'POST',
        body: JSON.stringify({ handle, displayName, bio, announcement }),
    });
}

export async function listCreatorChannelAppeals() {
    return request('/creator/channel/appeals');
}

export async function createCreatorChannelAppeal({ reason, evidenceUrl }) {
    const payload = { reason };
    if (evidenceUrl) payload.evidenceUrl = evidenceUrl;
    return request('/creator/channel/appeals', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function setCreatorPinnedUpload(uploadId) {
    return request('/creator/channel/pinned-upload', {
        method: 'PUT',
        body: JSON.stringify({ uploadId: uploadId || null }),
    });
}

export async function sendCreatorBroadcast({ title, content }) {
    return request('/creator/channel/broadcast', {
        method: 'POST',
        body: JSON.stringify({ title, content }),
    });
}

export async function createCreatorCollection({ title, description, visibility, uploadIds }) {
    return request('/creator/collections', {
        method: 'POST',
        body: JSON.stringify({ title, description, visibility, uploadIds }),
    });
}

export async function listCreatorUploads(status = '') {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/creator/uploads${query}`);
}

export async function createCreatorUpload({
    title,
    description,
    contentType,
    sourcePath,
    visibility,
    durationSeconds,
    width,
    height,
    aspectRatio,
    topicTags,
    coverFrameSeconds,
}) {
    const payload = { title, description, contentType, visibility };
    if (sourcePath) payload.sourcePath = sourcePath;
    if (durationSeconds) payload.durationSeconds = Number(durationSeconds);
    if (width) payload.width = Number(width);
    if (height) payload.height = Number(height);
    if (aspectRatio) payload.aspectRatio = Number(aspectRatio);
    if (topicTags) payload.topicTags = topicTags;
    if (coverFrameSeconds) payload.coverFrameSeconds = Number(coverFrameSeconds);
    return request('/creator/uploads', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function attachCreatorUploadSource(id, { sourcePath }) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/source`, {
        method: 'POST',
        body: JSON.stringify({ sourcePath }),
    });
}

export async function retryCreatorUploadTranscode(id) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/transcode/retry`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function updateCreatorUploadStatus(id, { status }) {
    return request(`/creator/uploads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
    });
}

export async function updateCreatorUploadDanmaku(id, danmakuEnabled) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/danmaku`, {
        method: 'PUT',
        body: JSON.stringify({ danmakuEnabled: Boolean(danmakuEnabled) }),
    });
}

export async function updateCreatorUploadChapters(id, chapters = []) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/chapters`, {
        method: 'PUT',
        body: JSON.stringify({ chapters }),
    });
}

export async function batchCreatorUploads({ action, ids }) {
    return request('/creator/uploads/batch', {
        method: 'POST',
        body: JSON.stringify({ action, ids }),
    });
}

export async function deleteCreatorUpload(id) {
    return request(`/creator/uploads/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

export async function listCreatorUploadAppeals(id) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/appeals`);
}

export async function createCreatorUploadAppeal(id, { reason, evidenceUrl }) {
    const payload = { reason };
    if (evidenceUrl) payload.evidenceUrl = evidenceUrl;
    return request(`/creator/uploads/${encodeURIComponent(id)}/appeals`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function getCreatorUploadRights(id) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/rights`);
}

export async function saveCreatorUploadRights(id, payload) {
    return request(`/creator/uploads/${encodeURIComponent(id)}/rights`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
}

export async function requestCreatorUploadIntent({ fileName, fileSize, mimeType }) {
    return request('/creator/upload-intent', {
        method: 'POST',
        body: JSON.stringify({ fileName, fileSize, mimeType }),
    });
}

export function uploadCreatorObject(intent, file, { onProgress, signal, timeoutMs = 30 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!(file instanceof Blob) || file.size <= 0) {
            reject(new Error('请选择有效的视频文件'));
            return;
        }
        if (intent.maxBytes && file.size > intent.maxBytes) {
            reject(new Error('文件超过上传凭证允许的大小'));
            return;
        }
        if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) {
            reject(new Error('上传凭证已过期，请重新选择文件'));
            return;
        }

        const xhr = new XMLHttpRequest();
        let timer = null;
        xhr.open('PUT', intent.uploadUrl, true);
        xhr.withCredentials = true;
        const headers = intent.headers || {};
        for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
        if (!headers['Content-Type'] && file.type) xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
            onProgress(percent);
        };
        xhr.onload = () => {
            clearTimeout(timer);
            let data = null;
            try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress?.(100);
                resolve(data);
                return;
            }
            const error = new Error(data?.message || xhr.responseText || `HTTP ${xhr.status}`);
            error.status = xhr.status;
            error.body = xhr.responseText;
            error.retriable = xhr.status >= 500 || xhr.status === 0;
            reject(error);
        };
        xhr.onerror = () => {
            clearTimeout(timer);
            const error = new Error('上传失败，请检查网络后重试');
            error.retriable = true;
            reject(error);
        };
        xhr.onabort = () => {
            clearTimeout(timer);
            reject(new Error('上传已取消'));
        };
        if (signal) {
            if (signal.aborted) {
                xhr.abort();
                return;
            }
            signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }
        timer = setTimeout(() => xhr.abort(), timeoutMs);
        xhr.send(file);
    });
}

export function creatorReviewStatusText(status) {
    return {
        not_submitted: '未提交',
        pending: '审核中',
        approved: '已通过',
        rejected: '已驳回',
    }[status] || '未知';
}

export function creatorContentTypeText(type) {
    return {
        video: '长视频',
        short: '短视频',
        series: '剧集',
        live: '直播',
    }[type] || '视频';
}

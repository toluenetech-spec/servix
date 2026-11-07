/**
 * Messages: attachments, replies, reactions, delete. Text/typing/read helpers live in workspaceApi.js.
 * Files go browser → Servix API → object storage (same path as every other upload); the API only
 * accepts a key on a message when this account uploaded it.
 */
import { authorizedFetch, getAccessToken } from './authApi.js';
import { workspaceCall } from './workspaceApi.js';
import { prepareImage } from './uploadApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const CHAT_LIMITS = {
  'chat-image': { accept: 'image/jpeg,image/png,image/webp,image/gif', maxBytes: 10 * 1024 * 1024, label: 'JPEG, PNG, WebP or GIF photos up to 10 MB' },
  'chat-audio': { accept: 'audio/webm,audio/mp4,audio/mpeg,audio/ogg,audio/wav,audio/aac,audio/x-m4a,audio/m4a', maxBytes: 10 * 1024 * 1024, label: 'voice notes up to 10 MB' },
  'chat-file': {
    accept: 'application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    maxBytes: 20 * 1024 * 1024,
    label: 'PDF, Word, Excel, PowerPoint, text or CSV files up to 20 MB',
  },
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i;
const AUDIO_EXT = /\.(m4a|mp3|ogg|opus|wav|aac|weba|webm)$/i;
/** Some phones hand over files with an empty or generic MIME type — fall back to the extension. */
export function kindForFile(file) {
  const type = (file.type || '').split(';')[0];
  if (type.startsWith('image/')) return 'chat-image';
  if (type.startsWith('audio/')) return 'chat-audio';
  if (!type || type === 'application/octet-stream') {
    if (IMAGE_EXT.test(file.name || '')) return 'chat-image';
    if (AUDIO_EXT.test(file.name || '')) return 'chat-audio';
  }
  return 'chat-file';
}

function checkChatFile(file, kind) {
  const limits = CHAT_LIMITS[kind];
  const type = (file.type || '').split(';')[0];
  if (!limits.accept.split(',').includes(type)) return `That file type isn’t supported. Use ${limits.label}.`;
  if (file.size === 0) return 'That file is empty.';
  if (file.size > limits.maxBytes) return `That file is too large. Use ${limits.label}.`;
  return null;
}

async function imageSize(file) {
  try {
    if (typeof createImageBitmap === 'function') { const b = await createImageBitmap(file); const s = { width: b.width, height: b.height }; b.close?.(); return s; }
  } catch { /* fall through */ }
  return {};
}

/** Upload one attachment with progress. Resolves `{ key, url, name, mime, size, width?, height? }`. */
export async function uploadChatAttachment(rawFile, kind, { onProgress, signal, durationMs } = {}) {
  let file = rawFile;
  if (kind === 'chat-image' && rawFile.type !== 'image/gif') {
    // Downsize in the browser; if decoding stalls (huge/odd photos on some phones) fall back to the original file.
    file = await Promise.race([
      prepareImage(rawFile, { maxEdge: 1600 }).catch(() => rawFile),
      new Promise((resolve) => setTimeout(() => resolve(rawFile), 15_000)),
    ]);
  }
  const problem = checkChatFile(file, kind);
  if (problem) throw Object.assign(new Error(problem), { status: 422 });
  const contentType = (file.type || 'application/octet-stream').split(';')[0];
  const params = new URLSearchParams({ kind, fileName: file.name || (kind === 'chat-audio' ? 'voice-note' : 'upload') });
  const url = `${V1}/uploads?${params}`;
  const dims = kind === 'chat-image' ? await imageSize(file) : {};
  const finish = (data) => ({ key: data.key, url: data.url, name: file.name || data.fileName || 'file', mime: contentType, size: file.size, ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}), ...dims });

  // XHR gives upload progress; on a stale token fall back to authorizedFetch (which refreshes and retries).
  const viaXhr = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', contentType);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(Object.assign(new Error('Upload failed. Check your connection and try again.'), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { aborted: true }));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(finish(data));
      else reject(Object.assign(new Error(data.error?.message || `Upload failed (${xhr.status})`), { status: xhr.status, code: data.error?.code }));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });

  try {
    return await viaXhr();
  } catch (e) {
    if (e.status !== 401) throw e;
    const res = await authorizedFetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: file, signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Upload failed.'), { status: res.status, code: data.error?.code });
    return finish(data);
  }
}

const thread = (id) => `/community/threads/${encodeURIComponent(id)}`;
export const sendChatMessage = (id, payload) => workspaceCall(`${thread(id)}/messages`, payload);
export const deleteChatMessage = (id, mid) => workspaceCall(`${thread(id)}/messages/${encodeURIComponent(mid)}`, undefined, 'DELETE');
export const reactToMessage = (id, mid, emoji) => workspaceCall(`${thread(id)}/messages/${encodeURIComponent(mid)}/react`, { emoji });

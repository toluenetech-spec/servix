/* Shared helpers for the Messages UI. Plain functions, no React. Safari-safe (no lookbehind, .at(), structuredClone). */

export const LOCATION_PREFIX = '📍 My location: ';
export const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
export const TYPING_TTL = 4500;

export const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso) {
  const d = new Date(iso); const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function relativeSeen(iso) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const label = dayLabel(iso);
  return `Last seen ${label === 'Today' ? '' : `${label} at `}${timeOf(iso)}`;
}

export function listTime(iso) {
  if (!iso) return '';
  const label = dayLabel(iso);
  return label === 'Today' ? timeOf(iso) : label;
}

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'S';
export const sortMessages = (list) => list.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
export const after = (iso, mark) => Boolean(mark) && new Date(mark).getTime() >= new Date(iso).getTime();

export function tickState(m, thread) {
  if (m.pending) return 'pending';
  if (m.failed) return 'failed';
  if (after(m.createdAt, thread?.otherReadAt)) return 'seen';
  if (after(m.createdAt, thread?.otherDeliveredAt)) return 'delivered';
  return 'sent';
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileLabel(mime = '', name = '') {
  const ext = (name.split('.').pop() || '').toUpperCase();
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('word')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PPT';
  if (mime === 'text/csv') return 'CSV';
  if (mime === 'text/plain') return 'TXT';
  return ext.slice(0, 4) || 'FILE';
}

/** Inbox one-liner for a message object (mirrors the API's previewOf). */
export function previewOf(m) {
  if (!m) return '';
  if (m.kind === 'deleted') return 'This message was deleted';
  if (m.kind === 'image') return m.body ? `📷 ${m.body}` : '📷 Photo';
  if (m.kind === 'audio') return '🎤 Voice note';
  if (m.kind === 'file') return `📄 ${m.attachment?.name ?? 'File'}`;
  if ((m.body || '').startsWith(LOCATION_PREFIX)) return '📍 Location';
  return m.body;
}

/** Merge a message update (reaction/delete) into an existing list without losing local-only fields. */
export function mergeMessage(list, update) {
  let found = false;
  const next = list.map((m) => {
    if (m.id !== update.id) return m;
    found = true;
    return { ...m, ...update, replyTo: update.replyTo && update.replyTo.body !== undefined ? update.replyTo : m.replyTo };
  });
  return found ? next : list;
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✅'];

export const EMOJI_GROUPS = [
  { label: 'Smileys', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😢', '😭', '😡', '🥳', '🤝', '👋', '👍', '👎', '👏', '🙏', '💪', '🙌', '🤞', '✌️'] },
  { label: 'Work', items: ['🔧', '🔨', '🪛', '🧰', '🪜', '🧹', '🧼', '🪣', '🎨', '🖌️', '📐', '📏', '💻', '📱', '📷', '🎥', '📦', '🚚', '🏠', '🏢', '🛠️', '⚡', '💡', '🔌'] },
  { label: 'Objects', items: ['📍', '📅', '⏰', '💰', '💳', '🧾', '📄', '📝', '✅', '❌', '⭐', '🔥', '🎉', '🎁', '☕', '🍽️', '🚗', '✈️', '☀️', '🌧️', '❤️', '💚', '🙂', '🤗'] },
];

/** Safe http(s) link detection → array of {text, url?} parts. */
export function linkParts(body) {
  const parts = String(body || '').split(URL_RE);
  return parts.map((part, i) => (i % 2 === 1 ? { url: part, text: part } : { text: part }));
}

export function isLocationMessage(m) {
  return m.kind === 'text' && (m.body || '').startsWith(LOCATION_PREFIX);
}

export function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const h = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
/** Attachment links are absolute on production (public bucket); in dev the API serves `/media/<key>` itself. */
export function mediaSrc(url) {
  if (!url) return url;
  return url.startsWith('/media/') ? `${API_BASE}${url}` : url;
}

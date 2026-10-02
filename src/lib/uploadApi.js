/**
 * File uploads — the browser sends the file to the Servix API, which checks it
 * and stores it in object storage. No bucket credentials or presigned URLs ever
 * reach the browser. Kinds: avatar | profile | portfolio | service |
 * service-video | service-document | resume.
 */
import { authorizedFetch } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const UPLOAD_LIMITS = {
  image: { accept: 'image/jpeg,image/png,image/webp', maxBytes: 5 * 1024 * 1024, label: 'JPEG, PNG or WebP up to 5 MB' },
  document: { accept: 'application/pdf', maxBytes: 10 * 1024 * 1024, label: 'PDF up to 10 MB' },
  video: { accept: 'video/mp4,video/webm,video/quicktime', maxBytes: 50 * 1024 * 1024, label: 'MP4, WebM or MOV up to 50 MB' },
};

export function limitsFor(kind) {
  if (kind === 'service-video') return UPLOAD_LIMITS.video;
  if (kind === 'service-document' || kind === 'resume') return UPLOAD_LIMITS.document;
  return UPLOAD_LIMITS.image;
}

/** Client-side pre-check so people get an instant answer before a long upload. */
export function checkFile(file, kind) {
  const limits = limitsFor(kind);
  const allowed = limits.accept.split(',');
  if (!allowed.includes(file.type)) return `That file type isn’t supported. Use ${limits.label}.`;
  if (file.size > limits.maxBytes) return `That file is too large. Use ${limits.label}.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

async function toApiError(res) {
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  const err = new Error(payload?.error?.message ?? `Upload failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  return err;
}

export async function uploadFile(file, kind) {
  const problem = checkFile(file, kind);
  if (problem) throw Object.assign(new Error(problem), { status: 422 });
  const params = new URLSearchParams({ kind, fileName: file.name || 'upload' });
  const res = await authorizedFetch(`${V1}/uploads?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json(); // { url, key, kind, fileName, contentType, size }
}

/** Reads a LinkedIn "Save to PDF" export or a CV and returns field suggestions. */
export async function importResume(file) {
  const problem = checkFile(file, 'resume');
  if (problem) throw Object.assign(new Error(problem), { status: 422 });
  const params = new URLSearchParams({ fileName: file.name || 'resume.pdf' });
  const res = await authorizedFetch(`${V1}/applications/resume?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json(); // { resumeUrl, resumeFileName, textFound, suggestions, note }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
  image: { accept: 'image/jpeg,image/png,image/webp', pickerAccept: 'image/*', maxBytes: 5 * 1024 * 1024, label: 'JPEG, PNG or WebP up to 5 MB (phone photos are resized automatically)' },
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

/* ---------- image preparation ----------
 * Phone cameras produce 4–12 MB JPEG/HEIC files that would fail the 5 MB
 * limit or the type check. Before uploading we decode the picture in the
 * browser and re-encode it as a JPEG no larger than MAX_IMAGE_EDGE px.
 * Anything that can't be decoded falls through to the normal checks. */
export const MAX_IMAGE_EDGE = 1280;

function isImageKind(kind) {
  return limitsFor(kind) === UPLOAD_LIMITS.image;
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareImage(file, { maxEdge = MAX_IMAGE_EDGE } = {}) {
  if (!file || typeof document === 'undefined') return file;
  const allowed = UPLOAD_LIMITS.image.accept.split(',');
  const small = file.size <= 1024 * 1024;
  const knownType = allowed.includes(file.type);
  const bitmap = await decodeImage(file);
  if (!bitmap) return file;
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const needsResize = Math.max(w, h) > maxEdge;
  if (small && knownType && !needsResize) return file;
  const scale = needsResize ? maxEdge / Math.max(w, h) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === 'function') bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) return file;
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function uploadFile(rawFile, kind) {
  const file = isImageKind(kind) ? await prepareImage(rawFile) : rawFile;
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

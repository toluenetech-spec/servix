/**
 * SERVIX storage (Phase E) — Cloudflare R2 (S3-compatible).
 *
 * Providers:
 *  - R2Provider        — real presigned PUT/DELETE URLs via AWS SigV4
 *                        (hand-rolled, verified against the official AWS
 *                        documentation test vector). Activated by
 *                        STORAGE_PROVIDER=r2 + R2_* env vars.
 *  - LocalStubProvider — honest stub when R2 is not configured:
 *                        enabled:false, uploadUrl:null, never fakes an
 *                        upload.
 *
 * Rules: content-type whitelist + size cap enforced server-side; object
 * keys are uuid-based (client filename never reaches the key); binary
 * media never enters PostgreSQL; R2 secrets never reach the browser —
 * only short-lived presigned URLs do.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { resolveStorageEnv } from './config.js';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type UploadKind =
  | 'profile'
  | 'portfolio'
  | 'service'
  | 'avatar'
  | 'resume'
  | 'service-video'
  | 'service-document';

export const UPLOAD_KINDS: UploadKind[] = ['profile', 'portfolio', 'service', 'avatar', 'resume', 'service-video', 'service-document'];

/** Content-type whitelist and size cap per upload kind (enforced server-side). */
export function uploadRules(kind: UploadKind): { types: string[]; maxBytes: number; label: string } {
  switch (kind) {
    case 'resume':
    case 'service-document':
      return { types: ALLOWED_DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES, label: 'PDF documents up to 10 MB' };
    case 'service-video':
      return { types: ALLOWED_VIDEO_TYPES, maxBytes: MAX_VIDEO_BYTES, label: 'MP4, WebM or MOV videos up to 50 MB' };
    default:
      return { types: ALLOWED_IMAGE_TYPES, maxBytes: MAX_UPLOAD_BYTES, label: 'JPEG, PNG or WebP images up to 5 MB' };
  }
}

export interface PresignResult {
  enabled: boolean;
  key: string;
  publicUrl: string;
  uploadUrl: string | null;
  note?: string;
}

export interface PutResult {
  key: string;
  publicUrl: string;
}

export interface StorageProvider {
  name: string;
  enabled: boolean;
  presign(kind: UploadKind, fileName: string, contentType: string): Promise<PresignResult>;
  presignDelete(key: string): Promise<string | null>;
  /** Server-side upload: the API streams the bytes to the bucket itself, so the
   * browser never talks to R2 directly (no bucket CORS needed). */
  putObject(kind: UploadKind, fileName: string, contentType: string, body: Buffer): Promise<PutResult>;
  /** Read an object back (used by GET /media/* so a private bucket still serves images). */
  fetchObject(key: string): Promise<Response | null>;
}

/** Keys we mint: `<kind>/<uuid>.<ext>` — anything else is refused by GET /media. */
export const MEDIA_KEY_RE = new RegExp(`^(${UPLOAD_KINDS.join('|')})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{2,5}$`);

function safeExt(fileName: string, contentType: string): string {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return byType[contentType] ?? 'bin';
}

export function makeKey(kind: UploadKind, fileName: string, contentType: string): string {
  return `${kind}/${randomUUID()}.${safeExt(fileName, contentType)}`;
}

/**
 * Public URL for a stored media reference. Links are saved with whatever
 * R2_PUBLIC_BASE_URL was at upload time; if that base later changes (e.g. a
 * retired host), the key inside the link is still ours, so rebuild the URL
 * on the current base instead of serving a dead link. Anything that is not
 * one of our minted keys is returned untouched.
 */
export function mediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const base = resolveStorageEnv().publicBaseUrl.replace(/\/$/, '');
  if (!base) return stored;
  if (stored.startsWith(`${base}/`)) return stored;
  const m = /(?:^|\/)((?:profile|portfolio|service|avatar|resume|service-video|service-document)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5})$/.exec(stored);
  if (!m) return stored;
  return `${base}/${m[1]}`;
}

/* ---------------- SigV4 (S3-compatible presigned URLs) ---------------- */

interface SigV4Params {
  method: 'PUT' | 'DELETE' | 'GET';
  host: string;
  path: string; // must start with /
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  now?: Date;
}

const encodeRfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function presignS3Url(p: SigV4Params): string {
  const now = p.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const scope = `${dateStamp}/${p.region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${p.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(p.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join('&');

  const canonicalPath = p.path
    .split('/')
    .map((seg) => encodeRfc3986(seg))
    .join('/');

  const canonicalRequest = [
    p.method,
    canonicalPath,
    canonicalQuery,
    `host:${p.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = createHmac('sha256', `AWS4${p.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(p.region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `https://${p.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/* ---------------- providers ---------------- */

class R2Provider implements StorageProvider {
  name = 'r2';
  enabled = true;
  private env = resolveStorageEnv();
  private accessKeyId = this.env.accessKeyId;
  private secretAccessKey = this.env.secretAccessKey;
  private bucket = this.env.bucket;
  private region = this.env.region || 'auto';
  private publicBase = this.env.publicBaseUrl.replace(/\/$/, '');

  private get host(): string {
    return this.env.endpointHost;
  }

  async presign(kind: UploadKind, fileName: string, contentType: string): Promise<PresignResult> {
    const key = makeKey(kind, fileName, contentType);
    const uploadUrl = presignS3Url({
      method: 'PUT',
      host: this.host,
      path: `/${this.bucket}/${key}`,
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      expiresSeconds: 300,
    });
    return {
      enabled: true,
      key,
      publicUrl: this.publicBase ? `${this.publicBase}/${key}` : `/media/${key}`,
      uploadUrl,
    };
  }

  async presignDelete(key: string): Promise<string | null> {
    return presignS3Url({
      method: 'DELETE',
      host: this.host,
      path: `/${this.bucket}/${key}`,
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      expiresSeconds: 300,
    });
  }

  async putObject(kind: UploadKind, fileName: string, contentType: string, body: Buffer): Promise<PutResult> {
    const presigned = await this.presign(kind, fileName, contentType);
    const res = await fetch(presigned.uploadUrl!, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
      body,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Object storage rejected the upload (${res.status}). ${detail}`.trim());
    }
    return { key: presigned.key, publicUrl: presigned.publicUrl };
  }

  async fetchObject(key: string): Promise<Response | null> {
    const res = await fetch(await this.presignGet(key, 300), { method: 'GET' });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Object storage read failed (${res.status}).`);
    return res;
  }

  /** Short-lived presigned GET (image retrieval when the bucket is private). */
  async presignGet(key: string, expiresSeconds = 3600): Promise<string> {
    return presignS3Url({
      method: 'GET',
      host: this.host,
      path: `/${this.bucket}/${key}`,
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      expiresSeconds,
    });
  }
}

class LocalStubProvider implements StorageProvider {
  name = 'stub';
  enabled = false;
  async presign(kind: UploadKind, fileName: string, contentType: string): Promise<PresignResult> {
    const key = makeKey(kind, fileName, contentType);
    return {
      enabled: false,
      key,
      publicUrl: `/uploads/${key}`,
      uploadUrl: null,
      note: 'Object storage is not configured in this environment. Uploads activate when R2 credentials are provided.',
    };
  }
  async presignDelete(): Promise<string | null> {
    return null;
  }
  async putObject(): Promise<PutResult> {
    throw new Error('Object storage is not configured in this environment.');
  }
  async fetchObject(): Promise<Response | null> {
    return null;
  }
}

export function getStorage(): StorageProvider {
  const env = resolveStorageEnv();
  const configured = env.enabled && env.endpointHost && env.accessKeyId && env.secretAccessKey && env.bucket;
  return configured ? new R2Provider() : new LocalStubProvider();
}

export { R2Provider };

/* ---------------- orphan cleanup ---------------- */

/**
 * Deletes uploaded keys that no DB row references and that are older
 * than 24h. Presign requests are tracked via `upload.presigned` audit
 * rows; anything presigned long ago and never attached (profile image,
 * portfolio media, service media) is orphaned. With the stub provider
 * this is a no-op.
 */
export async function sweepOrphans(): Promise<number> {
  const storage = getStorage();
  if (storage.name !== 'r2') return 0;
  const publicBase = resolveStorageEnv().publicBaseUrl.replace(/\/$/, '');

  // Referenced URLs across all media-bearing tables:
  const [profiles, portfolio, media] = await Promise.all([
    prisma.professionalProfile.findMany({ where: { imageUrl: { startsWith: publicBase || '/media/' } }, select: { imageUrl: true } }),
    prisma.portfolioItem.findMany({ where: { mediaUrl: { startsWith: publicBase || '/media/' } }, select: { mediaUrl: true } }),
    prisma.serviceMedia.findMany({ where: { url: { startsWith: publicBase || '/media/' } }, select: { url: true } }),
  ]);
  const referenced = new Set<string>();
  for (const p of profiles) if (p.imageUrl) referenced.add(p.imageUrl);
  for (const p of portfolio) if (p.mediaUrl) referenced.add(p.mediaUrl);
  for (const m of media) referenced.add(m.url);

  const pending = await prisma.auditLog.findMany({
    where: {
      action: 'upload.presigned',
      createdAt: { lte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    take: 200,
  });

  let deleted = 0;
  for (const row of pending) {
    const publicUrl = (row.data as { publicUrl?: string }).publicUrl;
    const key = (row.data as { key?: string }).key;
    if (!publicUrl || !key || referenced.has(publicUrl)) continue;
    const deleteUrl = await storage.presignDelete(key);
    if (!deleteUrl) continue;
    try {
      const res = await fetch(deleteUrl, { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
      if (res.ok || res.status === 404) {
        deleted += 1;
        await prisma.auditLog.delete({ where: { id: row.id } });
      }
    } catch {
      // Transient network failure — the next sweep retries.
    }
  }
  return deleted;
}

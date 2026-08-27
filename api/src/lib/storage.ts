/**
 * SERVIX storage abstraction — Phase C boundary for Cloudflare R2 / S3.
 *
 * Binary files are NEVER stored in PostgreSQL; the database keeps only
 * string references (URLs/keys). This module defines the presigned-upload
 * contract the frontend will use:
 *
 *   1. Client → POST /api/v1/pro/uploads  {kind, fileName, contentType}
 *   2. API validates type/size, returns {uploadUrl, publicUrl, key}
 *   3. Client PUTs the file directly to storage via uploadUrl
 *   4. Client saves publicUrl on the profile/portfolio/service media
 *
 * Providers:
 *   - LocalStubProvider (active in dev/CI): returns deterministic keys and
 *     public URLs under /uploads/*, but NO usable upload URL — it reports
 *     `enabled: false` so the UI can honestly say uploads aren't live.
 *     It never fakes a successful binary upload.
 *   - R2Provider (deploy-time): implement `presign()` with S3 SigV4
 *     (aws4fetch or @aws-sdk/s3-request-presigner) and the env vars below.
 *
 * Required env (production):
 *   STORAGE_PROVIDER=r2
 *   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
 *   R2_BUCKET / R2_PUBLIC_BASE_URL
 */
import { randomUUID } from 'node:crypto';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export type UploadKind = 'profile' | 'portfolio' | 'service';

export interface PresignResult {
  enabled: boolean;
  key: string;
  publicUrl: string;
  uploadUrl: string | null;
  headers?: Record<string, string>;
  note?: string;
}

export interface StorageProvider {
  presign(kind: UploadKind, fileName: string, contentType: string): Promise<PresignResult>;
}

function safeExt(fileName: string, contentType: string): string {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return byType[contentType] ?? (fileName.split('.').pop() || 'bin').toLowerCase().slice(0, 5);
}

class LocalStubProvider implements StorageProvider {
  async presign(kind: UploadKind, fileName: string, contentType: string): Promise<PresignResult> {
    const key = `${kind}/${randomUUID()}.${safeExt(fileName, contentType)}`;
    return {
      enabled: false,
      key,
      publicUrl: `/uploads/${key}`,
      uploadUrl: null,
      note: 'Object storage is not configured in this environment. Direct uploads activate when R2 credentials are provided at deploy time.',
    };
  }
}

export function getStorage(): StorageProvider {
  // R2Provider is added at deploy time; the stub keeps the contract testable.
  return new LocalStubProvider();
}

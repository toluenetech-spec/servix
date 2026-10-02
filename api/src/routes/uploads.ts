/**
 * Uploads — the browser sends the raw file to the API, the API validates it
 * (kind, content type, size) and stores it in Cloudflare R2 itself. R2 keys
 * are uuid-based; the original filename is returned for display only.
 *
 * Why not presigned browser → R2 PUTs? They need a bucket CORS policy and
 * surface R2 error pages to end users. Streaming through the API keeps one
 * origin, one error format and one place to enforce the rules.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/authGuard.js';
import { ApiError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { getStorage, uploadRules, UPLOAD_KINDS, MAX_VIDEO_BYTES, type UploadKind } from '../lib/storage.js';
import { resolveStorageEnv } from '../lib/config.js';

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'];

const querySchema = z.object({
  kind: z.enum(UPLOAD_KINDS as [UploadKind, ...UploadKind[]]),
  fileName: z.string().trim().min(1).max(200).default('upload'),
});

export function storageUnavailable() {
  return new ApiError(503, 'STORAGE_UNAVAILABLE', 'File uploads are not available right now. Please try again later or continue without a file.');
}

/** Only URLs that point at our own bucket may be saved as media. */
export function assertOwnMediaUrl(url: string | undefined | null, field: string): string | undefined {
  if (url == null || url === '') return undefined;
  const env = resolveStorageEnv();
  const base = env.publicBaseUrl.replace(/\/$/, '');
  const ok = base ? url.startsWith(`${base}/`) : /^https?:\/\/[^\s]+$/i.test(url) || url.startsWith('/uploads/');
  if (!ok || url.length > 500) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be a file uploaded to Servix.`);
  }
  return url;
}

export async function storeUpload(opts: { userId: string; kind: UploadKind; fileName: string; contentType: string; body: Buffer; ip?: string }) {
  const rules = uploadRules(opts.kind);
  const contentType = opts.contentType.split(';')[0].trim().toLowerCase();
  if (!rules.types.includes(contentType)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `Unsupported file type. Allowed: ${rules.label}.`);
  }
  if (opts.body.byteLength === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'The file is empty.');
  if (opts.body.byteLength > rules.maxBytes) {
    throw new ApiError(422, 'VALIDATION_ERROR', `That file is too large. Allowed: ${rules.label}.`);
  }
  const storage = getStorage();
  if (!storage.enabled) throw storageUnavailable();
  const stored = await storage.putObject(opts.kind, opts.fileName, contentType, opts.body);
  await audit(prisma, {
    actorId: opts.userId,
    action: 'upload.stored',
    entity: 'storage',
    entityId: stored.key,
    data: { key: stored.key, publicUrl: stored.publicUrl, kind: opts.kind, bytes: opts.body.byteLength, contentType },
    ip: opts.ip,
  });
  return { url: stored.publicUrl, key: stored.key, kind: opts.kind, fileName: opts.fileName, contentType, size: opts.body.byteLength };
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post(
    '/uploads',
    {
      preHandler: requireAuth,
      bodyLimit: MAX_VIDEO_BYTES + 64 * 1024,
      config: { rateLimit: { max: 40, timeWindow: '10 minutes' } },
      schema: { tags: ['uploads'], summary: 'Upload a file (raw body) to Servix storage', security: [{ bearerAuth: [] }] },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const query = querySchema.safeParse(req.query);
      if (!query.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Choose what kind of file you are uploading.');
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file itself with its content type.');
      const result = await storeUpload({
        userId: req.auth!.sub,
        kind: query.data.kind,
        fileName: query.data.fileName,
        contentType: String(req.headers['content-type'] ?? ''),
        body,
        ip: req.ip,
      });
      return reply.code(201).send(result);
    },
  );

  app.get('/uploads/rules', { schema: { tags: ['uploads'], summary: 'Upload limits per kind' } }, async () => {
    const storage = getStorage();
    return {
      enabled: storage.enabled,
      kinds: Object.fromEntries(UPLOAD_KINDS.map((k) => [k, uploadRules(k)])),
    };
  });
}

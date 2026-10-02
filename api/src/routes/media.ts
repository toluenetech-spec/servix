/**
 * GET /media/<kind>/<uuid>.<ext> — serves stored files from the R2 bucket
 * through the API. This lets R2_PUBLIC_BASE_URL simply be
 * `https://<api-host>/media`, so images work without making the bucket
 * public or wiring a custom domain. Keys are unguessable UUIDs and are
 * cached immutably by browsers and CDNs.
 */
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { getStorage, MEDIA_KEY_RE } from '../lib/storage.js';

const PASS_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified', 'content-disposition', 'accept-ranges'];

export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { '*': string } }>(
    '/media/*',
    {
      // Pages with galleries request many images at once; browsers cache them immutably afterwards.
      config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
      schema: { tags: ['meta'], summary: 'Serve an uploaded file from object storage' },
    },
    async (req, reply) => {
      const key = req.params['*'];
      if (!MEDIA_KEY_RE.test(key)) return reply.code(404).send({ error: { status: 404, code: 'NOT_FOUND', message: 'File not found.' } });
      const storage = getStorage();
      if (!storage.enabled) return reply.code(503).send({ error: { status: 503, code: 'STORAGE_UNAVAILABLE', message: 'File storage is not configured.' } });
      let upstream: Response | null;
      try {
        upstream = await storage.fetchObject(key);
      } catch (err) {
        req.log.error({ err, key }, 'media fetch failed');
        return reply.code(502).send({ error: { status: 502, code: 'STORAGE_ERROR', message: 'Could not read the file from storage.' } });
      }
      if (!upstream || !upstream.body) return reply.code(404).send({ error: { status: 404, code: 'NOT_FOUND', message: 'File not found.' } });
      for (const h of PASS_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) reply.header(h, v);
      }
      if (!upstream.headers.get('content-type')) reply.header('content-type', 'application/octet-stream');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cross-origin-resource-policy', 'cross-origin');
      return reply.send(Readable.fromWeb(upstream.body as never));
    },
  );
}

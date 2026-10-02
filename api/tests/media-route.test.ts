/**
 * GET /media/<key> — files are streamed from the bucket through the API so
 * R2_PUBLIC_BASE_URL can simply be `https://<api-host>/media`. No database
 * or real bucket: the upstream fetch is stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
const realFetch = globalThis.fetch;
const seen: string[] = [];
const KEY = 'avatar/bc4ed153-ced7-452c-8821-03f78c011852.jpg';

beforeAll(async () => {
  process.env.STORAGE_PROVIDER = 'r2';
  process.env.R2_ACCOUNT_ID = 'acct123';
  process.env.R2_ACCESS_KEY_ID = 'ak';
  process.env.R2_SECRET_ACCESS_KEY = 'sk';
  process.env.R2_BUCKET = 'servix-storage';
  process.env.R2_PUBLIC_BASE_URL = 'https://api.servix.test/media';
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes(`/servix-storage/${KEY}`)) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg', etag: '"abc"', 'content-length': '7' } });
    }
    return new Response('<Error>NoSuchKey</Error>', { status: 404 });
  }) as typeof fetch;
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const k of ['STORAGE_PROVIDER', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) delete process.env[k];
  await app.close();
});

describe('GET /media/*', () => {
  it('streams a stored object with immutable caching and the upstream content type', async () => {
    const res = await app.inject({ method: 'GET', url: `/media/${KEY}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.rawPayload.subarray(0, 2).toString('hex')).toBe('ffd8');
    // Fetched from the bucket with a short-lived signed GET, never a public bucket URL.
    expect(seen.at(-1)).toMatch(/^https:\/\/acct123\.r2\.cloudflarestorage\.com\/servix-storage\/avatar\/.*X-Amz-Signature=/);
  });

  it('refuses keys we did not mint and reports missing objects as 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/media/avatar/../../etc/passwd' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/media/other/bc4ed153-ced7-452c-8821-03f78c011852.jpg' })).statusCode).toBe(404);
    const missing = await app.inject({ method: 'GET', url: '/media/profile/00000000-0000-0000-0000-000000000000.png' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });
});

describe('mediaUrl()', () => {
  it('rebuilds links saved under a retired base on the current R2_PUBLIC_BASE_URL', async () => {
    const { mediaUrl } = await import('../src/lib/storage.js');
    expect(mediaUrl('https://servix-api-ugfs.onrender.com/media/avatar/b9028772-1b1f-41e9-861a-6984fcd981fa.jpg')).toBe('https://api.servix.test/media/avatar/b9028772-1b1f-41e9-861a-6984fcd981fa.jpg');
    expect(mediaUrl('/media/profile/b9028772-1b1f-41e9-861a-6984fcd981fa.png')).toBe('https://api.servix.test/media/profile/b9028772-1b1f-41e9-861a-6984fcd981fa.png');
    expect(mediaUrl('https://api.servix.test/media/avatar/b9028772-1b1f-41e9-861a-6984fcd981fa.jpg')).toBe('https://api.servix.test/media/avatar/b9028772-1b1f-41e9-861a-6984fcd981fa.jpg');
    // Seeded/static images and foreign links are left alone.
    expect(mediaUrl('/images/professionals/tunde-bakare.jpg')).toBe('/images/professionals/tunde-bakare.jpg');
    expect(mediaUrl('https://example.com/avatar/not-a-uuid.jpg')).toBe('https://example.com/avatar/not-a-uuid.jpg');
    expect(mediaUrl(null)).toBeNull();
  });
});

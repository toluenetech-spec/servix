/** Admin gig review (open any gig, approve & publish, send back) — real API on an isolated local PostgreSQL. Opt-in: RUN_LOCAL_ONBOARDING_GIGS_TESTS=1. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sinceFrom } from '../src/ai/since.js';

describe('sinceFrom (pure)', () => {
  it('understands today / yesterday / Nd / ISO in Lagos time', () => {
    const now = new Date('2026-10-04T13:30:00Z'); // 14:30 Lagos
    expect(sinceFrom('today', now)!.toISOString()).toBe('2026-10-03T23:00:00.000Z');
    expect(sinceFrom('yesterday', now)!.toISOString()).toBe('2026-10-02T23:00:00.000Z');
    expect(sinceFrom('7d', now)!.toISOString()).toBe('2026-09-27T13:30:00.000Z');
    expect(sinceFrom('2026-10-01', now)!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(sinceFrom('nonsense', now)).toBeNull();
    expect(sinceFrom(undefined, now)).toBeNull();
    // Lagos day boundary: 00:30 Lagos = 23:30Z previous day → "today" starts at 23:00Z of the day before.
    expect(sinceFrom('today', new Date('2026-10-04T23:30:00Z'))!.toISOString()).toBe('2026-10-04T23:00:00.000Z');
  });
});

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_ONBOARDING_GIGS_TESTS !== '1')('admin gig review, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let design: string; let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-gig-review-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55464/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10'; process.env.APP_BASE_URL = origin;
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55464, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) { if (name === 'migration_lock.toml') continue; await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8')); }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    design = (await prisma.category.create({ data: { slug: 'graphic-design', name: 'Graphic Design' } })).id;
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  }, 180_000);
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin', fullName: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only', kycStatus: 'unverified' } });
    const profile = role === 'professional' ? await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Designer', slug: `pro-${randomUUID().slice(0, 8)}`, categoryId: design } }) : null;
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, profile };
  }
  const call = (token: string, path: string, body?: object, method?: 'GET' | 'POST') =>
    app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });

  it('admin can open a draft gig, is blocked from publishing an incomplete one, publishes a complete one, and can send it back', async () => {
    const pro = await account('professional', 'Tunde Bakare');
    const admin = await account('admin', 'Servix Admin');
    const customer = await account('customer', 'Ada Obi');
    const slug = `flyer-${randomUUID().slice(0, 8)}`;
    await prisma.service.create({ data: { slug, professionalId: pro.profile!.id, categoryId: design, title: 'Flyer design', shortDescription: 'Event flyers delivered within 24 hours', description: 'Short.', price: 5000n, status: 'draft', deliveryDays: 1 } });

    // Non-admins get 403 on every review route; the public catalogue still hides drafts.
    expect((await call(customer.token, `admin/services/${slug}`)).statusCode).toBe(403);
    expect((await call(pro.token, `admin/services/${slug}/approve`, {})).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/services/${slug}` })).statusCode).toBe(404);

    // The list shows the draft with creator email and what blocks publishing.
    const list = await call(admin.token, 'admin/services?status=draft');
    expect(list.statusCode).toBe(200);
    const row = list.json().items.find((s: { id: string }) => s.id === slug);
    expect(row).toMatchObject({ status: 'draft', professional: 'Tunde Bakare', professionalEmail: pro.user.email, identityStatus: 'unverified', category: 'Graphic Design' });
    expect(row.problems).toEqual(expect.arrayContaining(['Describe the gig in at least 50 characters.', 'Add at least one image to the gallery.']));

    // Full detail works for a draft (the public route would 404).
    const detail = await call(admin.token, `admin/services/${slug}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: slug, status: 'draft', title: 'Flyer design', description: 'Short.', categoryName: 'Graphic Design', owner: { email: pro.user.email, name: 'Tunde Bakare', identityStatus: 'unverified' } });
    expect(detail.json().problems).toHaveLength(2);

    // Approving an incomplete gig is refused with the checklist; nothing changes.
    const blocked = await call(admin.token, `admin/services/${slug}/approve`, {});
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('GIG_INCOMPLETE');
    expect((await prisma.service.findUniqueOrThrow({ where: { slug } })).status).toBe('draft');

    // Complete it, then approve → active, startingPrice refreshed, owner notified, audited.
    const service = await prisma.service.update({ where: { slug }, data: { description: 'Eye-catching flyers for events, launches and promotions, delivered print-ready within 24 hours.' } });
    await prisma.serviceMedia.create({ data: { serviceId: service.id, url: 'uploads/flyer.jpg', kind: 'image', isCover: true } });
    const approved = await call(admin.token, `admin/services/${slug}/approve`, { note: 'Looks great.' });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ id: slug, status: 'active', changed: true });
    expect((await prisma.professionalProfile.findUniqueOrThrow({ where: { id: pro.profile!.id } })).startingPrice).toBe(5000n);
    expect(await prisma.notification.findFirst({ where: { userId: pro.user.id, type: 'gig.approved' } })).toMatchObject({ link: '/dashboard/gigs' });
    expect(await prisma.auditLog.count({ where: { actorId: admin.user.id, action: 'service.approve', entityId: slug } })).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/services/${slug}` })).statusCode).toBe(200);
    // Approving again is a no-op.
    expect((await call(admin.token, `admin/services/${slug}/approve`, {})).json()).toMatchObject({ status: 'active', changed: false });

    // Send back with a reason → draft again, owner notified with the reason, catalogue hides it.
    expect((await call(admin.token, `admin/services/${slug}/reject`, { reason: 'x' })).statusCode).toBe(422);
    const back = await call(admin.token, `admin/services/${slug}/reject`, { reason: 'Please add your own work samples, not stock images.' });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toEqual({ id: slug, status: 'draft' });
    const note = await prisma.notification.findFirst({ where: { userId: pro.user.id, type: 'gig.changes_requested' } });
    expect(note?.body).toContain('Please add your own work samples');
    expect((await app.inject({ method: 'GET', url: `/api/v1/services/${slug}` })).statusCode).toBe(404);
    expect((await prisma.professionalProfile.findUniqueOrThrow({ where: { id: pro.profile!.id } })).startingPrice).toBeNull();
  }, 60_000);
});

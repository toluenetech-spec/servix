/** Opt-in integration tests for notifications, saved professionals, plans and admin analytics.
 *  Creates its own loopback PostgreSQL (embedded-postgres); never touches Neon.
 *  Run: RUN_LOCAL_WORKSPACE_TESTS=1 npx vitest run tests/workspace-features-local.test.ts */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';

describe.skipIf(process.env.RUN_LOCAL_WORKSPACE_TESTS !== '1')('workspace features, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-workspace-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55448/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false'; process.env.COMMUNITY_ENABLED = 'true';
    process.env.PAYMENT_MODE = 'sandbox';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55448, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) {
        if (name === 'migration_lock.toml') continue;
        await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
      }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    /* Plans (free/go/pro/team/enterprise) are inserted by the subscriptions migration itself. */
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: 'Test Member', role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only' } });
    const slug = randomUUID(); let professionalId: string | null = null;
    if (role === 'professional') professionalId = (await prisma.professionalProfile.create({ data: { userId: user.id, name: 'Test Professional', title: 'Developer', slug } })).id;
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, slug, professionalId };
  }
  function call(token: string, path: string, body?: object, method?: 'GET' | 'POST' | 'PUT' | 'DELETE') {
    return app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }

  it('notifications start empty, broadcast reaches the right audience, and reads are per-account', async () => {
    const customer = await account(), pro = await account('professional'), admin = await account('admin'), outsider = await account();
    expect((await call('', 'account/notifications')).statusCode).toBe(401);
    expect((await call(customer.token, 'account/notifications/unread')).json()).toEqual({ unread: 0 });
    // Only admins may broadcast, and the role is re-read from the database.
    expect((await call(pro.token, 'admin/notifications', { audience: 'all', title: 'Nope', body: 'Not allowed.' })).statusCode).toBe(403);
    const sent = await call(admin.token, 'admin/notifications', { audience: 'professionals', title: 'Payout schedule', body: 'Payouts now run every weekday.', link: '/dashboard/earnings' });
    expect(sent.statusCode).toBeLessThan(300); expect(sent.json().recipientCount).toBeGreaterThanOrEqual(1);
    expect((await call(customer.token, 'account/notifications/unread')).json()).toEqual({ unread: 0 });
    const inbox = (await call(pro.token, 'account/notifications')).json();
    expect(inbox.unread).toBe(1); expect(inbox.items[0]).toMatchObject({ type: 'admin.broadcast', title: 'Payout schedule', link: '/dashboard/earnings', readAt: null });
    // Marking read is scoped to the caller: an outsider cannot read someone else's notification id.
    expect((await call(outsider.token, 'account/notifications/read', { ids: [inbox.items[0].id] })).json().updated).toBe(0);
    expect((await call(pro.token, 'account/notifications/read', { ids: [inbox.items[0].id] })).json()).toMatchObject({ updated: 1, unread: 0 });
    // Single-account delivery requires an existing email.
    expect((await call(admin.token, 'admin/notifications', { audience: 'user', email: 'missing@example.test', title: 'Hello', body: 'Direct message.' })).statusCode).toBe(404);
    const direct = await call(admin.token, 'admin/notifications', { audience: 'user', email: customer.user.email, title: 'Hello', body: 'Direct message.' });
    expect(direct.json().recipientCount).toBe(1);
    expect((await call(customer.token, 'account/notifications/unread')).json()).toEqual({ unread: 1 });
    // Validation: links must be Servix paths, bodies cannot be blank.
    expect((await call(admin.token, 'admin/notifications', { audience: 'all', title: 'Bad', body: 'Phishing', link: 'https://evil.example' })).statusCode).toBe(422);
    const log = (await call(admin.token, 'admin/notifications')).json();
    expect(log.items.length).toBeGreaterThanOrEqual(2); expect(log.items[0]).toHaveProperty('readCount');
  });

  it('saved professionals are per-account and ignore unknown slugs', async () => {
    const customer = await account(), pro = await account('professional');
    expect((await call(customer.token, 'account/saved')).json()).toEqual([]);
    expect((await call(customer.token, 'account/saved', { profileSlug: 'does-not-exist' })).statusCode).toBe(404);
    expect((await call(customer.token, 'account/saved', { profileSlug: pro.slug })).statusCode).toBeLessThan(300);
    expect((await call(customer.token, 'account/saved', { profileSlug: pro.slug })).statusCode).toBeLessThan(300); // idempotent
    const saved = (await call(customer.token, 'account/saved')).json();
    expect(saved).toHaveLength(1); expect(saved[0].professional.slug).toBe(pro.slug); expect(saved[0].professional).not.toHaveProperty('email');
    expect((await call(pro.token, 'account/saved')).json()).toEqual([]);
    expect((await call(customer.token, `account/saved/${pro.slug}`, undefined, 'DELETE')).statusCode).toBeLessThan(300);
    expect((await call(customer.token, 'account/saved')).json()).toEqual([]);
  });

  it('free plan limits listings, paid plans only activate after provider verification, and the public profile shows the plan', async () => {
    const pro = await account('professional'); const customer = await account();
    const plan = (await call(pro.token, 'pro/plan')).json();
    expect(plan).toMatchObject({ current: 'free', limits: { listings: 2 }, usage: { listings: 0 } });
    expect(plan.features).not.toContain('analytics_detailed');
    expect(plan.plans.map((p: { slug: string }) => p.slug)).toEqual(['free', 'go', 'pro', 'team', 'enterprise']);
    // Plans are for every account now: customers use /billing/plan; the legacy /pro/plan alias stays professional-only.
    expect((await call(customer.token, 'pro/plan')).statusCode).toBe(403);
    expect((await call(customer.token, 'billing/plan')).json().current).toBe('free');
    expect((await call(pro.token, 'pro/plan/checkout', { plan: 'enterprise' })).statusCode).toBe(422);
    expect((await call(pro.token, 'pro/plan/checkout', { plan: 'free' })).statusCode).toBe(422);
    const checkout = (await call(pro.token, 'pro/plan/checkout', { plan: 'pro' })).json();
    expect(checkout.reference).toMatch(/^sub-/); expect(checkout.authorizationUrl).toContain(checkout.reference);
    // Starting checkout changes nothing until the provider confirms payment.
    expect((await call(pro.token, 'pro/plan')).json().current).toBe('free');
    const verifyPending = (await call(pro.token, 'pro/plan/verify', { reference: checkout.reference })).json();
    expect(verifyPending.status).not.toBe('active');
    expect((await call(pro.token, 'pro/plan/verify', { reference: 'sub-' + randomUUID() })).statusCode).toBe(404);
    // Simulate the sandbox provider completing the charge, then verify.
    const { activateSubscription } = await import('../src/lib/plans.js');
    expect(await activateSubscription(checkout.reference)).toBe(true);
    expect(await activateSubscription(checkout.reference)).toBe(false); // idempotent
    const upgraded = (await call(pro.token, 'pro/plan')).json();
    expect(upgraded).toMatchObject({ current: 'pro', label: 'Pro', limits: { listings: 15 } });
    expect(upgraded.features).toContain('analytics_advanced');
    expect(new Date(upgraded.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await call(pro.token, 'account/notifications')).json().items.some((n: { type: string }) => n.type === 'plan.activated')).toBe(true);
    const publicProfile = (await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.slug}` })).json();
    expect(publicProfile.plan).toBe('pro');
    // Listing caps follow the effective plan: 15 on Pro, 2 on Free.
    const { assertListingAllowed } = await import('../src/lib/plans.js');
    const { resolveEntitlements } = await import('../src/lib/entitlements/index.js');
    const category = await prisma.category.create({ data: { slug: randomUUID(), name: 'Testing' } });
    for (let i = 0; i < 2; i++) await prisma.service.create({ data: { slug: randomUUID(), professionalId: pro.professionalId!, categoryId: category.id, title: `Listing ${i}`, shortDescription: 'Short', description: 'Long', price: 1000n } });
    await expect(assertListingAllowed(pro.professionalId!, await resolveEntitlements(pro.user.id))).resolves.toBeUndefined();
    // An expired paid plan behaves as free again.
    await prisma.user.update({ where: { id: pro.user.id }, data: { planExpiresAt: new Date(Date.now() - 1000) } });
    expect((await call(pro.token, 'pro/plan')).json()).toMatchObject({ current: 'free', expired: true });
    await expect(assertListingAllowed(pro.professionalId!, await resolveEntitlements(pro.user.id))).rejects.toMatchObject({ status: 403, code: 'PLAN_LIMIT' });
  });

  it('professional analytics, availability and reviews are own-data only', async () => {
    const pro = await account('professional'), customer = await account();
    const analytics = (await call(pro.token, 'pro/analytics?days=30')).json();
    expect(analytics.totals).toMatchObject({ bookings: 0, completed: 0, earnings: 0, uniqueClients: 0, reviewCount: 0 });
    expect(analytics.totals.responseRate).toBeNull(); expect(Array.isArray(analytics.series)).toBe(true);
    expect((await call(customer.token, 'pro/analytics')).statusCode).toBe(403);
    expect((await call(pro.token, 'pro/availability')).json()).toMatchObject({ usingDefaults: true, rules: [], exceptions: [] });
    expect((await call(pro.token, 'pro/availability', { rules: [{ weekday: 1, startHour: 10, endHour: 9 }] }, 'PUT')).statusCode).toBe(422);
    expect((await call(pro.token, 'pro/availability', { rules: [{ weekday: 1, startHour: 10, endHour: 16 }] }, 'PUT')).statusCode).toBe(200);
    const after = (await call(pro.token, 'pro/availability')).json();
    expect(after.usingDefaults).toBe(false); expect(after.rules).toEqual([{ weekday: 1, startHour: 10, endHour: 16 }]);
    const dayOff = await call(pro.token, 'pro/availability/exceptions', { date: '2030-01-15', reason: 'Public holiday' });
    expect(dayOff.statusCode).toBeLessThan(300);
    const id = (await call(pro.token, 'pro/availability')).json().exceptions[0].id;
    expect((await call(pro.token, `pro/availability/exceptions/${id}`, undefined, 'DELETE')).statusCode).toBeLessThan(300);
    expect((await call(pro.token, 'pro/reviews')).json()).toEqual([]);
  });

  it('admin analytics and subscriptions come from real records and are admin-only', async () => {
    const admin = await account('admin'), customer = await account();
    expect((await call(customer.token, 'admin/analytics')).statusCode).toBe(403);
    const data = (await call(admin.token, 'admin/analytics?days=30')).json();
    expect(data.totals).toHaveProperty('gmv'); expect(data.totals).toHaveProperty('signups');
    expect(Array.isArray(data.series)).toBe(true); expect(data.series.length).toBeGreaterThanOrEqual(30);
    expect(data.totals.signups).toBeGreaterThanOrEqual(2);
    expect(data.statusCounts).toBeDefined(); expect(Array.isArray(data.plans)).toBe(true); expect(Array.isArray(data.topProfessionals)).toBe(true);
    const subs = (await call(admin.token, 'admin/subscriptions')).json();
    expect(subs).toHaveProperty('items'); expect(subs.items.length).toBeGreaterThanOrEqual(1);
    expect(subs.items[0]).toHaveProperty('reference'); expect(subs.items[0]).not.toHaveProperty('passwordHash');
  });
});

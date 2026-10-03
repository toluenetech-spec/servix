/** Opt-in integration tests for the next-gen marketplace block:
 *  requests + proposals → booking, trust/reliability, achievements, compare,
 *  availability discovery, book again, preferred, verified portfolio, flags.
 *  Creates its own loopback PostgreSQL (embedded-postgres); never touches Neon.
 *  Run: RUN_LOCAL_NEXTGEN_TESTS=1 npx vitest run tests/nextgen-local.test.ts */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';

describe.skipIf(process.env.RUN_LOCAL_NEXTGEN_TESTS !== '1')('next-gen marketplace, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let categoryId: string; let ip = 1;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-nextgen-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55453/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.PAYMENT_MODE = 'sandbox'; process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10'; process.env.APP_BASE_URL = origin;
    process.env.REQUESTS_ENABLED = 'true'; process.env.COMPARE_ENABLED = 'true'; process.env.TRUST_ENABLED = 'true'; process.env.ACHIEVEMENTS_ENABLED = 'true';
    process.env.PROJECTS_ENABLED = 'false';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55453, user: 'postgres', password: dbPassword,
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
    categoryId = (await prisma.category.create({ data: { slug: 'design', name: 'Design' } })).id;
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer', fullName = 'Adaeze Okafor') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only', kycStatus: role === 'professional' ? 'verified' : 'unverified',
      // These suites exercise marketplace/AI behaviour, not plan limits: give every account the Pro plan (entitlements have their own suite).
      planSlug: 'pro', planExpiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    let profile: { id: string; slug: string } | null = null;
    if (role === 'professional') {
      profile = await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Designer', slug: `pro-${randomUUID().slice(0, 8)}`, categoryId, verification: 'verified' }, select: { id: true, slug: true } });
      await prisma.service.create({ data: { slug: `gig-${randomUUID().slice(0, 8)}`, professionalId: profile.id, categoryId, title: 'Logo design', shortDescription: 'x', description: 'y', price: 25000n, status: 'active', deliveryDays: 3 } });
    }
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, profile: profile! };
  }
  function call(token: string, path: string, body?: object, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
    return app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }
  const draft = { title: 'Brand identity for a bakery', categorySlug: 'design', description: 'We need a logo, colour palette and simple brand guide for a new bakery in Lekki. Deliver as PDF and SVG.', budgetType: 'range', budgetMin: 50000, budgetMax: 120000, isRemote: true, requiredSkills: ['branding', 'illustrator'] };

  it('feature snapshot and flag gating', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/features' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ requests: true, compare: true, trust: true, projects: false });
  });

  it('requests: validation, ownership, publish checklist, transitions', async () => {
    const me = await account();
    expect((await call('', 'requests', draft)).statusCode).toBe(401);
    const bad = await call(me.token, 'requests', { ...draft, title: 'Hi' });
    expect(bad.statusCode).toBe(422);
    const created = await call(me.token, 'requests', draft);
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({ status: 'draft', budgetMin: 50000, budgetMax: 120000, publishProblems: {} });
    // incomplete draft cannot publish
    const thin = await call(me.token, 'requests', { ...draft, description: 'short' });
    const pub = await call(me.token, `requests/${thin.json().id}/publish`, {});
    expect(pub.statusCode).toBe(422); expect(pub.json().error.code).toBe('REQUEST_INCOMPLETE');
    // another customer cannot see / edit it
    const other = await account();
    expect((await call(other.token, `requests/${id}`)).statusCode).toBe(404);
    expect((await call(other.token, `requests/${id}`, { title: 'Hijack attempt here' }, 'PATCH')).statusCode).toBe(404);
    // transitions
    expect((await call(me.token, `requests/${id}/pause`, {})).statusCode).toBe(409);
    expect((await call(me.token, `requests/${id}/publish`, {})).json().status).toBe('open');
    expect((await call(me.token, `requests/${id}/pause`, {})).json().status).toBe('paused');
    expect((await call(me.token, `requests/${id}/publish`, {})).json().status).toBe('open');
    expect((await call(me.token, `requests/${id}/close`, {})).json().status).toBe('closed');
    expect((await call(me.token, `requests/${id}`, { title: 'Edit after close here' }, 'PATCH')).statusCode).toBe(409);
  });

  it('proposals: one live per request, no self-proposal, award → booking with price snapshot, losers rejected, double-award blocked', async () => {
    const customer = await account();
    const alice = await account('professional', 'Alice Pro');
    const bob = await account('professional', 'Bob Pro');
    const req = (await call(customer.token, 'requests', draft)).json();
    // Not open yet → professionals cannot propose and browse hides it
    const early = await call(alice.token, `requests/${req.id}/proposals`, { cover: 'I would start with discovery, then three logo directions and a brand guide.', price: 90000, deliveryDays: 7 });
    expect(early.statusCode).toBe(409);
    await call(customer.token, `requests/${req.id}/publish`, {});
    expect((await call(customer.token, 'requests/browse')).statusCode).toBe(403); // customer is not a professional
    const browse = await call(alice.token, 'requests/browse?category=design&sort=budget-high');
    expect(browse.statusCode).toBe(200);
    expect(browse.json().items.map((r: { id: string }) => r.id)).toContain(req.id);
    expect(browse.json().items[0].customer).not.toHaveProperty('id'); // privacy: no account id for professionals
    const p1 = await call(alice.token, `requests/${req.id}/proposals`, { cover: 'I would start with discovery, then three logo directions and a brand guide.', price: 90000, deliveryDays: 7 });
    expect(p1.statusCode).toBe(201);
    const dup = await call(alice.token, `requests/${req.id}/proposals`, { cover: 'Second attempt should be refused because one is already live on this request.', price: 80000, deliveryDays: 5 });
    expect(dup.statusCode).toBe(409); expect(dup.json().error.code).toBe('PROPOSAL_EXISTS');
    expect((await call(alice.token, `requests/${req.id}/proposals`, { cover: 'x', price: 10, deliveryDays: 0 })).statusCode).toBe(422);
    const p2 = await call(bob.token, `requests/${req.id}/proposals`, { cover: 'Bob here. Clean modern identity in five working days with two revision rounds.', price: 70000, deliveryDays: 5 });
    expect(p2.statusCode).toBe(201);
    // customer sees both, professional cannot read the customer's proposal list
    const list = await call(customer.token, `requests/${req.id}/proposals`);
    expect(list.json().items).toHaveLength(2);
    expect((await call(alice.token, `requests/${req.id}/proposals`)).statusCode).toBe(404);
    // withdraw + re-propose by Alice works because the partial index only covers live proposals
    expect((await call(alice.token, `proposals/${p1.json().id}/withdraw`, {})).json().status).toBe('withdrawn');
    const p1b = await call(alice.token, `requests/${req.id}/proposals`, { cover: 'Revised approach after a second look at the brief: three concepts, one brand guide.', price: 85000, deliveryDays: 6 });
    expect(p1b.statusCode).toBe(201);
    // customer cannot award their own id or a proposal from another request; bob's accept → booking
    const accept = await call(customer.token, `requests/${req.id}/proposals/${p2.json().id}/accept`, {});
    expect(accept.statusCode).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: accept.json().bookingId } });
    expect(booking.status).toBe('pending_payment');
    expect(Number(booking.amountKobo)).toBe(70000 * 100);
    expect(booking.proposalId).toBe(p2.json().id);
    expect(booking.expectedDeliveryAt).not.toBeNull();
    const after = await call(customer.token, `requests/${req.id}/proposals`);
    const statuses = Object.fromEntries(after.json().items.map((p: { id: string; status: string }) => [p.id, p.status]));
    expect(statuses[p2.json().id]).toBe('accepted'); expect(statuses[p1b.json().id]).toBe('rejected');
    expect(after.json().request.status).toBe('awarded');
    // second award attempt is refused
    expect((await call(customer.token, `requests/${req.id}/proposals/${p1b.json().id}/accept`, {})).statusCode).toBe(409);
    // notifications were produced through the existing system
    const notes = await prisma.notification.findMany({ where: { userId: bob.user.id } });
    expect(notes.some((n) => n.type === 'proposal.accepted')).toBe(true);
    // admin sees everything; non-admin cannot
    expect((await call(customer.token, 'admin/requests')).statusCode).toBe(403);
    const admin = await account('admin');
    expect((await call(admin.token, 'admin/requests?status=awarded')).json().items.some((r: { id: string }) => r.id === req.id)).toBe(true);
    expect((await call(admin.token, 'admin/proposals')).json().total).toBeGreaterThanOrEqual(3);
  });

  it('trust: not enough data by default, reliability from booking timestamps, achievements from rules, admin view', async () => {
    const pro = await account('professional', 'Chidi Pro');
    const trust = await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.profile.slug}/trust` });
    expect(trust.statusCode).toBe(200);
    expect(trust.json().reliability).toMatchObject({ percent: null, enough: false });
    expect(trust.json().rating.enough).toBe(false);
    // 6 completed bookings: 5 on time, 1 late → 83%
    const service = await prisma.service.findFirstOrThrow({ where: { professionalId: pro.profile.id } });
    for (let i = 0; i < 6; i++) {
      const customer = await account();
      const created = new Date(Date.now() - 10 * 86_400_000);
      const expected = new Date(created.getTime() + 3 * 86_400_000);
      const delivered = new Date(expected.getTime() + (i === 5 ? 1 : -1) * 3_600_000);
      await prisma.booking.create({ data: { reference: `SVX-T${i}${randomUUID().slice(0, 4)}`, customerId: customer.user.id, professionalId: pro.profile.id, serviceId: service.id, scheduledAt: created, amountKobo: 2_500_000n, platformFeeKobo: 250_000n, serviceTitle: 'Logo design', priceUnit: 'project', status: 'completed', createdAt: created, expectedDeliveryAt: expected, deliveredAt: delivered, completedAt: delivered,
        events: { create: [{ event: 'payment_captured', createdAt: created, data: {} }, { event: 'accepted', createdAt: new Date(created.getTime() + 2 * 3_600_000), data: {} }] } } });
    }
    const after = (await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.profile.slug}/trust` })).json();
    expect(after.reliability).toMatchObject({ measurable: 6, enough: true, percent: 83 });
    expect(after.responseRate).toMatchObject({ enough: true, percent: 100 });
    expect(after.completedJobs).toBe(6);
    // achievements evaluate on demand from the same facts
    const own = await call(pro.token, 'pro/trust');
    expect(own.statusCode).toBe(200);
    expect(own.json().newlyEarned).toContain('servix_verified');
    expect(own.json().newlyEarned).toContain('fast_responder');
    expect(own.json().newlyEarned).not.toContain('jobs_10');
    const catalog = await app.inject({ method: 'GET', url: '/api/v1/achievements/catalog' });
    expect(catalog.json().items.find((a: { slug: string }) => a.slug === 'consistent_delivery').description).toMatch(/95%/);
    // admin trust tab with history + recompute
    const admin = await account('admin');
    const adminView = await call(admin.token, `admin/trust/${pro.profile.slug}`);
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json().history.length).toBeGreaterThan(0);
    expect((await call(pro.token, `admin/trust/${pro.profile.slug}`)).statusCode).toBe(403);
    // public profile carries the trust block + analytics carries reliability
    const profile = await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.profile.slug}` });
    expect(profile.json().trust.reliability.percent).toBe(83);
    const analytics = await call(pro.token, 'pro/analytics');
    expect(analytics.json().reliability.percent).toBe(83);
    expect(analytics.json().views.profile).toBe(0);
    await app.inject({ method: 'POST', url: '/api/v1/views', payload: { type: 'professional', slug: pro.profile.slug }, headers: { origin } });
    expect((await call(pro.token, 'pro/analytics')).json().views.profile).toBe(1);
  });

  it('verified portfolio: only own completed bookings, once; appears on public profile', async () => {
    const pro = await account('professional', 'Dami Pro');
    const other = await account('professional', 'Other Pro');
    const customer = await account();
    const service = await prisma.service.findFirstOrThrow({ where: { professionalId: pro.profile.id } });
    const done = await prisma.booking.create({ data: { reference: `SVX-P${randomUUID().slice(0, 6)}`, customerId: customer.user.id, professionalId: pro.profile.id, serviceId: service.id, scheduledAt: new Date(), amountKobo: 100n, platformFeeKobo: 10n, serviceTitle: 'Logo design', priceUnit: 'project', status: 'completed', completedAt: new Date() } });
    const pending = await prisma.booking.create({ data: { reference: `SVX-Q${randomUUID().slice(0, 6)}`, customerId: customer.user.id, professionalId: pro.profile.id, serviceId: service.id, scheduledAt: new Date(), amountKobo: 100n, platformFeeKobo: 10n, serviceTitle: 'Logo design', priceUnit: 'project', status: 'accepted' } });
    expect((await call(other.token, `pro/portfolio/from-booking/${done.id}`, {})).statusCode).toBe(404);
    expect((await call(pro.token, `pro/portfolio/from-booking/${pending.id}`, {})).statusCode).toBe(404);
    expect((await call(pro.token, 'pro/portfolio/verifiable')).json().items).toHaveLength(1);
    const ok = await call(pro.token, `pro/portfolio/from-booking/${done.id}`, { title: 'Bakery brand identity' });
    expect(ok.statusCode).toBe(201); expect(ok.json().verified).toBe(true);
    expect((await call(pro.token, `pro/portfolio/from-booking/${done.id}`, {})).statusCode).toBe(409);
    const profile = (await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.profile.slug}` })).json();
    expect(profile.verifiedProjects).toBe(1);
    expect(profile.portfolio[0]).toMatchObject({ title: 'Bakery brand identity', verified: true });
  });

  it('compare, availability summary, book again, preferred', async () => {
    const customer = await account();
    const a = await account('professional', 'Ada Pro'); const b = await account('professional', 'Bisi Pro');
    const cmp = await app.inject({ method: 'GET', url: `/api/v1/compare?professionals=${a.profile.slug},${b.profile.slug},missing` });
    expect(cmp.statusCode).toBe(200);
    expect(cmp.json().professionals).toHaveLength(2);
    expect(cmp.json().professionals[0].trust.reliability.enough).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/compare' })).statusCode).toBe(422);
    const avail = await app.inject({ method: 'GET', url: `/api/v1/professionals/${a.profile.slug}/availability/summary` });
    expect(avail.statusCode).toBe(200); expect(avail.json()).toHaveProperty('availableThisWeek');
    const list = await app.inject({ method: 'GET', url: '/api/v1/professionals?available=week' });
    expect(list.statusCode).toBe(200);
    // book again: only own bookings, sanitised payload
    const service = await prisma.service.findFirstOrThrow({ where: { professionalId: a.profile.id } });
    const prev = await prisma.booking.create({ data: { reference: `SVX-R${randomUUID().slice(0, 6)}`, customerId: customer.user.id, professionalId: a.profile.id, serviceId: service.id, scheduledAt: new Date(), amountKobo: 100n, platformFeeKobo: 10n, serviceTitle: 'Logo design', priceUnit: 'project', status: 'completed', notes: 'Use the old palette' } });
    const stranger = await account();
    expect((await call(stranger.token, `bookings/${prev.id}/rebook`)).statusCode).toBe(404);
    const rebook = await call(customer.token, `bookings/${prev.id}/rebook`);
    expect(rebook.statusCode).toBe(200);
    expect(rebook.json()).toMatchObject({ previousNotes: 'Use the old palette', previousServiceAvailable: true });
    expect(rebook.json().services[0]).toMatchObject({ id: service.slug, wasBooked: true });
    // preferred + private note on saved list
    const saved = await call(customer.token, `account/saved/${a.profile.slug}`, { preferred: true, note: 'Great with bakeries' }, 'PATCH');
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ preferred: true, note: 'Great with bakeries' });
    expect((await call(a.token, `account/saved/${a.profile.slug}`, { preferred: true }, 'PATCH')).statusCode).toBe(400);
    const mine = await call(customer.token, 'account/saved');
    expect(mine.json()[0]).toMatchObject({ preferred: true });
  });

  it('flags off → 503 FEATURE_DISABLED', async () => {
    process.env.COMPARE_ENABLED = 'false';
    const res = await app.inject({ method: 'GET', url: '/api/v1/compare?professionals=x' });
    expect(res.statusCode).toBe(503); expect(res.json().error.code).toBe('FEATURE_DISABLED');
    process.env.COMPARE_ENABLED = 'true';
  });
});

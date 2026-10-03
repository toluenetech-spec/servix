/** Opt-in integration tests for subscriptions, the entitlement engine, AI metering, teams and the
 *  admin AI analytics — against the REAL API + an isolated local PostgreSQL (embedded-postgres).
 *  The model provider is a scripted fake injected through configureAi(), so no network and no key.
 *  Run: RUN_LOCAL_ENTITLEMENT_TESTS=1 npx vitest run tests/entitlements-local.test.ts */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AiProvider, ChatRequest, ChatResponse } from '../src/ai/provider.js';
import { AiProviderError } from '../src/ai/provider.js';

const origin = 'https://www.servix.name.ng';
const text = (content: string, usage = { promptTokens: 20, completionTokens: 10 }): ChatResponse => ({ message: { role: 'assistant', content }, usage, finishReason: 'stop', latencyMs: 2 });

class ScriptedProvider implements AiProvider {
  readonly name = 'fake';
  calls: ChatRequest[] = [];
  down = new Set<string>();
  delayMs = 0;
  next: (req: ChatRequest) => ChatResponse = () => text('ok');
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.down.has(req.model)) throw new AiProviderError('rate_limited', 'model_concurrency: at capacity', 429);
    return this.next(req);
  }
}

describe.skipIf(process.env.RUN_LOCAL_ENTITLEMENT_TESTS !== '1')('subscriptions, entitlements, AI metering and teams — isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let configureAi: typeof import('../src/ai/index.js')['configureAi'];
  let loadAiConfig: typeof import('../src/ai/config.js')['loadAiConfig'];
  let plans: typeof import('../src/lib/plans.js');
  let ents: typeof import('../src/lib/entitlements/index.js');
  let usage: typeof import('../src/lib/entitlements/usage.js');
  const fake = new ScriptedProvider();
  let design: string; let ip = 1;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-ent-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55458/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.PAYMENT_MODE = 'sandbox'; process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10'; process.env.APP_BASE_URL = origin;
    process.env.REQUESTS_ENABLED = 'true'; process.env.TRUST_ENABLED = 'true';
    delete process.env.AI_ENABLED; delete process.env.AI_API_KEY;
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55458, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      // Simulate the live database: legacy plan rows + a professional on the old "professional" plan BEFORE the new migration runs.
      for (const name of (await readdir(root)).sort()) {
        if (name === 'migration_lock.toml') continue;
        if (name === '20261004000000_subscriptions_entitlements') {
          await client.query(`INSERT INTO plans (id, slug, name, price, position, features) VALUES ('p-free', 'free', 'Free', 0, 0, '[]'), ('p-pro', 'professional', 'Servix Pro', 15000, 1, '[]'), ('p-biz', 'business', 'Business', 40000, 2, '[]')`);
          await client.query(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at) VALUES ('legacy-user', 'legacy@example.test', 'x', 'Legacy Pro', 'professional', 'active', now(), now())`);
          await client.query(`INSERT INTO professional_profiles (id, user_id, slug, name, title, plan_slug, plan_expires_at, created_at, updated_at) VALUES ('legacy-pro', 'legacy-user', 'legacy-pro', 'Legacy Pro', 'Designer', 'professional', now() + interval '20 days', now(), now())`);
          await client.query(`INSERT INTO plan_subscriptions (id, professional_id, plan_slug, status, reference, provider, amount_kobo, currency, created_at, updated_at) VALUES ('legacy-sub', 'legacy-pro', 'professional', 'active', 'sub-legacy', 'sandbox', 1500000, 'NGN', now(), now())`);
        }
        await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
      }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    ({ configureAi } = await import('../src/ai/index.js'));
    ({ loadAiConfig } = await import('../src/ai/config.js'));
    plans = await import('../src/lib/plans.js');
    ents = await import('../src/lib/entitlements/index.js');
    usage = await import('../src/lib/entitlements/usage.js');
    design = (await prisma.category.create({ data: { slug: 'graphic-design', name: 'Graphic Design' } })).id;
    configureAi({ provider: fake, config: { ...loadAiConfig({ AI_ENABLED: 'true', AI_API_KEY: 'fake-key-for-tests', AI_HEDGE_AFTER_MS: '0' }), callTimeoutMs: 3000, taskTimeoutMs: 10000 } });
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { configureAi(null); await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer', fullName = 'Adaeze Okafor') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only', kycStatus: role === 'professional' ? 'verified' : 'unverified' } });
    let profile: { id: string; slug: string } | null = null;
    if (role === 'professional') {
      profile = await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Brand designer', slug: `pro-${randomUUID().slice(0, 8)}`, categoryId: design, verification: 'verified', about: 'I design brands.', locationCity: 'Lagos', startingPrice: 25000n, skills: { create: [{ skill: 'Logo', position: 0 }] } }, select: { id: true, slug: true } });
      await prisma.service.create({ data: { slug: `gig-${randomUUID().slice(0, 8)}`, professionalId: profile.id, categoryId: design, title: 'Logo design', shortDescription: 'Logo + brand sheet', description: 'A full logo package.', price: 25000n, status: 'active', deliveryDays: 3 } });
    }
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, profile: profile! };
  }
  const call = (token: string, path: string, body?: object, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE') =>
    app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  const setPlan = (userId: string, plan: string, days = 30) => prisma.user.update({ where: { id: userId }, data: { planSlug: plan, planExpiresAt: plan === 'free' ? null : new Date(Date.now() + days * 86_400_000) } });
  const openRequest = async (customerId: string, title = 'Bakery brand identity') =>
    prisma.serviceRequest.create({ data: { customerId, title, categoryId: design, description: 'Logo, palette and a simple brand guide for a bakery in Lekki. PDF + SVG.', budgetType: 'range', budgetMinKobo: 5_000_000n, budgetMaxKobo: 8_000_000n, status: 'open', publishedAt: new Date(), isRemote: true } });
  const proposalBody = { cover: 'I can deliver a complete brand identity for your bakery within a week, including revisions.', price: 60000, deliveryDays: 7, milestones: [], attachments: [] };

  /* ------------------------------------------------------------------ migration */
  it('migration renames legacy plans, inserts the five tiers and copies plans onto users', async () => {
    const slugs = (await prisma.plan.findMany({ orderBy: { position: 'asc' } })).map((p) => p.slug);
    expect(slugs).toEqual(['free', 'go', 'pro', 'team', 'enterprise']);
    expect((await prisma.plan.findUnique({ where: { slug: 'team' } }))!.price).toBe(35000n);
    const legacy = await prisma.user.findUnique({ where: { id: 'legacy-user' } });
    expect(legacy).toMatchObject({ planSlug: 'pro' });
    expect(legacy!.planExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.professionalProfile.findUnique({ where: { id: 'legacy-pro' } })).toMatchObject({ planSlug: 'pro' });
    expect(await prisma.planSubscription.findUnique({ where: { reference: 'sub-legacy' } })).toMatchObject({ planSlug: 'pro', userId: 'legacy-user' });
    const ent = await ents.resolveEntitlements('legacy-user');
    expect(ent.plan).toBe('pro'); expect(ent.limits.listings).toBe(15);
    const publicPlans = (await app.inject({ method: 'GET', url: '/api/v1/plans' })).json();
    expect(publicPlans.map((p: { id: string }) => p.id)).toEqual(['free', 'go', 'pro', 'team', 'enterprise']);
    expect(publicPlans[1]).toMatchObject({ price: 5000, purchasable: true, limits: { monthly_ai_tokens: 100_000 } });
    expect(publicPlans[4]).toMatchObject({ purchasable: false });
  });

  /* ------------------------------------------------------------------ catalogue sanity */
  it('catalogue: every tier is a superset of the one below; upgrade hints point at the right plan', async () => {
    const { PLAN_SLUGS, PLAN_LIMITS, PLAN_AI_DEPARTMENTS, FEATURE_KEYS, planHas, PLAN_RANK, nextPlanForLimit, minPlanFor } = ents;
    for (let i = 1; i < PLAN_SLUGS.length; i++) {
      const lower = PLAN_SLUGS[i - 1], upper = PLAN_SLUGS[i];
      for (const key of Object.keys(PLAN_LIMITS.free) as Array<keyof typeof PLAN_LIMITS.free>) {
        const a = PLAN_LIMITS[lower][key], b = PLAN_LIMITS[upper][key];
        expect(b === null || (a !== null && b >= a), `${key}: ${upper} >= ${lower}`).toBe(true);
      }
      for (const d of PLAN_AI_DEPARTMENTS[lower]) expect(PLAN_AI_DEPARTMENTS[upper]).toContain(d);
      for (const f of FEATURE_KEYS) if (planHas(lower, f)) expect(planHas(upper, f)).toBe(true);
    }
    expect(PLAN_LIMITS.free.monthly_ai_tokens).toBe(20_000); expect(PLAN_LIMITS.go.monthly_ai_tokens).toBe(100_000);
    expect(PLAN_LIMITS.pro.monthly_ai_tokens).toBe(300_000); expect(PLAN_LIMITS.team.monthly_ai_tokens).toBe(1_000_000);
    expect(PLAN_RANK.enterprise).toBeGreaterThan(PLAN_RANK.team);
    expect(nextPlanForLimit('listings', 'free')).toBe('go');
    expect(nextPlanForLimit('listings', 'team')).toBe('enterprise');
    expect(minPlanFor('advanced_filters')).toBe('go'); expect(minPlanFor('team_workspace')).toBe('team');
  });

  /* ------------------------------------------------------------------ entitlements endpoint & tiers */
  it('/me/entitlements reflects each tier (features, limits, AI departments) for customers and professionals alike', async () => {
    const me = await account();
    const expectations: Record<string, { feature: string; has: boolean; tokens: number; dept: string; deptOk: boolean }> = {
      free: { feature: 'advanced_filters', has: false, tokens: 20_000, dept: 'background_drafting', deptOk: false },
      go: { feature: 'advanced_filters', has: true, tokens: 100_000, dept: 'background_drafting', deptOk: true },
      pro: { feature: 'analytics_advanced', has: true, tokens: 300_000, dept: 'proposal_generation', deptOk: true },
      team: { feature: 'team_workspace', has: true, tokens: 1_000_000, dept: 'proposal_generation', deptOk: true },
      enterprise: { feature: 'org_custom_limits', has: true, tokens: 3_000_000, dept: 'opportunity_radar', deptOk: true },
    };
    for (const [plan, e] of Object.entries(expectations)) {
      await setPlan(me.user.id, plan);
      const res = await call(me.token, 'me/entitlements');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.current).toBe(plan);
      expect(body.features.includes(e.feature)).toBe(e.has);
      expect(body.limits.monthly_ai_tokens).toBe(e.tokens);
      expect(body.aiDepartments.includes(e.dept)).toBe(e.deptOk);
      expect(body.ai).toMatchObject({ used: 0, allowed: e.tokens, level: 'ok' });
      expect(typeof body.ai.resetAt).toBe('string');
    }
    // Pro accounts do not get free-tier features taken away.
    await setPlan(me.user.id, 'pro');
    expect((await call(me.token, 'me/entitlements')).json().features).toEqual(expect.arrayContaining(['advanced_filters', 'analytics_detailed', 'analytics_advanced', 'priority_ai']));
    // Expired paid plan → free, flagged as expired.
    await prisma.user.update({ where: { id: me.user.id }, data: { planSlug: 'pro', planExpiresAt: new Date(Date.now() - 1000) } });
    expect((await call(me.token, 'me/entitlements')).json()).toMatchObject({ current: 'free', expired: true });
    expect((await call('', 'me/entitlements')).statusCode).toBe(401);
  });

  /* ------------------------------------------------------------------ non-AI enforcement */
  it('enforces proposal, request, saved-professional, portfolio and listing limits server-side with upgrade metadata', async () => {
    const pro = await account('professional', 'Chiamaka Eze');
    const customer = await account();
    // Free customer: 3 requests per month, 2 open at a time.
    const req1 = await call(customer.token, 'requests', { title: 'Request one', categorySlug: 'graphic-design', description: 'A description long enough to be valid for the request body validation rules.', budgetType: 'fixed', budgetMax: 50000 });
    expect(req1.statusCode).toBe(201);
    await call(customer.token, 'requests', { title: 'Request two', categorySlug: 'graphic-design', description: 'A description long enough to be valid for the request body validation rules.', budgetType: 'fixed', budgetMax: 50000 });
    const req3 = await call(customer.token, 'requests', { title: 'Request three', categorySlug: 'graphic-design', description: 'A description long enough to be valid for the request body validation rules.', budgetType: 'fixed', budgetMax: 50000 });
    expect(req3.statusCode).toBe(403);
    expect(req3.json().error).toMatchObject({ code: 'PLAN_LIMIT', meta: { kind: 'limit', limit: 'active_requests', plan: 'free', upgradeTo: 'go', upgradeToLabel: 'Go', used: 2, allowed: 2 } });
    expect(req3.json().error.message).toContain('Nothing has been removed');

    // Free professional: 3 live proposals.
    const requests = await Promise.all([1, 2, 3, 4].map((i) => openRequest(customer.user.id, `Open request ${i}`)));
    for (let i = 0; i < 3; i++) expect((await call(pro.token, `requests/${requests[i].id}/proposals`, proposalBody)).statusCode).toBe(201);
    const fourth = await call(pro.token, `requests/${requests[3].id}/proposals`, proposalBody);
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json().error.meta).toMatchObject({ limit: 'active_proposals', upgradeTo: 'go', used: 3, allowed: 3 });
    // Upgrading immediately unlocks the next one — nothing was deleted on the way.
    await setPlan(pro.user.id, 'go');
    expect((await call(pro.token, `requests/${requests[3].id}/proposals`, proposalBody)).statusCode).toBe(201);
    expect(await prisma.proposal.count({ where: { professionalId: pro.profile.id } })).toBe(4);
    // Downgrade back to free: existing proposals stay, new ones are blocked, the message explains it.
    await setPlan(pro.user.id, 'free');
    const fifth = await call(pro.token, `requests/${(await openRequest(customer.user.id, 'Fifth')).id}/proposals`, proposalBody);
    expect(fifth.statusCode).toBe(403); expect(fifth.json().error.meta.used).toBe(4);
    expect(await prisma.proposal.count({ where: { professionalId: pro.profile.id } })).toBe(4);

    // Saved professionals: 10 on free (re-saving the same one never counts twice).
    const pros = await Promise.all(Array.from({ length: 11 }, (_, i) => account('professional', `Pro ${i}`)));
    for (let i = 0; i < 10; i++) expect((await call(customer.token, 'account/saved', { profileSlug: pros[i].profile.slug })).statusCode).toBe(200);
    expect((await call(customer.token, 'account/saved', { profileSlug: pros[0].profile.slug })).statusCode).toBe(200);
    const eleventh = await call(customer.token, 'account/saved', { profileSlug: pros[10].profile.slug });
    expect(eleventh.statusCode).toBe(403); expect(eleventh.json().error.meta.limit).toBe('saved_professionals');

    // Portfolio: 6 on free (replaces the old hard-coded 20).
    for (let i = 0; i < 6; i++) expect((await call(pro.token, 'pro/portfolio', { title: `Work ${i}`, category: 'Branding', description: 'Case study' })).statusCode).toBe(201);
    const seventh = await call(pro.token, 'pro/portfolio', { title: 'Work 7', category: 'Branding', description: 'Case study' });
    expect(seventh.statusCode).toBe(403); expect(seventh.json().error.meta).toMatchObject({ limit: 'portfolio_items', upgradeTo: 'go' });
  });

  it('advanced filters, proposal organisation, saved searches, exports and profile versions follow the plan', async () => {
    const pro = await account('professional', 'Ngozi Ade');
    // Basic browse is free; advanced filters need Go.
    expect((await call(pro.token, 'requests/browse?category=graphic-design&q=logo')).statusCode).toBe(200);
    const locked = await call(pro.token, 'requests/browse?sort=deadline');
    expect(locked.statusCode).toBe(403); expect(locked.json().error).toMatchObject({ code: 'PLAN_FEATURE', meta: { kind: 'feature', feature: 'advanced_filters', upgradeTo: 'go' } });
    expect((await call(pro.token, 'requests/browse?remote=remote')).statusCode).toBe(403);
    await setPlan(pro.user.id, 'go');
    expect((await call(pro.token, 'requests/browse?sort=deadline&remote=remote&skills=Logo')).statusCode).toBe(200);

    // Proposal labels/notes on Go; pipeline filters on Pro.
    const customer = await account();
    const r = await openRequest(customer.user.id);
    const p = (await call(pro.token, `requests/${r.id}/proposals`, proposalBody)).json();
    expect((await call(pro.token, `proposals/${p.id}/organize`, { label: 'Hot lead', privateNote: 'Follow up Monday' }, 'PATCH')).statusCode).toBe(200);
    const mine = (await call(pro.token, 'proposals/mine')).json();
    expect(mine.access).toEqual({ organization: true, pipeline: false });
    expect(mine.items[0]).toMatchObject({ label: 'Hot lead', privateNote: 'Follow up Monday' });
    expect((await call(pro.token, 'proposals/mine?status=submitted')).statusCode).toBe(403);
    // The customer never sees the professional's private organisation fields.
    const customerView = (await call(customer.token, `requests/${r.id}/proposals`)).json();
    const seen = JSON.stringify(customerView);
    expect(seen).not.toContain('Hot lead'); expect(seen).not.toContain('Follow up Monday');
    await setPlan(pro.user.id, 'pro');
    expect((await call(pro.token, 'proposals/mine?status=submitted&label=Hot%20lead&sort=price-high')).json().items).toHaveLength(1);
    await setPlan(pro.user.id, 'free');
    expect((await call(pro.token, `proposals/${p.id}/organize`, { label: 'x' }, 'PATCH')).statusCode).toBe(403);
    expect((await call(pro.token, 'proposals/mine')).json().items[0].label).toBeNull(); // hidden, not deleted
    expect((await prisma.proposal.findUnique({ where: { id: p.id } }))!.label).toBe('Hot lead');

    // Saved searches: 2 on free.
    expect((await call(pro.token, 'account/saved-searches', { kind: 'requests', name: 'Lagos logos', params: { q: 'logo', category: 'graphic-design' } })).statusCode).toBe(201);
    expect((await call(pro.token, 'account/saved-searches', { kind: 'requests', name: 'Remote', params: { remote: 'remote' } })).statusCode).toBe(201);
    const third = await call(pro.token, 'account/saved-searches', { kind: 'requests', name: 'Third', params: {} });
    expect(third.statusCode).toBe(403); expect(third.json().error.meta.limit).toBe('saved_searches');
    expect((await call(pro.token, 'account/saved-searches')).json()).toMatchObject({ limit: 2 });

    // Exports: 1 per month on free; the counter only moves on success; CSV never leaks another account's rows.
    const csv = await call(pro.token, 'exports/proposals.csv');
    expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body).toContain('Bakery brand identity');
    const second = await call(pro.token, 'exports/bookings.csv');
    expect(second.statusCode).toBe(403); expect(second.json().error).toMatchObject({ code: 'PLAN_LIMIT', meta: { limit: 'monthly_exports', upgradeTo: 'go' } });
    expect((await call(pro.token, 'exports')).json()).toMatchObject({ used: 1, allowed: 1, level: 'exhausted' });
    expect((await call(customer.token, 'exports/proposals.csv')).statusCode).toBe(404);
    expect((await call(customer.token, 'exports/nonsense.csv')).statusCode).toBe(404);
    expect((await call(customer.token, 'exports')).json().used).toBe(0); // a failed export is never counted

    // Profile versions: feature from Go, limit 3.
    expect((await call(pro.token, 'pro/profile/versions', { name: 'v1' })).statusCode).toBe(403);
    await setPlan(pro.user.id, 'go');
    for (const n of ['v1', 'v2', 'v3']) expect((await call(pro.token, 'pro/profile/versions', { name: n })).statusCode).toBe(201);
    expect((await call(pro.token, 'pro/profile/versions', { name: 'v4' })).json().error.meta.limit).toBe('profile_versions');
    const versions = (await call(pro.token, 'pro/profile/versions')).json();
    await prisma.professionalProfile.update({ where: { id: pro.profile.id }, data: { title: 'Changed title' } });
    expect((await call(pro.token, `pro/profile/versions/${versions.items[0].id}/restore`, {})).statusCode).toBe(200);
    expect((await prisma.professionalProfile.findUnique({ where: { id: pro.profile.id } }))!.title).toBe('Brand designer');
  });

  it('analytics depth follows the plan (server-side, not just hidden in the UI)', async () => {
    const pro = await account('professional');
    const free = (await call(pro.token, 'pro/analytics')).json();
    expect(free.access).toEqual({ plan: 'free', detailed: false, advanced: false });
    expect(free.series).toEqual([]); expect(free.performance).toBeNull(); expect(free.totals).toBeDefined();
    await setPlan(pro.user.id, 'go');
    const go = (await call(pro.token, 'pro/analytics')).json();
    expect(go.series.length).toBeGreaterThan(0); expect(go.performance).toBeNull();
    await setPlan(pro.user.id, 'pro');
    const proView = (await call(pro.token, 'pro/analytics')).json();
    expect(proView.performance.applications).toMatchObject({ sent: 0 }); expect(proView.performance.profile).toBeDefined();
  });

  /* ------------------------------------------------------------------ AI metering */
  it('AI: department gating per plan, token metering, warnings, hard stop at 100% and no charge for failures', async () => {
    const me = await account();
    fake.next = () => text('Hello from Servix AI', { promptTokens: 6_000, completionTokens: 2_000 });
    // Free can use the assistant but not background drafting.
    const draft = await call(me.token, 'ai/drafts', { kind: 'client_message', input: 'Thanks for the brief, I can start on Monday and deliver within a week.', tone: 'friendly' });
    expect(draft.statusCode).toBe(403); expect(draft.json().error).toMatchObject({ code: 'PLAN_FEATURE', meta: { kind: 'ai_department', department: 'background_drafting', upgradeTo: 'go' } });
    const first = await call(me.token, 'ai/explain', { topic: 'payments' });
    expect(first.statusCode).toBe(200);
    expect(first.json().ai).toMatchObject({ tokens: 8_000, quota: { used: 8_000, allowed: 20_000, level: 'ok' } });
    const second = await call(me.token, 'ai/explain', { topic: 'payments' });
    expect(second.json().ai.quota).toMatchObject({ used: 16_000, level: 'warning' }); // 80%
    expect((await call(me.token, 'ai/usage')).json()).toMatchObject({ used: 16_000, remaining: 4_000, percent: 80, level: 'warning' });
    // A provider failure is recorded but NOT charged.
    fake.down.add('deepseek-ai/DeepSeek-V4-Flash-0731'); fake.down.add('zai-org/GLM-5.3-Flash');
    expect((await call(me.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(503);
    fake.down.clear();
    expect((await call(me.token, 'ai/usage')).json().used).toBe(16_000);
    // Third real call: 4,000 left, the call uses 8,000 → allowed (last call may overshoot, it is counted) → 24,000 = exhausted.
    const third = await call(me.token, 'ai/explain', { topic: 'payments' });
    expect(third.statusCode).toBe(200); expect(third.json().ai.quota).toMatchObject({ used: 24_000, level: 'exhausted', remaining: 0 });
    const blocked = await call(me.token, 'ai/explain', { topic: 'payments' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatchObject({ code: 'AI_QUOTA_EXCEEDED', meta: { kind: 'ai_quota', plan: 'free', upgradeTo: 'go', used: 24_000, allowed: 20_000 } });
    expect(blocked.json().error.message).toContain('resets on');
    const callsBefore = fake.calls.length;
    expect((await call(me.token, 'ai/assistant', { messages: [{ role: 'user', content: 'hi' }] })).statusCode).toBe(403);
    expect(fake.calls.length).toBe(callsBefore); // the provider is never called once the allowance is used up
    // Upgrading raises the allowance immediately; usage carries over inside the month.
    await setPlan(me.user.id, 'go');
    const afterUpgrade = await call(me.token, 'ai/explain', { topic: 'payments' });
    expect(afterUpgrade.statusCode).toBe(200); expect(afterUpgrade.json().ai.quota).toMatchObject({ used: 32_000, allowed: 100_000, level: 'ok' });
    // Ledger: one row per task, failures included, never prompts.
    const events = await prisma.aiUsageEvent.findMany({ where: { userId: me.user.id }, orderBy: { createdAt: 'asc' } });
    expect(events.filter((e) => e.ok)).toHaveLength(4); expect(events.filter((e) => !e.ok)).toHaveLength(1);
    expect(events.find((e) => !e.ok)).toMatchObject({ errorCode: 'rate_limited', fallbackUsed: true });
    expect(JSON.stringify(events)).not.toContain('payments');
    // Priority routing: the hedge override is only applied for Pro+ (the router option exists and is honoured).
    const { PRIORITY_HEDGE_MS } = await import('../src/ai/metering.js');
    expect(PRIORITY_HEDGE_MS).toBeLessThan(6_000);
  });

  it('AI: concurrent requests cannot exceed the allowance (atomic reservation)', async () => {
    const me = await account();
    await setPlan(me.user.id, 'free');
    fake.next = () => text('ok', { promptTokens: 5_000, completionTokens: 1_000 });
    // One warm-up call teaches the meter what this department really costs (≈6,000 tokens per call).
    expect((await call(me.token, 'ai/explain', { topic: 'trust' })).statusCode).toBe(200);
    fake.delayMs = 150;
    const results = await Promise.all(Array.from({ length: 8 }, () => call(me.token, 'ai/explain', { topic: 'trust' })));
    fake.delayMs = 0;
    const ok = results.filter((r) => r.statusCode === 200).length;
    const blocked = results.filter((r) => r.statusCode === 403 && r.json().error.code === 'AI_QUOTA_EXCEEDED').length;
    expect(ok + blocked).toBe(8);
    // Allowance 20,000 with 6,000 already used: reservations of ≈6,000 each let at most 3 more requests start (the last one
    // partially covered); every other concurrent request is blocked before the provider is called.
    expect(ok).toBeGreaterThanOrEqual(2); expect(ok).toBeLessThanOrEqual(3);
    const meter = (await call(me.token, 'ai/usage')).json();
    expect(meter.used).toBe((ok + 1) * 6_000); expect(meter.reserved).toBe(0);
    expect(await prisma.aiUsageEvent.count({ where: { userId: me.user.id, ok: true } })).toBe(ok + 1);
    expect(fake.calls.filter((c) => c.messages.some((m) => typeof m.content === 'string' && m.content.includes('trust'))).length).toBe(ok + 1);
  });

  it('AI: anonymous search intent is served without a plan and recorded without a user; a signed-in user is metered', async () => {
    fake.next = () => text(JSON.stringify({ category: 'graphic-design', location: 'Lagos', maxPrice: 30000, keywords: ['logo'], explanation: 'Logo designers in Lagos under ₦30k' }), { promptTokens: 100, completionTokens: 50 });
    const anon = await app.inject({ method: 'POST', url: '/api/v1/ai/search/intent', payload: { query: 'logo designer in Lagos under 30k' }, headers: { origin }, remoteAddress: '192.0.2.250' });
    expect(anon.statusCode).toBe(200);
    expect(await prisma.aiUsageEvent.count({ where: { userId: null, department: 'search_intent' } })).toBeGreaterThanOrEqual(1);
    const me = await account();
    expect((await call(me.token, 'ai/search/intent', { query: 'logo designer in Lagos under 30k' })).statusCode).toBe(200);
    expect((await call(me.token, 'ai/usage')).json().used).toBe(150);
  });

  /* ------------------------------------------------------------------ billing */
  it('billing: any account can buy go/pro/team; switching plans starts a fresh term; downgrade keeps data; enterprise is not purchasable', async () => {
    const me = await account();
    expect((await call(me.token, 'billing/checkout', { plan: 'enterprise' })).statusCode).toBe(422);
    expect((await call(me.token, 'billing/checkout', { plan: 'free' })).statusCode).toBe(422);
    expect((await call(me.token, 'billing/checkout', { plan: 'nonsense' })).statusCode).toBe(422);
    const go = (await call(me.token, 'billing/checkout', { plan: 'go' })).json();
    expect(go.reference).toMatch(/^sub-/);
    expect((await call(me.token, 'billing/plan')).json().current).toBe('free'); // nothing until the provider confirms
    expect(await plans.activateSubscription(go.reference)).toBe(true);
    const onGo = (await call(me.token, 'billing/plan')).json();
    expect(onGo).toMatchObject({ current: 'go', label: 'Go' });
    const goEnds = new Date(onGo.expiresAt).getTime();
    expect(goEnds).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Another account cannot verify my reference.
    const other = await account();
    expect((await call(other.token, 'billing/verify', { reference: go.reference })).statusCode).toBe(404);
    expect((await call(me.token, 'billing/verify', { reference: go.reference })).json().status).toBe('active');
    // Switch to Pro: fresh 30-day term from now, not stacked on Go.
    const proRef = (await call(me.token, 'billing/checkout', { plan: 'pro' })).json().reference;
    expect(proRef).not.toBe(go.reference);
    await plans.activateSubscription(proRef);
    const onPro = (await call(me.token, 'billing/plan')).json();
    expect(onPro.current).toBe('pro');
    expect(Math.abs(new Date(onPro.expiresAt).getTime() - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);
    // Renewing the same plan extends the term.
    const proRef2 = (await call(me.token, 'billing/checkout', { plan: 'pro' })).json().reference;
    await plans.activateSubscription(proRef2);
    expect(new Date((await call(me.token, 'billing/plan')).json().expiresAt).getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    expect((await call(me.token, 'billing/plan')).json().subscriptions).toHaveLength(3);
    // Downgrade: immediate, data kept, explained by notification.
    expect((await call(me.token, 'billing/downgrade', { plan: 'free' })).statusCode).toBe(422); // confirm required
    const down = await call(me.token, 'billing/downgrade', { plan: 'free', confirm: true });
    expect(down.statusCode).toBe(200); expect(down.json().plan.current).toBe('free');
    expect((await call(me.token, 'account/notifications')).json().items.some((n: { type: string }) => n.type === 'plan.downgraded')).toBe(true);
    expect(await prisma.planSubscription.count({ where: { userId: me.user.id } })).toBe(3);
  });

  /* ------------------------------------------------------------------ teams */
  it('teams: Team owners create a workspace, invite members who inherit the plan and share one AI pool; members have no admin controls', async () => {
    const owner = await account('professional', 'Studio Owner');
    const member = await account('professional', 'Studio Member');
    const outsider = await account();
    // Needs the Team plan.
    expect((await call(owner.token, 'team', { name: 'Lekki Studio' })).statusCode).toBe(403);
    expect((await call(owner.token, 'team')).json()).toMatchObject({ team: null, canCreate: false });
    await setPlan(owner.user.id, 'team');
    const created = await call(owner.token, 'team', { name: 'Lekki Studio' });
    expect(created.statusCode).toBe(201);
    expect((await call(owner.token, 'team', { name: 'Second' })).statusCode).toBe(409);
    // Invite: email goes to the queue, in-app notification for existing accounts; the token hash is stored, never the token.
    const invite = await call(owner.token, 'team/invites', { email: member.user.email.toUpperCase(), role: 'member' });
    expect(invite.statusCode).toBe(201); expect(invite.json()).toMatchObject({ status: 'invited', role: 'member' });
    const notif = (await call(member.token, 'account/notifications')).json().items.find((n: { type: string }) => n.type === 'team.invite');
    expect(notif).toBeTruthy();
    const token = new URL(notif.link, origin).searchParams.get('token')!;
    expect(await prisma.organizationMember.count({ where: { inviteTokenHash: token } })).toBe(0);
    expect((await call(member.token, `team/invites/preview?token=${encodeURIComponent(token)}`)).json()).toMatchObject({ team: 'Lekki Studio', role: 'member' });
    // The wrong account cannot accept someone else's invitation.
    expect((await call(outsider.token, 'team/invites/accept', { token })).statusCode).toBe(403);
    expect((await call(member.token, 'team/invites/accept', { token })).statusCode).toBe(200);
    expect((await call(member.token, 'team/invites/accept', { token })).statusCode).toBe(410); // single use
    // Member inherits Team entitlements and the organisation AI pool.
    const memberEnt = (await call(member.token, 'me/entitlements')).json();
    expect(memberEnt).toMatchObject({ current: 'team', source: 'organization', organization: { name: 'Lekki Studio', role: 'member' } });
    expect(memberEnt.ai).toMatchObject({ allowed: 1_000_000, subject: 'org' });
    fake.next = () => text('ok', { promptTokens: 1_000, completionTokens: 500 });
    expect((await call(member.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200);
    expect((await call(owner.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200);
    expect((await call(owner.token, 'ai/usage')).json()).toMatchObject({ used: 3_000, allowed: 1_000_000, subject: 'org' });
    // Members: no admin controls.
    expect((await call(member.token, 'team/invites', { email: 'x@example.test' })).statusCode).toBe(403);
    expect((await call(member.token, 'team/activity')).statusCode).toBe(403);
    expect((await call(member.token, 'team/ai-usage')).statusCode).toBe(403);
    expect((await call(member.token, 'team', { name: 'Hijack' }, 'PATCH')).statusCode).toBe(403);
    const view = (await call(member.token, 'team')).json();
    expect(view.me).toEqual({ role: 'member', isAdmin: false });
    expect(view.members.every((m: { email?: string }) => m.email === undefined)).toBe(true); // no emails for members
    // Owner dashboards.
    const aiUsage = (await call(owner.token, 'team/ai-usage')).json();
    expect(aiUsage.pool.used).toBe(3_000);
    expect(aiUsage.members.find((m: { userId: string }) => m.userId === member.user.id).tokens).toBe(1_500);
    expect((await call(owner.token, 'team/activity')).json().totals.members).toBe(2);
    expect((await call(owner.token, 'team/work')).statusCode).toBe(200);
    // Per-member cap inside the pool.
    const memberRow = view.members.find((m: { userId: string }) => m.userId === member.user.id);
    expect((await call(owner.token, `team/members/${memberRow.id}`, { aiTokenCap: 2_000 }, 'PATCH')).statusCode).toBe(200);
    expect((await call(member.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200); // 1,500 → 3,000 ≥ cap after this call
    const capped = await call(member.token, 'ai/explain', { topic: 'payments' });
    expect(capped.statusCode).toBe(403); expect(capped.json().error.meta.scope).toBe('member');
    expect((await call(owner.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200); // the pool itself is fine
    // Team member limit (5 on Team, including pending invitations).
    for (let i = 0; i < 3; i++) expect((await call(owner.token, 'team/invites', { email: `invitee${i}-${randomUUID().slice(0, 4)}@example.test` })).statusCode).toBe(201);
    const sixth = await call(owner.token, 'team/invites', { email: `late-${randomUUID().slice(0, 4)}@example.test` });
    expect(sixth.statusCode).toBe(403); expect(sixth.json().error.meta).toMatchObject({ limit: 'team_members', upgradeTo: 'enterprise' });
    // Audit log export is Enterprise-only.
    expect((await call(owner.token, 'team/audit')).statusCode).toBe(403);
    // Member cannot buy a personal plan while covered by the team; leaving restores their own (free) plan.
    expect((await call(member.token, 'billing/checkout', { plan: 'go' })).statusCode).toBe(409);
    expect((await call(member.token, 'team/leave', {})).statusCode).toBe(200);
    expect((await call(member.token, 'me/entitlements')).json()).toMatchObject({ current: 'free', organization: null });
    expect((await call(owner.token, 'team/leave', {})).statusCode).toBe(409);
    // Owner's plan lapses → members fall back to their own plan, but the team and its data remain.
    await prisma.user.update({ where: { id: owner.user.id }, data: { planExpiresAt: new Date(Date.now() - 1000) } });
    expect((await call(owner.token, 'me/entitlements')).json()).toMatchObject({ current: 'free', organization: { name: 'Lekki Studio' } });
    expect((await call(owner.token, 'team/invites', { email: 'later@example.test' })).statusCode).toBe(403);
    expect(await prisma.organization.count({ where: { ownerId: owner.user.id } })).toBe(1);
  });

  /* ------------------------------------------------------------------ enterprise + admin */
  it('enterprise: admins assign the plan and custom limits per organisation; plan overrides are honoured; admin AI analytics aggregate without PII leaks', async () => {
    const admin = await account('admin', 'Servix Admin');
    const owner = await account('professional', 'Enterprise Owner');
    const member = await account();
    // Non-admins cannot touch admin plan routes.
    expect((await call(owner.token, 'admin/plans')).statusCode).toBe(403);
    expect((await call(owner.token, 'admin/ai/usage')).statusCode).toBe(403);
    expect((await call('', 'admin/plans')).statusCode).toBe(401);
    // Admin grants Enterprise to the owner, who creates the organisation.
    expect((await call(admin.token, `admin/users/${owner.user.id}/plan`, { plan: 'enterprise', days: 365, note: 'Pilot' })).statusCode).toBe(200);
    expect((await call(owner.token, 'me/entitlements')).json()).toMatchObject({ current: 'enterprise', limits: { team_members: 25, listings: null } });
    const org = (await call(owner.token, 'team', { name: 'Big Agency' })).json();
    // Custom limits on the organisation apply to everyone in it.
    expect((await call(admin.token, `admin/organizations/${org.id}`, { customLimits: { limits: { monthly_ai_tokens: 5_000, team_members: 50 } } }, 'PATCH')).statusCode).toBe(200);
    const invite = (await call(owner.token, 'team/invites', { email: member.user.email })).json();
    const token = new URL((await call(member.token, 'account/notifications')).json().items.find((n: { type: string }) => n.type === 'team.invite').link, origin).searchParams.get('token')!;
    expect((await call(member.token, 'team/invites/accept', { token })).statusCode).toBe(200);
    void invite;
    const memberEnt = (await call(member.token, 'me/entitlements')).json();
    expect(memberEnt).toMatchObject({ current: 'enterprise', limits: { monthly_ai_tokens: 5_000, team_members: 50 }, features: expect.arrayContaining(['org_audit_log', 'org_custom_limits']) });
    fake.next = () => text('ok', { promptTokens: 3_000, completionTokens: 1_000 });
    expect((await call(member.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200);
    expect((await call(member.token, 'ai/explain', { topic: 'payments' })).statusCode).toBe(200); // 8,000 ≥ 5,000 → exhausted (overshoot counted)
    expect((await call(member.token, 'ai/explain', { topic: 'payments' })).json().error.code).toBe('AI_QUOTA_EXCEEDED');
    // Enterprise audit log (JSON + CSV).
    expect((await call(owner.token, 'team/audit')).json().items.length).toBeGreaterThan(0);
    const csv = await call(owner.token, 'team/audit?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body).toContain('team.joined');
    // Admin can assign a plan directly to an organisation (no owner purchase needed).
    const org2Owner = await account();
    await setPlan(org2Owner.user.id, 'team');
    const org2 = (await call(org2Owner.token, 'team', { name: 'Assigned Org' })).json();
    await setPlan(org2Owner.user.id, 'free');
    expect((await call(org2Owner.token, 'me/entitlements')).json().current).toBe('free');
    expect((await call(admin.token, `admin/organizations/${org2.id}`, { plan: 'enterprise', days: 90 }, 'PATCH')).statusCode).toBe(200);
    expect((await call(org2Owner.token, 'me/entitlements')).json()).toMatchObject({ current: 'enterprise', source: 'admin' });
    // Operator plan overrides (plans.limits) change the effective catalogue without a deploy.
    const freeUser = await account();
    expect((await call(freeUser.token, 'me/entitlements')).json().limits.saved_searches).toBe(2);
    expect((await call(admin.token, 'admin/plans/free', { overrides: { limits: { saved_searches: 4 }, features: { advanced_filters: true } } }, 'PATCH')).json().effective.limits.saved_searches).toBe(4);
    const after = (await call(freeUser.token, 'me/entitlements')).json();
    expect(after.limits.saved_searches).toBe(4); expect(after.features).toContain('advanced_filters');
    expect((await call(admin.token, 'admin/plans/free', { price: 100 }, 'PATCH')).statusCode).toBe(422);
    expect((await call(admin.token, 'admin/plans/free', { overrides: {} }, 'PATCH')).statusCode).toBe(200);
    expect((await call(freeUser.token, 'me/entitlements')).json().limits.saved_searches).toBe(2);
    const list = (await call(admin.token, 'admin/plans')).json();
    expect(list.plans.map((p: { slug: string }) => p.slug)).toEqual(['free', 'go', 'pro', 'team', 'enterprise']);
    // Admin AI analytics: totals, breakdowns, series, filters — and no prompt text anywhere.
    const analytics = (await call(admin.token, 'admin/ai/usage?days=7')).json();
    expect(analytics.totals.requests).toBeGreaterThan(5);
    expect(analytics.totals.failed).toBeGreaterThanOrEqual(1);
    expect(analytics.byPlan.some((p: { plan: string }) => p.plan === 'enterprise')).toBe(true);
    expect(analytics.byDepartment.some((d: { department: string }) => d.department === 'explanations')).toBe(true);
    expect(analytics.byModel[0]).toHaveProperty('avgLatencyMs');
    expect(analytics.series.length).toBeGreaterThan(0);
    expect(analytics.topUsers.length).toBeGreaterThan(0); expect(analytics.topOrganizations.some((o: { name: string }) => o.name === 'Big Agency')).toBe(true);
    const filtered = (await call(admin.token, `admin/ai/usage?days=7&organizationId=${org.id}&status=ok`)).json();
    expect(filtered.totals.requests).toBe(2); expect(filtered.totals.failed).toBe(0);
    expect((await call(admin.token, `admin/ai/usage?days=7&department=explanations&plan=free&status=failed`)).json().totals.succeeded).toBe(0);
    const events = (await call(admin.token, 'admin/ai/usage/events?pageSize=5')).json();
    expect(events.items).toHaveLength(5);
    expect(JSON.stringify(events)).not.toMatch(/payments|fake-key|nvapi|Bearer/);
    expect((await call(admin.token, 'admin/organizations')).json().items.some((o: { name: string }) => o.name === 'Big Agency')).toBe(true);
    expect((await call(admin.token, `admin/users/${member.user.id}/ai-usage`)).statusCode).toBe(200);
  });

  it('quota primitives: reservation is atomic and settles correctly, periods reset monthly', async () => {
    const subject = { type: 'user' as const, id: randomUUID() };
    const r1 = await usage.reserve(subject, 'ai_tokens', 700, 1_000);
    expect(r1.reserved).toBe(700);
    const r2 = await usage.reserve(subject, 'ai_tokens', 700, 1_000);
    expect(r2.reserved).toBe(300); // only what is left
    const r3 = await usage.reserve(subject, 'ai_tokens', 10, 1_000);
    expect(r3.reserved).toBe(0);
    await usage.settle(subject, 'ai_tokens', 700, 650);
    await usage.settle(subject, 'ai_tokens', 300, 0, false);
    expect(await usage.readMeter(subject, 'ai_tokens', 1_000)).toMatchObject({ used: 650, reserved: 0, remaining: 350, requests: 1, level: 'ok' });
    expect(usage.meterOf('ai_tokens', 750, 0, 1_000).level).toBe('warning');
    expect(usage.meterOf('ai_tokens', 900, 0, 1_000).level).toBe('critical');
    expect(usage.meterOf('ai_tokens', 1_000, 0, 1_000).level).toBe('exhausted');
    expect(usage.meterOf('ai_tokens', 5, 0, null)).toMatchObject({ allowed: null, remaining: null, percent: null, level: 'ok' });
    const unlimited = await usage.reserve(subject, 'ai_tokens', 5_000, null);
    expect(unlimited.reserved).toBe(5_000);
    const next = new Date(Date.UTC(2031, 0, 15));
    expect(usage.periodStart(next).toISOString()).toBe('2031-01-01T00:00:00.000Z');
    expect(usage.nextPeriodStart(next).toISOString()).toBe('2031-02-01T00:00:00.000Z');
    expect((await usage.readMeter(subject, 'ai_tokens', 1_000, next)).used).toBe(0); // fresh month, fresh counter
  });
});

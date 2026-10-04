/** Opt-in integration tests for the Servix AI routing layer against the REAL
 *  API + an isolated local PostgreSQL (embedded-postgres). The model provider is
 *  a scripted fake injected through configureAi(), so no network and no key.
 *  Run: RUN_LOCAL_AI_TESTS=1 npx vitest run tests/ai-local.test.ts */
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
const M = { deepseek: 'deepseek-ai/DeepSeek-V4-Flash-0731', minimax: 'MiniMaxAI/MiniMax-M2.7', glm: 'zai-org/GLM-5.3-Flash' };
const text = (content: string): ChatResponse => ({ message: { role: 'assistant', content }, usage: { promptTokens: 20, completionTokens: 10 }, finishReason: 'stop', latencyMs: 2 });
const json = (o: unknown) => text(JSON.stringify(o));
const toolCall = (name: string, args: object): ChatResponse => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, usage: null, finishReason: 'tool_calls', latencyMs: 2 });

class ScriptedProvider implements AiProvider {
  readonly name = 'fake';
  calls: ChatRequest[] = [];
  down = new Set<string>();
  next: (req: ChatRequest) => ChatResponse = () => text('ok');
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    if (this.down.has(req.model)) throw new AiProviderError('rate_limited', 'model_concurrency: at capacity', 429);
    return this.next(req);
  }
}
const lastTool = (req: ChatRequest) => { const t = req.messages.filter((m) => m.role === 'tool'); return t.length ? JSON.parse(t.at(-1)!.content!.split('\n')[1]) : null; };

describe.skipIf(process.env.RUN_LOCAL_AI_TESTS !== '1')('Servix AI routing layer, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let configureAi: typeof import('../src/ai/index.js')['configureAi'];
  let loadAiConfig: typeof import('../src/ai/config.js')['loadAiConfig'];
  const fake = new ScriptedProvider();
  let design: string; let web: string; let ip = 1;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-ai-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55457/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.PAYMENT_MODE = 'sandbox'; process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10'; process.env.APP_BASE_URL = origin;
    process.env.REQUESTS_ENABLED = 'true'; process.env.TRUST_ENABLED = 'true';
    delete process.env.AI_ENABLED; delete process.env.AI_API_KEY;
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55457, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) { if (name === 'migration_lock.toml') continue; await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8')); }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    ({ configureAi } = await import('../src/ai/index.js'));
    ({ loadAiConfig } = await import('../src/ai/config.js'));
    /* Plans (free/go/pro/team/enterprise) are inserted by the subscriptions migration itself. */
    design = (await prisma.category.create({ data: { slug: 'graphic-design', name: 'Graphic Design' } })).id;
    web = (await prisma.category.create({ data: { slug: 'web-development', name: 'Web Development' } })).id;
    configureAi({ provider: fake, config: { ...loadAiConfig({ AI_ENABLED: 'true', AI_API_KEY: 'fake-key-for-tests' }), callTimeoutMs: 3000, taskTimeoutMs: 10000 } });
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { configureAi(null); await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer', fullName = 'Adaeze Okafor', categoryId?: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only', kycStatus: role === 'professional' ? 'verified' : 'unverified',
      // These suites exercise marketplace/AI behaviour, not plan limits: give every account the Pro plan (entitlements have their own suite).
      planSlug: 'pro', planExpiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    let profile: { id: string; slug: string } | null = null; let gig: { id: string; slug: string } | null = null;
    if (role === 'professional') {
      profile = await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Brand designer', slug: `pro-${randomUUID().slice(0, 8)}`, categoryId: categoryId ?? design, verification: 'verified', about: 'I design brands.', locationCity: 'Lagos', startingPrice: 25000n, skills: { create: [{ skill: 'Logo', position: 0 }, { skill: 'Branding', position: 1 }] } }, select: { id: true, slug: true } });
      gig = await prisma.service.create({ data: { slug: `gig-${randomUUID().slice(0, 8)}`, professionalId: profile.id, categoryId: categoryId ?? design, title: 'Logo design', shortDescription: 'Logo + brand sheet', description: 'A full logo package.', price: 25000n, status: 'active', deliveryDays: 3 }, select: { id: true, slug: true } });
    }
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, profile: profile!, gig: gig! };
  }
  const call = (token: string, path: string, body?: object, method?: 'GET' | 'POST') =>
    app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  const openRequest = async (customerId: string, overrides: Partial<{ categoryId: string; budgetMaxKobo: bigint; title: string }> = {}) =>
    prisma.serviceRequest.create({ data: { customerId, title: overrides.title ?? 'Bakery brand identity', categoryId: overrides.categoryId ?? design, description: 'Logo, palette and a simple brand guide for a bakery in Lekki. PDF + SVG.', budgetType: 'range', budgetMinKobo: 5_000_000n, budgetMaxKobo: overrides.budgetMaxKobo ?? 8_000_000n, status: 'open', publishedAt: new Date(), isRemote: true } });

  it('is OFF by default: /features reports ai=false and /ai/* answers 503 FEATURE_DISABLED', async () => {
    configureAi({ provider: fake, config: loadAiConfig({}) });
    const me = await account();
    expect((await app.inject({ method: 'GET', url: '/api/v1/features' })).json()).toMatchObject({ ai: false });
    const res = await call(me.token, 'ai/assistant', { messages: [{ role: 'user', content: 'hi' }] });
    expect(res.statusCode).toBe(503); expect(res.json().error.code).toBe('FEATURE_DISABLED');
    configureAi({ provider: fake, config: { ...loadAiConfig({ AI_ENABLED: 'true', AI_API_KEY: 'fake-key-for-tests' }), callTimeoutMs: 3000, taskTimeoutMs: 10000 } });
  });

  it('assistant: authenticated only, uses read tools over real rows, respects tool audience', async () => {
    const pro = await account('professional', 'Chiamaka Eze');
    const me = await account();
    expect((await call('', 'ai/assistant', { messages: [{ role: 'user', content: 'hi' }] })).statusCode).toBe(401);
    fake.next = (req) => {
      const toolMsgs = req.messages.filter((m) => m.role === 'tool');
      if (!toolMsgs.length) return toolCall('search_professionals', { category: 'graphics-design', location: 'Lagos' });
      if (toolMsgs.length === 1) return toolCall('get_my_profile', {}); // customer must NOT get a pro-only tool
      const first = JSON.parse(toolMsgs[0].content!.split('\n')[1]);
      return text(`I found ${first.items.length} designer(s): ${first.items.map((i: { name: string }) => i.name).join(', ')}. ${lastTool(req).error ?? ''}`);
    };
    const res = await call(me.token, 'ai/assistant', { messages: [{ role: 'user', content: 'I need a logo designer in Lagos' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().answer).toContain('Chiamaka Eze');
    expect(res.json().answer).toContain('not available here');
    expect(res.json().ai).toMatchObject({ model: 'deepseek', fallbackUsed: false, toolsUsed: ['search_professionals', 'get_my_profile'] });
    expect(fake.calls.at(-1)!.tools!.map((t) => t.function.name)).not.toContain('get_my_profile');
    void pro;
  });

  it('admin assistant: admin_* tools read platform data (gig creator + email), are hidden from non-admins, and the brief forbids acting', async () => {
    const pro = await account('professional', 'Tunde Bakare');
    const draft = await prisma.service.create({ data: { slug: `draft-${randomUUID().slice(0, 8)}`, professionalId: pro.profile.id, categoryId: design, title: 'Flyer design', shortDescription: 'Event flyers in 24h', description: 'Short.', price: 5000n, status: 'draft' } });
    const admin = await account('admin', 'Servix Admin');
    const customer = await account();
    fake.next = (req) => {
      const toolMsgs = req.messages.filter((m) => m.role === 'tool');
      if (!toolMsgs.length) return toolCall('admin_list_gigs', { createdSince: 'today' });
      if (toolMsgs.length === 1) return toolCall('admin_overview', {});
      const gigs = JSON.parse(toolMsgs[0].content!.split('\n')[1]);
      const overview = lastTool(req);
      const mine = gigs.items.find((g: { id: string }) => g.id === draft.slug);
      return text(mine ? `${mine.createdBy.name} (${mine.createdBy.email}) created "${mine.title}" today; status ${mine.status}; blocking: ${mine.blockingPublish.join(' | ')}. Drafts: ${overview.gigs.byStatus.draft}.` : `missing ${JSON.stringify(gigs)}`);
    };
    const res = await call(admin.token, 'ai/assistant', { messages: [{ role: 'user', content: 'Who created a gig today?' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().answer).toContain('Tunde Bakare');
    expect(res.json().answer).toContain(pro.user.email);
    expect(res.json().answer).toContain('status draft');
    expect(res.json().answer).toContain('Describe the gig in at least 50 characters.');
    expect(res.json().answer).toMatch(/Drafts: \d+/);
    expect(res.json().ai.toolsUsed).toEqual(['admin_list_gigs', 'admin_overview']);
    const offered = fake.calls.at(-1)!.tools!.map((t) => t.function.name);
    expect(offered).toEqual(expect.arrayContaining(['admin_overview', 'admin_list_gigs', 'admin_list_users', 'admin_list_applications', 'admin_list_identity_checks', 'admin_list_bookings', 'admin_list_requests', 'admin_recent_activity']));
    const system = fake.calls.at(-1)!.messages[0].content!;
    expect(system).toContain('platform ADMIN');
    expect(system).toContain('You still cannot act');
    expect(system).toContain('Money is out of bounds');
    // A customer never sees admin tools, and a forged call is refused.
    fake.next = (req) => (req.messages.some((m) => m.role === 'tool') ? text(`refused: ${lastTool(req).error}`) : toolCall('admin_list_users', {}));
    const theft = await call(customer.token, 'ai/assistant', { messages: [{ role: 'user', content: 'list all users' }] });
    expect(theft.json().answer).toContain('not available here');
    expect(fake.calls.at(-1)!.tools!.map((t) => t.function.name).some((n) => n.startsWith('admin_'))).toBe(false);
  });

  it('search intent: model drift is snapped to real categories and validated by the real query schema', async () => {
    fake.next = () => json({ q: 'logo', category: 'graphics-design', maxPrice: '₦30k', available: 'This Week', sort: 'cheapest' });
    const res = await call('', 'ai/search/intent', { query: 'logo for my bakery under 30k this week' });
    expect(res.statusCode).toBe(200);
    expect(res.json().filters).toEqual({ q: 'logo', category: 'graphic-design', maxPrice: 30000, available: 'week', sort: 'recommended' });
  });

  it('DeepSeek down → GLM answers (fallback visible in telemetry); whole chain down → 503, bounded calls', async () => {
    const me = await account(); const admin = await account('admin');
    fake.down = new Set([M.deepseek]); fake.calls = [];
    fake.next = () => text('Trust metrics come from real bookings.');
    const res = await call(me.token, 'ai/explain', { topic: 'trust' });
    expect(res.statusCode).toBe(200); expect(res.json().ai).toMatchObject({ model: 'glm', fallbackUsed: true });
    fake.down = new Set([M.deepseek, M.glm]); fake.calls = [];
    const down = await call(me.token, 'ai/explain', { topic: 'trust' });
    expect(down.statusCode).toBe(503); expect(down.json().error.code).toBe('AI_UNAVAILABLE');
    expect(fake.calls.length).toBeLessThanOrEqual(4);
    fake.down = new Set();
    const status = await call(admin.token, 'admin/ai/status');
    expect(status.statusCode).toBe(200);
    expect(JSON.stringify(status.json())).not.toContain('fake-key-for-tests');
    expect(status.json().provider.keyConfigured).toBe(true);
    const dept = status.json().telemetry.departments.find((d: { department: string }) => d.department === 'explanations');
    expect(dept).toMatchObject({ fallbackUsed: expect.any(Number) }); expect(dept.failed).toBeGreaterThanOrEqual(1);
    expect((await call(me.token, 'admin/ai/status')).statusCode).toBe(403);
  });

  it('MiniMax down → DeepSeek drafts the proposal; invented gig slug and over-budget price are caught; nothing is saved', async () => {
    const customer = await account(); const pro = await account('professional', 'Tunde Bakare');
    const req = await openRequest(customer.user.id);
    expect((await call(customer.token, 'ai/proposals/draft', { requestId: req.id })).statusCode).toBe(403);
    fake.down = new Set([M.minimax]);
    fake.next = () => json({ serviceSlug: 'premium-gig-i-made-up', price: '₦120,000', deliveryDays: 7, cover: 'Hello! I have designed bakery brands before and would deliver a logo, palette and brand guide in PDF and SVG within a week, with two revision rounds included.', milestones: [{ title: 'Concepts', days: 3 }], flags: [] });
    const res = await call(pro.token, 'ai/proposals/draft', { requestId: req.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().ai).toMatchObject({ model: 'deepseek', fallbackUsed: true });
    expect(res.json().draft).toMatchObject({ serviceSlug: null, price: 120000, deliveryDays: 7, requestId: req.id });
    expect(res.json().draft.flags.join(' ')).toMatch(/above the customer's budget/);
    expect(await prisma.proposal.count({ where: { requestId: req.id } })).toBe(0);
    fake.down = new Set();
    // the draft, once a real gig is chosen, is accepted by the real proposal endpoint
    const submit = await call(pro.token, `requests/${req.id}/proposals`, { ...res.json().draft, serviceSlug: pro.gig.slug, flags: undefined, requestId: undefined });
    expect(submit.statusCode).toBe(201);
    expect((await call(pro.token, 'ai/proposals/draft', { requestId: randomUUID() })).statusCode).toBe(404);
  });

  it('invalid structured JSON → repair round → 502 AI_INVALID_OUTPUT (never a half-valid draft)', async () => {
    const pro = await account('professional'); const customer = await account();
    const req = await openRequest(customer.user.id);
    fake.calls = [];
    fake.next = () => text('I would charge around fifty thousand naira, trust me.');
    const res = await call(pro.token, 'ai/proposals/draft', { requestId: req.id });
    expect(res.statusCode).toBe(502); expect(res.json().error.code).toBe('AI_INVALID_OUTPUT');
    expect(fake.calls.length).toBe(6); // 3 models × (1 answer + 1 repair)
    expect(fake.calls[1].messages.at(-1)!.content).toMatch(/failed validation/);
  });

  it('background drafting: invalid category and bare date are normalised; the draft is accepted by POST /requests', async () => {
    const me = await account();
    fake.next = () => json({ title: 'Restaurant website with WhatsApp ordering', description: 'Responsive restaurant website with menu, gallery, opening hours, map and a WhatsApp ordering button. Fast on mobile.', categorySlug: 'web-design', budgetType: 'range', budgetMin: '₦250,000', budgetMax: 150000, deadlineAt: '2099-11-20', isRemote: true, location: null, requiredSkills: ['React'], missingInformation: ['Do you have a domain?'] });
    const res = await call(me.token, 'ai/drafts', { kind: 'request_brief', input: 'I run a small restaurant in Lekki and need a website where people can order on WhatsApp.' });
    expect(res.statusCode).toBe(200);
    const draft = res.json().draft;
    expect(draft).toMatchObject({ categorySlug: 'web-development', budgetMin: 150000, budgetMax: 250000, deadlineAt: '2099-11-20T12:00:00.000Z', missingInformation: ['Do you have a domain?'] });
    const created = await call(me.token, 'requests', { ...draft, missingInformation: undefined });
    expect(created.statusCode).toBe(201);
    fake.next = () => json({ title: 'x', description: 'short', categorySlug: 'plumbing', deadlineAt: 'next tuesday' });
    expect((await call(me.token, 'ai/drafts', { kind: 'request_brief', input: 'fix my pipes please now' })).statusCode).toBe(502);
    fake.next = () => text('I offer a complete logo package: discovery call, three concepts, two revision rounds and final files in SVG, PNG and PDF.');
    const gig = await call(me.token, 'ai/drafts', { kind: 'gig_description', input: 'logo package, 3 concepts, 2 revisions' });
    expect(gig.statusCode).toBe(200); expect(gig.json()).toMatchObject({ kind: 'gig_description' }); expect(gig.json().draft).toMatch(/logo package/);
  });

  it('job matching + radar: only real request ids survive; empty marketplace short-circuits without a model call', async () => {
    const pro = await account('professional'); const customer = await account();
    const mine = await openRequest(customer.user.id); const other = await openRequest(customer.user.id, { categoryId: web, title: 'Shop website' });
    fake.calls = [];
    fake.next = () => json({ summary: 'Two requests fit you.', matches: [{ requestId: mine.id, fit: 88, why: 'Branding is your core skill', concerns: [] }, { requestId: randomUUID(), fit: 70, why: 'made up', concerns: [] }, { requestId: other.id, fit: '55', why: 'Different category' }] });
    const res = await call(pro.token, 'ai/opportunities/match', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().matches.map((m: { requestId: string }) => m.requestId)).toEqual([mine.id, other.id]);
    expect(res.json().matches[1].fit).toBe(55);
    fake.next = () => json({ headline: 'Two new requests this week', highlights: [{ requestId: mine.id, reason: 'Bakery branding, within your price range' }, { requestId: 'nope', reason: 'x' }], suggestedActions: ['Send a proposal today'] });
    const radar = await call(pro.token, 'ai/opportunities/radar', {});
    expect(radar.statusCode).toBe(200); expect(radar.json().highlights).toHaveLength(1);
    await prisma.serviceRequest.updateMany({ data: { status: 'closed' } });
    fake.calls = [];
    const empty = await call(pro.token, 'ai/opportunities/match', {});
    expect(empty.statusCode).toBe(200); expect(empty.json()).toMatchObject({ matches: [], ai: null }); expect(fake.calls).toHaveLength(0);
  });

  it('profile analysis/improvement: scores are bounded by backend facts; enums normalised', async () => {
    const pro = await account('professional');
    fake.next = () => json({ completenessScore: 100, summary: 'Strong start.', strengths: ['Clear title'], gaps: ['No photo', 'Short about'] });
    const res = await call(pro.token, 'ai/profile/analysis', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().completenessScore).toBeLessThanOrEqual(100); expect(res.json().completenessScore).toBeLessThan(100); // backend completeness is well below 100 for this fixture
    fake.next = () => json({ suggestions: [{ area: 'About Section', suggestion: 'Lead with the outcome you create for bakeries.' }, { area: 'Pricing', suggestion: 'Show a from-price on every gig.' }], rewrittenAbout: 'I help food brands look premium.' });
    const imp = await call(pro.token, 'ai/profile/improve', { focus: 'all' });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().suggestions.map((s: { area: string }) => s.area)).toEqual(['about', 'pricing']);
    expect((await call((await account()).token, 'ai/profile/analysis', {})).statusCode).toBe(403);
  });

  it('pricing guidance: insufficient Servix data forces basis=insufficient_data and null ranges; unknown category → 422', async () => {
    const me = await account();
    fake.next = () => json({ basis: 'servix_data', summary: 'Charge ₦80k–₦120k.', rangeLow: 80000, rangeHigh: 120000, tips: ['Bundle revisions'] });
    const res = await call(me.token, 'ai/pricing/guidance', { categorySlug: 'web dev' }); // no gigs in this category
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ basis: 'insufficient_data', rangeLow: null, rangeHigh: null, stats: { insufficient: true, category: 'web-development' } });
    // enough gigs: the model's range is clamped into the REAL min…max of Servix prices
    const enough = await call(me.token, 'ai/pricing/guidance', { categorySlug: 'graphic design' });
    expect(enough.statusCode).toBe(200);
    expect(enough.json().stats.insufficient).toBe(false);
    expect(enough.json().rangeLow).toBeGreaterThanOrEqual(enough.json().stats.min); expect(enough.json().rangeHigh).toBeLessThanOrEqual(enough.json().stats.max);
    expect((await call(me.token, 'ai/pricing/guidance', { categorySlug: 'plumbing' })).statusCode).toBe(422);
  });

  it('project health: status is derived by the backend from real timestamps; strangers get 404', async () => {
    const customer = await account(); const pro = await account('professional'); const stranger = await account();
    const late = await prisma.booking.create({ data: { reference: `SVX-AI${randomUUID().slice(0, 6)}`, customerId: customer.user.id, professionalId: pro.profile.id, serviceId: pro.gig.id, scheduledAt: new Date(Date.now() - 10 * 86_400_000), amountKobo: 2_500_000n, platformFeeKobo: 250_000n, serviceTitle: 'Logo design', priceUnit: 'project', status: 'in_progress', expectedDeliveryAt: new Date(Date.now() - 3 * 86_400_000), events: { create: [{ event: 'accepted', data: {} }] } } });
    fake.next = () => json({ summary: 'The delivery date passed three days ago.', nextSteps: ['Message the professional for an update'], concerns: ['No delivery yet'] });
    const res = await call(customer.token, `ai/bookings/${late.id}/health`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'late', booking: { id: late.id, overdueDays: 3 } });
    expect((await call(pro.token, `ai/bookings/${late.id}/health`, {})).statusCode).toBe(200);
    expect((await call(stranger.token, `ai/bookings/${late.id}/health`, {})).statusCode).toBe(404);
    expect((await call(customer.token, `ai/bookings/not-a-uuid/health`, {})).statusCode).toBe(404);
    const prompt = fake.calls.at(-1)!.messages.map((m) => m.content).join('\n');
    expect(prompt).not.toMatch(/amountKobo|platformFee|paystack|authorization_url/i);
  });

  it('streamed explain: words arrive as SSE deltas, the final event carries the full answer, errors stay in-band', async () => {
    const me = await account();
    fake.next = (req) => { for (const w of ['Escrow ', 'holds ', 'funds.']) req.onDelta?.(w); return text('Escrow holds funds.'); };
    const res = await call(me.token, 'ai/explain/stream', { topic: 'payments' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    const events = res.body.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    expect(events[0]).toEqual({ type: 'start' });
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Escrow holds funds.');
    expect(events.at(-1)).toMatchObject({ type: 'done', answer: 'Escrow holds funds.', ai: { model: 'deepseek', fallbackUsed: false } });
    fake.down.add(M.deepseek); fake.down.add(M.glm);
    const down = await call(me.token, 'ai/explain/stream', { topic: 'payments' });
    const last = down.body.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))).at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'AI_UNAVAILABLE', status: 503 });
    fake.down.clear();
    expect((await call('', 'ai/assistant/stream', { messages: [{ role: 'user', content: 'hi' }] })).statusCode).toBe(401);
  });

  it('existing features still work with the AI layer registered', async () => {
    const pro = await account('professional');
    expect((await app.inject({ method: 'GET', url: `/api/v1/professionals/${pro.profile.slug}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/professionals?category=graphic-design' })).json().items.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/categories' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});

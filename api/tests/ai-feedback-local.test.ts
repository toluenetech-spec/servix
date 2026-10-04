/** Servix AI answer feedback (thumbs up/down + admin satisfaction view) — real API on an isolated local PostgreSQL. Opt-in: RUN_LOCAL_AI_TESTS=1. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_AI_TESTS !== '1')('AI feedback, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-ai-feedback-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55467/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10'; process.env.APP_BASE_URL = origin;
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55467, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) { if (name === 'migration_lock.toml') continue; await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8')); }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  }, 180_000);
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'admin', fullName: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only', kycStatus: 'unverified' } });
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token };
  }
  const call = (token: string | null, path: string, body?: object, method?: 'GET' | 'POST') =>
    app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });

  it('stores a thumbs-up without the text, a thumbs-down with question + answer, and shows admins the summary', async () => {
    const ada = await account('customer', 'Ada Customer');
    const admin = await account('admin', 'Servix Admin');

    expect((await call(null, 'ai/feedback', { rating: 'up' })).statusCode).toBe(401);
    expect([400, 422]).toContain((await call(ada.token, 'ai/feedback', { rating: 'meh' })).statusCode);

    const up = await call(ada.token, 'ai/feedback', { rating: 'up', department: 'assistant', prompt: 'secret question', answer: 'secret answer', modelAlias: 'deepseek' });
    expect(up.statusCode).toBe(201);
    const upRow = await prisma.aiFeedback.findUniqueOrThrow({ where: { id: up.json().feedback.id } });
    expect(upRow.prompt).toBeNull(); expect(upRow.answer).toBeNull(); expect(upRow.modelAlias).toBe('deepseek'); expect(upRow.userId).toBe(ada.user.id);

    const down = await call(ada.token, 'ai/feedback', { rating: 'down', department: 'assistant', comment: 'It listed the wrong city.', prompt: 'Who can fix my generator in Ibadan?', answer: 'Here are electricians in Lagos…', modelAlias: 'glm' });
    expect(down.statusCode).toBe(201);
    const downRow = await prisma.aiFeedback.findUniqueOrThrow({ where: { id: down.json().feedback.id } });
    expect(downRow.prompt).toBe('Who can fix my generator in Ibadan?'); expect(downRow.answer).toBe('Here are electricians in Lagos…'); expect(downRow.comment).toBe('It listed the wrong city.');

    expect((await call(ada.token, 'admin/ai/feedback')).statusCode).toBe(403);
    const summary = await call(admin.token, 'admin/ai/feedback?days=7&rating=down');
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.totals).toEqual({ up: 1, down: 1, rated: 2, satisfaction: 50 });
    expect(body.daily.length).toBeGreaterThanOrEqual(7);
    const today = body.daily[body.daily.length - 1];
    expect(today.up).toBe(1); expect(today.down).toBe(1);
    expect(body.byDepartment).toEqual([{ department: 'assistant', up: 1, down: 1 }]);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ rating: 'down', prompt: 'Who can fix my generator in Ibadan?', answer: 'Here are electricians in Lagos…', comment: 'It listed the wrong city.', modelAlias: 'glm', user: { id: ada.user.id, name: 'Ada Customer', role: 'customer' } });

    const all = await call(admin.token, 'admin/ai/feedback?days=7&rating=all');
    expect(all.json().total).toBe(2);
    expect(all.json().items.find((f: { rating: string }) => f.rating === 'up')).toMatchObject({ prompt: null, answer: null });
  });

  it('answers 503 SCHEMA_PENDING (not 500) while the table is still missing on the database', async () => {
    const ada = await account('customer', 'Bisi Customer');
    const admin = await account('admin', 'Second Admin');
    await prisma.$executeRawUnsafe('DROP TABLE "ai_feedback"');
    const r = await call(ada.token, 'ai/feedback', { rating: 'up' });
    expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('SCHEMA_PENDING');
    const a = await call(admin.token, 'admin/ai/feedback');
    expect(a.statusCode).toBe(503); expect(a.json().error.code).toBe('SCHEMA_PENDING');
    // Everything else keeps working and readiness stays green; the gap is only reported.
    expect((await call(admin.token, 'admin/ai/status')).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.json().checks.schema).toBe(true);
    expect(ready.json().optionalPending).toEqual([expect.objectContaining({ table: 'ai_feedback', migration: '20261004120000_ai_feedback' })]);
  });
});

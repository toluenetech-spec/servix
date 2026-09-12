/**
 * SERVIX API — Phase E admin system tests.
 * Admin authorization matrix, audit logging, moderation, user management,
 * booking monitoring and the audit-log viewer. Roles are verified against
 * the DATABASE — a forged JWT role claim must never grant admin access.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import { signAccessToken } from '../src/lib/tokens.js';

let app: FastifyInstance;
const stamp = Date.now();

const admin = { email: `adm-${stamp}@test.servix`, password: 'admin-suite-pass-1', token: '', id: '' };
const customer = { email: `adm-cust-${stamp}@test.servix`, password: 'customer-pass-1', token: '', id: '' };
const proUser = { email: `adm-pro-${stamp}@test.servix`, password: 'pro-pass-1', token: '' };
const victim = { email: `adm-vict-${stamp}@test.servix`, password: 'victim-pass-1', token: '', id: '' };

const inject = (method: string, url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();

  for (const a of [customer, proUser, victim]) {
    const res = await inject('POST', '/api/v1/auth/register', undefined, {
      fullName: `T ${a.email.split('@')[0]}`,
      email: a.email,
      password: a.password,
    });
    a.token = res.json().accessToken;
    if ('id' in a) (a as { id: string }).id = res.json().user.id;
  }

  // Admin is created server-side only.
  const row = await prisma.user.create({
    data: {
      email: admin.email,
      fullName: 'Suite Admin',
      passwordHash: await hashPassword(admin.password),
      role: 'admin',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });
  admin.id = row.id;
  const login = await inject('POST', '/api/v1/auth/login', undefined, { email: admin.email, password: admin.password });
  admin.token = login.json().accessToken;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@test.servix' } } });
  const ids = users.map((u) => u.id);
  const profiles = await prisma.professionalProfile.findMany({ where: { userId: { in: ids } } });
  const pids = profiles.map((p) => p.id);
  await prisma.service.deleteMany({ where: { professionalId: { in: pids } } });
  await prisma.professionalProfile.deleteMany({ where: { id: { in: pids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
});

/* ================= authorization matrix ================= */

describe('admin authorization matrix', () => {
  const ADMIN_GETS = [
    '/api/v1/admin/stats',
    '/api/v1/admin/applications',
    '/api/v1/admin/services',
    '/api/v1/admin/users',
    '/api/v1/admin/bookings',
    '/api/v1/admin/payouts',
    '/api/v1/admin/audit',
  ];

  it('anonymous requests are rejected with 401', async () => {
    for (const url of ADMIN_GETS) {
      expect((await inject('GET', url)).statusCode, url).toBe(401);
    }
  });

  it('customers and professionals are rejected with 403', async () => {
    for (const token of [customer.token, proUser.token]) {
      for (const url of ADMIN_GETS) {
        expect((await inject('GET', url, token)).statusCode, url).toBe(403);
      }
    }
  });

  it('a FORGED admin role claim in the JWT is rejected (DB is the authority)', async () => {
    // Sign a syntactically valid token claiming role=admin for a customer.
    const forged = await signAccessToken({ sub: customer.id, role: 'admin', status: 'active' });
    const res = await inject('GET', '/api/v1/admin/stats', forged);
    expect(res.statusCode).toBe(403);
  });

  it('a real admin gets access', async () => {
    for (const url of ADMIN_GETS) {
      expect((await inject('GET', url, admin.token)).statusCode, url).toBe(200);
    }
  });

  it('a suspended admin token stops working (server-side status check)', async () => {
    // Suspend the admin directly in the DB, then try to use the old token.
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } });
    const res = await inject('GET', '/api/v1/admin/stats', admin.token);
    expect(res.statusCode).toBe(401);
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'active' } });
  });
});

/* ================= stats ================= */

describe('GET /admin/stats', () => {
  it('returns the operational counters', async () => {
    const res = await inject('GET', '/api/v1/admin/stats', admin.token);
    const body = res.json();
    for (const key of ['users', 'professionals', 'pendingApplications', 'activeServices', 'bookings', 'openDisputes', 'failedPayouts', 'deadJobs']) {
      expect(body[key], key).toBeTypeOf('number');
    }
  });
});

/* ================= application review + audit ================= */

describe('application review through admin endpoints', () => {
  let appId = '';

  it('lists applications with status filter', async () => {
    const create = await inject('POST', '/api/v1/applications', proUser.token, {
      title: 'Motion Designer',
      about: 'Animation and motion graphics.',
      categorySlug: 'video-editing',
      skills: ['After Effects'],
    });
    appId = create.json().id;
    await inject('POST', `/api/v1/applications/${appId}/submit`, proUser.token);

    const list = await inject('GET', '/api/v1/admin/applications?status=under_review', admin.token);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((a: { id: string }) => a.id === appId)).toBe(true);
  });

  it('approving writes an audit row with the acting admin', async () => {
    const res = await inject('POST', `/api/v1/admin/applications/${appId}/approve`, admin.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');

    const row = await prisma.auditLog.findFirst({
      where: { action: 'application.approve', entityId: appId },
    });
    expect(row).not.toBeNull();
    expect(row!.actorId).toBe(admin.id);

    // Approval is a one-shot transition.
    const again = await inject('POST', `/api/v1/admin/applications/${appId}/approve`, admin.token);
    expect(again.statusCode).toBe(409);
  });
});

/* ================= service moderation ================= */

describe('service moderation', () => {
  let slug = '';

  it('admin can pause an active service (removes it from the catalogue) and unpause it', async () => {
    const svc = await inject('POST', '/api/v1/pro/services', proUser.token, {
      title: `Moderation Target ${stamp}`,
      categorySlug: 'video-editing',
      price: 120000,
      shortDescription: 'A service used by the admin moderation test suite.',
      description: 'Full-length description for the admin moderation test suite service entry.',
    });
    slug = svc.json().id;
    await inject('POST', `/api/v1/pro/services/${slug}/publish`, proUser.token);
    expect((await inject('GET', `/api/v1/services/${slug}`)).statusCode).toBe(200);

    const paused = await inject('POST', `/api/v1/admin/services/${slug}/pause`, admin.token);
    expect(paused.json().status).toBe('paused');
    expect((await inject('GET', `/api/v1/services/${slug}`)).statusCode).toBe(404);

    // Audit row exists
    const row = await prisma.auditLog.findFirst({ where: { action: 'service.pause', entityId: slug } });
    expect(row).not.toBeNull();

    // Double pause is a 409 (CAS)
    expect((await inject('POST', `/api/v1/admin/services/${slug}/pause`, admin.token)).statusCode).toBe(409);

    const unpaused = await inject('POST', `/api/v1/admin/services/${slug}/unpause`, admin.token);
    expect(unpaused.json().status).toBe('active');
    expect((await inject('GET', `/api/v1/services/${slug}`)).statusCode).toBe(200);
  });

  it('non-admins cannot moderate', async () => {
    expect((await inject('POST', `/api/v1/admin/services/${slug}/pause`, proUser.token)).statusCode).toBe(403);
  });
});

/* ================= user management ================= */

describe('user management', () => {
  it('search finds users by email', async () => {
    const res = await inject('GET', `/api/v1/admin/users?q=adm-vict-${stamp}`, admin.token);
    expect(res.json().total).toBe(1);
    expect(res.json().items[0].email).toBe(victim.email);
  });

  it('suspend revokes sessions and blocks login; reinstate restores access', async () => {
    const res = await inject('POST', `/api/v1/admin/users/${victim.id}/suspend`, admin.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('suspended');

    // audit written
    const row = await prisma.auditLog.findFirst({ where: { action: 'user.suspend', entityId: victim.id } });
    expect(row).not.toBeNull();

    // active refresh tokens revoked
    const live = await prisma.refreshToken.count({ where: { userId: victim.id, revokedAt: null } });
    expect(live).toBe(0);

    // login refused while suspended
    const login = await inject('POST', '/api/v1/auth/login', undefined, { email: victim.email, password: victim.password });
    expect(login.statusCode).toBe(403);

    const back = await inject('POST', `/api/v1/admin/users/${victim.id}/reinstate`, admin.token);
    expect(back.json().status).toBe('active');
    const login2 = await inject('POST', '/api/v1/auth/login', undefined, { email: victim.email, password: victim.password });
    expect(login2.statusCode).toBe(200);
  });

  it('admins cannot suspend themselves or other admins', async () => {
    expect((await inject('POST', `/api/v1/admin/users/${admin.id}/suspend`, admin.token)).statusCode).toBe(409);
    const other = await prisma.user.create({
      data: {
        email: `adm2-${stamp}@test.servix`,
        fullName: 'Second Admin',
        passwordHash: await hashPassword('second-admin-pass'),
        role: 'admin',
        status: 'active',
      },
    });
    const res = await inject('POST', `/api/v1/admin/users/${other.id}/suspend`, admin.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADMIN_PROTECTED');
  });
});

/* ================= audit log viewer ================= */

describe('audit log viewer', () => {
  it('returns entries with actor emails, newest first, filterable by entity', async () => {
    const res = await inject('GET', '/api/v1/admin/audit?entity=user', admin.token);
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.entity).toBe('user');
    expect(items.some((i: { actor: string }) => i.actor === admin.email)).toBe(true);
  });

  it('audit log is read-only (no mutation routes exist)', async () => {
    const res = await inject('POST', '/api/v1/admin/audit', admin.token, {});
    expect(res.statusCode).toBe(404);
  });
});

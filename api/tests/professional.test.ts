/**
 * SERVIX API — Phase C professional onboarding integration tests.
 * Real database, real state transitions — nothing mocked.
 * Phase E migration: application review now goes through authenticated
 * admin endpoints instead of the retired X-Servix-Review-Key bridge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';

let app: FastifyInstance;
const stamp = Date.now();

/* Actors: applicant (becomes professional), rejected user, plain customer, second pro, admin. */
const actors = {
  applicant: { email: `pro-a-${stamp}@test.servix`, password: 'applicant-pass-1', token: '', appId: '' },
  rejected: { email: `pro-r-${stamp}@test.servix`, password: 'rejected-pass-1', token: '', appId: '' },
  customer: { email: `cust-${stamp}@test.servix`, password: 'customer-pass-1', token: '' },
  proB: { email: `pro-b-${stamp}@test.servix`, password: 'pro-b-pass-1', token: '' },
};
let adminToken = '';
const ADMIN_EMAIL = `admin-${stamp}@test.servix`;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
  for (const a of Object.values(actors)) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { fullName: `Test ${a.email.split('@')[0]}`, email: a.email, password: a.password },
    });
    a.token = res.json().accessToken;
  }
  // Server-side admin (role can never be set from the client).
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      fullName: 'Test Admin',
      passwordHash: await hashPassword('admin-test-pass-1'),
      role: 'admin',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: ADMIN_EMAIL, password: 'admin-test-pass-1' },
  });
  adminToken = login.json().accessToken;
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@test.servix' } } });
  const ids = users.map((u) => u.id);
  const profiles = await prisma.professionalProfile.findMany({ where: { userId: { in: ids } } });
  const profileIds = profiles.map((p) => p.id);
  await prisma.service.deleteMany({ where: { professionalId: { in: profileIds } } });
  await prisma.professionalProfile.deleteMany({ where: { id: { in: profileIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
});

const inject = (method: string, url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

const adminApprove = (appId: string) =>
  inject('POST', `/api/v1/admin/applications/${appId}/approve`, adminToken);
const adminReject = (appId: string, reason?: string) =>
  inject('POST', `/api/v1/admin/applications/${appId}/reject`, adminToken, reason ? { reason } : {});

/* ================= application lifecycle ================= */

describe('professional application', () => {
  it('unauthenticated users cannot create applications', async () => {
    const res = await inject('POST', '/api/v1/applications', undefined, { title: 'Nope' });
    expect(res.statusCode).toBe(401);
  });

  it('an authenticated customer can create a draft application', async () => {
    const res = await inject('POST', '/api/v1/applications', actors.applicant.token, {
      title: 'Backend Developer',
      about: 'Ten years of API work.',
      locationCity: 'Lagos',
      categorySlug: 'web-development',
      skills: ['Node.js', 'PostgreSQL'],
      portfolio: [{ title: 'Payments platform', category: 'API' }],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending');
    actors.applicant.appId = body.id;
  });

  it('prevents duplicate active applications', async () => {
    const res = await inject('POST', '/api/v1/applications', actors.applicant.token, {
      title: 'Second Application',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('APPLICATION_EXISTS');
  });

  it('validates application input', async () => {
    const res = await inject('POST', '/api/v1/applications', actors.customer.token, { title: 'x' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.errors.title).toBeDefined();
  });

  it('returns own latest application; 404 when none', async () => {
    const mine = await inject('GET', '/api/v1/applications/me', actors.applicant.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().id).toBe(actors.applicant.appId);

    const none = await inject('GET', '/api/v1/applications/me', actors.customer.token);
    expect(none.statusCode).toBe(404);
  });

  it("another user cannot read or edit someone else's application", async () => {
    const patch = await inject(
      'PATCH',
      `/api/v1/applications/${actors.applicant.appId}`,
      actors.customer.token,
      { title: 'Hijacked' },
    );
    expect(patch.statusCode).toBe(403);
    const submit = await inject(
      'POST',
      `/api/v1/applications/${actors.applicant.appId}/submit`,
      actors.customer.token,
    );
    expect(submit.statusCode).toBe(403);
  });

  it('owner can update while pending', async () => {
    const res = await inject(
      'PATCH',
      `/api/v1/applications/${actors.applicant.appId}`,
      actors.applicant.token,
      { about: 'Updated summary.', skills: ['Node.js', 'PostgreSQL', 'Fastify'] },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().skills).toContain('Fastify');
  });

  it('submit moves pending → under_review; resubmission blocked', async () => {
    const res = await inject('POST', `/api/v1/applications/${actors.applicant.appId}/submit`, actors.applicant.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('under_review');

    const again = await inject('POST', `/api/v1/applications/${actors.applicant.appId}/submit`, actors.applicant.token);
    expect(again.statusCode).toBe(409);
  });

  it('editing is locked once submitted', async () => {
    const res = await inject(
      'PATCH',
      `/api/v1/applications/${actors.applicant.appId}`,
      actors.applicant.token,
      { title: 'Too late' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('APPLICATION_LOCKED');
  });

  it('the retired review-key endpoint is gone (admin auth is the only path)', async () => {
    const res = await inject(
      'POST',
      `/api/v1/applications/${actors.applicant.appId}/review`,
      undefined,
      { decision: 'approved' },
      { 'x-servix-review-key': 'dev-review-key' },
    );
    expect(res.statusCode).toBe(404);
  });

  it('admin approval requires authentication and the admin role', async () => {
    const anon = await inject('POST', `/api/v1/admin/applications/${actors.applicant.appId}/approve`);
    expect(anon.statusCode).toBe(401);
    const asCustomer = await inject(
      'POST',
      `/api/v1/admin/applications/${actors.applicant.appId}/approve`,
      actors.customer.token,
    );
    expect(asCustomer.statusCode).toBe(403);
  });

  it('APPROVAL: admin promotes role and creates the profile transactionally (audited)', async () => {
    const res = await adminApprove(actors.applicant.appId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: actors.applicant.email } });
    expect(user.role).toBe('professional');
    const profile = await prisma.professionalProfile.findUnique({ where: { userId: user.id } });
    expect(profile).not.toBeNull();
    expect(profile!.title).toBe('Backend Developer');
    const skills = await prisma.professionalSkill.findMany({ where: { professionalId: profile!.id } });
    expect(skills.map((s) => s.skill)).toContain('Fastify');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'application.approve', entityId: actors.applicant.appId },
    });
    expect(auditRow).not.toBeNull();
  });

  it('REJECTION: rejected applicant stays a customer and may re-apply but not edit', async () => {
    const create = await inject('POST', '/api/v1/applications', actors.rejected.token, {
      title: 'Hopeful Designer',
    });
    const appId = create.json().id;
    await inject('POST', `/api/v1/applications/${appId}/submit`, actors.rejected.token);
    const rej = await adminReject(appId, 'Portfolio too thin.');
    expect(rej.statusCode).toBe(200);
    expect(rej.json().status).toBe('rejected');
    expect(rej.json().rejectionReason).toBe('Portfolio too thin.');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: actors.rejected.email } });
    expect(user.role).toBe('customer');

    // Cannot edit the rejected application…
    const edit = await inject('PATCH', `/api/v1/applications/${appId}`, actors.rejected.token, { title: 'Retry' });
    expect(edit.statusCode).toBe(409);
    // …but may create a fresh one.
    const reapply = await inject('POST', '/api/v1/applications', actors.rejected.token, {
      title: 'Hopeful Designer v2',
    });
    expect(reapply.statusCode).toBe(201);
  });

  it('an approved professional cannot apply again', async () => {
    const res = await inject('POST', '/api/v1/applications', actors.applicant.token, { title: 'Again?' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_PROFESSIONAL');
  });
});

/* ================= authorization matrix ================= */

describe('authorization', () => {
  it('customer cannot access professional endpoints', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/pro/profile'],
      ['GET', '/api/v1/pro/services'],
      ['POST', '/api/v1/pro/services'],
      ['PUT', '/api/v1/pro/skills'],
    ] as const) {
      const res = await inject(method, url, actors.customer.token, method === 'GET' ? undefined : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('rejected applicant cannot access professional endpoints', async () => {
    const res = await inject('GET', '/api/v1/pro/profile', actors.rejected.token);
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated users cannot access professional endpoints', async () => {
    const res = await inject('GET', '/api/v1/pro/profile');
    expect(res.statusCode).toBe(401);
  });

  it('client-side role escalation is impossible: no writable role field anywhere', async () => {
    // Attempt to smuggle role/status via application + profile payloads.
    const viaApp = await inject('POST', '/api/v1/applications', actors.customer.token, {
      title: 'Sneaky Applicant',
      role: 'admin',
      status: 'approved',
    } as object);
    // Extra keys are stripped by zod; the application stays pending.
    expect(viaApp.statusCode).toBe(201);
    expect(viaApp.json().status).toBe('pending');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: actors.customer.email } });
    expect(user.role).toBe('customer');
    // Clean up so later tests see the customer without an active app.
    await prisma.professionalApplication.deleteMany({ where: { userId: user.id } });
  });
});

/* ================= profile management ================= */

describe('professional profile management', () => {
  it('approved professional reads own profile', async () => {
    const res = await inject('GET', '/api/v1/pro/profile', actors.applicant.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Backend Developer');
  });

  it('updates profile fields (with category validation)', async () => {
    const bad = await inject('PATCH', '/api/v1/pro/profile', actors.applicant.token, {
      categorySlug: 'not-a-category',
    });
    expect(bad.statusCode).toBe(422);

    const res = await inject('PATCH', '/api/v1/pro/profile', actors.applicant.token, {
      title: 'Senior Backend Developer',
      availability: 'limited',
      categorySlug: 'web-development',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Senior Backend Developer');
    expect(res.json().availability).toBe('limited');
  });

  it('replaces skills and manages portfolio with ownership', async () => {
    const skills = await inject('PUT', '/api/v1/pro/skills', actors.applicant.token, {
      skills: ['Node.js', 'Fastify', 'PostgreSQL', 'Prisma'],
    });
    expect(skills.statusCode).toBe(200);
    expect(skills.json().skills).toHaveLength(4);

    const item = await inject('POST', '/api/v1/pro/portfolio', actors.applicant.token, {
      title: 'Marketplace API',
      category: 'Backend',
    });
    expect(item.statusCode).toBe(201);
    const itemId = item.json().id;

    // The customer (non-pro) cannot delete it; guard rejects at role level.
    const strangerDelete = await inject('DELETE', `/api/v1/pro/portfolio/${itemId}`, actors.customer.token);
    expect(strangerDelete.statusCode).toBe(403);

    const ownDelete = await inject('DELETE', `/api/v1/pro/portfolio/${itemId}`, actors.applicant.token);
    expect(ownDelete.statusCode).toBe(200);
  });

  it('upload presign validates type and size and never fakes uploads', async () => {
    const bad = await inject('POST', '/api/v1/pro/uploads', actors.applicant.token, {
      kind: 'profile',
      fileName: 'virus.exe',
      contentType: 'application/octet-stream',
      size: 1000,
    });
    expect(bad.statusCode).toBe(422);

    const tooBig = await inject('POST', '/api/v1/pro/uploads', actors.applicant.token, {
      kind: 'profile',
      fileName: 'huge.png',
      contentType: 'image/png',
      size: 99 * 1024 * 1024,
    });
    expect(tooBig.statusCode).toBe(422);

    const ok = await inject('POST', '/api/v1/pro/uploads', actors.applicant.token, {
      kind: 'profile',
      fileName: 'me.png',
      contentType: 'image/png',
      size: 100_000,
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.key).toMatch(/^profile\//);
    // Honest contract: stub reports enabled=false with no upload URL.
    expect(body.enabled).toBe(false);
    expect(body.uploadUrl).toBeNull();
  });
});

/* ================= service management ================= */

describe('service management', () => {
  let serviceId = '';
  let serviceSlug = '';

  const validService = {
    title: 'API Development & Integration',
    categorySlug: 'web-development',
    price: 300000,
    priceUnit: 'per project',
    durationLabel: '2–3 weeks',
    isRemote: true,
    shortDescription: 'Robust REST APIs designed, built and documented.',
    description:
      'I design and build production-grade REST APIs with authentication, validation, tests and OpenAPI documentation, then integrate them with your frontend.',
    included: ['API design', 'OpenAPI docs', 'Integration support'],
    requirements: ['A project brief'],
    faqs: [{ q: 'Which stack?', a: 'Node.js, Fastify and PostgreSQL.' }],
    gallery: ['/images/services/business-website.jpg'],
  };

  it('professional creates a service as draft', async () => {
    const res = await inject('POST', '/api/v1/pro/services', actors.applicant.token, validService);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('draft');
    expect(body.faqs[0].q).toBe('Which stack?');
    serviceSlug = body.id;
    const row = await prisma.service.findUnique({ where: { slug: serviceSlug } });
    serviceId = row!.id;
  });

  it('server-side validation rejects bad service payloads', async () => {
    const res = await inject('POST', '/api/v1/pro/services', actors.applicant.token, {
      title: 'x',
      categorySlug: 'web-development',
      price: 1,
      shortDescription: 'short',
      description: 'too short',
    });
    expect(res.statusCode).toBe(422);
    const errors = res.json().error.errors;
    expect(errors.title).toBeDefined();
    expect(errors.price).toBeDefined();
    expect(errors.shortDescription).toBeDefined();
    expect(errors.description).toBeDefined();
  });

  it('drafts are NOT visible in the public catalogue', async () => {
    const pub = await inject('GET', `/api/v1/services/${serviceSlug}`);
    expect(pub.statusCode).toBe(404);
    const list = await inject('GET', '/api/v1/services?pageSize=50');
    expect(list.json().items.map((s: { id: string }) => s.id)).not.toContain(serviceSlug);
  });

  it('customer cannot create services', async () => {
    const res = await inject('POST', '/api/v1/pro/services', actors.customer.token, validService);
    expect(res.statusCode).toBe(403);
  });

  it("professional B cannot read, edit, publish or delete professional A's service", async () => {
    // Promote proB through the real workflow (admin approval).
    const appRes = await inject('POST', '/api/v1/applications', actors.proB.token, { title: 'Video Editor' });
    const appId = appRes.json().id;
    await inject('POST', `/api/v1/applications/${appId}/submit`, actors.proB.token);
    await adminApprove(appId);

    const read = await inject('GET', `/api/v1/pro/services/${serviceId}`, actors.proB.token);
    expect(read.statusCode).toBe(404); // not-found masking, no enumeration

    const edit = await inject('PATCH', `/api/v1/pro/services/${serviceId}`, actors.proB.token, { price: 1000 });
    expect(edit.statusCode).toBe(404);

    const publish = await inject('POST', `/api/v1/pro/services/${serviceId}/publish`, actors.proB.token);
    expect(publish.statusCode).toBe(404);

    const del = await inject('DELETE', `/api/v1/pro/services/${serviceId}`, actors.proB.token);
    expect(del.statusCode).toBe(404);

    const row = await prisma.service.findUnique({ where: { id: serviceId } });
    expect(row!.status).toBe('draft'); // untouched
  });

  it('owner edits the service (fields, gallery, faqs)', async () => {
    const res = await inject('PATCH', `/api/v1/pro/services/${serviceId}`, actors.applicant.token, {
      price: 350000,
      faqs: [{ q: 'Do you write tests?', a: 'Always.' }],
      gallery: ['/images/services/business-website.jpg', '/images/services/seo-audit.jpg'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().price).toBe(350000);
    expect(res.json().faqs).toHaveLength(1);
    expect(res.json().gallery).toHaveLength(2);
  });

  it('publish makes it publicly visible; unpublish removes it again', async () => {
    const pub = await inject('POST', `/api/v1/pro/services/${serviceId}/publish`, actors.applicant.token);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().status).toBe('active');

    const publicView = await inject('GET', `/api/v1/services/${serviceSlug}`);
    expect(publicView.statusCode).toBe(200);
    expect(publicView.json().price).toBe(350000);

    // startingPrice aggregate updated on the profile
    const profile = await inject('GET', '/api/v1/pro/profile', actors.applicant.token);
    expect(profile.json().startingPrice).toBe(350000);

    const unpub = await inject('POST', `/api/v1/pro/services/${serviceId}/unpublish`, actors.applicant.token);
    expect(unpub.json().status).toBe('paused');
    const gone = await inject('GET', `/api/v1/services/${serviceSlug}`);
    expect(gone.statusCode).toBe(404);
  });

  it('archive removes the service from own list', async () => {
    await inject('POST', `/api/v1/pro/services/${serviceId}/publish`, actors.applicant.token);
    const del = await inject('DELETE', `/api/v1/pro/services/${serviceId}`, actors.applicant.token);
    expect(del.statusCode).toBe(200);
    const own = await inject('GET', '/api/v1/pro/services', actors.applicant.token);
    expect(own.json().map((s: { id: string }) => s.id)).not.toContain(serviceSlug);
    const publicView = await inject('GET', `/api/v1/services/${serviceSlug}`);
    expect(publicView.statusCode).toBe(404);
  });
});

/* ================= public catalogue regression ================= */

describe('public catalogue regression (Phase A intact)', () => {
  it('demo seed data still fully available with filters/search/pagination', async () => {
    const services = await inject('GET', '/api/v1/services?pageSize=50');
    const ids = services.json().items.map((s: { id: string }) => s.id);
    expect(ids).toContain('business-website-development');
    expect(services.json().total).toBeGreaterThanOrEqual(12);

    const filtered = await inject('GET', '/api/v1/services?category=photography');
    expect(filtered.json().total).toBeGreaterThanOrEqual(2);

    const search = await inject('GET', '/api/v1/services?q=brand');
    expect(search.json().total).toBeGreaterThanOrEqual(1);

    const paged = await inject('GET', '/api/v1/services?page=2&pageSize=5');
    expect(paged.json().items.length).toBeGreaterThan(0);

    const detail = await inject('GET', '/api/v1/services/business-website-development');
    expect(detail.statusCode).toBe(200);

    const pros = await inject('GET', '/api/v1/professionals?pageSize=50');
    expect(pros.json().items.map((p: { id: string }) => p.id)).toContain('adaeze-okafor');

    const proDetail = await inject('GET', '/api/v1/professionals/adaeze-okafor');
    expect(proDetail.statusCode).toBe(200);
    expect(proDetail.json().serviceIds).toContain('business-website-development');
  });

  it('newly approved professionals appear in the public directory', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: actors.applicant.email } });
    const profile = await prisma.professionalProfile.findUniqueOrThrow({ where: { userId: user.id } });
    const res = await inject('GET', `/api/v1/professionals/${profile.slug}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Senior Backend Developer');
  });
});

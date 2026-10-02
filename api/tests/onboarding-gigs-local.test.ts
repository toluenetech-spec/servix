/** Opt-in integration tests for Fiverr-style onboarding (CV import, profile details, photo),
 *  the gig wizard (draft saving, publish checklist, mixed media) and account photos.
 *  Creates its own loopback PostgreSQL (embedded-postgres); never touches Neon.
 *  Run: RUN_LOCAL_ONBOARDING_GIGS_TESTS=1 npx vitest run tests/onboarding-gigs-local.test.ts */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';

/** Minimal single-page PDF with Helvetica text lines (valid enough for pdf.js). */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT', '/F1 11 Tf', '14 TL', '40 800 Td', ...lines.map((l, i) => `${i === 0 ? '' : 'T* '}(${esc(l)}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe.skipIf(process.env.RUN_LOCAL_ONBOARDING_GIGS_TESTS !== '1')('onboarding + gig wizard, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-onboarding-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55449/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false';
    process.env.PAYMENT_MODE = 'sandbox';
    delete process.env.STORAGE_PROVIDER; delete process.env.STORAGE_DRIVER;
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55449, user: 'postgres', password: dbPassword,
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
    await prisma.plan.createMany({ data: [
      { slug: 'free', name: 'Free', price: 0n, position: 0, features: [] },
      { slug: 'professional', name: 'Servix Pro', price: 15000n, position: 1, features: [] },
      { slug: 'business', name: 'Business', price: 40000n, position: 2, features: [] },
    ] });
    await prisma.category.create({ data: { slug: 'web-development', name: 'Web Development' } });
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function account(role: 'customer' | 'professional' | 'admin' = 'customer', fullName = 'Adaeze Okafor') {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, fullName, role, status: 'active', emailVerifiedAt: new Date(), passwordHash: 'test-only' } });
    const slug = randomUUID(); let professionalId: string | null = null;
    if (role === 'professional') professionalId = (await prisma.professionalProfile.create({ data: { userId: user.id, name: fullName, title: 'Developer', slug } })).id;
    const token = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: user.id, role: user.role, status: 'active' });
    return { user, token, slug, professionalId };
  }
  function call(token: string, path: string, body?: object, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
    return app.inject({ method: method ?? (body ? 'POST' : 'GET'), url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }
  function raw(token: string, path: string, contentType: string, body: Buffer) {
    return app.inject({ method: 'POST', url: `/api/v1/${path}`, payload: body, headers: { authorization: `Bearer ${token}`, origin, 'content-type': contentType }, remoteAddress: `192.0.2.${ip++ % 240 + 1}` });
  }

  it('uploads are validated server-side and never faked when storage is off', async () => {
    const me = await account();
    expect((await raw('', 'uploads?kind=avatar', 'image/png', Buffer.from('x'))).statusCode).toBe(401);
    const wrongType = await raw(me.token, 'uploads?kind=avatar', 'application/pdf', Buffer.from('%PDF'));
    expect(wrongType.statusCode).toBe(422); expect(wrongType.json().error.message).toContain('Unsupported file type');
    const tooBig = await raw(me.token, 'uploads?kind=avatar', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(tooBig.statusCode).toBe(422); expect(tooBig.json().error.message).toContain('too large');
    const noStorage = await raw(me.token, 'uploads?kind=avatar', 'image/png', Buffer.from('fake-png'));
    expect(noStorage.statusCode).toBe(503); expect(noStorage.json().error.code).toBe('STORAGE_UNAVAILABLE');
    expect((await raw(me.token, 'uploads?kind=nonsense', 'image/png', Buffer.from('x'))).statusCode).toBe(422);
    const rules = (await call(me.token, 'uploads/rules')).json();
    expect(rules.enabled).toBe(false); expect(rules.kinds['service-video'].maxBytes).toBe(50 * 1024 * 1024);
  });

  it('reads a LinkedIn-style PDF into application suggestions', async () => {
    const me = await account();
    const pdf = makePdf([
      'Contact', 'adaeze@example.com', 'www.linkedin.com/in/adaeze-okafor (LinkedIn)',
      'Top Skills', 'React', 'Node.js', 'PostgreSQL',
      'Languages', 'English (Native or Bilingual)',
      'Adaeze Okafor', 'Senior Web Developer', 'Lagos, Nigeria',
      'Summary', 'I build fast, accessible web applications for growing businesses.',
      'Experience', 'Brightline Studio', 'Senior Web Developer', 'Mar 2021 - Present (3 years)', 'Lagos, Nigeria', 'Lead developer on storefronts.',
      'Education', 'University of Lagos', 'Bachelor of Science (B.Sc.), Computer Science (2012 - 2016)',
    ]);
    expect((await raw(me.token, 'applications/resume?fileName=cv.pdf', 'image/png', pdf)).statusCode).toBe(422);
    const res = await raw(me.token, 'applications/resume?fileName=cv.pdf', 'application/pdf', pdf);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.textFound).toBe(true);
    expect(body.resumeUrl).toBeNull(); // storage off → honest null + note
    expect(body.note).toMatch(/not active|not kept/);
    expect(body.suggestions.source).toBe('linkedin');
    expect(body.suggestions.title).toBe('Senior Web Developer');
    expect(body.suggestions.locationCity).toBe('Lagos');
    expect(body.suggestions.skills).toEqual(['React', 'Node.js', 'PostgreSQL']);
    expect(body.suggestions.experience[0]).toMatchObject({ title: 'Senior Web Developer', company: 'Brightline Studio', end: 'Present' });
    expect(body.suggestions.education[0].school).toBe('University of Lagos');
    const garbage = await raw(me.token, 'applications/resume', 'application/pdf', Buffer.from('not a pdf at all'));
    expect(garbage.statusCode).toBe(422); expect(garbage.json().error.message).toContain('could not read');
  });

  it('applications carry structured details and a photo through approval to the public profile', async () => {
    const me = await account(); const admin = await account('admin', 'Site Admin');
    const details = {
      occupation: 'Web developer', website: 'https://adaeze.design', source: 'linkedin',
      languages: [{ name: 'English', level: 'Native' }], education: [{ school: 'University of Lagos', degree: 'B.Sc. Computer Science', year: '2016' }],
      certifications: [{ name: 'AWS Developer', issuer: 'Amazon', year: '2023' }],
      experience: [{ title: 'Senior Web Developer', company: 'Brightline', start: '2021', end: 'Present', description: 'Lead developer.' }],
    };
    const created = await call(me.token, 'applications', { title: 'Senior Web Developer', about: 'I build web apps.', locationCity: 'Lagos', categorySlug: 'web-development', skills: ['React'], details, photoUrl: 'https://cdn.example.test/profile/me.jpg', resumeUrl: 'https://cdn.example.test/resume/cv.pdf', resumeFileName: 'cv.pdf' });
    expect(created.statusCode).toBe(201);
    expect(created.json().details).toMatchObject({ occupation: 'Web developer', languages: [{ name: 'English', level: 'Native' }] });
    expect(created.json()).toMatchObject({ photoUrl: 'https://cdn.example.test/profile/me.jpg', resumeFileName: 'cv.pdf' });
    // Partial PATCH leaves untouched fields alone and can clear the photo.
    const patched = await call(me.token, `applications/${created.json().id}`, { photoUrl: null, details: { ...details, occupation: 'Full-stack developer' } }, 'PATCH');
    expect(patched.json().photoUrl).toBeNull(); expect(patched.json().details.occupation).toBe('Full-stack developer'); expect(patched.json().resumeUrl).toContain('cv.pdf');
    expect((await call(me.token, `applications/${created.json().id}`, { photoUrl: 'javascript:alert(1)' }, 'PATCH')).statusCode).toBe(422);
    expect((await call(me.token, `applications/${created.json().id}/submit`, {})).json().status).toBe('under_review');
    const approved = await call(admin.token, `admin/applications/${created.json().id}/approve`, {});
    expect(approved.statusCode).toBeLessThan(300);
    const proToken = await (await import('../src/lib/tokens.js')).signAccessToken({ sub: me.user.id, role: 'professional', status: 'active' });
    const profile = (await call(proToken, 'pro/profile')).json();
    expect(profile.details.experience[0].company).toBe('Brightline');
    expect(profile.details.website).toBe('https://adaeze.design');
    expect(profile.skills).toEqual(['React']);
    // Account photo updates flow to the public card too.
    expect((await call(me.token, 'account/profile', { avatarUrl: 'https://cdn.example.test/avatar/a.png' }, 'PATCH')).statusCode).toBe(200);
    expect((await call(me.token, 'me')).json().user.avatarUrl).toBe('https://cdn.example.test/avatar/a.png');
    expect((await call(proToken, 'pro/profile')).json().image).toBe('https://cdn.example.test/avatar/a.png');
    expect((await call(me.token, 'account/profile', {}, 'PATCH')).statusCode).toBe(422);
    // …and a photo saved from the professional Profile tab updates the account avatar (navbar) too.
    expect((await call(proToken, 'pro/profile', { imageUrl: 'https://cdn.example.test/profile/p.jpg' }, 'PATCH')).json().image).toBe('https://cdn.example.test/profile/p.jpg');
    expect((await call(me.token, 'me')).json().user.avatarUrl).toBe('https://cdn.example.test/profile/p.jpg');
    expect((await call(proToken, 'pro/profile', { imageUrl: '' }, 'PATCH')).json().image).toBeNull();
    expect((await call(me.token, 'me')).json().user.avatarUrl).toBeNull();
    // A title-only PATCH leaves the avatar alone.
    expect((await call(proToken, 'pro/profile', { imageUrl: 'https://cdn.example.test/profile/q.jpg' }, 'PATCH')).statusCode).toBe(200);
    expect((await call(proToken, 'pro/profile', { title: 'Senior Web Developer' }, 'PATCH')).statusCode).toBe(200);
    expect((await call(me.token, 'me')).json().user.avatarUrl).toBe('https://cdn.example.test/profile/q.jpg');
  });

  it('gig wizard: drafts save early, publishing enforces the checklist, media kinds are capped', async () => {
    const pro = await account('professional');
    // Overview-only draft is allowed.
    const draft = await call(pro.token, 'pro/services', { title: 'I will build your online store', categorySlug: 'web-development', serviceType: 'E-commerce website', searchTags: ['shopify', 'woocommerce', 'online store'], price: 150000 });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ status: 'draft', searchTags: ['shopify', 'woocommerce', 'online store'], serviceType: 'E-commerce website', deliveryDays: null });
    expect(Object.keys(draft.json().publishProblems).sort()).toEqual(['deliveryDays', 'description', 'gallery', 'shortDescription']);
    const id = draft.json().id;
    const blocked = await call(pro.token, `pro/services/${id}/publish`, {});
    expect(blocked.statusCode).toBe(422); expect(blocked.json().error.code).toBe('GIG_INCOMPLETE'); expect(blocked.json().error.errors.gallery).toContain('image');
    // Validation on tags.
    expect((await call(pro.token, `pro/services/${id}`, { searchTags: ['a'] }, 'PATCH')).statusCode).toBe(422);
    expect((await call(pro.token, `pro/services/${id}`, { searchTags: ['one', 'two', 'three', 'four', 'five', 'six'] }, 'PATCH')).statusCode).toBe(422);
    // Media caps.
    const img = (n: number) => ({ url: `https://cdn.example.test/service/${n}.jpg`, kind: 'image', fileName: `${n}.jpg` });
    expect((await call(pro.token, `pro/services/${id}`, { gallery: [{ url: 'https://cdn.example.test/service/a.mp4', kind: 'video' }, { url: 'https://cdn.example.test/service/b.mp4', kind: 'video' }] }, 'PATCH')).statusCode).toBe(422);
    expect((await call(pro.token, `pro/services/${id}`, { gallery: [1, 2, 3, 4, 5, 6].map(img) }, 'PATCH')).statusCode).toBe(422);
    // Complete the remaining steps.
    const full = await call(pro.token, `pro/services/${id}`, {
      deliveryDays: 7, revisions: 2, shortDescription: 'A fast, secure online store built for Nigerian SMEs.',
      description: 'I design and build a complete e-commerce website with payments, delivery zones, product management and training for your team so you can run it yourself.',
      included: ['Up to 50 products', 'Paystack checkout'],
      requirements: [{ question: 'Do you already have a logo?', type: 'choice', options: ['Yes', 'No'], required: true }, 'Share your product list.'],
      faqs: [{ q: 'Do you offer hosting?', a: 'Yes, first year included.' }],
      gallery: [{ url: 'https://cdn.example.test/service/a.mp4', kind: 'video', fileName: 'intro.mp4' }, img(1), img(2), { url: 'https://cdn.example.test/service/brochure.pdf', kind: 'document', fileName: 'brochure.pdf' }],
    }, 'PATCH');
    expect(full.statusCode).toBe(200);
    expect(full.json().publishProblems).toEqual({});
    expect(full.json().requirements).toEqual([
      { question: 'Do you already have a logo?', type: 'choice', options: ['Yes', 'No'], required: true },
      { question: 'Share your product list.', type: 'text', options: [], required: false },
    ]);
    expect(full.json().video).toMatchObject({ kind: 'video', fileName: 'intro.mp4' });
    expect(full.json().documents).toHaveLength(1);
    expect(full.json().gallery).toEqual(['https://cdn.example.test/service/1.jpg', 'https://cdn.example.test/service/2.jpg']);
    expect(full.json().image).toBe('https://cdn.example.test/service/1.jpg'); // cover is the first IMAGE, not the video
    expect(full.json().duration).toBe('7 days delivery');
    const published = await call(pro.token, `pro/services/${id}/publish`, {});
    expect(published.statusCode).toBe(200); expect(published.json().status).toBe('active');
    const pub = await app.inject({ method: 'GET', url: `/api/v1/services/${id}`, headers: { origin } });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ deliveryDays: 7, revisions: 2, searchTags: ['shopify', 'woocommerce', 'online store'] });
    expect(pub.json().media.map((m: { kind: string }) => m.kind)).toEqual(['video', 'image', 'image', 'document']);
  });
});

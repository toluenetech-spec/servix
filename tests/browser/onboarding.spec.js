import { test, expect } from '@playwright/test';

const baseUser = { id: 'ui-user', fullName: 'Adaeze Okafor', email: 'adaeze@example.test', role: 'customer', status: 'active', avatarUrl: null };
const categories = [{ id: 'web-development', name: 'Web Development', description: '', serviceCount: 0, icon: 'code' }];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Mock API with an in-memory application + service store so the wizards behave like the real thing. */
async function mock(page, options = {}) {
  const db = { user: { ...baseUser, ...options.user }, application: options.application ?? null, services: {}, uploads: [], calls: [] };
  page.db = db;
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const method = req.method();
    db.calls.push(`${method} ${path}`);
    const body = () => { try { return req.postDataJSON(); } catch { return {}; } };
    if (path === 'auth/refresh') return route.fulfill({ json: { accessToken: 'ui-test-only', user: db.user } });
    if (path === 'me') return route.fulfill({ json: { user: db.user } });
    if (path === 'categories') return route.fulfill({ json: categories });
    if (path === 'account/overview') return route.fulfill({ json: { kind: db.user.role === 'professional' ? 'professional' : 'customer', intent: 'customer', needsChoice: false, emailVerified: true, applicationStatus: db.application?.status ?? null, canManageServices: db.user.role === 'professional' } });
    if (path === 'account/profile' && method === 'PATCH') { const b = body(); if (b.avatarUrl !== undefined) db.user = { ...db.user, avatarUrl: b.avatarUrl }; if (b.fullName) db.user = { ...db.user, fullName: b.fullName }; return route.fulfill({ json: { ok: true } }); }
    if (path === 'uploads') {
      const kind = url.searchParams.get('kind');
      db.uploads.push({ kind, contentType: req.headers()['content-type'], fileName: url.searchParams.get('fileName') });
      if (options.storageDown) return route.fulfill({ status: 503, json: { error: { code: 'STORAGE_UNAVAILABLE', message: 'File uploads are not available right now.', status: 503 } } });
      return route.fulfill({ status: 201, json: { url: `https://cdn.servix.test/${kind}/${db.uploads.length}.bin`, key: `${kind}/${db.uploads.length}`, kind, fileName: url.searchParams.get('fileName'), contentType: req.headers()['content-type'], size: 1 } });
    }
    if (path === 'applications/resume') {
      db.calls.push(`resume:${req.headers()['content-type']}`);
      return route.fulfill({ json: { resumeUrl: 'https://cdn.servix.test/resume/1.pdf', resumeFileName: url.searchParams.get('fileName'), textFound: true, note: null, suggestions: { source: 'linkedin', title: 'Senior Web Developer', about: 'I build fast, accessible web applications for growing businesses across Nigeria.', locationCity: 'Lagos', website: '', skills: ['React', 'Node.js'], languages: [{ name: 'English', level: 'Native' }], certifications: [], education: [{ school: 'University of Lagos', degree: 'B.Sc. Computer Science', year: '2016' }], experience: [{ title: 'Senior Web Developer', company: 'Brightline Studio', start: 'Mar 2021', end: 'Present', description: 'Lead developer.' }], found: ['title', 'about', 'locationCity', 'skills', 'languages', 'education', 'experience'] } } });
    }
    if (path === 'applications/me') return db.application ? route.fulfill({ json: db.application }) : route.fulfill({ status: 404, json: { error: { code: 'APPLICATION_NOT_FOUND', message: 'No application found.', status: 404 } } });
    if (path === 'applications' && method === 'POST') { db.application = { id: 'app-1', status: 'pending', submittedAt: null, rejectionReason: null, ...body() }; return route.fulfill({ status: 201, json: db.application }); }
    if (path.startsWith('applications/app-1') && method === 'PATCH') { db.application = { ...db.application, ...body() }; return route.fulfill({ json: db.application }); }
    if (path === 'applications/app-1/submit') { db.application = { ...db.application, status: 'under_review', submittedAt: new Date().toISOString() }; return route.fulfill({ json: db.application }); }
    if (path === 'pro/profile') return route.fulfill({ json: { id: 'adaeze', name: db.user.fullName, title: 'Developer', location: 'Lagos, Nigeria', skills: [], portfolio: [], details: {}, verified: false, availability: 'available', image: null } });
    if (path === 'pro/services' && method === 'GET') return route.fulfill({ json: Object.values(db.services) });
    if (path === 'pro/services' && method === 'POST') {
      const b = body(); const id = 'gig-1';
      db.services[id] = serviceFrom(id, 'draft', b);
      return route.fulfill({ status: 201, json: db.services[id] });
    }
    const svc = path.match(/^pro\/services\/([^/]+)(?:\/(publish|unpublish))?$/);
    if (svc) {
      const s = db.services[svc[1]];
      if (!s) return route.fulfill({ status: 404, json: { error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found', status: 404 } } });
      if (svc[2] === 'publish') {
        const problems = publishProblems(s);
        if (Object.keys(problems).length) return route.fulfill({ status: 422, json: { error: { code: 'GIG_INCOMPLETE', message: 'Finish these before publishing.', status: 422, errors: problems } } });
        s.status = 'active'; return route.fulfill({ json: s });
      }
      if (method === 'PATCH') { Object.assign(s, serviceFrom(svc[1], s.status, { ...s.raw, ...body() })); return route.fulfill({ json: s }); }
      return route.fulfill({ json: s });
    }
    if (path.startsWith('account/notifications')) return route.fulfill({ json: { unread: 0, before: null, items: [] } });
    return route.fulfill({ json: { items: [] } });
  });
}

function publishProblems(s) {
  const p = {};
  if ((s.shortDescription ?? '').length < 20) p.shortDescription = 'Write a short description of at least 20 characters.';
  if ((s.description ?? '').length < 50) p.description = 'Describe the gig in at least 50 characters.';
  if (!s.deliveryDays) p.deliveryDays = 'Choose a delivery time.';
  if (!(s.media ?? []).some((m) => m.kind === 'image')) p.gallery = 'Add at least one image to the gallery.';
  return p;
}
function serviceFrom(id, status, b) {
  const media = (b.gallery ?? []).map((m) => (typeof m === 'string' ? { url: m, kind: 'image', fileName: '' } : m));
  const s = {
    id, status, raw: b, title: b.title ?? '', categoryId: b.categorySlug ?? '', serviceType: b.serviceType ?? '', searchTags: b.searchTags ?? [],
    price: b.price ?? 0, priceUnit: b.priceUnit ?? 'per project', deliveryDays: b.deliveryDays ?? null, revisions: b.revisions ?? null,
    duration: b.deliveryDays ? `${b.deliveryDays} days delivery` : '', location: b.locationLabel ?? 'Remote',
    shortDescription: b.shortDescription ?? '', description: b.description ?? '', included: b.included ?? [], faqs: b.faqs ?? [],
    requirements: (b.requirements ?? []).map((r) => (typeof r === 'string' ? { question: r, type: 'text', options: [], required: false } : r)),
    media, gallery: media.filter((m) => m.kind === 'image').map((m) => m.url), image: media.find((m) => m.kind === 'image')?.url ?? null,
    video: media.find((m) => m.kind === 'video') ?? null, documents: media.filter((m) => m.kind === 'document'), availability: 'available', rating: 0, reviewCount: 0,
  };
  s.publishProblems = publishProblems(s);
  return s;
}

test('onboarding overview offers LinkedIn/CV import or manual entry, and the manual path saves a draft per step and submits', async ({ page }) => {
  await mock(page);
  await page.goto('/professionals/apply');
  await expect(page.getByRole('heading', { name: /Grow your brand/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Exit' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upload your experience/ })).toBeVisible();
  await expect(page.getByText('Recommended')).toBeVisible();
  await expect(page.getByText('Click on Resources')).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(cont).toBeDisabled();
  await page.getByRole('button', { name: /Fill out profile manually/ }).click();
  await expect(cont).toBeEnabled();
  await cont.click();

  // Step 1 — personal info, with validation before anything is saved.
  await expect(page.getByRole('heading', { name: 'Personal info' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Adaeze Okafor');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Enter your professional title')).toBeVisible();
  expect(page.db.calls.filter((c) => c.startsWith('POST applications'))).toHaveLength(0);
  await page.getByLabel('Professional title').fill('Senior Web Developer');
  await page.getByLabel('Category').selectOption('web-development');
  await page.getByLabel('Description').fill('I build fast, accessible web applications for growing businesses across Nigeria.');
  await page.getByLabel('City').fill('Lagos');
  await page.getByRole('button', { name: '+ Add language' }).click();
  await page.getByRole('textbox', { name: 'Language', exact: true }).fill('English');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 2 — professional info; the draft now exists on the server.
  await expect(page.getByRole('heading', { name: 'Professional info' })).toBeVisible();
  expect(page.db.application).toMatchObject({ title: 'Senior Web Developer', categorySlug: 'web-development', locationCity: 'Lagos', details: { languages: [{ name: 'English', level: '' }], source: 'manual' } });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Add at least one skill.')).toBeVisible();
  await page.getByLabel('Skills').fill('React');
  await page.getByLabel('Skills').press('Enter');
  await page.getByLabel('Skills').fill('Node.js');
  await page.getByLabel('Skills').press('Enter');
  await expect(page.getByRole('button', { name: 'Remove React' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add experience' }).click();
  await page.getByRole('textbox', { name: 'Job title' }).fill('Lead Developer');
  await page.getByLabel('Company / client').fill('Brightline Studio');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 3 — portfolio is optional.
  await expect(page.getByRole('heading', { name: 'Show your work' })).toBeVisible();
  expect(page.db.application.skills).toEqual(['React', 'Node.js']);
  expect(page.db.application.details.experience[0]).toMatchObject({ title: 'Lead Developer', company: 'Brightline Studio' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 4 — review, confirmation required, then submit locks the application.
  await expect(page.getByRole('heading', { name: 'Review and submit' })).toBeVisible();
  await expect(page.getByText('React, Node.js')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Please confirm your details are accurate.')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('heading', { name: 'Your application is being reviewed' })).toBeVisible();
  expect(page.db.application.status).toBe('under_review');
  expect(page.db.calls).toContain('POST applications/app-1/submit');

  // Coming back shows the status, not the form.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your application is being reviewed' })).toBeVisible();
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/apply-status.png`, fullPage: true });
});

test('uploading a LinkedIn PDF pre-fills the application and attaches the CV', async ({ page }) => {
  await mock(page);
  await page.goto('/professionals/apply');
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/apply-overview.png`, fullPage: true });
  // A non-PDF is refused before any upload happens.
  await page.getByLabel('Select a PDF file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('alert')).toContainText('isn’t supported');
  expect(page.db.calls.filter((c) => c.startsWith('resume:'))).toHaveLength(0);
  await page.getByLabel('Select a PDF file').setInputFiles({ name: 'Profile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  await expect(page.getByText(/We read Profile\.pdf/)).toBeVisible();
  await expect(page.getByText('2 skills')).toBeVisible();
  expect(page.db.calls).toContain('resume:application/pdf');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Professional title')).toHaveValue('Senior Web Developer');
  await expect(page.getByLabel('City')).toHaveValue('Lagos');
  await expect(page.getByRole('textbox', { name: 'Language', exact: true })).toHaveValue('English');
  await page.getByLabel('Category').selectOption('web-development');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove React' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Job title' })).toHaveValue('Senior Web Developer');
  await expect(page.getByText('CV attached:')).toBeVisible();
  expect(page.db.application).toMatchObject({ resumeUrl: 'https://cdn.servix.test/resume/1.pdf', resumeFileName: 'Profile.pdf', details: { source: 'linkedin' } });
});

test('gig wizard walks Overview → Pricing → Description → Requirements → Gallery → Publish with server checks', async ({ page }) => {
  await mock(page, { user: { role: 'professional' } });
  await page.goto('/dashboard/gigs');
  await page.getByRole('link', { name: 'Create a new gig' }).click();
  await expect(page).toHaveURL(/\/dashboard\/gigs\/new$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Save & Continue' });
  await next.click();
  await expect(page.getByText('Give the gig a title')).toBeVisible();
  await page.getByLabel('Gig title').fill('build a Shopify store for your brand');
  await page.getByLabel('Category').selectOption('web-development');
  await page.getByLabel('Service type').fill('E-commerce website');
  const tags = page.getByLabel('Search tags');
  for (const t of ['shopify', 'online store']) { await tags.fill(t); await tags.press('Enter'); }
  await next.click();
  expect(page.db.calls.filter((c) => c === 'POST pro/services')).toHaveLength(0); // nothing saved until a price exists

  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  await next.click();
  await expect(page.getByText('Set a price of at least')).toBeVisible();
  await page.getByLabel('Price (₦)').fill('150000');
  await page.getByLabel('Delivery time').selectOption('7');
  await page.getByLabel('Revisions included').selectOption('2');
  const inc = page.getByLabel('What’s included');
  await inc.fill('Up to 50 products'); await inc.press('Enter');
  await next.click();
  await expect(page).toHaveURL(/\/dashboard\/gigs\/gig-1\/edit$/);
  expect(page.db.services['gig-1'].raw).toMatchObject({ title: 'I will build a Shopify store for your brand', categorySlug: 'web-development', serviceType: 'E-commerce website', searchTags: ['shopify', 'online store'], price: 150000, deliveryDays: 7, revisions: 2, included: ['Up to 50 products'] });

  await expect(page.getByRole('heading', { name: 'Description & FAQ' })).toBeVisible();
  await page.getByLabel('Short description').fill('A fast, secure online store built for Nigerian SMEs.');
  await page.getByLabel('Full description').fill('I design and build a complete e-commerce website with payments, delivery zones, product management and training for your team.');
  await page.getByRole('button', { name: '+ Add FAQ' }).click();
  await page.getByLabel(/^Question/).fill('Do you offer hosting?');
  await page.getByLabel('Answer', { exact: true }).fill('Yes, the first year is included.');
  await next.click();

  await expect(page.getByRole('heading', { name: 'Requirements' })).toBeVisible();
  await page.getByRole('button', { name: 'What is your deadline?' }).click();
  await page.getByRole('button', { name: '+ Add a question' }).click();
  await page.getByLabel(/^Question/).nth(1).fill('Do you already have a logo?');
  await page.getByLabel('Answer type').nth(1).selectOption('choice');
  await next.click();
  await expect(page.getByText('Add at least two options.')).toBeVisible();
  const opts = page.getByPlaceholder('e.g. Yes');
  await opts.fill('Yes'); await opts.press('Enter'); await opts.fill('No'); await opts.press('Enter');
  await page.getByText('Client must answer before booking').nth(1).click();
  await next.click();
  expect(page.db.services['gig-1'].raw.requirements).toEqual([
    { question: 'What is your deadline?', type: 'text', options: [], required: false },
    { question: 'Do you already have a logo?', type: 'choice', options: ['Yes', 'No'], required: true },
  ]);

  // Gallery: at least one image is required; uploads go through the API.
  await expect(page.getByRole('heading', { name: /gig gallery/ })).toBeVisible();
  await next.click();
  await expect(page.getByRole('alert')).toContainText('at least one image');
  await page.getByLabel('Add gallery images').setInputFiles({ name: 'store.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Cover')).toBeVisible();
  await page.getByLabel('Add PDF documents').setInputFiles({ name: 'brochure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  await expect(page.getByText('brochure.pdf')).toBeVisible();
  expect(page.db.uploads.map((u) => u.kind)).toEqual(['service', 'service-document']);
  await next.click();

  // Publish
  await expect(page.getByRole('heading', { name: 'Almost there…' })).toBeVisible();
  await expect(page.getByText('Finish these before publishing')).toHaveCount(0);
  await expect(page.getByText('1 image(s), 0 video, 1 document(s)')).toBeVisible();
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/gig-publish.png`, fullPage: true });
  await page.getByRole('button', { name: 'Publish gig' }).click();
  await expect(page).toHaveURL(/\/dashboard\/gigs$/);
  expect(page.db.services['gig-1'].status).toBe('active');
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText('Web Development')).toBeVisible();
});

test('an incomplete draft cannot be published from the list and the publish step explains why', async ({ page }) => {
  await mock(page, { user: { role: 'professional' } });
  page.db.services['gig-1'] = serviceFrom('gig-1', 'draft', { title: 'I will write your blog posts', categorySlug: 'web-development', price: 20000 });
  await page.goto('/dashboard/gigs');
  await expect(page.getByText('4 steps left')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page).toHaveURL(/\/dashboard\/gigs\/gig-1\/edit$/);
  await expect(page.getByLabel('Gig title')).toHaveValue('write your blog posts');
  // Jump to the last step and read the checklist.
  for (let i = 0; i < 5; i += 1) { await page.getByLabel('Steps').getByText(['Pricing', 'Description & FAQ', 'Requirements', 'Gallery', 'Publish'][i], { exact: true }).isVisible(); }
  await page.getByRole('button', { name: 'Save & exit' }).click();
  await expect(page).toHaveURL(/\/dashboard\/gigs$/);
});

test('account settings let anyone upload, see and remove a profile photo', async ({ page }) => {
  await mock(page);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Profile photo' })).toBeVisible();
  await page.getByLabel('Profile photo file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Your photo has been saved.')).toBeVisible();
  expect(page.db.uploads[0]).toMatchObject({ kind: 'avatar', contentType: 'image/png', fileName: 'me.png' });
  expect(page.db.user.avatarUrl).toBe('https://cdn.servix.test/avatar/1.bin');
  await expect(page.getByRole('img', { name: 'Photo of Adaeze Okafor' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Your photo has been removed.')).toBeVisible();
  expect(page.db.user.avatarUrl).toBeNull();
});

test('photo upload reports storage problems instead of pretending', async ({ page }) => {
  await mock(page, { storageDown: true });
  await page.goto('/dashboard/settings');
  await page.getByLabel('Profile photo file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('alert')).toContainText('not available right now');
  expect(page.db.user.avatarUrl).toBeNull();
});

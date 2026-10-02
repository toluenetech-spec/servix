import { test, expect } from '@playwright/test';
/* Next-gen marketplace journeys with a mocked API: trust tab + verified portfolio + compare tray,
   customer request → proposals → accept, professional browse → propose, saved "preferred", admin tabs. */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const customer = { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' };
const overview = { kind: 'customer', intent: 'customer', needsChoice: false, emailVerified: true, applicationStatus: null, canManageServices: false, kycStatus: 'unverified' };
const features = { requests: true, compare: true, achievements: true, trust: true, projects: false, crm: false, packages: false, business: false, pricing: false, community: false };

const trust = { servixVerified: true, identityVerified: true, accountAgeDays: 400, completedJobs: 12, verifiedProjects: 2,
  rating: { average: 4.9, count: 11, enough: true, minimum: 3 },
  reliability: { percent: 92, measurable: 12, enough: true, minimum: 5 },
  responseRate: { percent: null, medianHours: null, sample: 2, enough: false, minimum: 5 },
  repeatCustomers: { percent: 40, customers: 10, enough: true, minimum: 5 },
  computedAt: new Date().toISOString(),
  achievements: [{ slug: 'jobs_10', name: '10 Jobs Completed', description: '10 bookings completed through Servix.', icon: 'briefcase', earnedAt: new Date().toISOString() }] };
const pro = (id, name, extra = {}) => ({ id, name, title: 'Brand Designer', location: 'Lagos, Nigeria', rating: 4.9, reviewCount: 11, verified: true, availability: 'available', image: '/images/professionals/adaeze-okafor.jpg', startingPrice: 50000, completedProjects: 12, verifiedProjects: 2, responseTime: 'Within 2 hours', memberSince: '2025', plan: 'free', bio: 'Designer.', skills: ['branding'], languages: ['English'], experience: [], education: [], certifications: [], categoryId: 'design', portfolio: [{ id: 'p1', title: 'Bakery brand identity', category: 'Design', image: null, verified: true, completedAt: '2026-08-01T00:00:00Z', customerRating: 5, deliveryDays: 4 }, { id: 'p2', title: 'Old poster', category: 'Design', image: null, verified: false }], trust, ...extra });

const request = { id: '11111111-1111-4111-8111-111111111111', title: 'Brand identity for a bakery', category: { slug: 'design', name: 'Design' }, description: 'We need a logo, colour palette and simple brand guide for a new bakery in Lekki. Deliver as PDF and SVG.', budgetType: 'range', budgetMin: 50000, budgetMax: 120000, deadlineAt: null, preferredDeliveryAt: null, isRemote: true, location: null, requiredSkills: ['branding'], attachments: [], extraRequirements: null, status: 'open', proposalCount: 2, awardedProposalId: null, publishedAt: new Date().toISOString(), closedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), customer: { id: 'ui-user', fullName: 'Test Member', avatarUrl: null }, publishProblems: {} };
const proposal = (id, name, price) => ({ id, requestId: request.id, cover: `${name} here. Three concepts, one brand guide, two revision rounds included.`, price, deliveryDays: 6, milestones: [], attachments: [], proposedStartAt: null, status: 'submitted', rejectedReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), service: null, booking: null, professional: { id: name.toLowerCase().replace(' ', '-'), name, title: 'Brand Designer', image: null, rating: 4.8, reviewCount: 9, completedProjects: 15, verified: true, identityVerified: true } });

async function mock(page, options = {}) {
  const log = { posts: [], patches: [] };
  const role = options.user?.role ?? 'customer';
  let state = { ...overview, ...options.state };
  let requestStatus = options.requests && options.requests.length === 0 ? 'draft' : 'open';
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    if (method === 'POST') log.posts.push({ path, body: route.request().postDataJSON?.() ?? null });
    if (method === 'PATCH') log.patches.push({ path, body: route.request().postDataJSON() });
    if (path === 'features') return route.fulfill({ json: options.features ?? features });
    if (path === 'auth/refresh') return options.anonymous ? route.fulfill({ status: 401, json: { error: { status: 401, code: 'UNAUTHENTICATED', message: 'no' } } }) : route.fulfill({ json: { accessToken: 'ui-test-only', user: { ...customer, ...options.user } } });
    if (path === 'auth/me') return route.fulfill({ json: { user: { ...customer, ...options.user } } });
    if (path === 'account/overview') return route.fulfill({ json: state });
    if (path === 'views') return route.fulfill({ status: 204, body: '' });
    if (path === 'categories') return route.fulfill({ json: [{ id: 'design', name: 'Design', description: '', serviceCount: 3, icon: 'pen' }] });
    // catalogue
    if (path === 'professionals') return route.fulfill({ json: { items: [pro('ada-pro', 'Ada Pro'), pro('bisi-pro', 'Bisi Pro')], total: 2, page: 1, pageSize: 12 } });
    if (/^professionals\/[^/]+\/trust$/.test(path)) return route.fulfill({ json: trust });
    if (/^professionals\/[^/]+\/availability\/summary$/.test(path)) return route.fulfill({ json: { nextAvailableAt: new Date(Date.now() + 3_600_000).toISOString(), availableToday: true, availableTomorrow: true, availableThisWeek: true } });
    if (/^professionals\/[^/]+\/(reviews|services)$/.test(path)) return route.fulfill({ json: [] });
    if (/^professionals\/[^/]+$/.test(path)) { const slug = path.split('/')[1]; return route.fulfill({ json: pro(slug, slug === 'ada-pro' ? 'Ada Pro' : 'Bisi Pro') }); }
    if (path === 'compare') { const slugs = (url.searchParams.get('professionals') || '').split(','); return route.fulfill({ json: { max: 4, professionals: slugs.map((s) => ({ ...pro(s, s === 'ada-pro' ? 'Ada Pro' : 'Bisi Pro'), identityVerified: true, achievements: trust.achievements, availabilityNext: { nextAvailableAt: new Date().toISOString(), availableToday: true }, services: [{ id: 'logo', title: 'Logo design', price: 50000, priceUnit: 'per project' }], trust: s === 'bisi-pro' ? { ...trust, reliability: { percent: null, measurable: 1, enough: false, minimum: 5 } } : trust })), services: [], notEnoughDataLabel: 'Not enough data', minimums: { reliability: 5 } } }); }
    // customer requests
    if (path === 'requests' && method === 'GET') return route.fulfill({ json: { items: options.requests ?? [request] } });
    if (path === 'requests' && method === 'POST') { const b = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...request, ...b, id: request.id, status: 'draft', category: { slug: 'design', name: 'Design' }, publishProblems: b.description.length < 40 ? { description: 'Describe what you need in at least 40 characters so professionals can quote accurately.' } : {} } }); }
    if (path === `requests/${request.id}/publish`) { requestStatus = 'open'; return route.fulfill({ json: { ...request, status: 'open' } }); }
    if (path === `requests/${request.id}/proposals` && method === 'GET') return route.fulfill({ json: { request: options.request ?? request, items: options.proposals ?? [proposal('p-1', 'Ada Pro', 90000), proposal('p-2', 'Bisi Pro', 70000)] } });
    if (path === `requests/${request.id}/proposals/p-2/accept`) return route.fulfill({ status: 201, json: { bookingId: 'bk-1', reference: 'SVX-TEST', status: 'pending_payment', next: '/bookings/bk-1' } });
    if (path === 'bookings/bk-1/pay') return route.fulfill({ status: 503, json: { error: { status: 503, code: 'PAYMENTS_OFF', message: 'Payments unavailable in test.' } } });
    if (path === 'bookings/bk-1') return route.fulfill({ json: { id: 'bk-1', reference: 'SVX-TEST', status: 'pending_payment', amount: 70000, platformFee: 7000, serviceTitle: 'Brand identity for a bakery (proposal)', professional: { id: 'bisi-pro', name: 'Bisi Pro' }, service: { id: 'custom-work-bisi-pro' }, scheduledAt: new Date().toISOString(), createdAt: new Date().toISOString(), notes: '', priceUnit: 'project', hasReview: false, events: [] } });
    if (path === `requests/${request.id}` && method === 'GET') return route.fulfill({ json: { ...request, status: requestStatus } });
    if (path === `requests/${request.id}` && method === 'PATCH') { const b = route.request().postDataJSON(); return route.fulfill({ json: { ...request, ...b, status: requestStatus, category: { slug: 'design', name: 'Design' }, publishProblems: {} } }); }
    // professional
    if (path === 'requests/browse') return route.fulfill({ json: { items: [{ ...request, customer: { displayName: 'Test', memberSince: '2025-01' }, myProposal: null }], total: 1, page: 1, pageSize: 12 } });
    if (path === `requests/browse/${request.id}`) return route.fulfill({ json: { ...request, customer: { displayName: 'Test', memberSince: '2025-01' }, myProposal: options.myProposal ?? null, myServices: [{ id: 'logo', title: 'Logo design' }] } });
    if (path === `requests/${request.id}/proposals` && method === 'POST') { const b = route.request().postDataJSON(); if (b.cover.length < 30) return route.fulfill({ status: 422, json: { error: { status: 422, code: 'VALIDATION_ERROR', message: 'Please check the highlighted fields.', errors: { cover: 'Write at least a short paragraph (30 characters).' } } } }); return route.fulfill({ status: 201, json: { ...proposal('p-new', 'Me', b.price), cover: b.cover } }); }
    if (path === 'proposals/mine') return route.fulfill({ json: { items: [] } });
    // saved
    if (path === 'account/saved' && method === 'GET') return route.fulfill({ json: options.saved ?? [{ id: 's1', savedAt: new Date().toISOString(), preferred: false, note: '', professional: { slug: 'ada-pro', name: 'Ada Pro', title: 'Brand Designer', imageUrl: null, locationCity: 'Lagos', ratingAvg: 4.9, reviewCount: 11, verification: 'verified', availability: 'available', startingPrice: 50000, currency: 'NGN' } }] });
    if (path === 'account/saved/ada-pro' && method === 'PATCH') { const b = route.request().postDataJSON(); return route.fulfill({ json: { id: 's1', savedAt: new Date().toISOString(), preferred: b.preferred ?? false, note: b.note ?? '', professional: { slug: 'ada-pro', name: 'Ada Pro', title: 'Brand Designer', imageUrl: null, locationCity: 'Lagos', ratingAvg: 4.9, reviewCount: 11, verification: 'verified', availability: 'available', startingPrice: 50000, currency: 'NGN' } } }); }
    // admin
    if (path === 'admin/requests') return route.fulfill({ json: { items: [{ ...request, customer: { id: 'u', fullName: 'Test Member', email: 'test@example.test' } }], total: 1, page: 1, pageSize: 20 } });
    if (path === 'admin/proposals') return route.fulfill({ json: { items: [{ ...proposal('p-1', 'Ada Pro', 90000), request: { id: request.id, title: request.title, status: 'open', customer: { id: 'u', fullName: 'Test Member' } } }], total: 1, page: 1, pageSize: 20 } });
    if (path === 'admin/trust') return route.fulfill({ json: { items: [{ slug: 'ada-pro', name: 'Ada Pro', title: 'Brand Designer', verification: 'verified', kycStatus: 'verified', completedProjects: 12, rating: 4.9, reviewCount: 11, achievements: ['jobs_10'] }], total: 1, page: 1, pageSize: 20 } });
    if (path === 'admin/trust/ada-pro') return route.fulfill({ json: { professional: { id: 'x', name: 'Ada Pro', slug: 'ada-pro' }, metrics: { reliability: { percent: 92, onTime: 11, late: 1, against: 0, measurable: 12 }, response: { ratePercent: null, medianHours: null, sample: 2 }, repeatCustomers: { percent: 40, repeat: 4, customers: 10 }, completedJobs: 12, verifiedProjects: 2, disputes: { total: 0, refunded: 0 }, accountAgeDays: 400 }, history: [{ slug: 'jobs_10', earnedAt: new Date().toISOString(), revokedAt: null, evidence: {} }], catalog: [{ slug: 'jobs_10', name: '10 Jobs Completed', description: '10 bookings completed through Servix.', icon: 'briefcase' }, { slug: 'top_rated', name: 'Top Rated', description: 'Average rating of 4.8 or higher across at least 10 reviews.', icon: 'star' }], source: 'bookings' } });
    if (path === 'admin/trust/ada-pro/recompute') return route.fulfill({ json: { earned: ['top_rated'], revoked: [] } });
    if (path.startsWith('admin/')) return route.fulfill({ json: { items: [], pending: [], recent: [], totals: {}, series: [] } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    if (path === 'account/notifications') return route.fulfill({ json: { unread: 0, before: null, items: [] } });
    if (path === 'community/config') return route.fulfill({ json: { enabled: false } });
    if (path === 'account/security-summary') return route.fulfill({ json: { method: null, passkeys: 0, recoveryCodesRemaining: 0 } });
    if (path === 'account/insights') return route.fulfill({ json: { statusCounts: {}, monthly: [], upcoming: [], pendingReviews: [] } });
    if (path === 'bookings') return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], providers: [] } });
  });
  return log;
}

test('profile shows the Trust & performance tab, "Not enough data", achievements and verified portfolio badge', async ({ page }) => {
  await mock(page, { anonymous: true });
  await page.goto('/professionals/ada-pro');
  await expect(page.getByRole('heading', { name: /Ada Pro/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Trust & performance' }).click();
  await expect(page.getByText('92%')).toBeVisible();
  await expect(page.getByText('Not enough data')).toBeVisible();
  await expect(page.getByText('10 Jobs Completed')).toBeVisible();
  await expect(page.getByText('Free today')).toBeVisible();
  await page.getByRole('tab', { name: 'Portfolio' }).click();
  await expect(page.getByText('Verified Servix Project')).toHaveCount(1);
});

test('compare: tick two professionals, tray appears, compare page highlights data and "Not enough data"', async ({ page }) => {
  await mock(page, { anonymous: true });
  await page.goto('/professionals');
  const toggles = page.getByRole('checkbox', { name: /Add .* to comparison/ });
  await expect(toggles).toHaveCount(2);
  await toggles.nth(0).check(); await toggles.nth(1).check();
  await expect(page.getByText('2 of 4 selected')).toBeVisible();
  await page.getByRole('link', { name: 'Compare', exact: true }).click();
  await expect(page).toHaveURL(/\/compare\?professionals=ada-pro,bisi-pro/);
  await expect(page.getByRole('heading', { name: 'Compare professionals' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Ada Pro/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Delivery reliability/ }).getByText('Not enough data')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Bisi Pro from comparison' }).click();
  await expect(page).toHaveURL(/professionals=ada-pro$/);
});

test('compare is hidden when the flag is off', async ({ page }) => {
  await mock(page, { anonymous: true, features: { ...features, compare: false } });
  await page.goto('/professionals');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /comparison/ })).toHaveCount(0);
  await page.goto('/compare?professionals=ada-pro');
  await expect(page.getByText('Comparison is not available yet')).toBeVisible();
});

test('customer: post a request (server field error → publish), review proposals side by side, accept one', async ({ page }) => {
  const log = await mock(page, { requests: [] });
  await page.goto('/dashboard/requests');
  await expect(page.getByRole('heading', { name: 'My requests' })).toBeVisible();
  await page.getByRole('link', { name: 'Post your first request' }).click();
  await page.getByLabel('Title').fill('Brand identity for a bakery');
  await page.getByLabel('Category').selectOption('design');
  await page.getByLabel('What do you need?').fill('short');
  await page.getByLabel('Budget (₦)').fill('80000');
  await page.getByRole('button', { name: 'Publish request' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at least 40 characters' })).toBeVisible();
  await page.getByLabel('What do you need?').fill(request.description);
  await page.getByRole('button', { name: 'Publish request' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/requests/${request.id}$`));
  expect(log.posts.some((p) => p.path === `requests/${request.id}/publish`)).toBe(true);
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proposals (2)' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bisi Pro/ })).toContainText('₦70,000');
  await page.getByRole('button', { name: 'Accept proposal' }).nth(1).click();
  await expect(page.getByText(/You are choosing Bisi Pro/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept and continue to payment' }).click();
  await expect(page).toHaveURL(/\/bookings\/bk-1$/);
  expect(log.posts.some((p) => p.path === `requests/${request.id}/proposals/p-2/accept`)).toBe(true);
});

test('professional: browse open requests and send a proposal (validation error shown inline)', async ({ page }) => {
  const log = await mock(page, { user: { role: 'professional' }, state: { kind: 'professional', canManageServices: true, plan: 'free' } });
  await page.goto('/dashboard/proposals');
  await expect(page.getByRole('heading', { name: 'Requests from customers' })).toBeVisible();
  await page.getByRole('link', { name: 'View & propose' }).click();
  await expect(page.getByRole('heading', { name: 'Send a proposal' })).toBeVisible();
  await page.getByLabel('Your approach').fill('Too short');
  await page.getByLabel('Total price (₦)').fill('85000');
  await page.getByLabel('Delivery (days)').fill('6');
  await page.getByRole('button', { name: 'Send proposal' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at least a short paragraph' })).toBeVisible();
  await page.getByLabel('Your approach').fill('I would start with discovery, then present three directions and finish a brand guide.');
  await page.getByLabel('Attach to one of your gigs (optional)').selectOption('logo');
  await page.getByRole('button', { name: 'Send proposal' }).click();
  const sent = log.posts.filter((p) => p.path === `requests/${request.id}/proposals`).at(-1);
  expect(sent.body).toMatchObject({ price: 85000, deliveryDays: 6, serviceSlug: 'logo' });
  await expect(page.getByText('Proposal sent.')).toBeVisible();
});

test('saved professionals: mark preferred and add a private note', async ({ page }) => {
  const log = await mock(page);
  await page.goto('/dashboard/saved');
  await page.getByRole('button', { name: 'Mark preferred' }).click();
  await expect(page.getByRole('button', { name: 'Preferred ✓' })).toBeVisible();
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel('Private note').fill('Great with bakeries');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('“Great with bakeries”')).toBeVisible();
  expect(log.patches.map((p) => p.body)).toEqual([{ preferred: true }, { note: 'Great with bakeries' }]);
});

test('admin: Requests & proposals and Trust & achievements tabs', async ({ page }) => {
  const log = await mock(page, { user: { role: 'admin' }, state: { kind: 'admin' } });
  await page.goto('/admin?tab=requests');
  await expect(page.getByRole('cell', { name: /Brand identity for a bakery/ })).toBeVisible();
  await page.getByRole('button', { name: 'Proposals' }).click();
  await expect(page.getByRole('cell', { name: /Ada Pro/ })).toBeVisible();
  await page.goto('/admin?tab=trust');
  await page.getByRole('button', { name: 'Ada Pro' }).click();
  await expect(page.getByText('11 on time · 1 late')).toBeVisible();
  await page.getByRole('button', { name: 'Recompute achievements' }).click();
  await expect(page.getByText('Recomputed: 1 earned, 0 revoked.')).toBeVisible();
  expect(log.posts.some((p) => p.path === 'admin/trust/ada-pro/recompute')).toBe(true);
});

test('mobile: request detail and compare page have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto(`/dashboard/requests/${request.id}`);
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto('/compare?professionals=ada-pro,bisi-pro');
  await expect(page.getByRole('heading', { name: 'Compare professionals' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

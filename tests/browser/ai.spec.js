import { test, expect } from '@playwright/test';
/* Servix AI UI with a mocked API: flag gating, smart search → filters, request brief → form, assistant chat,
   booking health, proposal draft, controlled error copy. No real model is called in these tests. */

const PNG = Buffer.from('iVBORw0KGgoAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const customer = { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' };
const overview = { kind: 'customer', intent: 'customer', needsChoice: false, emailVerified: true, applicationStatus: null, canManageServices: false, kycStatus: 'unverified' };
const features = { requests: true, compare: false, achievements: false, trust: false, projects: false, crm: false, packages: false, business: false, pricing: false, community: false, ai: true };
const aiMeta = { model: 'deepseek', fallbackUsed: false, durationMs: 1200, toolsUsed: [] };
const REQ = '11111111-1111-4111-8111-111111111111';
const BK = '22222222-2222-4222-8222-222222222222';
const request = { id: REQ, title: 'Brand identity for a bakery', category: { slug: 'design', name: 'Design' }, description: 'We need a logo, colour palette and simple brand guide for a new bakery in Lekki. Deliver as PDF and SVG.', budgetType: 'range', budgetMin: 50000, budgetMax: 120000, deadlineAt: null, preferredDeliveryAt: null, isRemote: true, location: null, requiredSkills: ['branding'], attachments: [], extraRequirements: null, status: 'open', proposalCount: 2, awardedProposalId: null, publishedAt: new Date().toISOString(), closedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), customer: { displayName: 'Test', memberSince: '2025-01' }, publishProblems: {} };
const pro = (id, name) => ({ id, name, title: 'Brand Designer', location: 'Lagos, Nigeria', rating: 4.9, reviewCount: 11, verified: true, availability: 'available', image: '/images/professionals/adaeze-okafor.jpg', startingPrice: 50000, completedProjects: 12, responseTime: 'Within 2 hours', memberSince: '2025', plan: 'free', bio: 'Designer.', skills: ['branding'], languages: ['English'], experience: [], education: [], certifications: [], categoryId: 'design', portfolio: [] });

async function mock(page, options = {}) {
  const log = { posts: [], professionalQueries: [] };
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    if (method === 'POST') log.posts.push({ path, body: route.request().postDataJSON?.() ?? null });
    if (path === 'features') return route.fulfill({ json: options.features ?? features });
    if (path === 'auth/refresh') return options.anonymous ? route.fulfill({ status: 401, json: { error: { status: 401, code: 'UNAUTHENTICATED', message: 'no' } } }) : route.fulfill({ json: { accessToken: 'ui-test-only', user: { ...customer, ...options.user } } });
    if (path === 'auth/me') return route.fulfill({ json: { user: { ...customer, ...options.user } } });
    if (path === 'account/overview') return route.fulfill({ json: { ...overview, ...options.state } });
    if (path === 'views') return route.fulfill({ status: 204, body: '' });
    if (path === 'categories') return route.fulfill({ json: [{ id: 'design', name: 'Design', description: '', serviceCount: 3, icon: 'pen' }] });
    if (path === 'professionals') { log.professionalQueries.push(Object.fromEntries(url.searchParams)); return route.fulfill({ json: { items: [pro('ada-pro', 'Ada Pro')], total: 1, page: 1, pageSize: 12 } }); }
    // ---- AI endpoints ----
    if (path.startsWith('ai/') && options.aiDown) return route.fulfill({ status: 503, json: { error: { status: 503, code: 'AI_UNAVAILABLE', message: 'upstream 429 model_concurrency from provider' } } });
    if (path === 'ai/search/intent') return route.fulfill({ json: { filters: { q: 'logo designer', category: 'design', location: 'Lagos', maxPrice: 30000, available: 'week', sort: 'recommended' }, ai: aiMeta } });
    if (path === 'ai/assistant') { const b = route.request().postDataJSON(); return route.fulfill({ json: { answer: `You asked: "${b.messages[b.messages.length - 1].content}". Ada Pro (ada-pro) is a verified brand designer in Lagos from ₦50,000.`, ai: { ...aiMeta, toolsUsed: ['search_professionals'] } } }); }
    if (path === 'ai/drafts') { const b = route.request().postDataJSON(); if (b.kind === 'request_brief') return route.fulfill({ json: { kind: 'request_brief', draft: { title: 'Restaurant website with menu and WhatsApp ordering', description: 'A mobile-first website for a restaurant in Ikeja with the full menu, opening hours and WhatsApp ordering. Five pages, basic SEO.', categorySlug: 'design', budgetType: 'range', budgetMin: 150000, budgetMax: 250000, deadlineAt: '2026-11-30T12:00:00.000Z', preferredDeliveryAt: null, isRemote: true, location: null, requiredSkills: ['web design', 'seo'], attachments: [], extraRequirements: null, missingInformation: ['Do you already have a logo and photos?'] }, ai: { ...aiMeta, model: 'minimax' } } }); return route.fulfill({ json: { kind: b.kind, draft: `Drafted (${b.tone}): ${b.input}`, ai: { ...aiMeta, model: 'minimax' } } }); }
    if (path === `ai/bookings/${BK}/health`) return route.fulfill({ json: { status: 'awaiting_payment', booking: { id: BK, reference: 'SVX-TEST', status: 'pending_payment', overdueDays: 0, expectedDeliveryAt: null }, summary: 'Your booking is reserved but not yet paid. Nothing starts until payment is confirmed.', nextSteps: ['Complete the secure checkout.'], concerns: [], ai: aiMeta } });
    if (path === 'ai/explain') return route.fulfill({ json: { answer: 'Pending payment means the booking is reserved but the professional cannot start until Servix confirms your payment.', ai: aiMeta } });
    if (path === 'ai/proposals/draft') return route.fulfill({ json: { draft: { requestId: REQ, serviceSlug: 'logo', price: 95000, deliveryDays: 6, cover: 'Hello! I would start with a short discovery call, then present three logo directions, refine your favourite and deliver a compact brand guide with all files in PDF and SVG.', milestones: [{ title: 'Concepts', amount: 40000, days: 3 }], attachments: [], proposedStartAt: null, flags: [] }, ai: { ...aiMeta, model: 'minimax' } } });
    if (path === 'ai/opportunities/match') return route.fulfill({ json: { summary: 'One strong match in your category.', matches: [{ requestId: REQ, fit: 88, why: 'Branding request in your category within your price range.', concerns: [], request: { id: REQ, title: request.title, categoryName: 'Design', budgetMin: 50000, budgetMax: 120000, deadlineAt: null, proposalCount: 2 } }], ai: aiMeta } });
    if (path === 'ai/opportunities/radar') return route.fulfill({ json: { headline: 'Design requests are up this week.', highlights: [], suggestedActions: ['Update your availability.'], ai: aiMeta } });
    if (path === 'ai/profile/analysis') return route.fulfill({ json: { completenessScore: 72, summary: 'Solid profile; portfolio is thin.', strengths: ['Verified'], gaps: ['Only one portfolio item'], ai: aiMeta } });
    if (path === 'ai/profile/improve') return route.fulfill({ json: { suggestions: [{ area: 'about', suggestion: 'Lead with outcomes.', example: 'I help bakeries look as good as they taste.' }], rewrittenAbout: 'I help small food businesses build brands customers remember.', ai: aiMeta } });
    if (path === 'ai/pricing/guidance') return route.fulfill({ json: { basis: 'servix_data', summary: 'Most design gigs on Servix sit between ₦40,000 and ₦120,000.', rangeLow: 40000, rangeHigh: 120000, tips: ['State revisions clearly.'], stats: { category: 'design', count: 9, insufficient: false, currency: 'NGN', min: 25000, p25: 40000, median: 60000, p75: 110000, max: 150000 }, ai: aiMeta } });
    // ---- the rest ----
    if (path === `requests/browse/${REQ}`) return route.fulfill({ json: { ...request, myProposal: null, myServices: [{ id: 'logo', title: 'Logo design' }] } });
    if (path === `bookings/${BK}`) return route.fulfill({ json: { id: BK, reference: 'SVX-TEST', status: 'pending_payment', amount: 70000, platformFee: 7000, serviceTitle: 'Logo design', professionalName: 'Ada Pro', professionalId: 'ada-pro', customerName: 'Test Member', scheduledAt: new Date().toISOString(), createdAt: new Date().toISOString(), notes: '', priceUnit: 'project', hasReview: false, events: [] } });
    if (path === 'requests' && method === 'GET') return route.fulfill({ json: { items: [] } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    if (path === 'account/notifications') return route.fulfill({ json: { unread: 0, before: null, items: [] } });
    if (path === 'account/insights') return route.fulfill({ json: { statusCounts: {}, monthly: [], upcoming: [], pendingReviews: [] } });
    if (path === 'pro/analytics' || path.startsWith('pro/analytics')) return route.fulfill({ json: { totals: { earnings: 0, bookings: 0, completed: 0, responseRate: null, medianResponseHours: null, ratingAvg: 0, reviewCount: 0 }, series: [] } });
    if (path === 'bookings' || path === 'pro/bookings') return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], providers: [] } });
  });
  return log;
}

test('everything AI is hidden when the flag is off', async ({ page }) => {
  await mock(page, { features: { ...features, ai: false } });
  await page.goto('/professionals');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('ai-smart-search')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  await expect(page.getByTestId('ai-launcher')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Servix AI' })).toHaveCount(0);
  await page.goto('/dashboard/ai');
  await expect(page.getByText('Coming soon')).toBeVisible();
});

test('smart search turns a sentence into validated directory filters (no account needed)', async ({ page }) => {
  const log = await mock(page, { anonymous: true });
  await page.goto('/professionals');
  const box = page.getByTestId('ai-smart-search');
  await box.getByLabel('Describe what you need').fill('logo designer in Lagos under 30k free this week');
  await box.getByRole('button', { name: 'Find' }).click();
  await expect(page).toHaveURL(/category=design/);
  await expect(page).toHaveURL(/location=Lagos/);
  await expect(page).toHaveURL(/price=150/);
  await expect(page).toHaveURL(/availability=week/);
  await expect(box.getByText('Up to ₦30,000')).toBeVisible();
  await expect(box.getByText('Design', { exact: true })).toBeVisible();
  const last = log.professionalQueries.at(-1);
  expect(last.category).toBe('design'); expect(last.location).toBe('Lagos'); expect(last.maxPrice).toBe('150000'); expect(last.available).toBe('week');
  expect(log.posts.find((p) => p.path === 'ai/search/intent').body).toEqual({ query: 'logo designer in Lagos under 30k free this week' });
});

test('request editor: brief → structured draft → form filled, nothing posted until the user saves', async ({ page }) => {
  const log = await mock(page);
  await page.goto('/dashboard/requests/new');
  const panel = page.getByTestId('ai-request-brief');
  await panel.getByLabel('Describe your request').fill('website for my restaurant in Ikeja with menu and whatsapp ordering, 150 to 250k, end of next month');
  await panel.getByRole('button', { name: 'Draft my request' }).click();
  await expect(panel.getByText('Do you already have a logo and photos?')).toBeVisible();
  await page.getByTestId('ai-request-fill').click();
  await expect(page.getByLabel('Title')).toHaveValue('Restaurant website with menu and WhatsApp ordering');
  await expect(page.getByLabel('Category')).toHaveValue('design');
  await expect(page.getByLabel('Budget type')).toHaveValue('range');
  await expect(page.getByLabel('Minimum (₦)')).toHaveValue('150000');
  await expect(page.getByLabel('Maximum (₦)')).toHaveValue('250000');
  await expect(page.getByLabel('Deadline (optional)')).toHaveValue('2026-11-30');
  expect(log.posts.filter((p) => p.path === 'requests')).toHaveLength(0);
});

test('assistant launcher opens a grounded chat; booking page explains status and health', async ({ page }) => {
  await mock(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('ai-dashboard-card')).toBeVisible();
  await page.getByTestId('ai-launcher').click();
  const chat = page.getByTestId('ai-panel');
  await chat.getByLabel('Your question').fill('Who can design a logo in Lagos?');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(/Ada Pro \(ada-pro\) is a verified brand designer/)).toBeVisible();
  await chat.getByRole('button', { name: 'Close assistant' }).click();
  await page.goto(`/bookings/${BK}`);
  await expect(page.getByRole('heading', { name: 'Logo design' })).toBeVisible();
  await page.getByTestId('ai-explain').click();
  await expect(page.getByText(/reserved but the professional cannot start/)).toBeVisible();
  await page.getByRole('button', { name: 'Explain this booking' }).click();
  await expect(page.getByTestId('ai-booking-health').getByText('Awaiting payment')).toBeVisible();
  await expect(page.getByText('Complete the secure checkout.')).toBeVisible();
});

test('professional: AI hub tabs, proposal draft fills the form and is not sent automatically', async ({ page }) => {
  const log = await mock(page, { user: { role: 'professional' }, state: { kind: 'professional', canManageServices: true, plan: 'free' } });
  await page.goto('/dashboard/ai');
  await page.getByRole('tab', { name: 'Opportunities' }).click();
  await page.getByRole('button', { name: 'Find my best matches' }).click();
  await expect(page.getByRole('link', { name: request.title })).toBeVisible();
  await expect(page.getByText('88% fit')).toBeVisible();
  await page.getByRole('tab', { name: 'Profile coach' }).click();
  await page.getByRole('button', { name: 'Analyse my profile' }).click();
  await expect(page.getByText('72')).toBeVisible();
  await page.getByRole('tab', { name: 'Pricing guide' }).click();
  await page.getByRole('button', { name: 'Get guidance' }).click();
  await expect(page.getByText('₦40,000 – ₦120,000')).toBeVisible();
  await page.goto(`/dashboard/proposals/requests/${REQ}`);
  await page.getByTestId('ai-proposal-open').click();
  await page.getByRole('button', { name: 'Write a draft' }).click();
  await expect(page.getByTestId('ai-proposal-cover')).toContainText('three logo directions');
  await page.getByTestId('ai-proposal-fill').click();
  await expect(page.getByLabel('Total price (₦)')).toHaveValue('95000');
  await expect(page.getByLabel('Delivery (days)')).toHaveValue('6');
  await expect(page.getByLabel('Attach to one of your gigs (optional)')).toHaveValue('logo');
  await expect(page.getByLabel('Milestones (optional, one per line: title | amount | days)')).toHaveValue('Concepts | 40000 | 3');
  expect(log.posts.filter((p) => p.path === `requests/${REQ}/proposals`)).toHaveLength(0);
});

test('provider outage shows calm copy with no provider details and the page keeps working', async ({ page }) => {
  await mock(page, { anonymous: true, aiDown: true });
  await page.goto('/professionals');
  const box = page.getByTestId('ai-smart-search');
  await box.getByLabel('Describe what you need').fill('photographer in Abuja');
  await box.getByRole('button', { name: 'Find' }).click();
  await expect(box.getByRole('alert')).toContainText('Servix AI is busy at the moment');
  await expect(box.getByRole('alert')).not.toContainText(/provider|429|model_concurrency/);
  await expect(page.getByText('1 professional found')).toBeVisible();
});

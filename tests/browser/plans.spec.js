import { test, expect } from '@playwright/test';
/* Plans, entitlements and AI usage UI with a mocked API: the Plan page, 75/90/100% AI warnings, plan-locked
   tools, proposal filter gating, the team workspace for members vs owners and the admin AI usage dashboard.
   The API is the source of truth in production; here we only check the UI explains boundaries honestly. */

const PNG = Buffer.from('iVBORw0KGgoAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const user = { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'professional', status: 'active' };
const overview = { kind: 'professional', intent: 'professional', needsChoice: false, emailVerified: true, applicationStatus: 'approved', canManageServices: true, kycStatus: 'verified', plan: 'free' };
const features = { requests: true, compare: false, achievements: false, trust: false, projects: false, crm: false, packages: false, business: false, pricing: false, community: false, ai: true };
const period = { start: '2026-10-01T00:00:00.000Z', resetAt: '2026-11-01T00:00:00.000Z' };
const meter = (used, allowed) => { const percent = Math.round((used / allowed) * 1000) / 10; return { metric: 'ai_tokens', used, reserved: 0, allowed, remaining: Math.max(0, allowed - used), percent, level: used >= allowed ? 'exhausted' : percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'ok', requests: 3, periodStart: period.start, resetAt: period.resetAt }; };
const L = (ai, listings, portfolio, proposals, active, requests, activeReq, saved, searches, versions, exportsN, members) => ({ monthly_ai_tokens: ai, listings, portfolio_items: portfolio, monthly_proposals: proposals, active_proposals: active, monthly_requests: requests, active_requests: activeReq, saved_professionals: saved, saved_searches: searches, profile_versions: versions, monthly_exports: exportsN, team_members: members });
const CAPS = { free: [], go: ['advanced_filters', 'proposal_organization', 'profile_versions', 'analytics_detailed'], pro: ['advanced_filters', 'proposal_organization', 'proposal_pipeline', 'profile_versions', 'analytics_detailed', 'analytics_advanced', 'profile_badge', 'priority_ai'], team: ['advanced_filters', 'proposal_organization', 'proposal_pipeline', 'profile_versions', 'analytics_detailed', 'analytics_advanced', 'profile_badge', 'priority_ai', 'team_workspace', 'team_analytics'], enterprise: ['advanced_filters', 'proposal_organization', 'proposal_pipeline', 'profile_versions', 'analytics_detailed', 'analytics_advanced', 'profile_badge', 'priority_ai', 'team_workspace', 'team_analytics', 'org_custom_limits', 'org_audit_log'] };
const BASE_AI = ['assistant', 'explanations', 'search_intent', 'project_health', 'pricing_guidance'];
const DEPTS = { free: BASE_AI, go: [...BASE_AI, 'background_drafting', 'profile_analysis', 'job_matching'], pro: [...BASE_AI, 'background_drafting', 'profile_analysis', 'job_matching', 'proposal_generation', 'profile_improvement', 'opportunity_radar'] };
DEPTS.team = DEPTS.pro; DEPTS.enterprise = DEPTS.pro;
const plans = [
  { slug: 'free', name: 'Free', tagline: 'Discover Servix.', price: 0, currency: 'NGN', period: 'forever', cta: 'Get started', features: ['Up to 2 service listings', '20,000 Servix AI tokens a month'], highlighted: false, limits: L(20000, 2, 6, 5, 3, 3, 2, 10, 2, 1, 1, 0), capabilities: CAPS.free, aiDepartments: DEPTS.free, purchasable: false, rank: 0 },
  { slug: 'go', name: 'Go', tagline: 'More capacity.', price: 5000, currency: 'NGN', period: 'per month', cta: 'Upgrade to Go', features: ['Up to 5 service listings', 'Advanced job filters'], highlighted: false, limits: L(100000, 5, 12, 25, 10, 10, 5, 50, 10, 3, 5, 0), capabilities: CAPS.go, aiDepartments: DEPTS.go, purchasable: true, rank: 1 },
  { slug: 'pro', name: 'Pro', tagline: 'For professionals who depend on Servix.', price: 15000, currency: 'NGN', period: 'per month', cta: 'Upgrade to Pro', features: ['Up to 15 service listings'], highlighted: true, limits: L(300000, 15, 20, 100, 30, 30, 15, 200, 30, 10, 25, 0), capabilities: CAPS.pro, aiDepartments: DEPTS.pro, purchasable: true, rank: 2 },
  { slug: 'team', name: 'Team', tagline: 'Agencies and small teams.', price: 35000, currency: 'NGN', period: 'per month', cta: 'Upgrade to Team', features: ['Team workspace for up to 5 members'], highlighted: false, limits: L(1000000, 30, 30, 300, 100, 100, 50, 500, 50, 25, 100, 5), capabilities: CAPS.team, aiDepartments: DEPTS.team, purchasable: true, rank: 3 },
  { slug: 'enterprise', name: 'Enterprise', tagline: 'Custom limits.', price: 0, currency: 'NGN', period: 'forever', cta: 'Contact Servix', features: ['Everything in Team'], highlighted: false, limits: L(3000000, null, null, null, null, null, null, null, null, null, null, 25), capabilities: CAPS.enterprise, aiDepartments: DEPTS.enterprise, purchasable: false, rank: 4 },
];
function entitlements(slug, { aiUsed = 0, organization = null, source = 'account' } = {}) {
  const p = plans.find((x) => x.slug === slug);
  return { current: slug, label: p.name, source, own: { plan: slug, label: p.name, expiresAt: slug === 'free' ? null : '2026-11-02T00:00:00.000Z', expired: false }, expiresAt: slug === 'free' ? null : '2026-11-02T00:00:00.000Z', expired: false, organization,
    features: p.capabilities, limits: p.limits, aiDepartments: p.aiDepartments,
    usage: { listings: 2, portfolio_items: 4, monthly_proposals: 1, active_proposals: 1, monthly_requests: 0, active_requests: 0, saved_professionals: 3, saved_searches: 0, profile_versions: 0, monthly_exports: 0, team_members: organization ? 2 : 0 },
    ai: { ...meter(aiUsed, p.limits.monthly_ai_tokens), member: null, subject: organization ? 'org' : 'user' }, period, plans, subscriptions: [] };
}

async function mock(page, options = {}) {
  const log = { posts: [], patches: [], gets: [] };
  const plan = options.plan ?? 'free';
  const ent = entitlements(plan, options);
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    if (method === 'POST') log.posts.push({ path, body: route.request().postDataJSON?.() ?? null });
    if (method === 'PATCH') log.patches.push({ path, body: route.request().postDataJSON?.() ?? null });
    if (method === 'GET') log.gets.push(path + url.search);
    if (path === 'features') return route.fulfill({ json: features });
    if (path === 'auth/refresh') return route.fulfill({ json: { accessToken: 'ui-test-only', user: { ...user, ...options.user } } });
    if (path === 'auth/me') return route.fulfill({ json: { user: { ...user, ...options.user } } });
    if (path === 'account/overview') return route.fulfill({ json: { ...overview, plan, ...options.state } });
    if (path === 'me/entitlements' || path === 'billing/plan') return route.fulfill({ json: ent });
    if (path === 'billing/downgrade') return route.fulfill({ json: { status: 'free', plan: entitlements('free') } });
    if (path === 'billing/checkout') return route.fulfill({ json: { authorizationUrl: 'http://127.0.0.1:5174/dashboard/plan?reference=sub-test', reference: 'sub-test' } });
    if (path === 'ai/usage') return route.fulfill({ json: { plan, planLabel: ent.label, departments: ent.aiDepartments, subject: ent.ai.subject, ...ent.ai, enabled: true } });
    if (path === 'ai/explain') {
      if (options.quotaExhausted) return route.fulfill({ status: 403, json: { error: { status: 403, code: 'AI_QUOTA_EXCEEDED', message: 'Your Servix AI allowance for this month is used up.', meta: { kind: 'ai_quota', plan, upgradeTo: 'go', upgradeToLabel: 'Go', used: 20000, allowed: 20000, resetAt: period.resetAt, scope: 'account' } } } });
      return route.fulfill({ json: { answer: 'Escrow holds the payment until delivery.', ai: { model: 'deepseek', fallbackUsed: false, durationMs: 900, toolsUsed: [], tokens: 1500, quota: meter(ent.ai.used + 1500, ent.ai.allowed) } } });
    }
    if (path === 'ai/assistant' || path === 'ai/assistant/stream') {
      if (options.quotaExhausted) return route.fulfill({ status: 403, json: { error: { status: 403, code: 'AI_QUOTA_EXCEEDED', message: 'Your Servix AI allowance for this month is used up.', meta: { kind: 'ai_quota', plan, upgradeTo: 'go', upgradeToLabel: 'Go', used: 20000, allowed: 20000, resetAt: period.resetAt, scope: 'account' } } } });
      return route.fulfill({ json: { answer: 'Payouts are released after delivery is approved.', ai: { model: 'deepseek', fallbackUsed: false, durationMs: 900, toolsUsed: [], tokens: 1500, quota: meter(ent.ai.used + 1500, ent.ai.allowed) } } });
    }
    if (path === 'admin/plans') return route.fulfill({ json: { catalog: { features: Object.fromEntries(CAPS.enterprise.map((k) => [k, { label: k.replaceAll('_', ' '), minPlan: 'go' }])), limits: Object.fromEntries(Object.keys(plans[0].limits).map((k) => [k, { label: k.replaceAll('_', ' '), unit: 'items' }])), departments: DEPTS.pro }, plans: plans.map((p) => ({ ...p, isActive: true, position: p.rank, defaults: { limits: p.limits, aiDepartments: p.aiDepartments }, overrides: {}, effective: { limits: p.limits, features: p.capabilities, aiDepartments: p.aiDepartments }, accounts: 3 })) } });
    if (path === 'admin/organizations') return route.fulfill({ json: { total: 1, page: 1, pageSize: 50, items: [{ id: 'org1', name: 'Studio Lagos', slug: 'studio-lagos', plan: 'team', planLabel: 'Team', planExpiresAt: '2026-11-02T00:00:00.000Z', active: true, members: 2, invited: 1, customLimits: {}, owner: { name: 'Owner Person', email: 'owner@example.test' }, aiTokensThisMonth: 120000, createdAt: period.start }] } });
    if (path === 'ai/explain/stream') return route.fulfill({ status: 404, json: { error: { status: 404, code: 'NOT_FOUND', message: 'no stream in test' } } });
    if (path === 'categories') return route.fulfill({ json: [{ id: 'design', name: 'Design', description: '', serviceCount: 3, icon: 'pen' }] });
    if (path === 'requests/browse') return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 12 } });
    if (path === 'account/saved-searches' && method === 'GET') return route.fulfill({ json: { limit: ent.limits.saved_searches, items: [{ id: 's1', kind: 'requests', name: 'Design in Lagos', params: { category: 'design' }, createdAt: period.start }] } });
    if (path === 'account/saved-searches' && method === 'POST') return options.savedSearchFull ? route.fulfill({ status: 403, json: { error: { status: 403, code: 'PLAN_LIMIT', message: 'You have reached the limit of 2 saved searches on the Free plan.', meta: { kind: 'limit', limit: 'saved_searches', plan: 'free', upgradeTo: 'go', upgradeToLabel: 'Go', used: 2, allowed: 2 } } } }) : route.fulfill({ json: { id: 's2', kind: 'requests', name: 'New', params: {}, createdAt: period.start } });
    if (path === 'proposals/mine') return route.fulfill({ json: { access: { organization: ent.features.includes('proposal_organization'), pipeline: ent.features.includes('proposal_pipeline') }, labels: ['Follow up'], items: [{ id: 'p1', status: 'submitted', price: 50000, deliveryDays: 5, createdAt: period.start, label: ent.features.includes('proposal_organization') ? 'Follow up' : null, privateNote: null, request: { id: 'r1', title: 'Logo for a bakery', status: 'open', category: { slug: 'design', name: 'Design' } } }] } });
    if (path.startsWith('proposals/') && path.endsWith('/organize')) return route.fulfill({ json: { id: 'p1', label: route.request().postDataJSON().label, privateNote: route.request().postDataJSON().privateNote } });
    if (path === 'team') {
      if (options.team === 'none') return route.fulfill({ json: { team: null, canCreate: ent.features.includes('team_workspace'), plan } });
      const admin = options.team === 'owner';
      return route.fulfill({ json: { team: { id: 'org1', name: 'Studio Lagos', slug: 'studio-lagos', createdAt: period.start, plan: 'team', planLabel: 'Team', planSource: 'organization', active: true }, me: { role: admin ? 'owner' : 'member', isAdmin: admin },
        members: [{ id: 'm1', role: 'owner', status: 'active', name: admin ? 'Test Member' : 'Owner Person', email: admin ? 'test@example.test' : undefined, userId: admin ? 'ui-user' : 'owner', invitedAt: period.start, joinedAt: period.start, professional: null }, { id: 'm2', role: 'member', status: 'active', name: admin ? 'Colleague' : 'Test Member', email: admin ? 'c@example.test' : undefined, userId: admin ? 'u2' : 'ui-user', invitedAt: period.start, joinedAt: period.start, professional: null, aiTokenCap: admin ? 50000 : undefined }, { id: 'm3', role: 'member', status: 'invited', name: 'pending', email: admin ? 'pending@example.test' : undefined, userId: null, invitedAt: period.start, joinedAt: null, professional: null }],
        limits: { members: 5, aiTokens: 1000000 }, ai: admin ? meter(120000, 1000000) : { ...meter(120000, 1000000), used: undefined, reserved: undefined }, myAi: meter(9000, admin ? null : 50000) } });
    }
    if (path === 'team/ai-usage') return route.fulfill({ json: { pool: meter(120000, 1000000), members: [{ memberId: 'm1', userId: 'ui-user', name: 'Test Member', role: 'owner', tokens: 100000, requests: 40, cap: null, capMeter: null }, { memberId: 'm2', userId: 'u2', name: 'Colleague', role: 'member', tokens: 20000, requests: 9, cap: 50000, capMeter: meter(20000, 50000) }], departments: [{ department: 'proposal_generation', tokens: 90000, requests: 30 }], daily: [{ date: '2026-10-01', tokens: 60000, requests: 20 }, { date: '2026-10-02', tokens: 60000, requests: 29 }] } });
    if (path === 'admin/ai/usage') return route.fulfill({ json: { range: {}, totals: { requests: 120, succeeded: 114, failed: 6, successRate: 95, tokens: 180000, promptTokens: 150000, completionTokens: 30000, tokensOnFailures: 2000, avgLatencyMs: 2400, avgLatencySuccessMs: 2300, fallbacks: 4, fallbackRate: 3.3 }, byPlan: [{ plan: 'pro', label: 'Pro', requests: 80, succeeded: 78, tokens: 120000, avgLatencyMs: 2000 }, { plan: 'free', label: 'Free', requests: 40, succeeded: 36, tokens: 60000, avgLatencyMs: 3000 }], byDepartment: [{ department: 'proposal_generation', requests: 50, succeeded: 48, tokens: 100000, avgLatencyMs: 4000 }], byModel: [{ alias: 'deepseek', model: 'deepseek-ai/DeepSeek-V4-Flash-0731', requests: 110, succeeded: 106, tokens: 170000, avgLatencyMs: 2200 }, { alias: 'glm', model: 'zai-org/GLM-5.3-Flash', requests: 10, succeeded: 8, tokens: 10000, avgLatencyMs: 5000 }], errors: [{ code: 'AI_UNAVAILABLE', count: 6 }], series: [{ date: '2026-10-01', requests: 60, succeeded: 58, failed: 2, tokens: 90000, avgLatencyMs: 2400, fallbacks: 2 }, { date: '2026-10-02', requests: 60, succeeded: 56, failed: 4, tokens: 90000, avgLatencyMs: 2400, fallbacks: 2 }], topUsers: [{ userId: 'u9', name: 'Heavy User', email: 'heavy@example.test', role: 'professional', plan: 'pro', requests: 70, tokens: 110000 }], topOrganizations: [{ organizationId: 'org1', name: 'Studio Lagos', requests: 30, tokens: 50000 }], filters: { plans: ['free', 'go', 'pro', 'team', 'enterprise'], departments: ['assistant', 'proposal_generation'] } } });
    if (path === 'admin/ai/usage/events') return route.fulfill({ json: { total: 1, page: 1, pageSize: 25, items: [{ id: 'e1', at: '2026-10-02T10:00:00.000Z', user: { name: 'Heavy User', email: 'heavy@example.test' }, organization: null, plan: 'pro', department: 'proposal_generation', alias: 'deepseek', model: 'deepseek-ai/DeepSeek-V4-Flash-0731', promptTokens: 1200, completionTokens: 300, totalTokens: 1500, ok: true, durationMs: 2100, fallbackUsed: false, attempts: 1, errorCode: null }] } });
    if (path === 'admin/stats') return route.fulfill({ json: { users: 0, professionals: 0, bookings: 0, revenue: 0, pendingApplications: 0, openDisputes: 0, pendingPayouts: 0 } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    if (path === 'account/notifications') return route.fulfill({ json: { unread: 0, before: null, items: [] } });
    if (path === 'bookings' || path === 'pro/bookings') return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], providers: [] } });
  });
  return log;
}

test('Plan page: every account sees its plan, meters, the five plans and an honest downgrade confirmation', async ({ page }) => {
  const log = await mock(page, { plan: 'pro', aiUsed: 240000 });
  await page.goto('/dashboard/plan');
  await expect(page.getByTestId('plan-current')).toHaveText('Pro');
  await expect(page.getByTestId('ai-meter')).toContainText('240,000 / 300,000 tokens used');
  await expect(page.getByTestId('ai-quota-warning')).toContainText('80%');
  for (const slug of ['free', 'go', 'pro', 'team', 'enterprise']) await expect(page.getByTestId(`plan-card-${slug}`)).toBeVisible();
  await expect(page.getByTestId('plan-card-pro')).toContainText('Your current plan');
  await expect(page.getByTestId('plan-card-enterprise').getByRole('link', { name: 'Contact Servix' })).toBeVisible();
  await page.getByTestId('plan-card-free').getByRole('button', { name: 'Move to Free' }).click();
  await expect(page.getByTestId('downgrade-confirm')).toContainText('Nothing is deleted');
  await page.getByTestId('downgrade-confirm-button').click();
  await expect(page.getByTestId('plan-current')).toHaveText('Free');
  expect(log.posts.find((p) => p.path === 'billing/downgrade')?.body).toEqual({ confirm: true });
});

test('Servix AI: usage meter, 100% stop with calm upgrade copy, and tools locked by plan stay visible but inert', async ({ page }) => {
  await mock(page, { plan: 'free', aiUsed: 20000, quotaExhausted: true });
  await page.goto('/dashboard/ai');
  await expect(page.getByTestId('ai-usage-card')).toContainText('20,000 / 20,000 tokens used');
  await expect(page.getByTestId('ai-quota-warning')).toContainText('used all 20,000 AI tokens');
  // Opportunities and the profile coach need Go — the tab is tagged and selecting it explains instead of calling the API.
  const opp = page.getByRole('tab', { name: /Opportunities/ });
  await expect(opp).toContainText('Go+');
  await opp.click();
  await expect(page.getByTestId('upgrade-notice').first()).toContainText('Go plan');
  await expect(page.getByTestId('ai-matches')).toHaveCount(0);
});

test('AI quota error in the assistant shows the upgrade card, not a provider error', async ({ page }) => {
  await mock(page, { plan: 'free', aiUsed: 20000, quotaExhausted: true, user: { role: 'customer' }, state: { kind: 'customer', canManageServices: false } });
  await page.goto('/dashboard/ai');
  await page.getByPlaceholder('Ask Servix AI…').fill('How do payouts work?');
  await page.getByPlaceholder('Ask Servix AI…').press('Enter');
  await expect(page.getByTestId('upgrade-notice').first()).toContainText('AI allowance for this month is used up');
  await expect(page.getByText(/provider|dahl|deepseek/i)).toHaveCount(0);
});

test('Open requests: advanced filters are tagged Go+ on Free and never sent; saved-search limit explains the plan', async ({ page }) => {
  const log = await mock(page, { plan: 'free', savedSearchFull: true });
  await page.goto('/dashboard/proposals');
  await expect(page.getByTestId('upgrade-notice').first()).toContainText('Advanced filters are included from the Go plan');
  await expect(page.getByTestId('filter-sort')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('filter-remote')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('filter-sort').selectOption('deadline', { force: true, timeout: 2000 }).catch(() => {});
  await expect(page.getByTestId('filter-sort')).toHaveValue('newest');
  expect(log.gets.filter((g) => g.startsWith('requests/browse') && g.includes('sort=deadline')).length).toBe(0);
  await page.getByLabel('Name this search').fill('Mine');
  // Save is disabled without active filters; set a free filter (category) first.
  await page.getByLabel('Category').selectOption('design');
  await page.getByRole('button', { name: 'Save current filters' }).click();
  await expect(page.getByTestId('saved-searches').getByTestId('upgrade-notice')).toContainText('reached the limit of 2 saved searches');
});

test('My proposals: labels and notes on Go, pipeline filters only on Pro', async ({ page }) => {
  const log = await mock(page, { plan: 'go' });
  await page.goto('/dashboard/proposals/mine');
  await expect(page.getByTestId('proposal-pipeline')).toContainText('Pipeline view is part of the Pro plan');
  await expect(page.getByRole('cell', { name: /Follow up/ })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Label' }).fill('Hot lead');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: /Hot lead/ })).toBeVisible();
  expect(log.patches[0]).toEqual({ path: 'proposals/p1/organize', body: { label: 'Hot lead', privateNote: null } });
});

test('Team workspace: members see the roster and pool but no admin controls; owners manage seats and AI caps', async ({ page }) => {
  await mock(page, { plan: 'team', team: 'member', organization: { id: 'org1', name: 'Studio Lagos', slug: 'studio-lagos', role: 'member', aiTokenCap: 50000 }, source: 'organization' });
  await page.goto('/dashboard/team');
  await expect(page.getByTestId('team-name')).toHaveText('Studio Lagos');
  await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'AI usage' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave team' })).toBeVisible();
  await expect(page.getByText('Only the team owner and admins can invite')).toBeVisible();
  await page.goto('/dashboard/plan');
  await expect(page.getByText('Shared by your team “Studio Lagos” (member)')).toBeVisible();
});

test('Team owner: invite form, pending seats, AI usage by member and personal caps', async ({ page }) => {
  const log = await mock(page, { plan: 'team', team: 'owner', organization: { id: 'org1', name: 'Studio Lagos', slug: 'studio-lagos', role: 'owner', aiTokenCap: null }, source: 'organization' });
  await page.goto('/dashboard/team');
  await expect(page.getByText('3 / 5 seats')).toBeVisible();
  await expect(page.getByTestId('team-member-invited')).toContainText('Cancel invite');
  await page.getByLabel('Email').fill('new@example.test');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  expect(log.posts.find((p) => p.path === 'team/invites')?.body).toEqual({ email: 'new@example.test', role: 'member' });
  await page.getByRole('tab', { name: 'AI usage' }).click();
  await expect(page.getByText('120,000 / 1,000,000 tokens used')).toBeVisible();
  await expect(page.getByRole('cell', { name: '20,000 / 50,000' })).toBeVisible();
});

test('Admin: AI usage dashboard aggregates by plan, tool and model with filters and no prompt content', async ({ page }) => {
  const log = await mock(page, { user: { role: 'admin' }, state: { kind: 'admin', canManageServices: false } });
  await page.goto('/admin?tab=ai');
  const tab = page.getByTestId('admin-ai-usage');
  await expect(tab).toContainText('120');
  await expect(tab).toContainText('95% success');
  await expect(tab).toContainText('Heavy User');
  await expect(tab).toContainText('Studio Lagos');
  await expect(tab).toContainText('AI_UNAVAILABLE');
  await page.getByLabel('Status').selectOption('failed');
  await expect.poll(() => log.gets.some((g) => g.startsWith('admin/ai/usage?') && g.includes('status=failed'))).toBe(true);
  await page.goto('/admin?tab=plans');
  await expect(page.getByTestId('admin-plan-editor')).toBeVisible();
  await expect(page.getByTestId('admin-grant-plan')).toBeVisible();
});

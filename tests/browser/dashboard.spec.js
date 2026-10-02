import { test, expect } from '@playwright/test';
const user = { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' };
const standard = { kind: 'customer', intent: 'customer', needsChoice: true, emailVerified: true, applicationStatus: null, canManageServices: false };
async function mock(page, options = {}) {
  let state = { ...standard, ...options.state };
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    if (path === 'auth/refresh') { options.refreshes = (options.refreshes ?? 0) + 1; return options.anonymous ? route.fulfill({ status: 401, json: {} }) : route.fulfill({ json: { accessToken: `ui-test-only-${options.refreshes}`, user: { ...user, ...options.user } } }); }
    if (options.expireAfterFirstToken && route.request().headers().authorization === 'Bearer ui-test-only-1') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', status: 401 } } });
    if (path === 'account/overview') return options.fail ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: state });
    if (path === 'account/onboarding') {
      const intent = route.request().postDataJSON().intent;
      state = { ...state, intent, kind: intent === 'professional' ? 'applicant' : 'customer', needsChoice: false };
      return route.fulfill({ json: state });
    }
    if (path === 'community/config') return route.fulfill({json:{enabled:!!options.community}});
    if (path === 'account/payments') return route.fulfill({json:{mode:'test',records:[]}});
    if (path === 'account/security-summary') return route.fulfill({json:{method:null,passkeys:0,recoveryCodesRemaining:0}});
    if (path === 'community/threads') return route.fulfill({json:[]});
    if (path === 'community/connections') return route.fulfill({json:[]});
    if (path === 'applications/me') return route.fulfill({ status: 404, json: {} });
    if (path === 'categories') return route.fulfill({ json: [] });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: options.unread ?? 0 } });
    if (path === 'account/notifications') return route.fulfill({ json: { unread: options.unread ?? 0, before: null, items: options.notifications ?? [] } });
    if (path === 'account/notifications/read') return route.fulfill({ json: { updated: 0, unread: 0 } });
    if (path === 'account/saved') return route.fulfill({ json: [] });
    if (path === 'account/insights') return route.fulfill({ json: { statusCounts: {}, monthly: [], upcoming: [], pendingReviews: [] } });
    if (path === 'pro/plan') return route.fulfill({ json: { current: options.plan ?? 'free', label: options.plan === 'professional' ? 'Servix Pro' : 'Free', expiresAt: null, expired: false, limits: { listings: 2, analytics: false, label: 'Free' }, usage: { listings: 0 }, plans: [], subscriptions: [] } });
    if (path === 'pro/analytics') return route.fulfill({ json: { days: 30, since: new Date().toISOString(), totals: { bookings: 0, completed: 0, cancelled: 0, earnings: 0, uniqueClients: 0, ratingAvg: 0, reviewCount: 0, completedProjects: 0, responseRate: null, medianResponseHours: null, activeServices: 0, totalServices: 0 }, series: [], byStatus: {}, topServices: [] } });
    if (path === 'pro/earnings') return route.fulfill({ json: { payable: 0, lifetimeEarnings: 0, payouts: [] } });
    if (path === 'pro/reviews') return route.fulfill({ json: [] });
    if (path === 'pro/availability') return route.fulfill({ json: { usingDefaults: true, rules: [], exceptions: [] } });
    if (path.startsWith('admin/')) return route.fulfill({ json: options.admin?.[path] ?? { items: [], pending: [], recent: [], totals: {}, series: [] } });
    if (['bookings','pro/bookings'].includes(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], providers: [] } });
  });
}
test('verified new social user chooses booking once and sees real empty dashboard', async ({page}) => {
  await mock(page); await page.goto('/dashboard');
  await expect(page.getByRole('dialog', { name: 'How would you like to use Servix?' })).toBeVisible();
  await page.getByRole('radio', { name: /Book services/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome back, Test.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first booking starts here.' })).toBeVisible();
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/dashboard.png`, fullPage: true, animations: "disabled" });
  await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('professional choice goes to application, not an approved workspace', async ({page}) => {
  await mock(page); await page.goto('/dashboard');
  await page.getByRole('radio', { name: /Apply as a professional/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/professionals\/apply$/);
  await expect(page.getByRole('heading', { name: 'Apply to join Servix' })).toBeVisible();
});
test('admin and approved professional dashboards have their own destination and no popup', async ({page}) => {
  await mock(page, { state: { kind:'admin', needsChoice:false }, user: { role:'admin' } });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Admin Console' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Verification', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Send notification', exact: true })).toBeVisible();
});
test('approved professional gets workspace destination', async ({page}) => {
  await mock(page, { state: { kind:'professional', needsChoice:false, canManageServices:true }, user: { role:'professional' } });
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name:'Open professional workspace', exact:true })).toHaveAttribute('href','/pro');
});
test('dashboard requires a session and handles API failures honestly', async ({page}) => {
  await mock(page, { anonymous:true }); await page.goto('/dashboard'); await expect(page).toHaveURL(/\/login$/);
});
test('dashboard offers retry instead of fabricated data', async ({page}) => {
  await mock(page, { fail:true }); await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('couldn’t load'); await expect(page.getByRole('button', {name:'Try again'})).toBeVisible();
});
test('dashboard and welcome popup fit mobile with keyboard-accessible choices', async ({page}) => {
  await mock(page);await page.setViewportSize({width:375,height:812});await page.goto('/dashboard');
  await expect(page.getByRole('dialog')).toBeVisible();
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/welcome-mobile.png`, fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Close dialog'}).click();
  await expect(page.getByRole('button',{name:'Choose my path'})).toBeVisible();
});

for (const [path,title] of [['payments','Payments'],['settings','Account settings'],['verification','Verification & security']]) {
 test(`workspace ${path} renders without mobile overflow`,async({page})=>{
  await mock(page,{state:{needsChoice:false}});await page.setViewportSize({width:375,height:812});await page.goto(`/dashboard/${path}`);
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(path==='payments')await expect(page.getByRole('heading',{name:'No payment records here yet'})).toBeVisible();
  if(path==='settings')await expect(page.getByLabel('Email address')).toHaveAttribute('readonly','');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('link',{name:'My network',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 });
}
for(const path of ['messages','network'])test(`${path} is honest when disabled and empty when enabled`,async({page})=>{
 await mock(page,{state:{needsChoice:false}});await page.goto(`/dashboard/${path}`);await expect(page.getByRole('heading',{name:'Community tools are not enabled yet'})).toBeVisible();
 await page.unroute('**/*');await mock(page,{state:{needsChoice:false},community:true});await page.reload();await expect(page.getByRole('heading',{name:path==='messages'?'A little conversation goes a long way':'Make your first connection'})).toBeVisible();
 if(process.env.DASHBOARD_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.DASHBOARD_SCREENSHOT_DIR}/${path}.png`,fullPage:true,animations:'disabled'});
});

test('approved professional on the free plan sees an upgrade link instead of the apply tab', async ({page}) => {
  await mock(page, { state: { kind:'professional', needsChoice:false, canManageServices:true, plan:'free' }, user: { role:'professional' } });
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Upgrade to Servix Pro', exact: true })).toHaveAttribute('href', '/dashboard/plan');
  await expect(page.getByRole('link', { name: 'Become a professional', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Analytics', exact: true })).toBeVisible();
});
test('professional already on Servix Pro sees the plan tab, not an upgrade prompt', async ({page}) => {
  await mock(page, { state: { kind:'professional', needsChoice:false, canManageServices:true, plan:'professional' }, user: { role:'professional' }, plan: 'professional' });
  await page.goto('/dashboard/plan');
  await expect(page.getByRole('link', { name: 'Servix Pro plan', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upgrade to Servix Pro', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Servix Pro plan' })).toBeVisible();
});
test('notification bell shows the unread count and opens the inbox', async ({page}) => {
  const notifications = [{ id: 'n1', type: 'admin.broadcast', title: 'Servix maintenance tonight', body: 'Payments pause from 23:00 for 10 minutes.', link: '/dashboard', readAt: null, createdAt: new Date().toISOString() }];
  await mock(page, { state: { needsChoice:false }, unread: 1, notifications });
  await page.goto('/dashboard');
  const bell = page.getByRole('button', { name: /Notifications, 1 unread/ });
  await expect(bell).toBeVisible(); await bell.click();
  await expect(page.getByText('Servix maintenance tonight')).toBeVisible();
  await page.getByRole('link', { name: /View all notifications/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
});
test('customer sees saved professionals and empty notifications honestly', async ({page}) => {
  await mock(page, { state: { needsChoice:false } });
  await page.goto('/dashboard/saved'); await expect(page.getByRole('heading', { name: 'No saved professionals yet' })).toBeVisible();
  await page.goto('/dashboard/notifications'); await expect(page.getByRole('heading', { name: 'No notifications yet' })).toBeVisible();
});

test('an expired access token is renewed silently and the page recovers without a reload', async ({page}) => {
  // Every call made with the first token is rejected as expired; the app must refresh and retry, not show an error.
  const options = { state: { needsChoice:false }, expireAfterFirstToken: true };
  await mock(page, options);
  await page.goto('/dashboard/saved');
  await expect(page.getByRole('heading', { name: 'No saved professionals yet' })).toBeVisible();
  await expect(page.getByText('Invalid or expired token')).toHaveCount(0);
  expect(options.refreshes).toBeGreaterThanOrEqual(2);
});
test('a rejected session renewal returns the user to sign-in instead of an error wall', async ({page}) => {
  const options = { state: { needsChoice:false } };
  await mock(page, options);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome back, Test.' })).toBeVisible();
  // From now on the API treats the session as gone: tokens fail and the refresh cookie is rejected.
  await page.unroute('**/*');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', status: 401 } } });
  });
  await page.getByRole('link', { name: 'Saved professionals', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

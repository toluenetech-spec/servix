// Every data-driven page must show a shaped skeleton (not plain "Loading…" text)
// while its API calls are in flight. API responses are deliberately held open so
// each page is captured mid-load.
import { test, expect } from '@playwright/test';

const user = { id: 'u1', email: 'pro@servix.test', fullName: 'Adaeze Okafor', role: 'professional', status: 'active', emailVerifiedAt: '2026-09-01T00:00:00.000Z', avatarUrl: null };
const overview = { kind: 'professional', intent: 'professional', needsChoice: false, emailVerified: true, canManageServices: true, plan: 'free', professionalStatus: 'approved' };

/** Resolve auth + overview immediately (so the shell renders) but never answer anything else. */
async function holdEverythingElse(page, { role = 'professional', resolve = [] } = {}) {
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  const pending = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const me = { ...user, role, ...(role === 'customer' ? {} : {}) };
    if (path === 'auth/refresh') return route.fulfill({ json: { accessToken: 'ui-test-only', user: me } });
    if (path === 'me') return route.fulfill({ json: { user: me } });
    if (path === 'account/overview') return route.fulfill({ json: { ...overview, kind: role === 'admin' ? 'admin' : role === 'customer' ? 'customer' : 'professional', canManageServices: role === 'professional' } });
    if (path === 'community/config') return route.fulfill({ json: { enabled: true } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    if (path === 'auth/oauth/config') return route.fulfill({ json: { providers: ['google', 'github'], enabled: true } });
    if (resolve.includes(path)) return route.fulfill({ json: [] });
    pending.push(route); // hold forever
  });
  return pending;
}

async function expectSkeleton(page, name) {
  // Wait until the page's own code has loaded (the route fallback is gone)…
  await expect(page.locator('.route-fallback')).toHaveCount(0);
  // …then the page itself must be showing shaped skeleton blocks.
  await expect(page.locator('.skeleton').first()).toBeVisible();
  // Plain "Loading…" sentences may exist only as visually-hidden screen-reader labels.
  await expect(page.getByText(/^(Loading|Searching|Checking)[^.]*…$/).and(page.locator(':not(.sr-only)'))).toHaveCount(0);
  if (process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DASHBOARD_SCREENSHOT_DIR}/skeleton-${name}.png`, fullPage: true });
}

const proPages = [
  ['dashboard', '/dashboard'],
  ['client-bookings', '/dashboard/work'],
  ['gigs', '/dashboard/gigs'],
  ['availability', '/dashboard/availability'],
  ['analytics', '/dashboard/analytics'],
  ['reviews', '/dashboard/reviews'],
  ['earnings', '/dashboard/earnings'],
  ['plan', '/dashboard/plan'],
  ['messages', '/dashboard/messages'],
  ['network', '/dashboard/network'],
  ['notifications', '/dashboard/notifications'],
  ['payments', '/dashboard/payments'],
  ['saved', '/dashboard/saved'],
  ['search', '/dashboard/search?q=design'],
  ['verification', '/dashboard/verification'],
  ['my-bookings', '/bookings'],
  ['booking-detail', '/bookings/b1'],
  ['gig-editor', '/dashboard/gigs/g1/edit'],
];

for (const [name, path] of proPages) {
  test(`professional ${name} page shows a skeleton while loading`, async ({ page }) => {
    await holdEverythingElse(page);
    await page.goto(path);
    await expectSkeleton(page, `pro-${name}`);
  });
}

test('customer apply page shows a skeleton while the draft loads', async ({ page }) => {
  await holdEverythingElse(page, { role: 'customer' });
  await page.goto('/professionals/apply');
  await expectSkeleton(page, 'apply');
});

test('admin console tabs show skeletons while loading', async ({ page }) => {
  await holdEverythingElse(page, { role: 'admin' });
  for (const tab of ['overview', 'analytics', 'applications', 'users', 'services', 'bookings', 'payouts', 'subscriptions', 'notifications', 'audit']) {
    await page.goto(`/admin?tab=${tab}`);
    await expectSkeleton(page, `admin-${tab}`);
  }
});

test('public service page shows skeletons for the page and the availability slots', async ({ page }) => {
  await holdEverythingElse(page, { role: 'customer' });
  await page.goto('/services/some-service');
  await expectSkeleton(page, 'service-detail');
});

test('public listing pages show card skeletons', async ({ page }) => {
  await holdEverythingElse(page, { role: 'customer' });
  for (const [name, path] of [['services', '/services'], ['professionals', '/professionals'], ['professional-profile', '/professionals/ada'], ['pricing', '/pricing'], ['home', '/']]) {
    await page.goto(path);
    await expectSkeleton(page, name);
  }
});

test('reset-password page shows a skeleton while the policy loads', async ({ page }) => {
  await holdEverythingElse(page, { role: 'customer' });
  await page.goto('/reset-password?token=abc');
  await expectSkeleton(page, 'reset-password');
});

import { test, expect } from '@playwright/test';

/* Phone-width regressions: nothing may be wider than the screen (Android
 * Chrome zooms the whole page out when it is, so the header and footer look
 * cut short), and camera photos must be shrunk before upload. */

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const user = { id: 'u1', fullName: 'Toluwalase Olawumi', email: 'tolu@example.test', role: 'professional', status: 'active', emailVerifiedAt: '2026-09-01T00:00:00Z', avatarUrl: null };
const pro = {
  id: 'toluwalase-olawumi', name: 'Toluwalase Olawumi', title: 'Full Stack Developer', location: 'Lagos, Nigeria', categoryId: 'web-development',
  rating: 0, reviewCount: 0, startingPrice: null, verified: false, completedProjects: 0, responseTime: '', memberSince: '2026', availability: 'available', image: null, plan: 'professional',
  about: 'I create more works and more reliable', skills: ['Backend', 'Frontend', 'JS', 'CSS3', 'HTML5', 'Typescript', 'Averyveryverylongunbreakableskillnamethatshouldwrap'], serviceIds: [], portfolio: [],
  details: { occupation: '', website: 'https://toluenetech.name.ng/a-very-long-path-that-must-not-widen-the-page/even-more', languages: [{ name: 'English', level: 'Fluent' }], education: [], certifications: [], experience: [{ title: 'Lead Developer', company: 'Brightline', start: '2021', end: 'Present', description: 'Shipped things.' }] },
};

async function mock(page) {
  const db = { uploads: [] };
  page.db = db;
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'cdn.servix.test') return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    if (path === 'auth/refresh') return route.fulfill({ json: { accessToken: 't', user } });
    if (path === 'me') return route.fulfill({ json: { user } });
    if (path === 'uploads' && req.method() === 'POST') {
      const body = req.postDataBuffer();
      db.uploads.push({ kind: url.searchParams.get('kind'), fileName: url.searchParams.get('fileName'), contentType: req.headers()['content-type'], size: body.length, magic: body.subarray(0, 3).toString('hex'), base64: body.toString('base64') });
      return route.fulfill({ status: 201, json: { url: `https://cdn.servix.test/${db.uploads.length}.jpg`, key: 'k', kind: url.searchParams.get('kind'), fileName: 'x', contentType: 'image/jpeg', size: body.length } });
    }
    if (path === 'account/profile' && req.method() === 'PATCH') { Object.assign(user, req.postDataJSON()); return route.fulfill({ json: { user } }); }
    if (path === `professionals/${pro.id}`) return route.fulfill({ json: pro });
    if (path.startsWith(`professionals/${pro.id}/`)) return route.fulfill({ json: { items: [], total: 0 } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    return route.fulfill({ json: { items: [], total: 0, providers: [], services: [] } });
  });
}

async function widestOverflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders = [];
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1 && !clipped(el)) offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}:${Math.round(r.right - w)}px`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, width: w, offenders: offenders.slice(0, 8) };
  });
}

test.describe('360px phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test('navbar shows only the avatar for a signed-in user and nothing overflows the public profile page', async ({ page }) => {
    await mock(page);
    await page.goto(`/professionals/${pro.id}`);
    await expect(page.getByRole('heading', { name: 'Toluwalase Olawumi' })).toBeVisible();
    // The first name is hidden on phones; the avatar/initial remains as a link to settings.
    await expect(page.locator('.navbar__user-name')).toBeHidden();
    await expect(page.locator('.navbar__user')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    const result = await widestOverflow(page);
    expect(result, JSON.stringify(result)).toMatchObject({ scrollWidth: 360, offenders: [] });
    // Opening the menu does not widen the page either.
    await page.getByRole('button', { name: 'Open menu' }).click();
    expect((await widestOverflow(page)).scrollWidth).toBe(360);
  });

  test('home, services and dashboard pages fit the screen', async ({ page }) => {
    await mock(page);
    for (const path of ['/', '/services', '/professionals', '/dashboard/profile', '/dashboard/settings']) {
      await page.goto(path);
      await page.waitForTimeout(500);
      const result = await widestOverflow(page);
      expect(result, `${path} ${JSON.stringify(result)}`).toMatchObject({ scrollWidth: 360, offenders: [] });
    }
  });
});

test('large phone photos are shrunk to a JPEG before upload', async ({ page }) => {
  await mock(page);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Profile photo' })).toBeVisible();
  // Build a 3000×2000 PNG in the browser (solid colour: small file, big pixels).
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#2b7a4b'; ctx.fillRect(0, 0, 3000, 2000);
    return c.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  const input = page.getByLabel('Profile photo file');
  await expect(input).toHaveAttribute('accept', 'image/*');
  await input.setInputFiles({ name: 'IMG_20261002.png', mimeType: 'image/png', buffer });
  await expect(page.getByText('Your photo has been saved.')).toBeVisible();
  expect(page.db.uploads).toHaveLength(1);
  const up = page.db.uploads[0];
  expect(up).toMatchObject({ kind: 'avatar', contentType: 'image/jpeg', fileName: 'IMG_20261002.jpg' });
  expect(up.magic.startsWith('ffd8')).toBe(true); // JPEG magic bytes
  // Decode what was uploaded and confirm the longest edge is now 1280px.
  const dims = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    return [bmp.width, bmp.height];
  }, up.base64);
  expect(dims).toEqual([1280, 853]);
  await expect(page.locator('img.ws-avatar--photo').first()).toHaveAttribute('src', 'https://cdn.servix.test/1.jpg');
});

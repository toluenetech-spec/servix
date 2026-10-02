import { test, expect } from '@playwright/test';
/* Identity verification (KYC): user submission form, dashboard banner/badge and the admin split-screen review. API is mocked; files are tiny real PNG/PDF bytes. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%fake\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
const user = { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' };
const overview = { kind: 'customer', intent: 'customer', needsChoice: false, emailVerified: true, applicationStatus: null, canManageServices: false, kycStatus: 'unverified' };
const notSubmitted = { status: 'not_submitted', kycStatus: 'unverified', documentType: null, rejectionReason: null, submittedAt: null, canSubmit: true };

async function mock(page, options = {}) {
  const log = { uploads: [], submits: [], reviews: [] };
  let kyc = options.kyc ?? notSubmitted;
  let state = { ...overview, ...options.state, kycStatus: kyc.kycStatus };
  const role = options.user?.role ?? 'customer';
  await page.addInitScript(() => localStorage.setItem('servix_cookie_preferences', JSON.stringify({ version: '2026-09-28', optional: false, savedAt: Date.now() })));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    if (path === 'auth/refresh') return route.fulfill({ json: { accessToken: 'ui-test-only', user: { ...user, ...options.user, kycStatus: kyc.kycStatus } } });
    if (path === 'auth/me') return route.fulfill({ json: { user: { ...user, ...options.user, kycStatus: kyc.kycStatus } } });
    if (path === 'account/overview') return route.fulfill({ json: state });
    if (path === 'kyc/status') return route.fulfill({ json: kyc });
    if (path === 'kyc/upload') {
      const part = url.searchParams.get('part');
      log.uploads.push({ part, documentType: url.searchParams.get('documentType'), contentType: route.request().headers()['content-type'], bytes: route.request().postDataBuffer()?.length ?? 0 });
      if (options.rejectUpload) return route.fulfill({ status: 422, json: { error: { status: 422, code: 'UNSUPPORTED_FILE', message: 'Only JPEG or PNG images are accepted.' } } });
      return route.fulfill({ status: 201, json: { fileKey: `kyc/ui-user/${part}-00000000-0000-4000-8000-000000000001.png`, part } });
    }
    if (path === 'kyc/submit' && method === 'POST') {
      log.submits.push(route.request().postDataJSON());
      kyc = { status: 'pending', kycStatus: 'pending', documentType: log.submits[0].documentType, documentTypeLabel: 'NIN slip', rejectionReason: null, submittedAt: new Date().toISOString(), canSubmit: false };
      state = { ...state, kycStatus: 'pending' };
      return route.fulfill({ status: 201, json: kyc });
    }
    if (path.startsWith('admin/kyc/') && path.endsWith('/review')) { log.reviews.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'case-1', status: log.reviews.at(-1).action === 'approve' ? 'approved' : 'rejected', userKycStatus: 'verified' } }); }
    if (path === 'admin/kyc/pending') return route.fulfill({ json: options.queue ?? { items: [], total: 0, page: 1, pageSize: 20, counts: {}, reasons: [] } });
    if (path.startsWith('admin/kyc/')) return route.fulfill({ json: options.kycCase });
    if (path === 'kyc/files/document.png' || path === 'kyc/files/selfie.png') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path.startsWith('admin/')) return route.fulfill({ json: { items: [], pending: [], recent: [], totals: {}, series: [] } });
    if (path === 'account/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    if (path === 'account/notifications') return route.fulfill({ json: { unread: 0, before: null, items: [] } });
    if (path === 'community/config') return route.fulfill({ json: { enabled: false } });
    if (path === 'account/security-summary') return route.fulfill({ json: { method: null, passkeys: 0, recoveryCodesRemaining: 0 } });
    if (path === 'categories') return route.fulfill({ json: [] });
    if (path === 'account/insights') return route.fulfill({ json: { statusCounts: {}, monthly: [], upcoming: [], pendingReviews: [] } });
    if (path === 'account/saved' || path === 'bookings') return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], providers: [] } });
  });
  return log;
}

test('submission form: consent gates submit, files are sniffed, PDF only for NIN slip, then the pending banner shows', async ({ page }) => {
  const log = await mock(page);
  await page.goto('/dashboard/identity');
  await expect(page.getByRole('heading', { name: 'Identity verification' })).toBeVisible();
  await expect(page.getByText('Hold a paper with today’s date and your full name clearly visible.')).toBeVisible();
  await expect(page.getByText('I confirm these documents are mine and consent to identity processing under NDPA regulations.')).toBeVisible();
  const submit = page.getByTestId('kyc-submit');
  await expect(submit).toBeDisabled();
  // A renamed text file is refused in the browser before any upload happens.
  await page.getByTestId('kyc-document-input').setInputFiles({ name: 'id.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') });
  await expect(page.getByTestId('kyc-document').getByRole('alert')).toContainText('Only JPEG or PNG');
  expect(log.uploads).toHaveLength(0);
  // PDF is refused for a passport, accepted for an NIN slip.
  await page.getByTestId('kyc-document-type').selectOption('international_passport');
  await page.getByTestId('kyc-document-input').setInputFiles({ name: 'passport.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('kyc-document').getByRole('alert')).toContainText('PDF is only accepted for an NIN slip');
  await page.getByTestId('kyc-document-type').selectOption('nin_slip');
  await page.getByTestId('kyc-document-input').setInputFiles({ name: 'nin.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('kyc-document')).toContainText('Uploaded securely');
  expect(log.uploads.at(-1)).toMatchObject({ part: 'document', documentType: 'nin_slip', contentType: 'application/pdf' });
  await page.getByTestId('kyc-selfie-input').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('kyc-selfie')).toContainText('Uploaded securely');
  expect(log.uploads.at(-1)).toMatchObject({ part: 'selfie', contentType: 'image/png' });
  await page.getByTestId('kyc-id-number').fill('12345678901');
  await expect(submit).toBeDisabled(); // consent still unchecked
  await page.getByTestId('kyc-consent').check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Your identity verification is under review.')).toBeVisible();
  await expect(page.getByText('This usually takes 12–24 hours.')).toBeVisible();
  expect(log.submits[0]).toMatchObject({ documentType: 'nin_slip', idNumber: '12345678901', consentGiven: true, documentFileKey: /^kyc\/ui-user\/document-/, selfieFileKey: /^kyc\/ui-user\/selfie-/ });
  // Banner on other workspace pages while pending; not on the identity page itself.
  await page.goto('/dashboard/settings');
  await expect(page.getByTestId('kyc-banner')).toContainText('Your identity verification is under review. This usually takes 12–24 hours.');
  await expect(page.getByRole('link', { name: 'Identity verification' })).toBeVisible();
});

test('rejected: reason + re-submit link; verified: green badge and no form', async ({ page }) => {
  await mock(page, { kyc: { status: 'rejected', kycStatus: 'rejected', documentType: 'nin_slip', documentTypeLabel: 'NIN slip', rejectionReason: 'Document blurry', submittedAt: new Date().toISOString(), canSubmit: true } });
  await page.goto('/dashboard/settings');
  const banner = page.getByTestId('kyc-banner');
  await expect(banner).toContainText('Verification failed.');
  await banner.getByRole('link', { name: 'Click here to re-submit.' }).click();
  await expect(page).toHaveURL(/\/dashboard\/identity$/);
  await expect(page.getByRole('alert').filter({ hasText: 'Verification failed: Document blurry' })).toBeVisible();
  await expect(page.getByTestId('kyc-form')).toBeVisible();
  await expect(page.getByTestId('kyc-banner')).toHaveCount(0);
});

test('verified user sees the green badge and a verified card', async ({ page }) => {
  await mock(page, { kyc: { status: 'approved', kycStatus: 'verified', documentType: 'nin_slip', documentTypeLabel: 'NIN slip', rejectionReason: null, submittedAt: new Date().toISOString(), reviewedAt: new Date().toISOString(), canSubmit: false } });
  await page.goto('/dashboard/identity');
  await expect(page.getByTestId('kyc-verified-badge')).toContainText('Identity verified');
  await expect(page.getByRole('heading', { name: "You're verified." })).toBeVisible();
  await expect(page.getByTestId('kyc-form')).toHaveCount(0);
  await expect(page.getByTestId('kyc-banner')).toHaveCount(0);
});

test('admin: queue → split-screen review with signed files, approve and reject with standard reasons', async ({ page }) => {
  const item = { id: 'case-1', status: 'pending', user: { id: 'u-2', fullName: 'Tunde Bakare', email: 'tunde@example.test', role: 'professional' }, documentType: 'drivers_license', documentTypeLabel: "Driver's licence", idNumber: 'ABC123456XY', idNumberMasked: '••••••56XY', submittedAt: new Date().toISOString(), firstSubmittedAt: new Date().toISOString(), reviewedAt: null, rejectionReason: null };
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const kycCase = { ...item, dateOfBirth: '1990-05-14', phone: '+2348012345678', consentAt: new Date().toISOString(), reviewedBy: null, user: { ...item.user, status: 'active', kycStatus: 'pending', emailVerified: true, memberSince: new Date().toISOString(), professional: { title: 'Developer', location: 'Ibadan', slug: 'tunde' } }, files: { document: { url: 'http://127.0.0.1:5174/api/v1/kyc/files/document.png?t=signed', contentType: 'image/*' }, selfie: { url: 'http://127.0.0.1:5174/api/v1/kyc/files/selfie.png?t=signed', contentType: 'image/*' }, expiresAt }, reasons: ['Document blurry', 'Name mismatch', 'Selfie does not match ID', 'Expired document'] };
  const log = await mock(page, { user: { role: 'admin', fullName: 'Servix Admin' }, state: { kind: 'admin' }, queue: { items: [item], total: 1, page: 1, pageSize: 20, counts: { pending: 1 }, reasons: kycCase.reasons }, kycCase });
  await page.goto('/admin?tab=identity');
  const queue = page.getByTestId('kyc-queue');
  await expect(queue).toContainText('Tunde Bakare');
  await expect(queue).toContainText('tunde@example.test');
  await expect(queue).toContainText("Driver's licence");
  await expect(queue).toContainText('ABC123456XY');
  await queue.getByRole('button', { name: 'Review' }).click();
  const view = page.getByTestId('kyc-case');
  await expect(view.getByTestId('kyc-id-number')).toHaveText('ABC123456XY');
  await expect(view.getByRole('region', { name: 'Profile details' })).toContainText('Developer');
  await expect(view.getByRole('img', { name: 'Identity document' })).toBeVisible();
  await expect(view.getByRole('img', { name: 'Selfie holding dated paper' })).toBeVisible();
  await expect(page.getByTestId('kyc-link-expiry')).toContainText(/expire in 19:/);
  // Zoom controls work on the document viewer.
  const docRegion = view.getByRole('region', { name: 'Identity document' });
  await docRegion.getByRole('button', { name: 'Zoom in' }).click();
  await expect(docRegion).toContainText('150%');
  // Reject needs a reason chosen from the standard list.
  await page.getByTestId('kyc-reject').click();
  const dialog = page.getByRole('dialog', { name: 'Reject verification' });
  for (const r of kycCase.reasons) await expect(dialog.getByRole('radio', { name: r })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Selfie does not match ID' }).check();
  await page.getByTestId('kyc-reject-confirm').click();
  expect(log.reviews.at(-1)).toEqual({ action: 'reject', rejectionReason: 'Selfie does not match ID' });
  await expect(dialog).toHaveCount(0);
  // Approve sends the action with no reason.
  await page.getByTestId('kyc-approve').click();
  await expect.poll(() => log.reviews.length).toBe(2);
  expect(log.reviews.at(-1)).toEqual({ action: 'approve' });
});

test('non-admin cannot see the Identity tab in the admin console', async ({ page }) => {
  await mock(page);
  await page.goto('/admin?tab=identity');
  await expect(page.getByText('Admin access required')).toBeVisible();
  await expect(page.getByTestId('kyc-queue')).toHaveCount(0);
});

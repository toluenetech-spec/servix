/** UI-only tests with intercepted API responses. Never contacts live providers. */
import { test, expect } from '@playwright/test';

async function mockApi(page, overrides = {}) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const key = url.pathname.slice('/api/v1/'.length);
    if (overrides[key]) return overrides[key](route);
    if (key === 'auth/refresh') return route.fulfill({ status: 401, json: { error: { message: 'No session' } } });
    if (key === 'auth/oauth/config') return route.fulfill({ json: { providers: ['google', 'github'] } });
    return route.fulfill({ json: { items: [] } });
  });
}
const state = { next: 'factor', method: 'totp', purpose: 'social', email: 't•••@example.test' };

test('provider buttons are hidden when disabled', async ({ page }) => {
  await mockApi(page, { 'auth/oauth/config': r => r.fulfill({ json: { providers: [] } }) });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
});
test('enabled providers and safe collision guidance appear', async ({ page }) => {
  await mockApi(page); await page.goto('/login?oauth_error=link_required');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('existing account');
});
test('start failure stays on the sign-in screen and permits retry', async ({ page }) => {
  await mockApi(page, { 'auth/google/start': r => r.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }) });
  await page.goto('/login'); await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not start');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});
test('social callback restores factor step, with no replacement enrollment', async ({ page }) => {
  await mockApi(page, { 'auth/security/status': r => r.fulfill({ json: state }) });
  await page.goto('/security-check');
  await expect(page.getByRole('textbox', { name: 'Google Authenticator code', exact: true })).toBeVisible();
  await expect(page.getByText('Provider verified')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Google Authenticator', exact: true })).toHaveCount(0);
});
test('failed status hides step controls and offers retry', async ({ page }) => {
  let failed = true;
  await mockApi(page, { 'auth/security/status': r => failed ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: state }) });
  await page.goto('/security-check');
  await expect(page.getByRole('button', { name: 'Verify security code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try loading again' })).toBeVisible();
  failed = false; await page.getByRole('button', { name: 'Try loading again' }).click();
  await expect(page.getByRole('textbox', { name: 'Google Authenticator code', exact: true })).toBeVisible();
});
test('connection settings require an existing session', async ({ page }) => {
  await mockApi(page); await page.goto('/connected-sign-in');
  await expect(page.getByRole('link', { name: 'Sign in to your existing account first' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect GitHub' })).toHaveCount(0);
});
test('connected provider is disabled, other provider remains available', async ({ page }) => {
  await mockApi(page, {
    'auth/refresh': r => r.fulfill({ json: { accessToken: 'ui-test-only', user: { id: 'ui-user', fullName: 'Test', role: 'customer', status: 'active' } } }),
    'auth/oauth/connections': r => r.fulfill({ json: { providers: ['google'] } }),
  });
  await page.goto('/connected-sign-in');
  await expect(page.getByRole('button', { name: 'Connected: Google' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
});

test('factor verification does not sign in until finish is acknowledged by server', async ({ page }) => {
  let finished = false;
  await mockApi(page, {
    'auth/security/status': r => r.fulfill({ json: state }),
    'auth/security/totp/verify': r => r.fulfill({ json: { ...state, next: 'finish' } }),
    'auth/security/finish': r => { finished = true; return r.fulfill({ json: { accessToken: 'ui-test-only', user: { id: 'test-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' } } }); },
  });
  await page.goto('/security-check');
  await page.getByRole('textbox', { name: 'Google Authenticator code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify security code' }).click();
  await expect(page.getByRole('button', { name: 'Finish signing in' })).toBeVisible();
  expect(finished).toBe(false);
  await page.getByRole('button', { name: 'Finish signing in' }).click();
  await expect(page.getByRole('heading', { name: 'You’re securely signed in' })).toBeVisible();
  expect(finished).toBe(true);
});

test('recovery codes must be acknowledged before completion', async ({ page }) => {
  const codes = ['abcdef-123456-abcdef-123456', 'fedcba-654321-fedcba-654321'];
  await mockApi(page, {
    'auth/security/status': r => r.fulfill({ json: { ...state, purpose: 'registration', next: 'recovery' } }),
    'auth/security/recovery/codes': r => r.fulfill({ json: { recoveryCodes: codes } }),
  });
  await page.goto('/security-check');
  await expect(page.getByText(codes[0], { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish securely' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have saved my recovery codes somewhere private.' }).check();
  await expect(page.getByRole('button', { name: 'Finish securely' })).toBeEnabled();
});

test('link completion has an explicit confirmation step and distinct success message', async ({ page }) => {
  await mockApi(page, {
    'auth/security/status': r => r.fulfill({ json: { ...state, next: 'finish', purpose: 'link' } }),
    'auth/security/finish': r => r.fulfill({ json: { accessToken: 'ui-test-only', user: { id: 'ui-user', fullName: 'Test Member', email: 'test@example.test', role: 'customer', status: 'active' } } }),
  });
  await page.goto('/security-check');
  await page.getByRole('button', { name: 'Confirm connection' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in provider connected' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View connected sign-in' })).toHaveAttribute('href', '/connected-sign-in');
});

test('Chromium virtual passkey returns a registration response before recovery step', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let credential;
  await mockApi(page, {
    'auth/security/status': r => r.fulfill({ json: { ...state, next: 'enroll', method: null } }),
    'auth/security/passkey/options': r => r.fulfill({ json: { enrolling: true, options: {
      challenge: Buffer.alloc(32, 7).toString('base64url'), rp: { id: 'localhost', name: 'Servix UI Test' },
      user: { id: Buffer.from('test-user').toString('base64url'), name: 'test@example.test', displayName: 'Test' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 15000, attestation: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    } } }),
    'auth/security/passkey/verify': r => {
      credential = r.request().postDataJSON().response;
      return r.fulfill({ json: { ...state, next: 'recovery', method: 'passkey', recoveryCodes: ['abcdef-123456-abcdef-123456'] } });
    },
  });
  await page.goto('http://localhost:5174/security-check');
  await page.getByRole('button', { name: /^Passkey/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in' })).toBeVisible();
  expect(credential.type).toBe('public-key');
  expect(credential.response.attestationObject).toBeTruthy();
  const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString());
  expect(clientData.type).toBe('webauthn.create');
  expect(clientData.origin).toBe('http://localhost:5174');
});

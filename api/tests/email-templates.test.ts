import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { emailSamples } from '../scripts/emailSamples.js';
import { bookingConfirmedMail, emailOtpMail, resetPasswordMail, payoutSentMail, bookingCancelledMail, deliverMail } from '../src/lib/mailer.js';
import { emailAppLink, renderEmail } from '../src/lib/emailTemplate.js';
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('APP_BASE_URL', 'https://www.servix.name.ng');
  vi.stubEnv('EMAIL_LOGO_URL', 'https://www.servix.name.ng/brand/servix-email-logo.png');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('professional transactional email templates', () => {
  it('covers every current mail type and important variant with HTML and plain text', () => {
    const samples = emailSamples(); expect(samples).toHaveLength(17);
    for (const { mail } of samples) {
      expect(mail.html).toContain('<html lang="en">'); expect(mail.html).toContain('role="presentation"');
      expect(mail.html).toContain('alt="SERVIX"'); expect(mail.html).toContain('Contact Servix support');
      expect(mail.text).toContain('https://www.servix.name.ng/contact');
      expect(mail.html!.length).toBeLessThan(30000); expect(mail.text.length).toBeGreaterThan(100);
      expect(mail.html).not.toMatch(/<script|<form|<iframe|javascript:/i);
    }
  });
  it('escapes service names and references instead of treating them as HTML', () => {
    const attack = '<img src=x onerror="alert(1)"> & \'quoted\'';
    const message = bookingConfirmedMail('preview@example.test', attack, attack, '2026-10-02T09:00:00Z');
    expect(message.html).not.toContain(attack); expect(message.html).toContain('&lt;img');
    expect(message.html).toContain('&amp;'); expect(message.text).toContain(attack);
  });
  it('encodes token parameters, escapes links, and never puts tokens in the preheader', () => {
    const token = 'private-token&next=https://evil.example/"<>';
    const message = resetPasswordMail('preview@example.test', token);
    const url = new URL(message.text.split('Reset my password: ')[1].split('\n')[0]);
    expect(url.searchParams.get('token')).toBe(token); expect(url.searchParams.get('next')).toBeNull();
    expect(message.html).not.toContain(token);
    expect(message.html!.match(/<div style="display:none[^>]*>(.*?)<\/div>/s)?.[1]).not.toContain('private-token');
  });
  it('gives login/reset codes purpose-specific copy without a token link', () => {
    const login = emailOtpMail('preview@example.test', '012345', 'login');
    const reset = emailOtpMail('preview@example.test', '012345', 'reset');
    expect(login.subject).toContain('sign-in'); expect(login.text).toContain('saved security method');
    expect(reset.subject).toContain('password reset'); expect(reset.text).toContain('recovery code is also required');
    expect(reset.html).not.toContain('?token='); expect(reset.text).toContain('012345');
    expect(reset.text).toContain('10 minutes');
  });
  it('renders readable branding without an unsafe logo', () => {
    vi.stubEnv('EMAIL_LOGO_URL', 'javascript:alert(1)');
    const message = emailOtpMail('preview@example.test', '012345');
    expect(message.html).not.toContain('<img'); expect(message.html).toContain('SERVIX');
  });
  it('rejects dangerous actions and production HTTP configuration', () => {
    expect(() => renderEmail({ category: 'Test', title: 'Test', preheader: 'Test', paragraphs: [], action: { label: 'Click', url: 'javascript:alert(1)' } })).toThrow();
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_BASE_URL', 'http://localhost:5173');
    expect(() => emailAppLink('/login')).toThrow();
    vi.stubEnv('APP_BASE_URL', 'https://user:secret@www.servix.name.ng');
    expect(() => emailAppLink('/login')).toThrow();
  });
  it('uses real application paths and displays explicit Lagos appointment time', () => {
    expect(payoutSentMail('preview@example.test', 'ref', '₦28,000').text).toContain('https://www.servix.name.ng/pro');
    const message = bookingConfirmedMail('preview@example.test', 'ref', 'Cleaning', '2026-10-02T09:00:00Z');
    expect(message.text).toContain('10:00'); expect(message.text).toContain('Lagos time, WAT');
  });
  it('does not promise a refund arrived or show a refund notice for unpaid cancellation', () => {
    expect(bookingCancelledMail('preview@example.test', 'ref', true).text).toContain('does not confirm that it has reached');
    expect(bookingCancelledMail('preview@example.test', 'ref', false).text).not.toContain('refund has');
  });
  it('passes both formats to Brevo without changing the delivery contract', async () => {
    vi.stubEnv('EMAIL_MODE', 'brevo'); vi.stubEnv('BREVO_API_KEY', 'fake-test-key');
    const send = vi.fn().mockResolvedValue(Response.json({ messageId: 'unit-id' })); vi.stubGlobal('fetch', send);
    const mail = resetPasswordMail('preview@example.test', 'test-token');
    expect((await deliverMail(mail)).accepted).toBe(true);
    const body = JSON.parse(send.mock.calls[0][1].body);
    expect(body.htmlContent).toBe(mail.html); expect(body.textContent).toBe(mail.text);
  });
});

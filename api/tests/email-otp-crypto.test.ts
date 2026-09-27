import { describe, it, expect, beforeEach } from 'vitest';
import { generateEmailCode, emailCodeDigest, matchesEmailCode, sealOtpMail, openOtpMail } from '../src/lib/emailOtpCrypto.js';
import { emailOtpMail } from '../src/lib/mailer.js';

beforeEach(() => { process.env.EMAIL_OTP_SECRET = 'unit-test-only-key-not-for-production-123456789'; });
describe('email OTP cryptography', () => {
  it('produces six numeric digits including leading zeros', () => {
    for (let i = 0; i < 100; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/);
  });
  it('binds each digest to user and issuance nonce', () => {
    const digest = emailCodeDigest('user-a', 'nonce-a', '012345');
    expect(matchesEmailCode(digest, emailCodeDigest('user-a', 'nonce-a', '012345'))).toBe(true);
    expect(matchesEmailCode(digest, emailCodeDigest('user-b', 'nonce-a', '012345'))).toBe(false);
    expect(matchesEmailCode(digest, emailCodeDigest('user-a', 'nonce-b', '012345'))).toBe(false);
    expect(matchesEmailCode(digest, emailCodeDigest('user-a', 'nonce-a', '123456'))).toBe(false);
    expect(matchesEmailCode('', digest)).toBe(false);
  });
  it('encrypts queued email and detects tampering', () => {
    const mail = { to: 'unit@example.com', text: 'Code 012345' };
    const sealed = sealOtpMail(mail);
    expect(sealed).not.toContain('012345');
    expect(openOtpMail(sealed)).toEqual(mail);
    const parts = sealed.split('.');
    parts[1] = Buffer.alloc(16).toString('base64url');
    expect(() => openOtpMail(parts.join('.'))).toThrow();
    expect(sealOtpMail(mail)).not.toBe(sealed);
  });
  it('fails closed without a sufficiently long key', () => {
    process.env.EMAIL_OTP_SECRET = '';
    expect(() => emailCodeDigest('u', 'n', '012345')).toThrow();
    expect(() => sealOtpMail({})).toThrow();
  });
});
describe('email OTP template', () => {
  it('includes plain text and branded HTML without a verification token link', () => {
    const mail = emailOtpMail('unit@example.com', '012345');
    expect(mail.text).toContain('10 minutes');
    expect(mail.html).toContain('012345');
    expect(mail.html).not.toContain('?token=');
  });
  it('rejects markup as a code and unsafe logo URLs', () => {
    expect(() => emailOtpMail('unit@example.com', '<img/>')).toThrow();
    process.env.EMAIL_LOGO_URL = 'javascript:alert(1)';
    expect(emailOtpMail('unit@example.com', '012345').html).not.toContain('<img');
  });
  it('escapes an HTTPS logo URL', () => {
    process.env.EMAIL_LOGO_URL = 'https://example.com/logo.png?a=1&b=2';
    expect(emailOtpMail('unit@example.com', '012345').html).toContain('&amp;b=2');
  });
});

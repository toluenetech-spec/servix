import { beforeEach, describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { seal, unseal, newTotp, verifyTotp, securityDigest, equalDigest, recoveryCodes, normalizeRecovery } from '../src/lib/securityCrypto.js';
beforeEach(() => { process.env.AUTH_SECURITY_SECRET = 'test-only-security-secret-not-for-production-1234'; });
describe('security primitives', () => {
  it('encrypts secrets with authenticated encryption and random IVs', () => {
    const encrypted = seal('TESTSECRET'); expect(encrypted).not.toContain('TESTSECRET');
    expect(unseal(encrypted)).toBe('TESTSECRET'); expect(seal('TESTSECRET')).not.toBe(encrypted);
    const parts = encrypted.split('.'); parts[1] = Buffer.alloc(16).toString('base64url');
    expect(() => unseal(parts.join('.'))).toThrow();
  });
  it('binds HMACs to purpose and owner', () => {
    const d = securityDigest('email', 'a', '123456');
    expect(equalDigest(d, securityDigest('email', 'a', '123456'))).toBe(true);
    expect(equalDigest(d, securityDigest('email', 'b', '123456'))).toBe(false);
    expect(equalDigest(d, securityDigest('recovery', 'a', '123456'))).toBe(false);
  });
  it('uses standard Google Authenticator compatible TOTP and rejects replay', () => {
    const setup = newTotp('unit@example.test');
    expect(setup.uri).toContain('otpauth://totp/'); expect(setup.uri).toContain('issuer=Servix');
    const time = 1800000000000;
    const generator = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });
    const code = generator.generate({ timestamp: time });
    const step = verifyTotp(setup.secret, code, -1, time)!;
    expect(step).toBe(Math.floor(time / 30000));
    expect(verifyTotp(setup.secret, code, step, time)).toBeNull();
    expect(verifyTotp(setup.secret, code, -1, time + 90000)).toBeNull();
  });
  it('generates high entropy recovery codes with normalized formatting', () => {
    const codes = recoveryCodes(); expect(codes).toHaveLength(8); expect(new Set(codes).size).toBe(8);
    expect(normalizeRecovery(codes[0])).toMatch(/^[a-f0-9]{24}$/);
  });
  it('fails closed when the security key is missing', () => {
    process.env.AUTH_SECURITY_SECRET = '';
    expect(() => seal('x')).toThrow(); expect(() => securityDigest('a', 'b', 'c')).toThrow();
  });
});

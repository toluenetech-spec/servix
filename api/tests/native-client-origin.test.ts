import { test, expect } from 'vitest';
import { requireSecurityOrigin, isTrustedNativeClient } from '../src/routes/security.js';

const req = (headers: Record<string, string>) => ({ headers }) as never;

test('browser request from a trusted origin passes', () => {
  process.env.CORS_ORIGINS = 'https://www.servix.name.ng';
  expect(() => requireSecurityOrigin(req({ origin: 'https://www.servix.name.ng' }))).not.toThrow();
});

test('browser request from an unknown origin is rejected even with the native header', () => {
  process.env.CORS_ORIGINS = 'https://www.servix.name.ng';
  const headers = { origin: 'https://evil.example', 'x-servix-client': 'ng.name.servix.app' };
  expect(() => requireSecurityOrigin(req(headers))).toThrow(/trusted website/);
  expect(isTrustedNativeClient(req(headers))).toBe(false);
});

test('request without origin is rejected unless it carries a known native client id', () => {
  delete process.env.NATIVE_CLIENT_IDS;
  expect(() => requireSecurityOrigin(req({}))).toThrow(/trusted website/);
  expect(() => requireSecurityOrigin(req({ 'x-servix-client': 'com.other.app' }))).toThrow(/trusted website/);
  expect(() => requireSecurityOrigin(req({ 'x-servix-client': 'ng.name.servix.app' }))).not.toThrow();
  process.env.NATIVE_CLIENT_IDS = 'com.example.ios, com.example.android';
  expect(() => requireSecurityOrigin(req({ 'x-servix-client': 'com.example.android' }))).not.toThrow();
  expect(() => requireSecurityOrigin(req({ 'x-servix-client': 'ng.name.servix.app' }))).toThrow(/trusted website/);
  delete process.env.NATIVE_CLIENT_IDS;
});

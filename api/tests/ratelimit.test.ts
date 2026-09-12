/**
 * Rate limiting — verified against a non-test-mode app instance
 * (test mode allowlists the limiter so functional suites can run freely).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  process.env.NODE_ENV = 'test';
  await app.close();
});

describe('auth rate limiting', () => {
  it('returns 429 with the error envelope after 10 login attempts/minute', async () => {
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'rate-limit@test.servix', password: 'xxxxxxxxxx' },
        remoteAddress: '10.99.99.99',
      });
      last = res.statusCode;
      if (last === 429) {
        expect(res.json().error.code).toBe('RATE_LIMITED');
        expect(res.json().error.status).toBe(429);
        return;
      }
    }
    expect(last).toBe(429);
  });
});

/**
 * SERVIX API — Phase A catalogue integration tests.
 * Requires the running, seeded database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });

describe('meta', () => {
  it('healthz responds ok', async () => {
    const res = await get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('unknown route returns the error envelope', async () => {
    const res = await get('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('serves OpenAPI documentation', async () => {
    const res = await get('/api/v1/docs');
    expect([200, 302]).toContain(res.statusCode);
  });
});

describe('GET /api/v1/categories', () => {
  it('returns the 8 seeded categories in frontend shape', async () => {
    const res = await get('/api/v1/categories');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(8);
    expect(body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      serviceCount: expect.any(Number),
    });
    expect(body.map((c: { id: string }) => c.id)).toContain('web-development');
  });
});

describe('GET /api/v1/services', () => {
  it('returns paginated envelope with all 12 seeded services present', async () => {
    const body = (await get('/api/v1/services?pageSize=50')).json();
    // Phase C: professionals can publish real services, so total may exceed
    // the seed — the regression contract is that the seed is fully intact.
    expect(body.total).toBeGreaterThanOrEqual(12);
    const ids = body.items.map((s: { id: string }) => s.id);
    for (const seeded of [
      'business-website-development',
      'ecommerce-store-build',
      'brand-identity-package',
      'product-photography-session',
    ]) {
      expect(ids).toContain(seeded);
    }
  });

  it('paginates without duplicates', async () => {
    const all = (await get('/api/v1/services?pageSize=50')).json();
    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(all.total / 5); page += 1) {
      const p = (await get(`/api/v1/services?page=${page}&pageSize=5`)).json();
      seen.push(...p.items.map((s: { id: string }) => s.id));
    }
    expect(new Set(seen).size).toBe(all.total);
  });

  it('filters by category, price, rating, availability, location', async () => {
    const cat = (await get('/api/v1/services?category=photography')).json();
    expect(cat.total).toBeGreaterThanOrEqual(2);
    for (const i of cat.items) expect(i.categoryId).toBe('photography');

    const price = (await get('/api/v1/services?minPrice=150000&maxPrice=300000')).json();
    for (const i of price.items) {
      expect(i.price).toBeGreaterThanOrEqual(150000);
      expect(i.price).toBeLessThanOrEqual(300000);
    }

    const rating = (await get('/api/v1/services?minRating=4.9')).json();
    for (const i of rating.items) expect(i.rating).toBeGreaterThanOrEqual(4.9);

    const avail = (await get('/api/v1/services?availability=limited')).json();
    for (const i of avail.items) expect(i.availability).toBe('limited');

    const loc = (await get('/api/v1/services?location=remote')).json();
    for (const i of loc.items) expect(i.location.toLowerCase()).toContain('remote');
  });

  it('searches and returns empty results without error', async () => {
    expect((await get('/api/v1/services?q=photography')).json().total).toBeGreaterThanOrEqual(2);
    const none = (await get('/api/v1/services?q=zzzz-nothing')).json();
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);
  });

  it('sorts by price and rating', async () => {
    const asc = (await get('/api/v1/services?sort=price-asc')).json();
    const prices = asc.items.map((s: { price: number }) => s.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));

    const rated = (await get('/api/v1/services?sort=rating')).json();
    const ratings = rated.items.map((s: { rating: number }) => s.rating);
    expect(ratings).toEqual([...ratings].sort((a: number, b: number) => b - a));
  });

  it('rejects invalid query params with 400', async () => {
    for (const url of [
      '/api/v1/services?page=0',
      '/api/v1/services?pageSize=999',
      '/api/v1/services?minRating=9',
      '/api/v1/services?availability=whenever',
      '/api/v1/services?sort=cheapest',
    ]) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
  });
});

describe('GET /api/v1/services/:slug', () => {
  it('returns full detail in frontend shape', async () => {
    const s = (await get('/api/v1/services/business-website-development')).json();
    expect(s).toMatchObject({
      id: 'business-website-development',
      categoryId: 'web-development',
      professionalId: 'adaeze-okafor',
      price: 450000,
    });
    expect(s.gallery.length).toBeGreaterThan(0);
    expect(s.faqs[0]).toHaveProperty('q');
  });

  it('404s for unknown slug (and reviews)', async () => {
    expect((await get('/api/v1/services/does-not-exist')).statusCode).toBe(404);
    expect((await get('/api/v1/services/does-not-exist/reviews')).statusCode).toBe(404);
  });

  it('returns reviews for a valid slug', async () => {
    const list = (await get('/api/v1/services/business-website-development/reviews')).json();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('author');
  });
});

describe('GET /api/v1/professionals', () => {
  it('lists seeded pros with filters and search', async () => {
    const all = (await get('/api/v1/professionals?pageSize=50')).json();
    expect(all.total).toBeGreaterThanOrEqual(8);
    expect(all.items.map((p: { id: string }) => p.id)).toContain('adaeze-okafor');
    const writing = (await get('/api/v1/professionals?category=writing')).json();
    expect(writing.items.map((p: { id: string }) => p.id)).toContain('ngozi-umeh');
    expect((await get('/api/v1/professionals?q=adaeze')).json().total).toBe(1);
    expect((await get('/api/v1/professionals?q=figma')).json().total).toBeGreaterThanOrEqual(1);
    const none = (await get('/api/v1/professionals?q=zzznobody')).json();
    expect(none.items).toEqual([]);
  });

  it('recommended sort ranks verified first', async () => {
    const flags = (await get('/api/v1/professionals?sort=recommended')).json().items.map(
      (p: { verified: boolean }) => p.verified,
    );
    const firstUnverified = flags.indexOf(false);
    if (firstUnverified !== -1) expect(flags.slice(firstUnverified)).not.toContain(true);
  });

  it('profile detail, reviews and services; 404s for unknown', async () => {
    const p = (await get('/api/v1/professionals/adaeze-okafor')).json();
    expect(p.name).toBe('Adaeze Okafor');
    expect(p.serviceIds).toContain('business-website-development');
    expect((await get('/api/v1/professionals/adaeze-okafor/services')).json()).toHaveLength(2);
    expect((await get('/api/v1/professionals/nobody')).statusCode).toBe(404);
    expect((await get('/api/v1/professionals/nobody/reviews')).statusCode).toBe(404);
  });
});

describe('content endpoints', () => {
  it('testimonials flagged demo; plans in shape; faqs grouped', async () => {
    const t = (await get('/api/v1/testimonials')).json();
    for (const x of t) expect(x.isDemo).toBe(true);

    const plans = (await get('/api/v1/plans')).json();
    expect(plans.map((p: { id: string }) => p.id)).toEqual(['free', 'professional', 'business']);
    expect(plans[0].period).toBe('forever');

    const grouped = (await get('/api/v1/faqs')).json();
    expect(Object.keys(grouped).sort()).toEqual(['contact', 'general', 'professionals']);
    expect((await get('/api/v1/faqs?context=nonsense')).statusCode).toBe(400);
  });

  it('stats matches the trust-strip contract', async () => {
    const body = (await get('/api/v1/stats')).json();
    expect(Object.keys(body).sort()).toEqual([
      'activeServices',
      'averageRating',
      'serviceCategories',
      'verifiedProfessionals',
    ]);
    expect(body.activeServices).toBeGreaterThanOrEqual(12);
    expect(body.serviceCategories).toBe(8);
    expect(body.verifiedProfessionals).toBeGreaterThanOrEqual(7);
    expect(body.averageRating).toBeGreaterThanOrEqual(1);
    expect(body.averageRating).toBeLessThanOrEqual(5);
  });
});

describe('POST /api/v1/contact', () => {
  const post = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/v1/contact', payload: payload as object });

  it('accepts a valid message; rejects invalid with field errors', async () => {
    const ok = await post({
      name: 'Test Person',
      email: 'test@example.com',
      subject: 'General enquiry',
      message: 'This is a valid test message with enough characters.',
    });
    expect(ok.statusCode).toBe(201);

    const bad = await post({ name: '', email: 'nope', subject: '', message: 'short' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.errors.email).toBeDefined();
  });
});

describe('CORS', () => {
  it('allows configured + preview origins, rejects others', async () => {
    const prod = await get('/api/v1/categories', { origin: 'https://servix-two.vercel.app' });
    expect(prod.headers['access-control-allow-origin']).toBe('https://servix-two.vercel.app');

    const preview = await get('/api/v1/categories', {
      origin: 'https://servix-git-x-toluenetech.vercel.app',
    });
    expect(preview.headers['access-control-allow-origin']).toBe(
      'https://servix-git-x-toluenetech.vercel.app',
    );

    const evil = await get('/api/v1/categories', { origin: 'https://evil.example.com' });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

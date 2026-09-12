/**
 * SERVIX API — Fastify application factory.
 * Phase A: read-only public catalogue + contact intake.
 * Phase B: accounts & authentication.
 * Phase C: professional onboarding. Phase D: bookings & payments.
 * Phase E: admin system, security headers, request ids, redacted
 * structured logging, body limits, readiness checks.
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { loadConfig, resolveStorageEnv } from './lib/config.js';
import { ApiError } from './lib/errors.js';
import { prisma } from './lib/db.js';
import { queueHealthy } from './lib/jobs.js';
import { categoryRoutes } from './routes/categories.js';
import { serviceRoutes } from './routes/services.js';
import { professionalRoutes } from './routes/professionals.js';
import { contentRoutes } from './routes/content.js';
import { authRoutes } from './routes/auth.js';
import { applicationRoutes } from './routes/applications.js';
import { proRoutes } from './routes/pro.js';
import { bookingRoutes } from './routes/bookings.js';
import { webhookRoutes } from './routes/webhooks.js';
import { earningsRoutes } from './routes/earnings.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({
    // Phase E: request ids + structured logs with secret redaction.
    genReqId: () => randomUUID(),
    bodyLimit: 512 * 1024, // 512 KB
    logger:
      config.nodeEnv !== 'test'
        ? {
            level: 'info',
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                '*.password',
                '*.passwordHash',
                '*.accessToken',
                '*.token',
                '*.secret',
              ],
              censor: '[REDACTED]',
            },
          }
        : false,
  });

  /* ---------------- CORS ---------------- */
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      try {
        const { hostname } = new URL(origin);
        if (hostname.endsWith('.vercel.app') && hostname.startsWith('servix')) {
          return cb(null, true);
        }
      } catch {
        /* fallthrough */
      }
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true, // refresh cookie
  });

  /* ---------------- Cookies & rate limiting ---------------- */
  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, {
    global: true,
    // Generous global cap; auth routes set stricter per-route limits.
    // Disabled in tests so suites can exercise auth flows repeatedly —
    // limiter behaviour itself is covered by a dedicated test app.
    max: config.nodeEnv === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
    allowList: () => config.nodeEnv === 'test',
  });

  /* ---------------- Security headers (Phase E) ---------------- */
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Request-Id', req.id);
    if (config.nodeEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  /* ---------------- OpenAPI ---------------- */
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Servix API',
        description:
          'Servix marketplace API. Catalogue, accounts, professional onboarding, bookings & payments, administration.',
        version: '0.6.1',
      },
      servers: [{ url: '/api/v1' }],
      tags: [
        { name: 'catalogue', description: 'Categories, services, professionals, reviews' },
        { name: 'content', description: 'Testimonials, plans, FAQs, contact, stats' },
        { name: 'auth', description: 'Accounts and authentication' },
        { name: 'professional', description: 'Professional onboarding and management' },
        { name: 'bookings', description: 'Bookings, availability, disputes, reviews' },
        { name: 'payments', description: 'Payments, webhooks, earnings, payouts' },
        { name: 'admin', description: 'Administration (server-verified admin role)' },
        { name: 'meta', description: 'Health and metadata' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/v1/docs' });

  /* ---------------- Error envelope ---------------- */
  app.setErrorHandler((err: unknown & { validation?: unknown; message?: string; statusCode?: number }, _req, reply) => {
    if (err instanceof ApiError) {
      const body: Record<string, unknown> = {
        error: { code: err.code, message: err.message, status: err.status },
      };
      if (err.errors) (body.error as Record<string, unknown>).errors = err.errors;
      return reply.code(err.status).send(body);
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', status: 429 },
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: 'REQUEST_ERROR', message: err.message ?? 'Request error', status: err.statusCode },
      });
    }
    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: err.message, status: 400 },
      });
    }
    app.log.error(err);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', status: 500 },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', status: 404 },
    }),
  );

  /* ---------------- Health & readiness ---------------- */
  app.get('/healthz', { schema: { tags: ['meta'], summary: 'Liveness probe' } }, async () => ({
    ok: true,
  }));

  app.get('/readyz', { schema: { tags: ['meta'], summary: 'Readiness probe (db, queue, storage)' } }, async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }
    checks.queue = await queueHealthy();
    const storageEnv = resolveStorageEnv();
    checks.storage = !storageEnv.enabled || Boolean(storageEnv.bucket && storageEnv.accessKeyId);
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  /* ---------------- Routes ---------------- */
  await app.register(webhookRoutes); // /api/v1/webhooks/* + /sandbox/* (see route defs)

  await app.register(
    async (v1) => {
      await categoryRoutes(v1);
      await serviceRoutes(v1);
      await professionalRoutes(v1);
      await contentRoutes(v1);
      await authRoutes(v1);
      await applicationRoutes(v1);
      await proRoutes(v1);
      await bookingRoutes(v1);
      await earningsRoutes(v1);
      await adminRoutes(v1);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

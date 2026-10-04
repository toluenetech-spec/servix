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
import { communityRoutes } from './routes/community.js';
import { accountRoutes } from './routes/account.js';
import { uploadRoutes, UPLOAD_CONTENT_TYPES } from './routes/uploads.js';
import { mediaRoutes } from './routes/media.js';
import { authRoutes } from './routes/auth.js';
import { applicationRoutes } from './routes/applications.js';
import { proRoutes } from './routes/pro.js';
import { proWorkspaceRoutes } from './routes/proWorkspace.js';
import { bookingRoutes } from './routes/bookings.js';
import { webhookRoutes } from './routes/webhooks.js';
import { earningsRoutes } from './routes/earnings.js';
import { adminRoutes } from './routes/admin.js';
import { kycRoutes } from './routes/kyc.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { requestRoutes } from './routes/requests.js';
import { aiRoutes } from './routes/ai.js';
import { aiFeedbackRoutes } from './routes/aiFeedback.js';
import { billingRoutes } from './routes/billing.js';
import { teamRoutes } from './routes/teams.js';
import { productivityRoutes } from './routes/productivity.js';
import { adminPlanRoutes } from './routes/adminPlans.js';
import { checkSchema, LATEST_MIGRATION } from './lib/schemaCheck.js';

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
            // OAuth callbacks contain temporary codes/state in the query string.
            serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0], hostname: req.hostname, remoteAddress: req.ip }) },
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
  // Raw file bodies for /uploads and /applications/resume. Route-level
  // bodyLimit applies; everything else keeps the 512 KB default.
  app.addContentTypeParser(UPLOAD_CONTENT_TYPES, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
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
      if (err.meta) (body.error as Record<string, unknown>).meta = err.meta;
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
    // Prisma P2021/P2022 = table/column missing: the image is newer than the database (pending manual migration).
    const prismaCode = (err as { code?: unknown }).code;
    if (prismaCode === 'P2021' || prismaCode === 'P2022') {
      app.log.error(err, `database schema behind (pending migration ${LATEST_MIGRATION})`);
      reply.header('Retry-After', '60');
      return reply.code(503).send({
        error: { code: 'SCHEMA_PENDING', message: 'Servix is finishing an update. Please try again in a few minutes.', status: 503 },
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
    let pendingMigration: string | null = null;
    let optionalPending: Array<{ table: string; migration: string; script: string }> = [];
    if (checks.database) {
      try { const schema = await checkSchema(); checks.schema = schema.ok; pendingMigration = schema.pendingMigration; optionalPending = schema.optionalPending; } catch { checks.schema = false; }
    } else checks.schema = false;
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({
      ready,
      checks,
      ...(pendingMigration ? { pendingMigration, hint: `Apply api/docs/manual-subscriptions-upgrade.sql (migration ${pendingMigration}) on the database; no restart needed.` } : {}),
      // Optional features whose table is not on the database yet (they answer 503 SCHEMA_PENDING; nothing else is affected).
      ...(optionalPending.length ? { optionalPending: optionalPending.map((o) => ({ ...o, hint: `Apply ${o.script} (migration ${o.migration}) on the database; no restart needed.` })) } : {}),
    });;
  });

  /* ---------------- Routes ---------------- */
  await app.register(webhookRoutes); // /api/v1/webhooks/* + /sandbox/* (see route defs)
  await app.register(mediaRoutes); // GET /media/<key> — files served from the bucket

  await app.register(
    async (v1) => {
      await categoryRoutes(v1);
      await serviceRoutes(v1);
      await professionalRoutes(v1);
      await contentRoutes(v1);
      await authRoutes(v1);
      await accountRoutes(v1);
      await uploadRoutes(v1);
      await communityRoutes(v1);
      await applicationRoutes(v1);
      await proRoutes(v1);
      await proWorkspaceRoutes(v1);
      await bookingRoutes(v1);
      await earningsRoutes(v1);
      await adminRoutes(v1);
      await kycRoutes(v1); // /kyc/* + /admin/kyc/*
      await marketplaceRoutes(v1); // /features, trust, compare, achievements, verified portfolio
      await requestRoutes(v1); // /requests/* + /proposals/* (REQUESTS_ENABLED)
      await aiRoutes(v1); // /ai/* (AI_ENABLED) + /admin/ai/*
      await aiFeedbackRoutes(v1); // POST /ai/feedback + GET /admin/ai/feedback (thumbs up/down on answers)
      await billingRoutes(v1); // /me/entitlements + /billing/* (plans for every account)
      await teamRoutes(v1); // /team/* (Team / Enterprise workspaces)
      await productivityRoutes(v1); // saved searches, CSV exports, profile versions
      await adminPlanRoutes(v1); // /admin/plans, /admin/organizations, /admin/ai/usage
    },
    { prefix: '/api/v1' },
  );

  return app;
}

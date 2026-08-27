/**
 * SERVIX Phase D — Paystack webhook + sandbox checkout.
 *
 * Security: HMAC-SHA512 signature over the RAW body must match
 * x-paystack-signature (401 otherwise, nothing persisted). Events are
 * idempotent via UNIQUE(provider, provider_id). charge.success is
 * re-verified server-to-server before any credit. All financial state
 * changes are CAS transactions — duplicates and out-of-order deliveries
 * no-op safely.
 */
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { capturePayment } from '../lib/bookingService.js';
import { getPaymentProvider, SandboxControl, signWebhook } from '../lib/payments.js';

interface PaystackEvent {
  id?: string | number;
  event: string;
  data: { reference?: string; id?: string | number; status?: string };
}

export async function webhookRoutes(app: FastifyInstance) {
  // Raw-body capture for signature verification on this route only.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 1024 * 512 },
    (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, {});
      }
    },
  );

  app.post(
    '/api/v1/webhooks/paystack',
    { config: { rateLimit: false }, schema: { tags: ['payments'], summary: 'Paystack webhook (signature-verified)' } },
    async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const signature = req.headers['x-paystack-signature'];
      const expected = signWebhook(raw);
      const provided = typeof signature === 'string' ? signature : '';
      const valid =
        provided.length === expected.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      if (!valid) {
        return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Signature mismatch', status: 401 } });
      }

      const event = req.body as PaystackEvent;
      const providerId = String(event.data?.id ?? event.id ?? event.data?.reference ?? '');
      if (!providerId || !event.event) {
        return reply.code(400).send({ error: { code: 'INVALID_EVENT', message: 'Malformed event', status: 400 } });
      }

      // Idempotency: first delivery wins; duplicates are acknowledged no-ops.
      let stored;
      try {
        stored = await prisma.webhookEvent.create({
          data: { provider: 'paystack', providerId, type: event.event, payload: event as object },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          return reply.code(200).send({ ok: true, duplicate: true });
        }
        throw err;
      }

      try {
        if (event.event === 'charge.success' && event.data.reference) {
          const payment = await prisma.payment.findUnique({ where: { reference: event.data.reference } });
          if (!payment) throw new Error(`No payment for reference ${event.data.reference}`);

          // Never trust the webhook body — verify with the provider.
          const verification = await getPaymentProvider().verify(payment.reference);
          if (verification.status !== 'success') {
            throw new Error(`Verification returned ${verification.status}`);
          }
          if (verification.amountKobo !== payment.amountKobo || verification.currency !== payment.currency) {
            throw new Error(
              `Amount mismatch: expected ${payment.amountKobo} ${payment.currency}, got ${verification.amountKobo} ${verification.currency}`,
            );
          }
          await capturePayment(payment.id, payment.bookingId, payment.amountKobo);
        } else if (event.event === 'charge.failed' && event.data.reference) {
          await prisma.payment.updateMany({
            where: { reference: event.data.reference, status: 'initiated' },
            data: { status: 'failed' },
          });
        }
        await prisma.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date() } });
        return reply.code(200).send({ ok: true });
      } catch (err) {
        await prisma.webhookEvent.update({
          where: { id: stored.id },
          data: { error: (err as Error).message.slice(0, 500) },
        });
        // 200 so the provider doesn't hammer retries for a permanent error;
        // the stored error supports replay/alerting.
        return reply.code(200).send({ ok: false });
      }
    },
  );

  /* ---------------- sandbox checkout (no PAYSTACK_SECRET_KEY) ----------------
     A clearly-labelled local stand-in for the Paystack hosted page. Its
     buttons emit a SIGNED webhook through the pipeline above — identical
     verification path to production. Disabled when real credentials exist. */

  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYMENT_MODE === 'sandbox') {
    app.get('/sandbox/checkout/:reference', { schema: { hide: true } }, async (req, reply) => {
      const { reference } = req.params as { reference: string };
      const payment = await prisma.payment.findUnique({
        where: { reference },
        include: { booking: true },
      });
      if (!payment) return reply.code(404).type('text/html').send('<h1>Unknown checkout reference</h1>');
      const amount = (payment.amountKobo / 100n).toString();
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      return reply.type('text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Sandbox Checkout — Servix</title>
<style>body{font-family:system-ui;background:#F7F4EC;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;border:1px solid #ddd7c9;border-radius:10px;padding:2.5rem;max-width:24rem;text-align:center}
.badge{display:inline-block;background:#fdecea;color:#b3372a;font-size:.7rem;font-weight:700;letter-spacing:.08em;padding:.25rem .6rem;border-radius:999px;margin-bottom:1rem}
h1{font-size:1.1rem;margin:.2rem 0}.amt{font-size:1.8rem;font-weight:800;color:#12372A;margin:.6rem 0 1.2rem}
button{width:100%;padding:.85rem;border:0;border-radius:6px;font-weight:600;cursor:pointer;margin-top:.5rem}
.pay{background:#12372A;color:#F7F4EC}.fail{background:#eee;color:#333}</style></head>
<body><div class="card"><span class="badge">SANDBOX — NOT A REAL CHARGE</span>
<h1>${payment.booking.serviceTitle}</h1><div class="amt">₦${Number(amount).toLocaleString('en-NG')}</div>
<form method="POST" action="/sandbox/checkout/${encodeURIComponent(reference)}/complete">
<button class="pay" name="outcome" value="success">Pay (test)</button>
<button class="fail" name="outcome" value="failed">Simulate failure</button></form>
<p style="font-size:.75rem;color:#68716B">Payment is confirmed only via the signed webhook — exactly like production.</p>
<p style="font-size:.75rem"><a href="${appBase}/bookings/${payment.bookingId}">Back to Servix</a></p></div></body></html>`);
    });

    app.post('/sandbox/checkout/:reference/complete', { schema: { hide: true } }, async (req, reply) => {
      const { reference } = req.params as { reference: string };
      const outcome =
        ((req.body as Record<string, string>)?.outcome === 'failed' ? 'failed' : 'success') as 'success' | 'failed';
      if (!SandboxControl.settle(reference, outcome)) {
        return reply.code(409).type('text/html').send('<h1>Checkout already completed</h1>');
      }
      // Emit the signed webhook through the real pipeline. Using
      // app.inject targets THIS instance (works identically when the
      // server is listening and under test), while still exercising the
      // full signature verification + idempotency path.
      const eventBody = JSON.stringify({
        id: `evt-${reference}-${outcome}`,
        event: outcome === 'success' ? 'charge.success' : 'charge.failed',
        data: { id: `evt-${reference}-${outcome}`, reference, status: outcome },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/paystack',
        payload: eventBody,
        headers: { 'content-type': 'application/json', 'x-paystack-signature': signWebhook(eventBody) },
      });
      const payment = await prisma.payment.findUnique({ where: { reference } });
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      return reply.redirect(`${appBase}/bookings/${payment?.bookingId ?? ''}`);
    });
  }
}

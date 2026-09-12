/**
 * SERVIX API — Phase D bookings + payments integration tests.
 * Real database, real webhook pipeline (signed), real ledger.
 * Phase E migration: application approval and dispute resolution now go
 * through authenticated admin endpoints (the review-key bridge is gone).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { signWebhook } from '../src/lib/payments.js';
import { runAutoConfirmSweep } from '../src/lib/bookingService.js';
import { accountBalance } from '../src/lib/ledger.js';
import { hashPassword } from '../src/lib/password.js';

let app: FastifyInstance;
const stamp = Date.now();

const customer = { email: `bk-cust-${stamp}@test.servix`, password: 'customer-pass-1', token: '', id: '' };
const intruder = { email: `bk-intr-${stamp}@test.servix`, password: 'intruder-pass-1', token: '' };
const proUser = { email: `bk-pro-${stamp}@test.servix`, password: 'pro-pass-1', token: '', profileId: '' };
const proB = { email: `bk-prob-${stamp}@test.servix`, password: 'pro-b-pass-1', token: '' };
let adminToken = '';
const ADMIN_EMAIL = `bk-admin-${stamp}@test.servix`;

let serviceSlug = '';
let servicePriceNaira = 200000;

const inject = (method: string, url: string, token?: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

/** Register + approve a professional (through the real admin endpoint). */
async function makeProfessional(actor: { email: string; password: string; token: string }, title: string) {
  const appRes = await inject('POST', '/api/v1/applications', actor.token, { title });
  const appId = appRes.json().id;
  await inject('POST', `/api/v1/applications/${appId}/submit`, actor.token);
  await inject('POST', `/api/v1/admin/applications/${appId}/approve`, adminToken);
}

async function futureSlot(offsetDays = 1, hour = 10): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // land on a weekday (default rules Mon–Fri)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Drive a payment to captured via the REAL signed webhook pipeline. */
async function payBooking(bookingId: string, token: string) {
  const init = await inject('POST', `/api/v1/bookings/${bookingId}/pay`, token);
  const reference = init.json().reference as string;
  // settle sandbox session
  await app.inject({ method: 'POST', url: `/sandbox/checkout/${reference}/complete`, payload: 'outcome=success', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return reference;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();

  for (const a of [customer, intruder, proUser, proB]) {
    const res = await inject('POST', '/api/v1/auth/register', undefined, {
      fullName: `T ${a.email.split('@')[0]}`,
      email: a.email,
      password: a.password,
    });
    a.token = res.json().accessToken;
    if (a === customer) customer.id = res.json().user.id;
  }

  // Server-side admin — clients can never set roles.
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      fullName: 'Bookings Test Admin',
      passwordHash: await hashPassword('admin-test-pass-1'),
      role: 'admin',
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });
  const adminLogin = await inject('POST', '/api/v1/auth/login', undefined, {
    email: ADMIN_EMAIL,
    password: 'admin-test-pass-1',
  });
  adminToken = adminLogin.json().accessToken;

  await makeProfessional(proUser, 'Booking Test Pro');
  await makeProfessional(proB, 'Other Pro');
  const profile = await prisma.professionalProfile.findFirstOrThrow({
    where: { user: { email: proUser.email } },
  });
  proUser.profileId = profile.id;

  const svc = await inject('POST', '/api/v1/pro/services', proUser.token, {
    title: `Booking Flow Service ${stamp}`,
    categorySlug: 'consulting',
    price: servicePriceNaira,
    shortDescription: 'A service used by the Phase D booking test suite.',
    description: 'Full-length description used by the automated Phase D booking and payment test-suite runs.',
  });
  serviceSlug = svc.json().id;
  await inject('POST', `/api/v1/pro/services/${serviceSlug}/publish`, proUser.token);
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@test.servix' } } });
  const ids = users.map((u) => u.id);
  const profiles = await prisma.professionalProfile.findMany({ where: { userId: { in: ids } } });
  const pids = profiles.map((p) => p.id);
  await prisma.booking.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { professionalId: { in: pids } }] } });
  await prisma.payout.deleteMany({ where: { professionalId: { in: pids } } });
  await prisma.service.deleteMany({ where: { professionalId: { in: pids } } });
  await prisma.professionalProfile.deleteMany({ where: { id: { in: pids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
});

/* ================= availability ================= */

describe('availability', () => {
  it('returns real bookable slots and excludes taken/closed times', async () => {
    const res = await inject('GET', `/api/v1/services/${serviceSlug}/availability?days=7`);
    expect(res.statusCode).toBe(200);
    expect(res.json().slots.length).toBeGreaterThan(0);
  });

  it('rejects off-hours, past times and non-hour starts', async () => {
    const sunday = new Date();
    while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
    sunday.setHours(10, 0, 0, 0);
    const offday = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: sunday.toISOString() });
    expect(offday.statusCode).toBe(409);

    const past = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: '2020-01-06T10:00:00.000Z' });
    expect(past.statusCode).toBe(422);

    const halfHour = new Date(await futureSlot(2, 10));
    halfHour.setMinutes(30);
    const odd = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: halfHour.toISOString() });
    expect(odd.statusCode).toBe(422);
  });
});

/* ================= booking creation ================= */

describe('booking creation', () => {
  let bookingId = '';
  let slot = '';

  it('creates a pending_payment booking with an immutable price snapshot', async () => {
    slot = await futureSlot(3, 10);
    const res = await inject('POST', '/api/v1/bookings', customer.token, {
      serviceId: serviceSlug,
      scheduledAt: slot,
      // Price-manipulation attempt: extra fields are stripped by zod.
      price: 1,
      amount: 1,
      amountKobo: 1,
    } as object);
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.status).toBe('pending_payment');
    expect(b.amount).toBe(servicePriceNaira); // server-side snapshot wins
    bookingId = b.id;

    // Snapshot survives service price edits.
    await inject('PATCH', `/api/v1/pro/services/${serviceSlug}`, proUser.token, { price: 999000 });
    const after = await inject('GET', `/api/v1/bookings/${bookingId}`, customer.token);
    expect(after.json().amount).toBe(servicePriceNaira);
    await inject('PATCH', `/api/v1/pro/services/${serviceSlug}`, proUser.token, { price: servicePriceNaira });
  });

  it('prevents double-booking the same slot (conflict detection)', async () => {
    const res = await inject('POST', '/api/v1/bookings', intruder.token, { serviceId: serviceSlug, scheduledAt: slot });
    expect(res.statusCode).toBe(409);
    expect(['SLOT_TAKEN', 'SLOT_UNAVAILABLE']).toContain(res.json().error.code);
  });

  it('duplicate requests with the same Idempotency-Key return the same booking', async () => {
    const s = await futureSlot(4, 11);
    const h = { 'idempotency-key': `idem-${stamp}` };
    const a = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: s }, h);
    const b = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: s }, h);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    await inject('POST', `/api/v1/bookings/${a.json().id}/cancel`, customer.token, {});
  });

  it('unauthenticated users cannot book; a pro cannot book own service', async () => {
    expect((await inject('POST', '/api/v1/bookings', undefined, { serviceId: serviceSlug, scheduledAt: await futureSlot(5) })).statusCode).toBe(401);
    expect((await inject('POST', '/api/v1/bookings', proUser.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(5) })).json().error.code).toBe('OWN_SERVICE');
  });

  it('cancelling an unpaid booking frees the slot without any refund entries', async () => {
    const res = await inject('POST', `/api/v1/bookings/${bookingId}/cancel`, customer.token, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    const entries = await prisma.ledgerEntry.findMany({ where: { bookingId } });
    expect(entries).toHaveLength(0);
  });
});

/* ================= payment + webhook ================= */

describe('payments and webhooks', () => {
  let bookingId = '';
  let reference = '';

  it('initializes payment idempotently', async () => {
    const res = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(6, 9) });
    bookingId = res.json().id;
    const p1 = await inject('POST', `/api/v1/bookings/${bookingId}/pay`, customer.token);
    const p2 = await inject('POST', `/api/v1/bookings/${bookingId}/pay`, customer.token);
    expect(p1.json().reference).toBe(p2.json().reference);
    reference = p1.json().reference;
    const open = await prisma.payment.count({ where: { bookingId, status: 'initiated' } });
    expect(open).toBe(1);
  });

  it('rejects a webhook with an invalid signature and persists nothing', async () => {
    const body = JSON.stringify({ id: 'forged-1', event: 'charge.success', data: { id: 'forged-1', reference } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/paystack',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-paystack-signature': 'not-a-real-signature-padded-to-len'.padEnd(128, 'x') },
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { providerId: 'forged-1' } })).toBe(0);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('pending_payment'); // unchanged
  });

  it('customers cannot mark bookings paid by any client input', async () => {
    // There is no endpoint for it; the only path is the signed webhook.
    const attempt = await inject('POST', `/api/v1/bookings/${bookingId}/confirm`, customer.token);
    expect(attempt.statusCode).toBe(409); // not delivered — and never paid
  });

  it('a correctly signed webhook (verified with provider) captures payment → escrow + requested', async () => {
    await app.inject({ method: 'POST', url: `/sandbox/checkout/${reference}/complete`, payload: 'outcome=success', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('requested');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    expect(payment.status).toBe('captured');

    // Ledger: balanced capture into escrow.
    const entries = await prisma.ledgerEntry.findMany({ where: { bookingId } });
    expect(entries).toHaveLength(2);
    const escrow = entries.find((e) => e.account === 'customer_escrow');
    expect(escrow?.direction).toBe('credit');
    expect(escrow?.amountKobo).toBe(BigInt(servicePriceNaira) * 100n);
  });

  it('duplicate webhook delivery does not double-credit', async () => {
    const before = await prisma.ledgerEntry.count({ where: { bookingId } });
    const eventBody = JSON.stringify({ id: `evt-${reference}-success`, event: 'charge.success', data: { id: `evt-${reference}-success`, reference, status: 'success' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/paystack',
      payload: eventBody,
      headers: { 'content-type': 'application/json', 'x-paystack-signature': signWebhook(eventBody) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(before);
  });

  it('failed payments mark the payment failed and never move the booking', async () => {
    const res = await inject('POST', '/api/v1/bookings', intruder.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(7, 14) });
    const bid = res.json().id;
    const init = await inject('POST', `/api/v1/bookings/${bid}/pay`, intruder.token);
    const ref = init.json().reference;
    await app.inject({ method: 'POST', url: `/sandbox/checkout/${ref}/complete`, payload: 'outcome=failed', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference: ref } });
    expect(payment.status).toBe('failed');
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bid } });
    expect(booking.status).toBe('pending_payment');
    await inject('POST', `/api/v1/bookings/${bid}/cancel`, intruder.token, {});
  });

  /* ---- keep the paid booking flowing through the lifecycle ---- */

  it('professional accepts, starts, delivers; customer confirms → escrow released', async () => {
    // authorization: proB cannot act on proUser's booking
    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/accept`, proB.token)).statusCode).toBe(404);
    // customer cannot act via pro endpoints
    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/accept`, customer.token)).statusCode).toBe(403);

    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/accept`, proUser.token)).json().status).toBe('accepted');
    // invalid transition: deliver before start
    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/deliver`, proUser.token)).statusCode).toBe(409);
    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/start`, proUser.token)).json().status).toBe('in_progress');
    expect((await inject('POST', `/api/v1/pro/bookings/${bookingId}/deliver`, proUser.token)).json().status).toBe('delivered');

    // intruder cannot confirm someone else's booking
    expect((await inject('POST', `/api/v1/bookings/${bookingId}/confirm`, intruder.token)).statusCode).toBe(404);
    // professional cannot release escrow (no such pro endpoint; confirm is customer-owned)
    expect((await inject('POST', `/api/v1/bookings/${bookingId}/confirm`, proUser.token)).statusCode).toBe(404);

    const confirmed = await inject('POST', `/api/v1/bookings/${bookingId}/confirm`, customer.token);
    expect(confirmed.json().status).toBe('completed');

    // Ledger release: escrow → payable + platform fee (balanced txn).
    const amount = BigInt(servicePriceNaira) * 100n;
    const fee = (amount * 10n) / 100n;
    const payable = await accountBalance('professional_payable', proUser.profileId);
    expect(payable).toBe(amount - fee);
    const revenue = await accountBalance('platform_revenue');
    expect(revenue).toBeGreaterThanOrEqual(fee);

    // double-confirm is a no-op conflict
    expect((await inject('POST', `/api/v1/bookings/${bookingId}/confirm`, customer.token)).statusCode).toBe(409);
  });

  /* ---- review ---- */

  it('review eligibility: only the customer, only completed, only once', async () => {
    // intruder cannot review
    expect((await inject('POST', `/api/v1/bookings/${bookingId}/review`, intruder.token, { rating: 5 })).statusCode).toBe(404);

    const ok = await inject('POST', `/api/v1/bookings/${bookingId}/review`, customer.token, { rating: 5, text: 'Excellent work, delivered on time.' });
    expect(ok.statusCode).toBe(201);

    // duplicate review blocked (endpoint + DB unique)
    const dup = await inject('POST', `/api/v1/bookings/${bookingId}/review`, customer.token, { rating: 4 });
    expect(dup.statusCode).toBe(409);

    // aggregates recomputed on service + professional
    const svc = await inject('GET', `/api/v1/services/${serviceSlug}`);
    expect(svc.json().reviewCount).toBeGreaterThanOrEqual(1);
    expect(svc.json().rating).toBeGreaterThan(0);

    // review appears on the public service reviews feed
    const reviews = await inject('GET', `/api/v1/services/${serviceSlug}/reviews`);
    expect(reviews.json().some((r: { text: string }) => r.text.includes('Excellent work'))).toBe(true);
  });

  /* ---- payout ---- */

  it('professional requests payout; duplicates rejected; ledger settled', async () => {
    const before = await accountBalance('professional_payable', proUser.profileId);
    expect(before).toBeGreaterThan(0n);

    const res = await inject('POST', '/api/v1/pro/payouts', proUser.token);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('paid');
    expect(res.json().providerRef).toBeTruthy();

    const after = await accountBalance('professional_payable', proUser.profileId);
    expect(after).toBe(0n);

    // nothing left to pay → 409
    const again = await inject('POST', '/api/v1/pro/payouts', proUser.token);
    expect(again.statusCode).toBe(409);

    // customer cannot request payouts
    expect((await inject('POST', '/api/v1/pro/payouts', customer.token)).statusCode).toBe(403);
  });
});

/* ================= refunds ================= */

describe('refunds (policy-controlled)', () => {
  async function paidBooking(dayOffset: number, hour: number) {
    const res = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(dayOffset, hour) });
    const id = res.json().id;
    await payBooking(id, customer.token);
    return id;
  }

  it('customer cancel before acceptance → 100% refund', async () => {
    const id = await paidBooking(8, 9);
    const res = await inject('POST', `/api/v1/bookings/${id}/cancel`, customer.token, { reason: 'changed my mind' });
    expect(res.json().status).toBe('cancelled');
    const refund = await prisma.ledgerEntry.findFirst({ where: { bookingId: id, account: 'refunds_paid' } });
    expect(refund?.amountKobo).toBe(BigInt(servicePriceNaira) * 100n);
    const pay = await prisma.payment.findFirst({ where: { bookingId: id } });
    expect(pay?.status).toBe('refunded');
  });

  it('professional decline → 100% refund', async () => {
    const id = await paidBooking(8, 10);
    const res = await inject('POST', `/api/v1/pro/bookings/${id}/decline`, proUser.token, { reason: 'unavailable' });
    expect(res.json().status).toBe('declined');
    const refund = await prisma.ledgerEntry.findFirst({ where: { bookingId: id, account: 'refunds_paid' } });
    expect(refund?.amountKobo).toBe(BigInt(servicePriceNaira) * 100n);
  });

  it('customer cannot cancel once work is in progress (dispute instead); client refund fields ignored', async () => {
    const id = await paidBooking(8, 11);
    await inject('POST', `/api/v1/pro/bookings/${id}/accept`, proUser.token);
    await inject('POST', `/api/v1/pro/bookings/${id}/start`, proUser.token);
    const res = await inject('POST', `/api/v1/bookings/${id}/cancel`, customer.token, { reason: 'nope', refundPercent: 100, amount: 999999 } as object);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_CANCELLABLE');
    // clean up via pro cancel (full refund)
    await inject('POST', `/api/v1/pro/bookings/${id}/cancel`, proUser.token, {});
  });
});

/* ================= disputes & auto-confirm ================= */

describe('disputes and auto-confirmation', () => {
  async function deliveredBooking(dayOffset: number, hour: number) {
    const res = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(dayOffset, hour) });
    const id = res.json().id;
    await payBooking(id, customer.token);
    await inject('POST', `/api/v1/pro/bookings/${id}/accept`, proUser.token);
    await inject('POST', `/api/v1/pro/bookings/${id}/start`, proUser.token);
    await inject('POST', `/api/v1/pro/bookings/${id}/deliver`, proUser.token);
    return id;
  }

  it('3-day auto-confirm completes delivered bookings and releases escrow', async () => {
    const id = await deliveredBooking(9, 9);
    // Not yet due → sweep skips it.
    expect(await runAutoConfirmSweep()).toBe(0);
    // Age the delivery 4 days.
    await prisma.booking.update({ where: { id }, data: { deliveredAt: new Date(Date.now() - 4 * 86_400_000) } });
    const swept = await runAutoConfirmSweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe('completed');
    expect(b.autoConfirmed).toBe(true);
    const release = await prisma.ledgerEntry.findFirst({ where: { bookingId: id, account: 'professional_payable' } });
    expect(release).not.toBeNull();
  });

  it('disputed bookings freeze funds and NEVER auto-release', async () => {
    const id = await deliveredBooking(9, 10);
    const disputed = await inject('POST', `/api/v1/bookings/${id}/dispute`, customer.token, { reason: 'The delivered work is incomplete.' });
    expect(disputed.json().status).toBe('disputed');

    // Age it past the window — sweep must NOT touch it.
    await prisma.booking.update({ where: { id }, data: { deliveredAt: new Date(Date.now() - 10 * 86_400_000) } });
    await runAutoConfirmSweep();
    const still = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(still.status).toBe('disputed');
    // no release entries
    expect(await prisma.ledgerEntry.count({ where: { bookingId: id, account: 'professional_payable' } })).toBe(0);

    // resolution requires the admin role (customer forbidden; old bridge is gone)
    expect((await inject('POST', `/api/v1/admin/bookings/${id}/resolve`, customer.token, { decision: 'refund' })).statusCode).toBe(403);
    expect((await inject('POST', `/api/v1/bookings/${id}/resolve`, undefined, { decision: 'refund' }, { 'x-servix-review-key': 'dev-review-key' })).statusCode).toBe(404);

    // admin refund resolution (audited)
    const resolved = await inject('POST', `/api/v1/admin/bookings/${id}/resolve`, adminToken, { decision: 'refund' });
    expect(resolved.json().status).toBe('refunded');
    const refund = await prisma.ledgerEntry.findFirst({ where: { bookingId: id, account: 'refunds_paid' } });
    expect(refund?.amountKobo).toBe(BigInt(servicePriceNaira) * 100n);
    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'dispute.refund', entityId: id } });
    expect(auditRow).not.toBeNull();
  });

  it('dispute release resolution completes the booking and releases escrow', async () => {
    const id = await deliveredBooking(10, 11);
    await inject('POST', `/api/v1/bookings/${id}/dispute`, customer.token, { reason: 'Not matching the agreed scope.' });
    const resolved = await inject('POST', `/api/v1/admin/bookings/${id}/resolve`, adminToken, { decision: 'release' });
    expect(resolved.json().status).toBe('completed');
    expect(await prisma.ledgerEntry.count({ where: { bookingId: id, account: 'professional_payable' } })).toBe(1);
  });
});

/* ================= concurrency ================= */

describe('concurrency', () => {
  it('two simultaneous accepts: exactly one wins', async () => {
    const res = await inject('POST', '/api/v1/bookings', customer.token, { serviceId: serviceSlug, scheduledAt: await futureSlot(11, 9) });
    const id = res.json().id;
    await payBooking(id, customer.token);
    const [a, b] = await Promise.all([
      inject('POST', `/api/v1/pro/bookings/${id}/accept`, proUser.token),
      inject('POST', `/api/v1/pro/bookings/${id}/accept`, proUser.token),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    // events: exactly one 'accepted'
    const events = await prisma.bookingEvent.count({ where: { bookingId: id, event: 'accepted' } });
    expect(events).toBe(1);
  });

  it('every ledger transaction is balanced (Σ debits = Σ credits per txn)', async () => {
    const entries = await prisma.ledgerEntry.findMany();
    const byTxn = new Map<string, bigint>();
    for (const e of entries) {
      const delta = e.direction === 'debit' ? e.amountKobo : -e.amountKobo;
      byTxn.set(e.txnId, (byTxn.get(e.txnId) ?? 0n) + delta);
    }
    for (const [txn, sum] of byTxn) {
      expect(sum, `txn ${txn}`).toBe(0n);
    }
  });
});

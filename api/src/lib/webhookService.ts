/**
 * Webhook (re)processing shared by the HTTP route and the retry job.
 * Idempotent end-to-end: events keyed by UNIQUE(provider, provider_id);
 * capture is a CAS; replays no-op.
 */
import { prisma } from './db.js';
import { capturePayment } from './bookingService.js';
import { getPaymentProvider } from './payments.js';
import { enqueueMail } from './jobs.js';
import { bookingConfirmedMail, paymentReceivedMail } from './mailer.js';

interface PaystackEventShape {
  event: string;
  data: { reference?: string };
}

export async function processWebhookEvent(eventId: string, event: PaystackEventShape): Promise<void> {
  if (event.event === 'charge.success' && event.data.reference) {
    const payment = await prisma.payment.findUnique({ where: { reference: event.data.reference } });
    if (!payment) throw new Error(`No payment for reference ${event.data.reference}`);

    const verification = await getPaymentProvider().verify(payment.reference);
    if (verification.status !== 'success') {
      throw new Error(`Verification returned ${verification.status}`);
    }
    if (verification.amountKobo !== payment.amountKobo || verification.currency !== payment.currency) {
      throw new Error(
        `Amount mismatch: expected ${payment.amountKobo} ${payment.currency}, got ${verification.amountKobo} ${verification.currency}`,
      );
    }
    const booking = await capturePayment(payment.id, payment.bookingId, payment.amountKobo);
    if (booking) {
      const customer = await prisma.user.findUnique({ where: { id: booking.customerId } });
      if (customer) {
        await enqueueMail(
          paymentReceivedMail(customer.email, booking.reference, `₦${(booking.amountKobo / 100n).toLocaleString('en-NG')}`),
          `payment-mail-${payment.id}`,
        );
        await enqueueMail(
          bookingConfirmedMail(customer.email, booking.reference, booking.serviceTitle, booking.scheduledAt.toISOString()),
          `booking-mail-${booking.id}`,
        );
      }
    }
  } else if (event.event === 'charge.failed' && event.data.reference) {
    await prisma.payment.updateMany({
      where: { reference: event.data.reference, status: 'initiated' },
      data: { status: 'failed' },
    });
  }
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), error: null } });
}

/** Job handler: reprocess a stored event that previously errored. */
export async function reprocessWebhookEvent(eventId: string): Promise<void> {
  const stored = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!stored || stored.processedAt) return; // idempotent
  await processWebhookEvent(stored.id, stored.payload as unknown as PaystackEventShape);
}

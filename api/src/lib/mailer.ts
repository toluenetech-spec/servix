/**
 * Email delivery (Phase E).
 *
 * Transports:
 *  - console  — dev: prints the message; never used in production
 *               (validateProductionConfig refuses console in prod)
 *  - resend   — production: HTTPS API call; sendMail resolves ONLY when
 *               the provider accepts the message (2xx + id). No delivery
 *               is ever claimed otherwise.
 *  - noop     — tests
 *
 * In Phase E all sends go through the job queue (lib/jobs.ts) so SMTP/API
 * latency and retries never sit on the HTTP request path.
 */
import { loadConfig } from './config.js';

const config = loadConfig();

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  accepted: boolean;
  providerId: string | null;
}

export async function deliverMail(mail: Mail): Promise<SendResult> {
  const mode = (process.env.EMAIL_MODE as 'console' | 'resend' | 'noop') ?? config.emailMode;
  if (mode === 'noop') return { accepted: true, providerId: 'noop' };

  if (mode === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Servix <no-reply@servix.app>',
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`resend rejected (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { id?: string };
    return { accepted: true, providerId: data.id ?? null };
  }

  // console transport (development)
  console.log('--- EMAIL (console transport) ---');
  console.log(`To:      ${mail.to}`);
  console.log(`Subject: ${mail.subject}`);
  console.log(mail.text);
  console.log('---------------------------------');
  return { accepted: true, providerId: 'console' };
}

/* ---------------- templates ---------------- */

const appBase = () => process.env.APP_BASE_URL ?? 'http://localhost:5173';

export function verifyEmailMail(to: string, token: string): Mail {
  return {
    to,
    subject: 'Verify your Servix email address',
    text: `Welcome to Servix.\n\nConfirm your email address by opening this link:\n${appBase()}/verify-email?token=${token}\n\nThe link expires in 24 hours. If you did not create a Servix account, ignore this email.`,
  };
}

export function resetPasswordMail(to: string, token: string): Mail {
  return {
    to,
    subject: 'Reset your Servix password',
    text: `A password reset was requested for your Servix account.\n\nChoose a new password here:\n${appBase()}/reset-password?token=${token}\n\nThe link expires in 30 minutes. If you did not request this, ignore this email — your password is unchanged.`,
  };
}

export function bookingConfirmedMail(to: string, ref: string, serviceTitle: string, when: string): Mail {
  return {
    to,
    subject: `Booking ${ref} confirmed — ${serviceTitle}`,
    text: `Your payment is confirmed and your booking request has been sent to the professional.\n\nBooking: ${serviceTitle}\nReference: ${ref}\nScheduled: ${when}\n\nTrack it here: ${appBase()}/bookings`,
  };
}

export function paymentReceivedMail(to: string, ref: string, amount: string): Mail {
  return {
    to,
    subject: `Payment received for booking ${ref}`,
    text: `We received your payment of ${amount}. It is held securely and only released to the professional after you confirm completion.\n\nReference: ${ref}`,
  };
}

export function bookingCancelledMail(to: string, ref: string, refunded: boolean): Mail {
  return {
    to,
    subject: `Booking ${ref} cancelled`,
    text: `Booking ${ref} has been cancelled.${refunded ? ' Your refund has been recorded and will be returned via your payment method.' : ''}`,
  };
}

export function disputeOpenedMail(to: string, ref: string): Mail {
  return {
    to,
    subject: `Dispute opened on booking ${ref}`,
    text: `A dispute has been opened on booking ${ref}. Funds are on hold while the Servix team reviews it. We may contact you for details.`,
  };
}

export function disputeResolvedMail(to: string, ref: string, outcome: 'released' | 'refunded'): Mail {
  return {
    to,
    subject: `Dispute resolved on booking ${ref}`,
    text: `The dispute on booking ${ref} has been resolved: payment ${outcome === 'released' ? 'released to the professional' : 'refunded to the customer'}.`,
  };
}

export function payoutSentMail(to: string, reference: string, amount: string): Mail {
  return {
    to,
    subject: `Payout ${reference} sent`,
    text: `Your payout of ${amount} has been sent (reference ${reference}). Depending on your bank it may take a short while to arrive.`,
  };
}

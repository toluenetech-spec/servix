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
import { loadConfig, resolveEmailMode } from './config.js';

const config = loadConfig();

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  accepted: boolean;
  providerId: string | null;
}

const PROVIDER_TIMEOUT_MS = 15_000;

function fromParts(): { name: string; email: string } {
  const combined = process.env.EMAIL_FROM;
  if (combined) {
    const m = combined.match(/^(.*)<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || 'Servix', email: m[2].trim() };
    return { name: process.env.EMAIL_FROM_NAME ?? 'Servix', email: combined.trim() };
  }
  return {
    name: process.env.EMAIL_FROM_NAME ?? 'Servix',
    email: process.env.EMAIL_FROM_EMAIL ?? 'no-reply@servix.app',
  };
}

export async function deliverMail(mail: Mail): Promise<SendResult> {
  const mode = resolveEmailMode();
  if (mode === 'noop') return { accepted: true, providerId: 'noop' };

  if (mode === 'brevo') {
    const from = fromParts();
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: {
        'api-key': process.env.BREVO_API_KEY ?? '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: from.name, email: from.email },
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        ...(mail.html ? { htmlContent: mail.html } : {}),
      }),
    });
    if (!res.ok) {
      // Do not retain provider bodies that may reflect recipient details or OTPs.
      throw new Error(`brevo rejected (${res.status})`);
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { accepted: true, providerId: data.messageId ?? null };
  }

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
        ...(mail.html ? { html: mail.html } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`resend rejected (${res.status})`);
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

/** Branded body, not a mailbox-provider-controlled sender avatar. */
export function emailOtpMail(to: string, code: string): Mail {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid email code format');
  const logo = process.env.EMAIL_LOGO_URL ?? `${appBase().replace(/\/$/, '')}/brand/servix-email-logo.png`;
  let image = '';
  try {
    const url = new URL(logo);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      const safe = url.href.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
      image = `<img src="${safe}" alt="Servix" width="160" style="display:block;max-width:160px;height:auto;margin-bottom:24px">`;
    }
  } catch { /* A readable wordmark remains when no logo is configured. */ }
  return {
    to, subject: 'Your Servix email verification code',
    text: `Your Servix verification code is ${code}.\n\nEnter it on the Servix verification page. It expires in 10 minutes and works once. Never share this code. If you did not request it, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f7f5ed;color:#163b2e;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #e5e7df;border-radius:16px"><tr><td style="padding:32px">${image || '<p style="font-size:24px;font-weight:bold">SERVIX</p>'}<h1 style="font-size:26px">Verify your email</h1><p style="color:#52625a;line-height:1.6">One quick check to confirm this email belongs to you. Enter this code on your Servix verification page.</p><p style="font-size:36px;letter-spacing:8px;font-weight:bold;background:#eef5ef;padding:20px;text-align:center">${code}</p><p>Expires in <strong>10 minutes</strong>. Use only once.</p><hr style="border:0;border-top:1px solid #e5e7df"><p style="font-size:13px;color:#52625a">Never share this code. Servix support will never ask for it. If you did not request this email, you can ignore it.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

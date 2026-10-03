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
import { resolveEmailMode } from './config.js';
import { emailAppLink, renderEmail, type EmailContent } from './emailTemplate.js';


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

function brandedMail(to: string, subject: string, content: EmailContent): Mail {
  return { to, subject, ...renderEmail(content) };
}

export function verifyEmailMail(to: string, token: string): Mail {
  return brandedMail(to, 'Verify your Servix email address', {
    category: 'Account', status: 'One small step', preheader: 'Confirm your email to continue with Servix. This link expires in 24 hours.',
    title: 'Welcome to Servix.',
    paragraphs: ['You’re one step closer to finding the right professional—or sharing your expertise. Confirm your email address to continue.'],
    action: { label: 'Verify email address', url: emailAppLink('/verify-email', { token }) },
    note: { title: 'This link expires in 24 hours', text: 'If you did not create a Servix account, you can ignore this email. Never share your verification link.' },
  });
}
export function resetPasswordMail(to: string, token: string): Mail {
  return brandedMail(to, 'Reset your Servix password', {
    category: 'Account security', status: 'Password reset requested', preheader: 'Choose a new password using your private reset link. Expires in 30 minutes.',
    title: 'A fresh start for your password.',
    paragraphs: ['We received a request to reset your Servix password. Use the button below to choose a new, unique password.'],
    action: { label: 'Reset my password', url: emailAppLink('/reset-password', { token }) },
    note: { title: 'Didn’t request this?', text: 'Your password has not changed. Ignore this email if the request wasn’t yours. This private link expires in 30 minutes; never share it.' },
  });
}
function scheduledTime(value: string): string {
  // Only format explicit timestamps; preserve already-human-readable legacy values.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(date) + ' (Lagos time, WAT)';
}
const bookingsAction = () => ({ label: 'View my bookings', url: emailAppLink('/bookings') });
export function bookingConfirmedMail(to: string, ref: string, serviceTitle: string, when: string): Mail {
  return brandedMail(to, `Booking ${ref} confirmed — ${serviceTitle}`, {
    category: 'Bookings', status: 'Payment confirmed', preheader: 'Your payment is confirmed and your booking request has been sent to the professional.',
    title: 'Your booking request is in.',
    paragraphs: ['Your payment is confirmed. We’ve sent your booking request to the professional. You can follow its progress from your bookings page.'],
    details: [['Service', serviceTitle], ['Booking reference', ref], ['Scheduled for', scheduledTime(when)]], action: bookingsAction(),
    note: { title: 'Keep everything in one place', text: 'Check your booking page for the latest status and service details.' },
  });
}
export function paymentReceivedMail(to: string, ref: string, amount: string): Mail {
  return brandedMail(to, `Payment received for booking ${ref}`, {
    category: 'Payments', status: 'Payment received', preheader: 'Your payment has been recorded. View your booking for details.',
    title: 'Payment received. Thank you.',
    paragraphs: ['We’ve received your payment for this booking. You can review the booking and track its progress in your Servix account.'],
    details: [['Amount received', amount], ['Booking reference', ref]], action: bookingsAction(),
  });
}
export function bookingCancelledMail(to: string, ref: string, refunded: boolean): Mail {
  return brandedMail(to, `Booking ${ref} cancelled`, {
    category: 'Bookings', status: 'Booking update', preheader: 'Your booking has been cancelled. Review the details inside.',
    title: 'Your booking has been cancelled.', paragraphs: ['This booking is no longer scheduled to go ahead.'],
    details: [['Booking reference', ref], ['Status', 'Cancelled']], action: bookingsAction(),
    note: refunded ? { title: 'About your refund', text: 'Your refund has been recorded and will be returned via your payment method. This notice does not confirm that it has reached your account.' } : { title: 'Need a hand?', text: 'If you have a question about this cancellation, contact our support team with your booking reference.' },
  });
}
export function disputeOpenedMail(to: string, ref: string): Mail {
  return brandedMail(to, `Dispute opened on booking ${ref}`, {
    category: 'Booking support', status: 'Under review', preheader: 'A dispute has been opened. Funds are on hold while our team reviews it.',
    title: 'We’re reviewing your booking.', paragraphs: ['A dispute has been opened on this booking. Funds are on hold while the Servix team reviews it. We may contact you for more details.'],
    details: [['Booking reference', ref], ['Status', 'Dispute opened']], action: bookingsAction(),
    note: { title: 'Keep your booking details handy', text: 'Any relevant service details can help our team understand what happened. Never share passwords or verification codes.' },
  });
}
export function disputeResolvedMail(to: string, ref: string, outcome: 'released' | 'refunded'): Mail {
  const result = outcome === 'released' ? 'Payment released to the professional' : 'Payment refunded to the customer';
  return brandedMail(to, `Dispute resolved on booking ${ref}`, {
    category: 'Booking support', status: 'Review complete', preheader: 'The dispute on your booking has been resolved. See the outcome inside.',
    title: 'Your dispute has been resolved.', paragraphs: ['Our review of this booking is complete. The outcome is recorded below.'],
    details: [['Booking reference', ref], ['Outcome', result]], action: bookingsAction(),
    note: { title: 'Questions about the outcome?', text: 'Contact Servix support and include your booking reference so we can help.' },
  });
}
export function payoutSentMail(to: string, reference: string, amount: string): Mail {
  return brandedMail(to, `Payout ${reference} sent`, {
    category: 'Professional payments', status: 'Payout sent', preheader: 'Your payout has been sent. Bank processing times may vary.',
    title: 'Your payout is on its way.', paragraphs: ['Your payout has been sent. Depending on your bank, it may take a short while to arrive.'],
    details: [['Payout amount', amount], ['Payout reference', reference]],
    action: { label: 'Open my workspace', url: emailAppLink('/pro') },
  });
}
export function emailOtpMail(to: string, code: string, purpose: 'registration' | 'login' | 'reset' = 'registration'): Mail {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid email code format');
  const copy = {
    registration: { subject: 'Your Servix email verification code', title: 'Let’s verify your email.', intro: 'Enter this code on the Servix verification page to confirm this email address belongs to you.' },
    login: { subject: 'Your Servix sign-in verification code', title: 'Your sign-in code is here.', intro: 'Enter this code on the Servix sign-in page to continue. Next, verify with your saved security method—or set one up if this is your first time.' },
    reset: { subject: 'Your Servix password reset verification code', title: 'Let’s get you back in.', intro: 'Enter this code on the Servix password recovery page. Your existing security method or a recovery code is also required before you can change your password.' },
  }[purpose];
  return brandedMail(to, copy.subject, {
    category: 'Account security', status: 'Verify it’s you', preheader: 'Your private verification code is inside. It expires in 10 minutes.',
    title: copy.title, paragraphs: [copy.intro], code,
    note: { title: 'Keep this code private', text: 'Never share this code. Servix support will never ask for it. If you did not request this email, ignore it. Return to the Servix page where you started to enter your code.' },
  });
}
export function securityNoticeMail(to: string, action: string, message: string): Mail {
  const titles: Record<string, string> = {
    'security.enrolled': 'Your security method is set.',
    'security.recovery_used': 'A recovery code was used.',
    'security.password_reset': 'Your password has been updated.',
    'security.provider_linked': 'A sign-in provider was connected.',
  };
  const title = titles[action] ?? 'An update to your account security.';
  return brandedMail(to, `Servix security update: ${title}`, {
    category: 'Account security', status: 'Important account activity', preheader: 'Review this security change to your Servix account. Contact support if it wasn’t you.',
    title, paragraphs: [message],
    note: { title: 'Don’t recognise this activity?', text: 'Contact Servix support immediately using the link below. Never share your password, verification codes or recovery codes—even with someone claiming to be support.' },
  });
}

export function kycOutcomeMail(to: string, outcome: 'approved' | 'rejected', reason?: string | null): Mail {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  const link = `${base}/dashboard/identity`;
  if (outcome === 'approved') {
    return {
      to,
      subject: 'Your identity has been verified',
      text: `Good news — your identity verification on Servix was approved. Verified features such as publishing gigs and requesting payouts are now open to you.\n\n${link}`,
      html: `<p>Good news — your identity verification on Servix was <strong>approved</strong>.</p><p>Verified features such as publishing gigs and requesting payouts are now open to you.</p><p><a href="${link}">Open your dashboard</a></p>`,
    };
  }
  const why = (reason ?? '').trim() || 'The documents could not be verified.';
  return {
    to,
    subject: 'Action needed: identity verification was not approved',
    text: `We could not verify your identity on Servix.\n\nReason: ${why}\n\nYou can submit fresh documents at any time: ${link}`,
    html: `<p>We could not verify your identity on Servix.</p><p><strong>Reason:</strong> ${why.replace(/</g, '&lt;')}</p><p>You can submit fresh documents at any time: <a href="${link}">Identity verification</a></p>`,
  };
}
export function teamInviteMail(to: string, teamName: string, inviterName: string, token: string): Mail {
  return brandedMail(to, `${inviterName} invited you to ${teamName} on Servix`, {
    category: 'Team', status: 'Invitation', preheader: `Join ${teamName} on Servix to share work, requests and AI tools with your team.`,
    title: `You’re invited to ${teamName}.`,
    paragraphs: [`${inviterName} has invited you to join the ${teamName} workspace on Servix. Accept the invitation to work alongside your team, share service requests and proposals, and use the team’s Servix AI allowance.`],
    action: { label: 'Accept invitation', url: emailAppLink('/join-team', { token }) },
    note: { title: 'This invitation expires in 7 days', text: 'If you were not expecting this invitation you can ignore this email. Accepting requires a Servix account with this email address.' },
  });
}

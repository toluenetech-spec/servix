/**
 * Email delivery abstraction.
 *
 * Phase B ships with a console transport (links logged to stdout) so the
 * flow is fully testable without an email provider. Production swaps in
 * Resend/SES here — one file, no route changes. No fake "email sent"
 * claims are surfaced to users beyond the neutral copy in the UI.
 */
import { loadConfig } from './config.js';

const config = loadConfig();

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (config.emailMode === 'noop') return;
  // console transport (development / staging)
  console.log('--- EMAIL (console transport) ---');
  console.log(`To:      ${mail.to}`);
  console.log(`Subject: ${mail.subject}`);
  console.log(mail.text);
  console.log('---------------------------------');
}

export function verifyEmailMail(to: string, token: string): Mail {
  const link = `${config.appBaseUrl}/verify-email?token=${token}`;
  return {
    to,
    subject: 'Verify your Servix email address',
    text: `Welcome to Servix.\n\nConfirm your email address by opening this link:\n${link}\n\nThe link expires in 24 hours. If you did not create a Servix account, ignore this email.`,
  };
}

export function resetPasswordMail(to: string, token: string): Mail {
  const link = `${config.appBaseUrl}/reset-password?token=${token}`;
  return {
    to,
    subject: 'Reset your Servix password',
    text: `A password reset was requested for your Servix account.\n\nChoose a new password here:\n${link}\n\nThe link expires in 30 minutes. If you did not request this, you can safely ignore it.`,
  };
}

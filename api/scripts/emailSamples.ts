/** Synthetic preview data only. No delivery or database access. */
import * as mail from '../src/lib/mailer.js';
export function emailSamples() {
  const to = 'preview@example.test';
  const ref = 'SVX-2026-0148';
  return [
    { id: 'welcome', label: 'Welcome & verification', group: 'Account', mail: mail.verifyEmailMail(to, 'PREVIEW-ONLY-NOT-A-REAL-TOKEN') },
    { id: 'reset-link', label: 'Password reset link', group: 'Account', mail: mail.resetPasswordMail(to, 'PREVIEW-ONLY-NOT-A-REAL-TOKEN') },
    { id: 'registration-code', label: 'Email verification code', group: 'Account', mail: mail.emailOtpMail(to, '284619') },
    { id: 'login-code', label: 'Sign-in code', group: 'Account', mail: mail.emailOtpMail(to, '284619', 'login') },
    { id: 'reset-code', label: 'Password recovery code', group: 'Account', mail: mail.emailOtpMail(to, '284619', 'reset') },
    { id: 'booking', label: 'Booking confirmation', group: 'Services & payments', mail: mail.bookingConfirmedMail(to, ref, 'Home cleaning · Standard clean', '2026-10-02T09:00:00.000Z') },
    { id: 'payment', label: 'Payment received', group: 'Services & payments', mail: mail.paymentReceivedMail(to, ref, '₦35,000') },
    { id: 'cancellation', label: 'Booking cancelled', group: 'Services & payments', mail: mail.bookingCancelledMail(to, ref, false) },
    { id: 'cancellation-refund', label: 'Cancellation & refund', group: 'Services & payments', mail: mail.bookingCancelledMail(to, ref, true) },
    { id: 'dispute-open', label: 'Dispute under review', group: 'Services & payments', mail: mail.disputeOpenedMail(to, ref) },
    { id: 'dispute-released', label: 'Dispute resolved · release', group: 'Services & payments', mail: mail.disputeResolvedMail(to, ref, 'released') },
    { id: 'dispute-refunded', label: 'Dispute resolved · refund', group: 'Services & payments', mail: mail.disputeResolvedMail(to, ref, 'refunded') },
    { id: 'payout', label: 'Professional payout', group: 'Services & payments', mail: mail.payoutSentMail(to, 'PAY-2026-0062', '₦28,000') },
    { id: 'enrolled', label: 'Security method added', group: 'Security alerts', mail: mail.securityNoticeMail(to, 'security.enrolled', 'A Google Authenticator-compatible authenticator was enrolled on your Servix account.') },
    { id: 'recovery-used', label: 'Recovery code used', group: 'Security alerts', mail: mail.securityNoticeMail(to, 'security.recovery_used', 'A single-use recovery code was used on your account. Existing sessions have been signed out.') },
    { id: 'password-changed', label: 'Password changed', group: 'Security alerts', mail: mail.securityNoticeMail(to, 'security.password_reset', 'Your Servix password was reset. Existing sessions have been signed out.') },
    { id: 'provider-linked', label: 'Sign-in provider connected', group: 'Security alerts', mail: mail.securityNoticeMail(to, 'security.provider_linked', 'A Google sign-in was connected to your Servix account.') },
  ];
}

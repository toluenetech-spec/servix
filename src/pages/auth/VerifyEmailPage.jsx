import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

export default function VerifyEmailPage() {
  useDocumentMeta({
    title: 'Verify Email',
    description: 'Verify the email address for your Servix account.',
  });

  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, verifyEmail, resendVerification, authAvailable, setUser } = useAuth();
  // idle | verifying | verified | failed
  const [state, setState] = useState(token && authAvailable ? 'verifying' : 'idle');
  const attempted = useRef(false);

  // If the page was opened from an email link, verify automatically.
  useEffect(() => {
    if (!token || !authAvailable || attempted.current) return;
    attempted.current = true;
    verifyEmail(token)
      .then((verifiedUser) => {
        setState('verified');
        if (verifiedUser) setUser(verifiedUser);
      })
      .catch(() => setState('failed'));
  }, [token, authAvailable, verifyEmail, setUser]);

  async function onResend() {
    if (!authAvailable) {
      showToast('Email verification launches with the Servix platform.', 'info');
      return;
    }
    if (!user) {
      showToast('Sign in first, then resend the verification email.', 'info');
      return;
    }
    try {
      const res = await resendVerification();
      showToast(
        res.alreadyVerified ? 'Your email is already verified.' : 'Verification email sent.',
        'success',
      );
    } catch (err) {
      if (err.status === 429) showToast('Please wait a few minutes before resending.', 'error');
      else showToast('Could not resend right now. Please try again.', 'error');
    }
  }

  const icon = state === 'verified' ? 'check-circle' : state === 'failed' ? 'alert' : 'mail';

  return (
    <AuthShell>
      <div
        style={{
          width: '3.5rem',
          height: '3.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-full)',
          background: state === 'failed' ? 'rgba(179, 55, 42, 0.1)' : 'rgba(31, 92, 69, 0.1)',
          color: state === 'failed' ? 'var(--danger)' : 'var(--color-forest)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Icon name={icon} size={24} />
      </div>

      {state === 'verifying' && (
        <>
          <h1>Verifying…</h1>
          <p>Confirming your email address.</p>
        </>
      )}

      {state === 'verified' && (
        <>
          <h1>Email verified</h1>
          <p>Your email address is confirmed and your account is active.</p>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Button variant="primary" size="lg" block to="/">
              Continue to Servix
            </Button>
          </div>
        </>
      )}

      {state === 'failed' && (
        <>
          <h1>Link invalid or expired</h1>
          <p>
            This verification link is no longer valid. Request a new one below —
            links expire after 24 hours.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Button variant="primary" size="lg" block onClick={onResend}>
              Resend Verification Email
            </Button>
            <Button variant="secondary" size="lg" block to="/login">
              Back to Sign In
            </Button>
          </div>
        </>
      )}

      {state === 'idle' && (
        <>
          <h1>Check your inbox</h1>
          <p>
            {authAvailable
              ? 'We sent a verification link to your email address. Clicking it confirms your account.'
              : 'When accounts go live, we\u2019ll send a verification link to your email address. Clicking it confirms your account and unlocks bookings.'}
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Button variant="primary" size="lg" block onClick={onResend}>
              Resend Verification Email
            </Button>
            <Button variant="secondary" size="lg" block to="/">
              Back to Home
            </Button>
          </div>
        </>
      )}

      <p className="auth__meta">
        Wrong address? <Link to="/register">Update your details</Link>
      </p>
    </AuthShell>
  );
}

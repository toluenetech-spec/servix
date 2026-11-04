import { useEffect, useRef, useState } from 'react';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { verifyEmailCode } from '../../lib/authApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

export function EmailCodeVerification() {
  useDocumentMeta({ title: 'Verify your email', description: 'Confirm your Servix email with a single-use code.' });
  const { user, initializing, setUser, resendVerification } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [wait, setWait] = useState(0);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setWait((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    if (!/^\d{6}$/.test(code)) { setError('Enter all six digits from your latest email.'); return; }
    pending.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await verifyEmailCode(code);
      setUser(updated); setVerified(true); setCode('');
    } catch (err) {
      if (err.status === 401) setError('Your session expired. Sign in again to continue verification.');
      else if (err.status === 429) setError(err.code === 'OTP_LIMIT' ? 'Too many attempts. Wait one hour before trying again.' : 'Please wait a minute before trying again.');
      else if (err.status === 400) setError('That code is incorrect, expired, or already used. Use the newest email or request a new code.');
      else setError('We could not check your code. Check your connection and try again.');
    } finally { pending.current = false; setBusy(false); }
  }

  async function resend() {
    if (pending.current || wait > 0) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await resendVerification();
      if (result.alreadyVerified) { setVerified(true); }
      else {
        setWait(result.retryAfterSeconds ?? 60); setCode('');
        setNotice('A new code is queued for delivery. Check your inbox and spam folder. Only the newest code will work.');
      }
    } catch (err) {
      if (err.status === 429) { setWait(err.code === 'OTP_LIMIT' ? 3600 : 60); setError('You have reached the request limit. Please wait before requesting another code.'); }
      else if (err.status === 401) setError('Sign in again before requesting a code.');
      else setError('We could not request another code. Please try again shortly.');
    } finally { pending.current = false; setBusy(false); }
  }

  if (initializing) return <AuthShell><h1>Checking your session…</h1><p role="status">Please wait a moment.</p></AuthShell>;
  if (!user) return <AuthShell><h1>Let’s verify your email</h1><p>Sign in to the account you want to verify. This keeps your code linked to the right account.</p><Button to="/login" block>Sign in to continue</Button></AuthShell>;
  if (verified || user.emailVerified) return <AuthShell>
    <div style={{ color: 'var(--color-forest)', marginBottom: 'var(--space-4)' }}><Icon name="check-circle" size={40} /></div>
    <h1>Email confirmed</h1><p role="status">Your email address has been verified successfully.</p>
    <p>You can close this verification page. Keep your account password private.</p>
    <Button to="/dashboard" block size="lg">Go to dashboard</Button>
  </AuthShell>;
  return <AuthShell>
    <p style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-forest)' }}>ACCOUNT VERIFICATION</p>
    <h1>Your inbox. Your code.</h1>
    <p>Enter the six-digit code sent to <strong style={{ overflowWrap: 'anywhere' }}>{user.email}</strong>. It expires after 10 minutes.</p>
    <form className="auth__form" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Email verification code" required error={error} hint="Use the newest code. You can paste all six digits at once.">
        {(props) => <input {...props} className="input" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} value={code}
          style={{ fontSize: '1.75rem', letterSpacing: '0.35em', textAlign: 'center' }}
          onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} />}
      </Field>
      <Button type="submit" size="lg" block disabled={busy}>{busy ? 'Please wait…' : 'Verify email'}</Button>
      {notice && <p role="status" style={{ color: 'var(--color-forest)' }}>{notice}</p>}
      <Button type="button" variant="secondary" block disabled={busy || wait > 0} onClick={resend}>
        {wait > 0 ? `Request another code in ${wait}s` : 'Send a new code'}
      </Button>
    </form>
    <p className="auth__meta">Never share your code. Servix support will never ask for it.</p>
  </AuthShell>;
}

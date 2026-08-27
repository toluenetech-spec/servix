import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  useDocumentMeta({
    title: 'Forgot Password',
    description: 'Reset your Servix account password.',
  });

  const showToast = useToast();
  const { forgotPassword, authAvailable } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Please enter your email address.');
    if (!EMAIL_RE.test(email)) return setError('Please enter a valid email address.');
    setError('');

    if (!authAvailable) {
      showToast('Password reset launches with the Servix platform. Accounts are not live yet.', 'info');
      return;
    }

    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      if (err.status === 429) showToast('Too many requests. Please wait a few minutes.', 'error');
      else showToast('Password reset is temporarily unavailable. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <h1>Check your inbox</h1>
        <p>
          If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a
          password reset link. The link expires in 30 minutes.
        </p>
        <p className="auth__meta">
          <Link to="/login">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1>Reset your password</h1>
      <p>Enter your account email and we&rsquo;ll send you a reset link.</p>
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <Field label="Email" required error={error}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Reset Link'}
        </Button>
      </form>
      <p className="auth__meta">
        Remembered it? <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

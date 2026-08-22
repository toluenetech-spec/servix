import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  useDocumentMeta({
    title: 'Forgot Password',
    description: 'Reset your Servix account password.',
  });

  const showToast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  function onSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Please enter your email address.');
    if (!EMAIL_RE.test(email)) return setError('Please enter a valid email address.');
    setError('');
    showToast('Password reset launches with the Servix platform. Accounts are not live yet.', 'info');
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
        <Button type="submit" variant="primary" size="lg" block>
          Send Reset Link
        </Button>
      </form>
      <p className="auth__meta">
        Remembered it? <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

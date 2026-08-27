import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  useDocumentMeta({
    title: 'Sign In',
    description: 'Sign in to your Servix account to manage bookings and services.',
  });

  const showToast = useToast();
  const navigate = useNavigate();
  const { login, authAvailable } = useAuth();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!values.email.trim()) next.email = 'Please enter your email address.';
    else if (!EMAIL_RE.test(values.email)) next.email = 'Please enter a valid email address.';
    if (!values.password) next.password = 'Please enter your password.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!authAvailable) {
      // Honest pre-launch behaviour when no backend is configured.
      showToast('Sign in launches with the Servix platform. Accounts are not live yet.', 'info');
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: values.email, password: values.password });
      showToast('Welcome back.', 'success');
      navigate('/');
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      else if (err.status === 401) setErrors({ password: 'Incorrect email or password.' });
      else if (err.status === 403) showToast(err.message, 'error');
      else if (err.status === 429) showToast('Too many attempts. Please wait a minute.', 'error');
      else showToast('Sign in is temporarily unavailable. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p>Sign in to manage your bookings and services.</p>
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <Field label="Email" required error={errors.email}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Password" required error={errors.password}>
          {(props) => (
            <div className="input-wrap input-wrap--action" style={{ position: 'relative' }}>
              <input
                {...props}
                className="input"
                style={{ paddingLeft: 'var(--space-4)' }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={values.password}
                onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              />
              <button
                type="button"
                className="input-wrap__action"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          )}
        </Field>
        <div style={{ textAlign: 'right', marginTop: 'calc(-1 * var(--space-3))' }}>
          <Link
            to="/forgot-password"
            style={{ fontSize: 'var(--text-sm)', color: 'var(--color-forest)', fontWeight: 600 }}
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" block disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
      <p className="auth__meta">
        New to Servix? <Link to="/register">Create an account</Link>
      </p>
    </AuthShell>
  );
}

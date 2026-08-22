import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  useDocumentMeta({
    title: 'Create Account',
    description:
      'Create a Servix account — book professional services or join as a professional.',
  });

  const showToast = useToast();
  const [accountType, setAccountType] = useState('customer');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  function onSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!values.name.trim()) next.name = 'Please enter your full name.';
    if (!values.email.trim()) next.email = 'Please enter your email address.';
    else if (!EMAIL_RE.test(values.email)) next.email = 'Please enter a valid email address.';
    if (!values.password) next.password = 'Please create a password.';
    else if (values.password.length < 8)
      next.password = 'Password must be at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    showToast('Registration opens with the Servix platform launch. Accounts are not live yet.', 'info');
  }

  const typeBtn = (type, label, desc) => (
    <button
      type="button"
      onClick={() => setAccountType(type)}
      aria-pressed={accountType === type}
      style={{
        flex: 1,
        padding: 'var(--space-3) var(--space-4)',
        border: `1px solid ${accountType === type ? 'var(--color-deep-forest)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-sm)',
        background: accountType === type ? 'rgba(18, 55, 42, 0.05)' : 'var(--bg-surface)',
        textAlign: 'left',
        transition: 'border-color var(--dur-fast) var(--ease)',
      }}
    >
      <span style={{ display: 'block', fontWeight: 650, fontSize: 'var(--text-sm)' }}>{label}</span>
      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        {desc}
      </span>
    </button>
  );

  return (
    <AuthShell>
      <h1>Create your account</h1>
      <p>Join Servix as a customer or a professional.</p>
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 'var(--space-2)' }}>
            I want to
          </legend>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {typeBtn('customer', 'Book services', 'Find professionals')}
            {typeBtn('professional', 'Offer services', 'Grow my business')}
          </div>
        </fieldset>

        <Field label="Full name" required error={errors.name}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="text"
              autoComplete="name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          )}
        </Field>
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
        <Field
          label="Password"
          required
          error={errors.password}
          hint="At least 8 characters."
        >
          {(props) => (
            <div className="input-wrap input-wrap--action" style={{ position: 'relative' }}>
              <input
                {...props}
                className="input"
                style={{ paddingLeft: 'var(--space-4)' }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
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
        <Button type="submit" variant="primary" size="lg" block>
          Create Account
        </Button>
      </form>
      <p className="auth__meta">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

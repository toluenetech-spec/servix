import { ProviderButtons } from './ProviderButtons.jsx';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

import { PASSWORD_RULES, normalizeEmail, passwordsMatch, validateRegistration } from '../../lib/registrationValidation.js';

export default function RegisterPage() {
  useDocumentMeta({
    title: 'Create Account',
    description: 'Create a Servix account — book professional services or join as a professional.',
  });

  const showToast = useToast();
  const navigate = useNavigate();
  const { register, authAvailable } = useAuth();
  const [accountType, setAccountType] = useState('customer');
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError('');
    const next = validateRegistration(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!authAvailable) {
      showToast('Registration opens with the Servix platform launch. Accounts are not live yet.', 'info');
      return;
    }

    setSubmitting(true);
    try {
      const result = await register({
        fullName: values.name,
        email: normalizeEmail(values.email),
        password: values.password,
        accountType,
      });
      if (result?.security) { navigate('/security-check', { state: result.security }); return; }
      showToast('Account created. Check your inbox to verify your email.', 'success');
      navigate('/verify-email');
    } catch (err) {
      if (err.errors) {
        // API uses fullName; map back to the local field name.
        const mapped = { ...err.errors };
        if (mapped.fullName) mapped.name = mapped.fullName;
        setErrors(mapped);
      } else if (err.status === 429) {
        setSubmitError('Too many attempts. Please wait a minute before trying again. Your details are still here.');
      } else {
        setSubmitError('We could not finish creating your account. Check your connection and try again. If you already registered, try signing in.');
      }
    } finally {
      setSubmitting(false);
    }
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
      <ProviderButtons />
      <form className="auth__form" onSubmit={onSubmit} noValidate aria-busy={submitting}>
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
        <Field label="Password" required error={errors.password} hint="Choose a unique password you do not use elsewhere.">
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
        <ul aria-label="Password requirements" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 'var(--text-sm)' }}>
          {PASSWORD_RULES.map((rule) => {
            const met = Boolean(values.password) && rule.test(values.password);
            return <li key={rule.id} style={{ color: met ? 'var(--color-deep-forest)' : 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
              <span aria-hidden="true">{met ? '✓' : '○'} </span>
              <span className="sr-only">{met ? 'Met: ' : 'Not met: '}</span>{rule.label}
            </li>;
          })}
        </ul>
        <Field label="Confirm password" required error={errors.confirmPassword}
          hint={values.confirmPassword ? (passwordsMatch(values.password, values.confirmPassword) ? '✓ Passwords match' : 'Passwords do not match yet') : 'Enter your password again.'}>
          {(props) => <input {...props} className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
            value={values.confirmPassword} onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))} />}
        </Field>
        {submitError && <p role="alert" className="field__error">{submitError}</p>}
        <Button type="submit" variant="primary" size="lg" block disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>
      <p className="auth__meta">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

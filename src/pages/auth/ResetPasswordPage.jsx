import { PasswordRequirements } from './PasswordRequirements.jsx';
import { resetPasswordRules, passwordsMatch } from '../../lib/registrationValidation.js';
import { getResetPasswordPolicy } from '../../lib/authApi.js';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

export default function ResetPasswordPage() {
  useDocumentMeta({
    title: 'Set New Password',
    description: 'Choose a new password for your Servix account.',
  });

  const showToast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { resetPassword, authAvailable } = useAuth();
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [policy, setPolicy] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [retry, setRetry] = useState(0);
  const rules = resetPasswordRules(policy);
  useEffect(() => {
    let cancelled = false;
    setPolicy(null); setPolicyError('');
    if (!token || !authAvailable) {
      setPolicyError('Open a valid reset link from your email to continue.');
      return;
    }
    getResetPasswordPolicy(token).then(result => {
      if (!cancelled) setPolicy(result.passwordPolicy);
    }).catch(err => {
      if (!cancelled) setPolicyError(err.code === 'INVALID_TOKEN' ? 'This reset link is invalid or has expired. Request a new one.' : 'Unable to load password requirements. Please try again.');
    });
    return () => { cancelled = true; };
  }, [token, authAvailable, retry]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!policy) return;
    const next = {};
    if (!values.password) next.password = 'Please create a new password.';
    else if (!rules.every(rule => rule.test(values.password))) next.password = 'Please meet all the password requirements below.';
    if (values.confirm !== values.password) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!authAvailable) {
      showToast('Password reset launches with the Servix platform. Accounts are not live yet.', 'info');
      return;
    }
    if (!token) {
      showToast('This reset link is incomplete. Use the link from your email.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({ token, password: values.password });
      showToast('Password updated. Sign in with your new password.', 'success');
      navigate('/login');
    } catch (err) {
      if (err.code === 'INVALID_TOKEN') {
        showToast('This reset link is invalid or has expired. Request a new one.', 'error');
      } else if (err.errors) {
        setErrors(err.errors);
      } else {
        showToast('Password reset is temporarily unavailable. Please try again.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1>Choose a new password</h1>
      <p>Choose a unique password with at least 8 characters.</p>
      {!policy && !policyError && <p role="status">Loading password requirements…</p>}
      {policyError && <div role="alert">{policyError} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button> <Link to="/forgot-password">Request a new link</Link></div>}
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <Field label="New password" required error={errors.password}>
          {(props) => (
            <div className="input-wrap input-wrap--action" style={{ position: 'relative' }}>
              <input
                {...props}
                className="input"
                style={{ paddingLeft: 'var(--space-4)' }}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              />
              <button
                type="button"
                className="input-wrap__action"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                <Icon name={show ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          )}
        </Field>
        {policy && <PasswordRequirements password={values.password} rules={rules} />}
        <Field label="Confirm new password" required error={errors.confirm}
          hint={values.confirm ? passwordsMatch(values.password, values.confirm) ? '✓ Passwords match' : 'Passwords do not match yet' : 'Enter your new password again.'}>
          {(props) => (
            <input
              {...props}
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={values.confirm}
              onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block disabled={submitting || !policy}>
          {submitting ? 'Updating…' : 'Reset Password'}
        </Button>
      </form>
      <p className="auth__meta">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

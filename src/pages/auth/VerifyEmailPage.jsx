import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';

export default function VerifyEmailPage() {
  useDocumentMeta({
    title: 'Verify Email',
    description: 'Verify the email address for your Servix account.',
  });

  const showToast = useToast();

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
          background: 'rgba(31, 92, 69, 0.1)',
          color: 'var(--color-forest)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Icon name="mail" size={24} />
      </div>
      <h1>Check your inbox</h1>
      <p>
        When accounts go live, we&rsquo;ll send a verification link to your email
        address. Clicking it confirms your account and unlocks bookings.
      </p>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() =>
            showToast('Email verification launches with the Servix platform.', 'info')
          }
        >
          Resend Verification Email
        </Button>
        <Button variant="secondary" size="lg" block to="/">
          Back to Home
        </Button>
      </div>
      <p className="auth__meta">
        Wrong address? <Link to="/register">Update your details</Link>
      </p>
    </AuthShell>
  );
}

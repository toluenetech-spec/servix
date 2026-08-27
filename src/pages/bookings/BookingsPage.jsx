/**
 * My Bookings (customer) — Phase D. Existing design system only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Skeleton, EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import * as bookingApi from '../../lib/bookingApi.js';

export const STATUS_META = {
  pending_payment: { label: 'Awaiting payment', variant: 'accent' },
  requested: { label: 'Requested', variant: 'neutral' },
  accepted: { label: 'Accepted', variant: 'brand' },
  in_progress: { label: 'In progress', variant: 'brand' },
  delivered: { label: 'Delivered — confirm within 3 days', variant: 'accent' },
  completed: { label: 'Completed', variant: 'brand' },
  declined: { label: 'Declined (refunded)', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  disputed: { label: 'In dispute', variant: 'accent' },
  refunded: { label: 'Refunded', variant: 'outline' },
};

export default function BookingsPage() {
  useDocumentMeta({ title: 'My Bookings', description: 'Manage your Servix bookings.' });
  const { user, initializing, authAvailable } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    bookingApi.getMyBookings().then(setBookings).catch(setError);
  }, []);

  useEffect(() => {
    if (!initializing && user) load();
  }, [initializing, user, load]);

  if (!authAvailable || (!initializing && !user)) {
    return (
      <div className="page container container--narrow section">
        <EmptyState
          title="My bookings"
          message={authAvailable ? 'Sign in to see your bookings.' : 'Bookings activate with the Servix platform launch.'}
          action={
            authAvailable ? (
              <Button to="/login" variant="primary">Sign In</Button>
            ) : (
              <Button to="/services" variant="secondary">Browse Services</Button>
            )
          }
        />
      </div>
    );
  }

  if (initializing || (!bookings && !error)) {
    return (
      <div className="page container section" aria-busy="true">
        <Skeleton height="2rem" width="30%" style={{ marginBottom: '1.5rem' }} />
        <Skeleton height="10rem" />
      </div>
    );
  }

  return (
    <div className="page container" style={{ paddingBlock: 'var(--space-10) var(--space-20)' }}>
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <span className="eyebrow">Your account</span>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>My Bookings</h1>
      </header>

      {error && <ErrorState message="We couldn't load your bookings." onRetry={load} />}

      {bookings && bookings.length === 0 && (
        <EmptyState
          title="No bookings yet"
          message="When you book a service, it appears here."
          action={<Button to="/services" variant="primary">Explore Services</Button>}
        />
      )}

      {bookings && bookings.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {bookings.map((b) => {
            const meta = STATUS_META[b.status] ?? { label: b.status, variant: 'neutral' };
            return (
              <Link key={b.id} to={`/bookings/${b.id}`} className="card card--interactive" style={{ padding: 'var(--space-5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: '14rem' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{b.reference}</span>
                    </div>
                    <h3 style={{ fontSize: 'var(--text-base)' }}>{b.serviceTitle}</h3>
                    <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                      with {b.professionalName} ·{' '}
                      {new Date(b.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong style={{ fontSize: 'var(--text-md)' }}>{formatPrice(b.amount)}</strong>
                    <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{b.priceUnit}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

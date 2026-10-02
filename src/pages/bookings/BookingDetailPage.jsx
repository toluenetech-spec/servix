/**
 * Booking detail (customer + professional views) — Phase D.
 * Payment status, lifecycle actions, dispute, review — all real API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Skeleton, EmptyState, ErrorState, PanelSkeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import * as bookingApi from '../../lib/bookingApi.js';
import { STATUS_META } from './BookingsPage.jsx';
import { getRebookDraft } from '../../lib/marketplaceApi.js';

export default function BookingDetailPage() {
  useDocumentMeta({ title: 'Booking', description: 'Servix booking details.' });
  const { id } = useParams();
  const { user, initializing } = useAuth();
  const showToast = useToast();

  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // 'cancel' | 'dispute' | 'review'
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(() => {
    setError(null);
    return bookingApi.getBooking(id).then(setBooking).catch(setError);
  }, [id]);

  useEffect(() => {
    if (!initializing && user) load();
  }, [initializing, user, load]);

  // While awaiting the webhook, poll for the server-confirmed state.
  useEffect(() => {
    if (booking?.status === 'pending_payment') {
      pollRef.current = setInterval(load, 4000);
      return () => clearInterval(pollRef.current);
    }
    return undefined;
  }, [booking?.status, load]);

  async function act(fn, success, ...args) {
    setBusy(true);
    try {
      await fn(id, ...args);
      showToast(success, 'success');
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      showToast(err.message ?? 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function payNow() {
    setBusy(true);
    try {
      const { authorizationUrl } = await bookingApi.payBooking(id);
      window.location.href = authorizationUrl;
    } catch (err) {
      showToast(err.message ?? 'Could not start payment.', 'error');
      setBusy(false);
    }
  }

  if (initializing || (!booking && !error)) {
    return (
      <div className="page container container--narrow section" aria-busy="true">
        <Skeleton height="2rem" width="45%" style={{ marginBottom: '1rem' }} />
        <Skeleton height="0.9rem" width="30%" style={{ marginBottom: '1.5rem' }} />
        <PanelSkeleton rows={4} heading={false} label="Loading booking…" />
        <PanelSkeleton rows={2} label="" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page container container--narrow section">
        {error.status === 404 ? (
          <EmptyState title="Booking not found" message="This booking doesn't exist or isn't yours." action={<Button to="/bookings" variant="secondary">My Bookings</Button>} />
        ) : (
          <ErrorState message="We couldn't load this booking." onRetry={load} />
        )}
      </div>
    );
  }

  const meta = STATUS_META[booking.status] ?? { label: booking.status, variant: 'neutral' };
  const isCustomer = booking.customerName != null && user && booking.professionalId !== undefined;
  const isPro = user?.role === 'professional';

  return (
    <div className="page container container--narrow" style={{ paddingBlock: 'var(--space-10) var(--space-20)' }}>
      <span className="eyebrow">Booking {booking.reference}</span>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-4)' }}>{booking.serviceTitle}</h1>

      <div className="card" style={{ padding: 'var(--space-6)', display: 'grid', gap: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          <strong style={{ fontSize: 'var(--text-lg)' }}>{formatPrice(booking.amount)}</strong>
        </div>

        <div className="booking-card__meta" style={{ borderBlock: '1px solid var(--border)' }}>
          <span className="booking-card__meta-row">
            <Icon name="calendar" size={15} />
            {new Date(booking.scheduledAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}
          </span>
          <span className="booking-card__meta-row">
            <Icon name="users" size={15} />
            {isPro ? `Customer: ${booking.customerName}` : `Professional: ${booking.professionalName}`}
          </span>
          {booking.notes && (
            <span className="booking-card__meta-row">
              <Icon name="file" size={15} /> {booking.notes}
            </span>
          )}
        </div>

        {booking.status === 'pending_payment' && (
          <div className="notice">
            <span className="notice__icon"><Icon name="info" size={18} /></span>
            <span>
              <strong>Payment pending.</strong> Complete the secure checkout to send
              this request. This page updates automatically once payment is
              confirmed by our payment provider.
            </span>
          </div>
        )}
        {booking.status === 'delivered' && !isPro && (
          <div className="notice">
            <span className="notice__icon"><Icon name="clock" size={18} /></span>
            <span>
              <strong>Confirm within 3 days.</strong> If you don&rsquo;t confirm,
              the booking completes automatically and payment is released.
            </span>
          </div>
        )}
        {booking.status === 'disputed' && (
          <div className="notice">
            <span className="notice__icon"><Icon name="alert" size={18} /></span>
            <span><strong>Dispute open.</strong> Funds are held while the Servix team reviews: “{booking.disputeReason}”.</span>
          </div>
        )}

        {/* -------- actions -------- */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {!isPro && booking.status === 'pending_payment' && (
            <>
              <Button variant="primary" onClick={payNow} disabled={busy}>Pay {formatPrice(booking.amount)}</Button>
              <Button variant="secondary" onClick={() => setModal('cancel')} disabled={busy}>Cancel</Button>
            </>
          )}
          {!isPro && ['requested', 'accepted'].includes(booking.status) && (
            <Button variant="secondary" onClick={() => setModal('cancel')} disabled={busy}>Cancel Booking</Button>
          )}
          {!isPro && booking.status === 'delivered' && (
            <>
              <Button variant="primary" onClick={() => act(bookingApi.confirmBooking, 'Completion confirmed. Payment released.')} disabled={busy}>
                Confirm Completion
              </Button>
              <Button variant="secondary" onClick={() => setModal('dispute')} disabled={busy}>Report a Problem</Button>
            </>
          )}
          {!isPro && booking.status === 'in_progress' && (
            <Button variant="secondary" onClick={() => setModal('dispute')} disabled={busy}>Report a Problem</Button>
          )}
          {!isPro && booking.status === 'completed' && !booking.hasReview && (
            <Button variant="primary" onClick={() => setModal('review')} disabled={busy}>Leave a Review</Button>
          )}
          {!isPro && booking.status === 'completed' && booking.hasReview && (
            <Badge variant="brand">Reviewed — thank you</Badge>
          )}
          {!isPro && ['completed', 'cancelled', 'declined', 'refunded'].includes(booking.status) && (
            <RebookButton bookingId={booking.id} />
          )}

          {isPro && booking.status === 'requested' && (
            <>
              <Button variant="primary" onClick={() => act(bookingApi.acceptBooking, 'Booking accepted.')} disabled={busy}>Accept</Button>
              <Button variant="secondary" onClick={() => act(bookingApi.declineBooking, 'Booking declined. Customer refunded.', '')} disabled={busy}>Decline</Button>
            </>
          )}
          {isPro && booking.status === 'accepted' && (
            <Button variant="primary" onClick={() => act(bookingApi.startBooking, 'Work started.')} disabled={busy}>Start Work</Button>
          )}
          {isPro && booking.status === 'in_progress' && (
            <Button variant="primary" onClick={() => act(bookingApi.deliverBooking, 'Marked as delivered.')} disabled={busy}>Mark Delivered</Button>
          )}
        </div>
      </div>

      {/* -------- modals -------- */}
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel this booking?">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Refunds follow the Servix policy: full refund before the professional
            starts work. The refund amount is determined by the platform, not
            entered manually.
          </p>
          <Field label="Reason (optional)">
            {(props) => <textarea {...props} className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button variant="primary" disabled={busy} onClick={() => act(bookingApi.cancelBooking, 'Booking cancelled.', reason)}>Cancel Booking</Button>
            <Button variant="secondary" onClick={() => setModal(null)}>Keep Booking</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'dispute'} onClose={() => setModal(null)} title="Report a problem">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Opening a dispute freezes payment until the Servix team reviews it.
          </p>
          <Field label="What went wrong?" required>
            {(props) => <textarea {...props} className="textarea" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button variant="primary" disabled={busy || reason.trim().length < 10} onClick={() => act(bookingApi.disputeBooking, 'Dispute opened. Funds are on hold.', reason)}>Open Dispute</Button>
            <Button variant="secondary" onClick={() => setModal(null)}>Back</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'review'} onClose={() => setModal(null)} title="Review this service">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Field label="Rating" required>
            {(props) => (
              <select {...props} className="select" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((r) => (
                  <option key={r} value={r}>{r} — {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][r]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Your review (optional)">
            {(props) => <textarea {...props} className="textarea" rows={4} value={reviewText} onChange={(e) => setReviewText(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => act(bookingApi.reviewBooking, 'Review published. Thank you!', { rating, text: reviewText || undefined })}
            >
              Publish Review
            </Button>
            <Button variant="secondary" onClick={() => setModal(null)}>Back</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Book again: fetches a sanitised prefill (professional's current gigs + previous notes the customer may reuse) and sends them to the gig page with the date left open. */
function RebookButton({ bookingId }) {
  const navigate = useNavigate(); const showToast = useToast();
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState(null); const [service, setService] = useState(''); const [reuseNotes, setReuseNotes] = useState(true); const [loading, setLoading] = useState(false);
  async function start() {
    setLoading(true);
    try { const d = await getRebookDraft(bookingId); setDraft(d); setService((d.services.find((s) => s.wasBooked) || d.services[0])?.id || ''); setOpen(true); }
    catch (e) { showToast(e.message, 'error'); } finally { setLoading(false); }
  }
  function go() {
    const params = new URLSearchParams({ rebook: bookingId });
    if (reuseNotes && draft.previousNotes) params.set('notes', draft.previousNotes.slice(0, 1000));
    navigate(`/services/${encodeURIComponent(service)}?${params}`);
  }
  return <>
    <Button variant="secondary" onClick={start} disabled={loading}><Icon name="calendar" size={15} /> {loading ? 'Preparing…' : 'Book again'}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={draft ? `Book ${draft.professional.name} again` : 'Book again'}>
      {draft && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {!draft.services.length ? <p style={{ fontSize: 'var(--text-sm)' }}>{draft.professional.name} has no active gigs right now. <a href={`/professionals/${encodeURIComponent(draft.professional.id)}`}>View their profile</a>.</p> : <>
            <Field label="Service">{(props) => <select {...props} className="select" value={service} onChange={(e) => setService(e.target.value)}>{draft.services.map((s) => <option key={s.id} value={s.id}>{s.title} — {formatPrice(s.price)}{s.wasBooked ? ' (booked before)' : ''}</option>)}</select>}</Field>
            {!draft.previousServiceAvailable && <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>The gig you booked last time is no longer available; pick one of the current ones.</p>}
            {draft.previousNotes && <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 'var(--text-sm)' }}><input type="checkbox" checked={reuseNotes} onChange={(e) => setReuseNotes(e.target.checked)} /> <span>Reuse my previous requirements<br /><small className="text-muted">“{draft.previousNotes.slice(0, 140)}{draft.previousNotes.length > 140 ? '…' : ''}”</small></span></label>}
            <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>You will pick a new date and see the current price before anything is booked or paid.</p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}><Button variant="primary" onClick={go} disabled={!service}>Continue</Button><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button></div>
          </>}
        </div>
      )}
    </Modal>
  </>;
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/ui/Breadcrumb.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { Rating } from '../components/ui/Rating.jsx';
import { Badge, VerifiedBadge } from '../components/ui/Badge.jsx';
import { Gallery } from '../components/ui/Gallery.jsx';
import { Accordion } from '../components/ui/Accordion.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Skeleton, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { Field } from '../components/ui/Field.jsx';
import * as bookingApi from '../lib/bookingApi.js';
import { getService, getServiceReviews } from '../lib/api.js';
import { formatPrice, formatDate } from '../lib/format.js';
import { categories } from '../data/categories.js';
import { professionals } from '../data/professionals.js';

/* Demo availability preview — replaced by real calendar data via
   `GET /api/services/:id/availability` in the backend phase. */
function buildAvailabilityPreview() {
  const days = [];
  const now = new Date();
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const isSunday = d.getDay() === 0;
    days.push({
      label: `${weekday} ${d.getDate()}`,
      slots: isSunday ? 0 : ((i * 3) % 4) + 1,
    });
  }
  return days;
}

function DetailSkeleton() {
  return (
    <div className="container detail" aria-busy="true">
      <div className="detail__main">
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="2rem" width="75%" />
        <Skeleton height="22rem" />
        <Skeleton height="8rem" />
      </div>
      <div className="detail__aside">
        <Skeleton height="18rem" />
      </div>
    </div>
  );
}

function BookingForm({ service, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [slots, setSlots] = useState(null);
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bookingApi
      .getAvailability(service.id, 14)
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [service.id]);

  if (!user) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Sign in to book this service.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <Button to="/login" variant="primary">Sign In</Button>
          <Button to="/register" variant="secondary">Create Account</Button>
        </div>
      </div>
    );
  }

  const days = new Map();
  for (const iso of slots ?? []) {
    const d = new Date(iso);
    const key = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(iso);
  }

  async function book() {
    setBusy(true);
    try {
      const booking = await bookingApi.createBooking(
        { serviceId: service.id, scheduledAt: selected, notes: notes || undefined },
        `book-${service.id}-${selected}`,
      );
      const { authorizationUrl } = await bookingApi.payBooking(booking.id);
      window.location.href = authorizationUrl; // provider-hosted checkout
    } catch (err) {
      showToast(err.message ?? 'Could not create the booking.', 'error');
      if (err.code === 'SLOT_TAKEN') {
        const r = await bookingApi.getAvailability(service.id, 14).catch(() => null);
        if (r) setSlots(r.slots);
        setSelected('');
      }
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {formatPrice(service.price)} {service.priceUnit} — the price is locked
        when you book. Payment is held securely and only released after you
        confirm completion.
      </p>

      {slots === null && <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>Loading availability…</p>}
      {slots !== null && slots.length === 0 && (
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>No open slots in the next two weeks.</p>
      )}

      {slots !== null && slots.length > 0 && (
        <Field label="Choose a time" required>
          {(props) => (
            <select {...props} className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a slot…</option>
              {[...days.entries()].map(([day, iso]) => (
                <optgroup key={day} label={day}>
                  {iso.map((slot) => (
                    <option key={slot} value={slot}>
                      {new Date(slot).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label="Notes for the professional (optional)">
        {(props) => <textarea {...props} className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button variant="primary" disabled={!selected || busy} onClick={book}>
          {busy ? 'Redirecting to payment…' : `Book & Pay ${formatPrice(service.price)}`}
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

export default function ServiceDetailPage() {
  const { id } = useParams();
  const [bookingOpen, setBookingOpen] = useState(false);

  const { data: service, loading, error, retry } = useFetch(() => getService(id), [id]);
  const { data: reviews } = useFetch(() => getServiceReviews(id), [id]);

  useDocumentMeta({
    title: service ? service.title : 'Service',
    description: service
      ? service.shortDescription
      : 'Professional service details on Servix.',
  });

  if (loading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="container section">
        {error.status === 404 ? (
          <EmptyState
            title="Service not found"
            message="This service does not exist or may have been removed."
            action={
              <Button to="/services" variant="secondary">
                Browse all services
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="We couldn't load this service. Please try again."
            onRetry={retry}
          />
        )}
      </div>
    );
  }

  const category = categories.find((c) => c.id === service.categoryId);
  const pro = professionals.find((p) => p.id === service.professionalId);
  const availability = buildAvailabilityPreview();

  return (
    <div className="page container">
      <div style={{ paddingTop: 'var(--space-6)' }}>
        <Breadcrumb
          items={[
            { label: 'Home', to: '/' },
            { label: 'Services', to: '/services' },
            { label: category?.name || 'Category', to: `/services?category=${service.categoryId}` },
            { label: service.title },
          ]}
        />
      </div>

      <div className="detail">
        <div className="detail__main">
          <div>
            <span className="service-card__category">{category?.name}</span>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
              {service.title}
            </h1>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-5)',
                marginTop: 'var(--space-4)',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <Rating value={service.rating} count={service.reviewCount} />
              <span className="pro-card__meta-item text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                <Icon name="map-pin" size={14} /> {service.location}
              </span>
              <span className="pro-card__meta-item text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                <Icon name="clock" size={14} /> {service.duration}
              </span>
            </div>
          </div>

          <Gallery images={service.gallery} alt={service.title} />

          {pro && (
            <div className="pro-strip">
              <img src={pro.image} alt="" width="52" height="52" />
              <div>
                <span className="pro-strip__name">
                  {pro.name}
                  {pro.verified && <VerifiedBadge compact />}
                </span>
                <span className="pro-strip__title">{pro.title} · {pro.completedProjects} projects completed</span>
              </div>
              <Link className="pro-strip__link" to={`/professionals/${pro.id}`}>
                View profile
              </Link>
            </div>
          )}

          <section className="detail__block" aria-labelledby="about-service">
            <h2 id="about-service">About this service</h2>
            <p>{service.description}</p>
          </section>

          <section className="detail__block" aria-labelledby="included">
            <h2 id="included">What&rsquo;s included</h2>
            <ul className="check-list">
              {service.included.map((item) => (
                <li key={item}>
                  <Icon name="check" size={16} />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="detail__block" aria-labelledby="requirements">
            <h2 id="requirements">What the professional needs from you</h2>
            <ul className="check-list">
              {service.requirements.map((item) => (
                <li key={item}>
                  <Icon name="arrow-right" size={16} />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="detail__block" aria-labelledby="availability-preview">
            <h2 id="availability-preview">Availability preview</h2>
            <div className="avail">
              {availability.map((day) => (
                <div
                  key={day.label}
                  className={`avail__day ${day.slots ? 'avail__day--open' : 'avail__day--closed'}`}
                >
                  <span className="avail__date">{day.label}</span>
                  <span className="avail__slots">
                    {day.slots ? `${day.slots} slot${day.slots > 1 ? 's' : ''}` : 'Closed'}
                  </span>
                </div>
              ))}
            </div>
            <p className="trust-strip__note" style={{ marginTop: 'var(--space-4)' }}>
              Demo availability — live scheduling arrives with the platform launch.
            </p>
          </section>

          <section className="detail__block" aria-labelledby="reviews-heading">
            <h2 id="reviews-heading">Reviews</h2>
            {reviews && reviews.length > 0 ? (
              <div>
                {reviews.map((review) => (
                  <article className="review" key={review.id}>
                    <div className="review__head">
                      <span className="review__author">{review.author}</span>
                      <Rating value={review.rating} showCount={false} />
                      <span className="review__date">{formatDate(review.date)}</span>
                    </div>
                    <p className="review__text">{review.text}</p>
                  </article>
                ))}
                <p className="trust-strip__note" style={{ marginTop: 'var(--space-4)' }}>
                  Demonstration reviews illustrating the review system.
                </p>
              </div>
            ) : (
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                No reviews yet.
              </p>
            )}
          </section>

          {service.faqs?.length > 0 && (
            <section className="detail__block" aria-labelledby="faq-heading">
              <h2 id="faq-heading">Frequently asked questions</h2>
              <Accordion items={service.faqs} />
            </section>
          )}
        </div>

        <aside className="detail__aside" aria-label="Booking">
          <div className="booking-card">
            <div className="booking-card__price">
              <strong>{formatPrice(service.price)}</strong>
              <span>{service.priceUnit}</span>
            </div>
            <div className="booking-card__meta">
              <span className="booking-card__meta-row">
                <Icon name="clock" size={15} /> Duration: {service.duration}
              </span>
              <span className="booking-card__meta-row">
                <Icon name="map-pin" size={15} /> {service.location}
              </span>
              <span className="booking-card__meta-row">
                <Icon name="calendar" size={15} />
                {service.availability === 'available'
                  ? 'Available now'
                  : 'Limited availability'}
              </span>
            </div>
            <Button variant="primary" size="lg" block onClick={() => setBookingOpen(true)}>
              Request Booking
            </Button>
            <p className="trust-strip__note" style={{ margin: 0 }}>
              No payment is taken at this stage.
            </p>
          </div>

          <div className="notice">
            <span className="notice__icon">
              <Icon name="shield" size={18} />
            </span>
            <span>
              <strong>Servix protection.</strong> Clear scope, agreed pricing and
              structured communication on every booking.
            </span>
          </div>
        </aside>
      </div>

      <Modal open={bookingOpen} onClose={() => setBookingOpen(false)} title={bookingApi.bookingAvailable ? 'Book this service' : 'Booking coming soon'}>
        {bookingApi.bookingAvailable ? (
          <BookingForm service={service} onClose={() => setBookingOpen(false)} />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <Badge variant="demo">Pre-launch preview</Badge>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Online booking is part of the upcoming Servix platform launch and is
              not connected to a live backend yet.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Button to="/how-it-works" variant="primary" onClick={() => setBookingOpen(false)}>
                How Servix works
              </Button>
              <Button variant="secondary" onClick={() => setBookingOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

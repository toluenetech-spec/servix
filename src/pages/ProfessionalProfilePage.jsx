import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/ui/Breadcrumb.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { Rating } from '../components/ui/Rating.jsx';
import { Badge, VerifiedBadge } from '../components/ui/Badge.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { ServiceCard } from '../components/cards/ServiceCard.jsx';
import { Skeleton, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import {
  getProfessional,
  getProfessionalReviews,
  getProfessionalServices,
} from '../lib/api.js';
import { formatPrice, formatDate } from '../lib/format.js';

const TABS = [
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'reviews', label: 'Reviews' },
];

function ProfileSkeleton() {
  return (
    <div className="container section" aria-busy="true">
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <Skeleton height="7rem" width="7rem" style={{ borderRadius: '999px', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'grid', gap: '0.75rem' }}>
          <Skeleton height="1.5rem" width="40%" />
          <Skeleton height="1rem" width="30%" />
          <Skeleton height="0.9rem" width="55%" />
        </div>
      </div>
      <Skeleton height="14rem" style={{ marginTop: '2rem' }} />
    </div>
  );
}

export default function ProfessionalProfilePage() {
  const { id } = useParams();
  const [tab, setTab] = useState('about');
  const [bookingOpen, setBookingOpen] = useState(false);

  const { data: pro, loading, error, retry } = useFetch(() => getProfessional(id), [id]);
  const { data: services } = useFetch(() => getProfessionalServices(id), [id]);
  const { data: reviews } = useFetch(() => getProfessionalReviews(id), [id]);

  useDocumentMeta({
    title: pro ? `${pro.name} — ${pro.title}` : 'Professional Profile',
    description: pro
      ? `${pro.name}, ${pro.title} in ${pro.location}. View services, portfolio and reviews on Servix.`
      : 'Professional profile on Servix.',
  });

  if (loading) return <ProfileSkeleton />;

  if (error) {
    return (
      <div className="container section">
        {error.status === 404 ? (
          <EmptyState
            title="Professional not found"
            message="This profile does not exist or may have been removed."
            action={
              <Button to="/professionals" variant="secondary">
                Browse professionals
              </Button>
            }
          />
        ) : (
          <ErrorState
            message="We couldn't load this profile. Please try again."
            onRetry={retry}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page container">
      <div style={{ paddingTop: 'var(--space-6)' }}>
        <Breadcrumb
          items={[
            { label: 'Home', to: '/' },
            { label: 'Professionals', to: '/professionals' },
            { label: pro.name },
          ]}
        />
      </div>

      <header className="profile-head">
        <img className="profile-head__avatar" src={pro.image} alt={`Portrait of ${pro.name}`} width="112" height="112" />
        <div className="profile-head__info" style={{ flex: 1, minWidth: '16rem' }}>
          <h1>
            {pro.name}
            {pro.verified && <VerifiedBadge />}
          </h1>
          <p className="profile-head__title">{pro.title}</p>
          <div className="profile-head__meta">
            <span>
              <Icon name="map-pin" size={15} /> {pro.location}
            </span>
            <span>
              <Icon name="clock" size={15} /> Responds {pro.responseTime.toLowerCase()}
            </span>
            <span>
              <Icon name="calendar" size={15} /> Member since {pro.memberSince}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Button variant="primary" onClick={() => setBookingOpen(true)}>
            Request Booking
          </Button>
          <span className="trust-strip__note" style={{ margin: 0, textAlign: 'center' }}>
            {pro.availability === 'available' ? 'Available now' : 'Limited availability'}
          </span>
        </div>
      </header>

      <div className="profile-stats" style={{ marginBottom: 'var(--space-8)' }}>
        <div>
          <div className="profile-stat__value">{pro.rating.toFixed(1)}</div>
          <div className="profile-stat__label">Rating</div>
        </div>
        <div>
          <div className="profile-stat__value">{pro.reviewCount}</div>
          <div className="profile-stat__label">Reviews</div>
        </div>
        <div>
          <div className="profile-stat__value">{pro.completedProjects}</div>
          <div className="profile-stat__label">Completed projects</div>
        </div>
        <div>
          <div className="profile-stat__value">{formatPrice(pro.startingPrice)}</div>
          <div className="profile-stat__label">Starting price</div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Profile sections" />

      <div style={{ paddingBlock: 'var(--space-8) var(--space-20)' }}>
        {tab === 'about' && (
          <div style={{ display: 'grid', gap: 'var(--space-8)', maxWidth: '46rem' }}>
            <section aria-labelledby="about-h">
              <h2 id="about-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>
                About
              </h2>
              <p className="text-muted">{pro.about}</p>
            </section>
            <section aria-labelledby="skills-h">
              <h2 id="skills-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
                Skills
              </h2>
              <div className="skills">
                {pro.skills.map((skill) => (
                  <Badge key={skill} variant="outline">
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'services' && (
          <section aria-label="Services offered">
            {services && services.length > 0 ? (
              <div className="results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}>
                {services.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No services listed"
                message="This professional has not published any services yet."
              />
            )}
          </section>
        )}

        {tab === 'portfolio' && (
          <section aria-label="Portfolio">
            <div className="portfolio-grid" style={{ maxWidth: '52rem' }}>
              {pro.portfolio.map((item) => (
                <article className="portfolio-item" key={item.id}>
                  <div className="portfolio-item__media" aria-hidden="true">
                    <Icon name="layout" size={28} />
                  </div>
                  <div className="portfolio-item__body">
                    <h3 className="portfolio-item__title">{item.title}</h3>
                    <p className="portfolio-item__cat">{item.category}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="trust-strip__note" style={{ marginTop: 'var(--space-5)' }}>
              Portfolio previews are placeholders — full case studies arrive with
              the platform launch.
            </p>
          </section>
        )}

        {tab === 'reviews' && (
          <section aria-label="Reviews" style={{ maxWidth: '46rem' }}>
            {reviews && reviews.length > 0 ? (
              <>
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
              </>
            ) : (
              <EmptyState title="No reviews yet" message="This professional has no reviews yet." />
            )}
          </section>
        )}
      </div>

      <Modal open={bookingOpen} onClose={() => setBookingOpen(false)} title="Booking coming soon">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Badge variant="demo">Pre-launch preview</Badge>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Direct booking with professionals launches with the full Servix
            platform. Nothing has been booked and no payment has been taken.
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
      </Modal>
    </div>
  );
}

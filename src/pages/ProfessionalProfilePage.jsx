import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getSaved, saveProfessional, unsaveProfessional } from '../lib/workspaceApi.js';
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
import { useFeatures } from '../lib/useFeatures.js';
import { countView, getAvailabilitySummary } from '../lib/marketplaceApi.js';
import { TrustPanel, VerifiedProjectBadge } from '../components/marketplace/TrustPanel.jsx';
import { CompareToggle } from '../components/marketplace/CompareTray.jsx';

const BASE_TABS = [
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'reviews', label: 'Reviews' },
];
const TRUST_TAB = { id: 'trust', label: 'Trust & performance' };

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
  const features = useFeatures();
  const { data: availability } = useFetch(() => getAvailabilitySummary(id).catch(() => null), [id]);
  useEffect(() => { if (pro?.id) countView('professional', pro.id); }, [pro?.id]);
  const TABS = features.trust && pro?.trust ? [...BASE_TABS.slice(0, 1), TRUST_TAB, ...BASE_TABS.slice(1)] : BASE_TABS;

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
    <div className="page container profile-page">
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
        {pro.image ? (
          <img className="profile-head__avatar" src={pro.image} alt={`Portrait of ${pro.name}`} width="112" height="112" />
        ) : (
          <span className="profile-head__avatar profile-head__avatar--initial" role="img" aria-label={`${pro.name} has not added a photo yet`}>
            {(pro.name || '?').trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="profile-head__info" style={{ flex: 1, minWidth: '16rem' }}>
          <h1>
            {pro.name}
            {pro.verified && <VerifiedBadge />}
            {pro.plan && pro.plan !== 'free' && <Badge variant="brand"><Icon name="crown" size={13} /> Servix Pro</Badge>}
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
          <SaveButton slug={pro.id} />
          <CompareToggle slug={pro.id} name={pro.name} />
          <span className="trust-strip__note" style={{ margin: 0, textAlign: 'center' }}>
            {availability?.nextAvailableAt
              ? <span className="avail-chip">{availability.availableToday ? 'Free today' : availability.availableTomorrow ? 'Free tomorrow' : availability.availableThisWeek ? 'Free this week' : `Next: ${new Date(availability.nextAvailableAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span>
              : (pro.availability === 'available' ? 'Available now' : 'Limited availability')}
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
          <div className="profile-stat__label">Completed projects{pro.verifiedProjects ? ` · ${pro.verifiedProjects} verified` : ''}</div>
        </div>
        <div>
          <div className="profile-stat__value">{formatPrice(pro.startingPrice)}</div>
          <div className="profile-stat__label">Starting price</div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Profile sections" />

      <div style={{ paddingBlock: 'var(--space-8) var(--space-20)' }}>
        {tab === 'trust' && pro.trust && (
          <div style={{ maxWidth: '52rem' }}>
            <TrustPanel trust={pro.trust} />
            <p className="trust-strip__note" style={{ marginTop: 'var(--space-4)' }}>
              How these are calculated: delivery reliability counts deliveries made on or before the agreed deadline (customer-requested changes don’t count against the professional); response rate counts paid requests answered; repeat customers are people who booked this professional more than once.
            </p>
          </div>
        )}
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
            {pro.details?.experience?.length > 0 && (
              <section aria-labelledby="experience-h">
                <h2 id="experience-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Experience</h2>
                <ul className="profile-timeline">
                  {pro.details.experience.map((x, i) => (
                    <li key={`${x.title}-${i}`}>
                      <strong>{x.title}</strong>{x.company ? ` · ${x.company}` : ''}
                      {(x.start || x.end) && <span className="text-muted"> · {x.start}{x.start && x.end ? ' – ' : ''}{x.end}</span>}
                      {x.description && <p className="text-muted">{x.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {pro.details?.education?.length > 0 && (
              <section aria-labelledby="education-h">
                <h2 id="education-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Education</h2>
                <ul className="profile-timeline">
                  {pro.details.education.map((x, i) => (
                    <li key={`${x.school}-${i}`}><strong>{x.school}</strong>{x.degree ? ` · ${x.degree}` : ''}{x.year && <span className="text-muted"> · {x.year}</span>}</li>
                  ))}
                </ul>
              </section>
            )}
            {pro.details?.certifications?.length > 0 && (
              <section aria-labelledby="cert-h">
                <h2 id="cert-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>Certifications</h2>
                <ul className="profile-timeline">
                  {pro.details.certifications.map((x, i) => (
                    <li key={`${x.name}-${i}`}><strong>{x.name}</strong>{x.issuer ? ` · ${x.issuer}` : ''}{x.year && <span className="text-muted"> · {x.year}</span>}</li>
                  ))}
                </ul>
              </section>
            )}
            {(pro.details?.languages?.length > 0 || pro.details?.website) && (
              <section aria-labelledby="more-h">
                <h2 id="more-h" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>More</h2>
                {pro.details.languages?.length > 0 && <p className="text-muted"><strong>Languages:</strong> {pro.details.languages.map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`).join(', ')}</p>}
                {pro.details.website && <p className="text-muted"><strong>Website:</strong> <a href={pro.details.website} target="_blank" rel="noreferrer nofollow">{pro.details.website}</a></p>}
              </section>
            )}
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
                  <div className="portfolio-item__media" aria-hidden={item.image ? undefined : 'true'}>
                    {item.image ? <img src={item.image} alt={item.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="layout" size={28} />}
                  </div>
                  <div className="portfolio-item__body">
                    <h3 className="portfolio-item__title">{item.title}</h3>
                    <p className="portfolio-item__cat">{item.category}</p>
                    {item.verified && (
                      <p className="portfolio-item__cat" style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                        <VerifiedProjectBadge item={item} />
                        <small>{[item.completedAt ? `Completed ${formatDate(item.completedAt)}` : null, item.deliveryDays ? `${item.deliveryDays} day${item.deliveryDays === 1 ? '' : 's'}` : null, item.customerRating ? `Rated ${item.customerRating}/5` : null].filter(Boolean).join(' · ')}</small>
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {pro.portfolio.length === 0 && (
              <p className="trust-strip__note" style={{ marginTop: 'var(--space-5)' }}>
                This professional hasn’t added portfolio items yet.
              </p>
            )}
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

/* Save/unsave for signed-in accounts; signed-out visitors get a sign-in link. Private: professionals are not told who saved them. */
function SaveButton({ slug }) {
  const { user, authAvailable } = useAuth();
  const [saved, setSaved] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!user || !authAvailable) return; let alive = true; getSaved().then(list => { if (alive) setSaved(list.some(i => i.professional.slug === slug)); }).catch(() => { if (alive) setSaved(false); }); return () => { alive = false; }; }, [user?.id, slug, authAvailable]);
  if (!authAvailable) return null;
  if (!user) return <Link to="/login" className="btn btn--secondary">Sign in to save</Link>;
  async function toggle() { setBusy(true); setError(''); try { if (saved) { await unsaveProfessional(slug); setSaved(false); } else { await saveProfessional(slug); setSaved(true); } } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <>
    <Button variant="secondary" onClick={toggle} disabled={busy || saved === null} aria-pressed={Boolean(saved)}><Icon name="bookmark" size={15} /> {saved ? 'Saved' : 'Save professional'}</Button>
    {error && <span role="alert" className="trust-strip__note" style={{ margin: 0 }}>{error}</span>}
  </>;
}

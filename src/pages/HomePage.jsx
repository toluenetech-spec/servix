import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { CategoryCard } from '../components/cards/CategoryCard.jsx';
import { ProfessionalCard } from '../components/cards/ProfessionalCard.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { categories } from '../data/categories.js';
import { professionals } from '../data/professionals.js';
import { testimonials } from '../data/testimonials.js';

const SEARCH_SUGGESTIONS = [
  'Web Development',
  'Graphic Design',
  'Photography',
  'Video Editing',
  'Marketing',
  'Consulting',
];

/* Trust metrics — demo values, clearly labelled below the strip.
   Wired for replacement by `GET /api/stats`. */
const TRUST_STATS = [
  { value: '500+', label: 'Verified professionals' },
  { value: '2,400+', label: 'Completed services' },
  { value: '8', label: 'Service categories' },
  { value: '4.8/5', label: 'Customer satisfaction' },
];

const STEPS = [
  { num: '01', title: 'Discover', desc: 'Find the right service or professional for what you need.' },
  { num: '02', title: 'Compare', desc: 'Review services, portfolios, ratings and availability.' },
  { num: '03', title: 'Book', desc: 'Choose a suitable date and time that works for you.' },
  { num: '04', title: 'Get It Done', desc: 'Manage your service from start to finish through Servix.' },
];

const WHY_ITEMS = [
  {
    icon: 'shield',
    title: 'Trusted Professionals',
    desc: 'Discover professionals with complete profiles, portfolios and reviews — so you know exactly who you are working with.',
  },
  {
    icon: 'calendar',
    title: 'Simple Booking',
    desc: 'Find a service and book it without unnecessary complexity. Clear pricing, clear scope, clear timelines.',
  },
  {
    icon: 'target',
    title: 'Professional Experience',
    desc: 'Every part of Servix is designed around quality service delivery, from discovery to completion.',
  },
  {
    icon: 'layout',
    title: 'One Place',
    desc: 'Manage bookings, communication and service information from a single platform instead of scattered chats and emails.',
  },
];

function SearchPanel() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/services?q=${encodeURIComponent(q)}` : '/services');
  }

  return (
    <div className="search-panel">
      <form className="search-panel__form" onSubmit={onSubmit} role="search">
        <div className="input-wrap">
          <span className="input-wrap__icon">
            <Icon name="search" size={18} />
          </span>
          <input
            type="search"
            className="input"
            placeholder="What service are you looking for?"
            aria-label="Search for a service"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
      <div className="search-panel__tags">
        <span>Popular:</span>
        {SEARCH_SUGGESTIONS.map((tag) => (
          <Link
            key={tag}
            to={`/services?q=${encodeURIComponent(tag)}`}
            className="search-tag"
          >
            {tag}
          </Link>
        ))}
      </div>
    </div>
  );
}

function DashboardPreview() {
  /* Static presentation component — replaced by the real professional
     dashboard in a later phase. */
  return (
    <div className="dash-preview" aria-hidden="true">
      <div className="dash-preview__bar">
        <div className="dash-preview__dots">
          <span />
          <span />
          <span />
        </div>
        <span style={{ color: 'var(--text-secondary)' }}>Professional dashboard · preview</span>
      </div>
      <div className="dash-preview__body">
        <div className="dash-preview__stats">
          <div className="dash-stat">
            <div className="dash-stat__label">Bookings this month</div>
            <div className="dash-stat__value">18</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat__label">Earnings</div>
            <div className="dash-stat__value">₦1.2m</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat__label">Rating</div>
            <div className="dash-stat__value">4.9</div>
          </div>
        </div>
        <div className="dash-row">
          <span>Brand identity — discovery call</span>
          <span className="dash-row__status dash-row__status--confirmed">Confirmed</span>
        </div>
        <div className="dash-row">
          <span>Website build — final review</span>
          <span className="dash-row__status dash-row__status--confirmed">Confirmed</span>
        </div>
        <div className="dash-row">
          <span>Product shoot — new request</span>
          <span className="dash-row__status dash-row__status--pending">Pending</span>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  useDocumentMeta({
    title: 'Professional Services, Simplified',
    description:
      'Servix connects customers with trusted professional service providers. Discover services, compare professionals, and manage bookings in one place.',
  });

  const featuredCategories = categories.slice(0, 8);
  const featuredPros = professionals.filter((p) => p.verified).slice(0, 4);

  return (
    <div className="page">
      {/* ---------- HERO ---------- */}
      <section className="hero">
        <div className="container">
          <div className="hero__inner">
            <span className="eyebrow">Professional services, simplified.</span>
            <h1>Services, delivered professionally.</h1>
            <p className="hero__lead">
              Discover trusted professionals, compare services, and manage your
              bookings from one place.
            </p>
            <div className="hero__ctas">
              <Button to="/services" variant="primary" size="lg">
                Explore Services
              </Button>
              <Button to="/professionals/join" variant="secondary" size="lg">
                Become a Professional
              </Button>
            </div>
            <SearchPanel />
          </div>
        </div>
      </section>

      {/* ---------- TRUST ---------- */}
      <section className="trust-strip" aria-label="Platform statistics">
        <div className="container">
          <div className="trust-strip__grid">
            {TRUST_STATS.map((stat) => (
              <div className="trust-stat" key={stat.label}>
                <span className="trust-stat__value">{stat.value}</span>
                <span className="trust-stat__label">{stat.label}</span>
              </div>
            ))}
          </div>
          <p className="trust-strip__note">
            Figures shown are demonstration values for the pre-launch platform.
          </p>
        </div>
      </section>

      {/* ---------- POPULAR SERVICES ---------- */}
      <section className="section" aria-labelledby="popular-services">
        <div className="container">
          <SectionHeader
            layout="row"
            eyebrow="Popular services"
            title="Find the service you need"
            description="Browse the most requested categories on Servix."
            link={{ to: '/services', label: 'View all services' }}
          />
          <div className="grid-4">
            {featuredCategories.map((cat) => (
              <CategoryCard key={cat.id} category={cat} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FEATURED PROFESSIONALS ---------- */}
      <section className="section section--surface" aria-labelledby="featured-pros">
        <div className="container">
          <SectionHeader
            layout="row"
            eyebrow="Featured professionals"
            title="Work with skilled professionals"
            description="Example profiles showing how professionals present their work on Servix."
            link={{ to: '/professionals', label: 'Browse all professionals' }}
          />
          <div className="grid-2">
            {featuredPros.map((pro) => (
              <ProfessionalCard key={pro.id} professional={pro} />
            ))}
          </div>
          <p className="trust-strip__note" style={{ marginTop: 'var(--space-6)' }}>
            Profiles shown are demonstration content illustrating the Servix experience.
          </p>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section className="section" aria-labelledby="how-it-works">
        <div className="container">
          <SectionHeader
            eyebrow="How Servix works"
            title="From search to done, in four steps"
          />
          <div className="steps">
            {STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="step__num">{step.num}</span>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FOR PROFESSIONALS ---------- */}
      <section className="section section--dark on-dark" aria-labelledby="for-pros">
        <div className="container">
          <div className="pro-cta">
            <div>
              <span className="eyebrow">For professionals</span>
              <h2 className="h-section" id="for-pros" style={{ color: 'var(--color-ivory)' }}>
                Turn your skills into a business.
              </h2>
              <ul className="pro-cta__points">
                <li>
                  <Icon name="check" size={16} />
                  Build a professional profile and showcase your work
                </li>
                <li>
                  <Icon name="check" size={16} />
                  List services with clear pricing and scope
                </li>
                <li>
                  <Icon name="check" size={16} />
                  Manage bookings and availability in one place
                </li>
                <li>
                  <Icon name="check" size={16} />
                  Connect with customers who value professional work
                </li>
              </ul>
              <Button to="/professionals/join" variant="on-dark" size="lg">
                Become a Professional
              </Button>
            </div>
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* ---------- WHY SERVIX ---------- */}
      <section className="section" aria-labelledby="why-servix">
        <div className="container">
          <SectionHeader
            eyebrow="Why Servix"
            title="Built around quality service delivery"
          />
          <div>
            {WHY_ITEMS.map((item) => (
              <div className="why-item" key={item.title}>
                <span className="why-item__icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- TESTIMONIALS (demo placeholders) ---------- */}
      <section className="section section--subtle" aria-labelledby="testimonials">
        <div className="container">
          <SectionHeader
            eyebrow="What customers will say"
            title="Feedback, from real bookings"
            description="Genuine reviews will appear here once Servix launches. The examples below are placeholders."
          />
          <div className="grid-3">
            {testimonials.map((t) => (
              <figure className="card card--flat testimonial" key={t.id}>
                <Badge variant="demo">Demo testimonial</Badge>
                <blockquote>“{t.quote}”</blockquote>
                <figcaption>
                  <strong>{t.author}</strong>
                  <span>{t.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="section--dark on-dark cta-final" aria-labelledby="final-cta">
        <div className="container container--narrow">
          <h2 id="final-cta">Ready to get started?</h2>
          <p>Find a professional who can get the job done.</p>
          <div className="cta-final__actions">
            <Button to="/services" variant="on-dark" size="lg">
              Explore Services
            </Button>
            <Button to="/professionals/join" variant="outline-dark" size="lg">
              Join as a Professional
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Accordion } from '../components/ui/Accordion.jsx';
import { Rating } from '../components/ui/Rating.jsx';
import { VerifiedBadge } from '../components/ui/Badge.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { faqs } from '../data/faqs.js';

const BENEFITS = [
  {
    icon: 'users',
    title: 'Customers come to you',
    desc: 'Servix puts your profile in front of customers actively searching for your service — no cold outreach required.',
  },
  {
    icon: 'briefcase',
    title: 'A professional storefront',
    desc: 'A structured profile, portfolio and service listings that present your work like a business, not a classified ad.',
  },
  {
    icon: 'calendar',
    title: 'Bookings without back-and-forth',
    desc: 'Customers book against your availability with the scope agreed up front. Fewer calls, clearer projects.',
  },
  {
    icon: 'shield',
    title: 'Verification that builds trust',
    desc: 'Complete verification to earn a badge that tells customers you are exactly who you say you are.',
  },
  {
    icon: 'chart',
    title: 'Know what\u2019s working',
    desc: 'See how customers find you, which services convert, and where your next opportunity is.',
  },
  {
    icon: 'grow',
    title: 'Reputation that compounds',
    desc: 'Every completed booking and review strengthens your profile and improves your placement.',
  },
];

const ONBOARDING_STEPS = [
  {
    num: '01',
    title: 'Apply',
    desc: 'Create your account and tell us about your professional experience.',
  },
  {
    num: '02',
    title: 'Build your profile',
    desc: 'Add your skills, portfolio and the services you want to offer.',
  },
  {
    num: '03',
    title: 'Get verified',
    desc: 'Submit identity and credential documents for review.',
  },
  {
    num: '04',
    title: 'Go live',
    desc: 'Your profile becomes discoverable and bookings can start arriving.',
  },
];

function ProfileExample() {
  /* Static presentation component — illustrates how a professional profile
     appears in the directory. Fictional example content. */
  return (
    <div className="card" style={{ maxWidth: '26rem' }} aria-hidden="true">
      <div className="pro-card__top" style={{ paddingTop: 'var(--space-5)' }}>
        <span
          className="pro-card__avatar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-sand)',
            color: 'var(--color-deep-forest)',
            fontWeight: 700,
            fontSize: 'var(--text-md)',
          }}
        >
          YN
        </span>
        <div>
          <h3 className="pro-card__name">
            Your Name <VerifiedBadge compact />
          </h3>
          <p className="pro-card__title">Your Professional Title</p>
        </div>
      </div>
      <div className="pro-card__body">
        <div className="pro-card__meta">
          <span className="pro-card__meta-item">
            <Icon name="map-pin" size={14} /> Your City
          </span>
          <Rating value={4.9} count={48} />
        </div>
        <div className="pro-card__foot">
          <span className="pro-card__price">
            Starting at <strong>Your price</strong>
          </span>
          <span className="section-header__link">
            View profile <Icon name="arrow-right" size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}

function ListingExample() {
  return (
    <div className="card" style={{ maxWidth: '26rem' }} aria-hidden="true">
      <div
        className="service-card__media"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <Icon name="camera" size={30} />
      </div>
      <div className="service-card__body">
        <span className="service-card__category">Your Category</span>
        <h3 className="service-card__title">Your service, clearly described</h3>
        <p className="service-card__pro">Scope, deliverables and timeline up front</p>
        <div className="service-card__foot">
          <span className="service-card__price">
            From <strong>Your price</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ProfessionalsJoinPage() {
  useDocumentMeta({
    title: 'Become a Professional',
    description:
      'Join Servix as a professional — build your profile, list your services, manage bookings and grow your business.',
  });

  return (
    <div className="page">
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <div className="hero__inner">
            <span className="eyebrow">For professionals</span>
            <h1>Turn your skills into a business.</h1>
            <p className="hero__lead">
              Build your professional profile, showcase your work, manage
              bookings and connect with customers through Servix.
            </p>
            <div className="hero__ctas">
              <Button to="/register" variant="primary" size="lg">
                Become a Professional
              </Button>
              <Button to="/pricing" variant="secondary" size="lg">
                See Pricing
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="section" aria-labelledby="benefits">
        <div className="container">
          <SectionHeader
            eyebrow="Why join"
            title="Built for how professionals actually work"
          />
          <div className="grid-3">
            {BENEFITS.map((b) => (
              <div className="benefit" key={b.title}>
                <span className="benefit__icon">
                  <Icon name={b.icon} size={18} />
                </span>
                <h3>{b.title}</h3>
                <p>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Onboarding */}
      <section className="section section--surface" aria-labelledby="onboarding">
        <div className="container">
          <SectionHeader
            eyebrow="Getting started"
            title="From application to first booking"
          />
          <div className="steps">
            {ONBOARDING_STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="step__num">{step.num}</span>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Profile + listing examples */}
      <section className="section" aria-labelledby="examples">
        <div className="container">
          <SectionHeader
            eyebrow="What you get"
            title="Your work, presented properly"
            description="Examples of how your profile and service listings appear to customers."
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
              gap: 'var(--space-8)',
              alignItems: 'start',
            }}
          >
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-4)' }}>
                Your professional profile
              </h3>
              <ProfileExample />
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-4)' }}>
                Your service listing
              </h3>
              <ListingExample />
            </div>
          </div>
        </div>
      </section>

      {/* Booking management + earnings preview */}
      <section className="section section--subtle" aria-labelledby="tools">
        <div className="container">
          <SectionHeader
            eyebrow="Your tools"
            title="Manage bookings and track earnings"
            description="A preview of the professional workspace arriving with the platform launch."
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
              gap: 'var(--space-8)',
              alignItems: 'start',
            }}
          >
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-4)' }}>
                Booking requests
              </h3>
              <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
                <div className="dash-row" style={{ fontSize: 'var(--text-sm)' }}>
                  <span>Brand identity — discovery call · Tue 10:00</span>
                  <span className="dash-row__status dash-row__status--confirmed">Confirmed</span>
                </div>
                <div className="dash-row" style={{ fontSize: 'var(--text-sm)' }}>
                  <span>Logo refresh — kickoff · Thu 14:00</span>
                  <span className="dash-row__status dash-row__status--pending">Pending</span>
                </div>
                <div className="dash-row" style={{ fontSize: 'var(--text-sm)' }}>
                  <span>Packaging design — review · Fri 11:30</span>
                  <span className="dash-row__status dash-row__status--confirmed">Confirmed</span>
                </div>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-4)' }}>
                Earnings overview
              </h3>
              <div className="earnings">
                <table aria-hidden="true">
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Bookings</th>
                      <th scope="col">Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>June</td>
                      <td>9</td>
                      <td>₦820,000</td>
                    </tr>
                    <tr>
                      <td>July</td>
                      <td>12</td>
                      <td>₦1,140,000</td>
                    </tr>
                    <tr>
                      <td>August</td>
                      <td>14</td>
                      <td>₦1,360,000</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p className="trust-strip__note" style={{ marginTop: 'var(--space-6)' }}>
            Illustrative preview with example figures — the live dashboard ships in the next phase.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" aria-labelledby="join-faq">
        <div className="container container--narrow">
          <SectionHeader eyebrow="Questions" title="Professional FAQs" />
          <Accordion items={faqs.professionals} />
        </div>
      </section>

      {/* CTA */}
      <section className="section--dark on-dark cta-final" aria-labelledby="join-cta">
        <div className="container container--narrow">
          <h2 id="join-cta">Your next customer is already searching.</h2>
          <p>Create your professional profile and be ready when Servix launches.</p>
          <div className="cta-final__actions">
            <Button to="/register" variant="on-dark" size="lg">
              Become a Professional
            </Button>
            <Button to="/contact" variant="outline-dark" size="lg">
              Talk to Us
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

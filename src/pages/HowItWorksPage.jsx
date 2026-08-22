import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Accordion } from '../components/ui/Accordion.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { faqs } from '../data/faqs.js';

const CUSTOMER_STEPS = [
  {
    num: '01',
    title: 'Discover',
    desc: 'Search by service or browse categories. Every listing shows clear pricing, scope and delivery expectations.',
  },
  {
    num: '02',
    title: 'Compare',
    desc: 'Review portfolios, ratings, reviews and availability side by side before you decide.',
  },
  {
    num: '03',
    title: 'Book',
    desc: 'Choose a date and time that suits you, confirm the scope, and send your booking request.',
  },
  {
    num: '04',
    title: 'Complete',
    desc: 'Track progress and communicate through Servix until the service is delivered.',
  },
  {
    num: '05',
    title: 'Review',
    desc: 'Share honest feedback that helps the next customer and rewards great professionals.',
  },
];

const PRO_STEPS = [
  {
    num: '01',
    title: 'Create Profile',
    desc: 'Build a professional profile with your experience, skills and portfolio.',
  },
  {
    num: '02',
    title: 'List Services',
    desc: 'Publish services with transparent pricing, clear scope and defined deliverables.',
  },
  {
    num: '03',
    title: 'Receive Bookings',
    desc: 'Customers find you through search and categories, and book directly against your availability.',
  },
  {
    num: '04',
    title: 'Deliver',
    desc: 'Manage the engagement through Servix — communication, scheduling and delivery in one place.',
  },
  {
    num: '05',
    title: 'Grow',
    desc: 'Collect reviews, improve your ranking and turn great work into repeat business.',
  },
];

export default function HowItWorksPage() {
  useDocumentMeta({
    title: 'How It Works',
    description:
      'How the Servix marketplace works for customers and professionals — from discovery and comparison to booking, delivery and reviews.',
  });

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero">
          <span className="eyebrow">How it works</span>
          <h1>One platform, two sides, zero friction</h1>
          <p className="page-hero__desc">
            Servix connects people who need professional work done with the
            professionals who do it — with clear pricing, structured bookings
            and accountable delivery on both sides.
          </p>
        </header>
      </div>

      <section className="section section--surface" aria-labelledby="for-customers">
        <div className="container">
          <SectionHeader
            eyebrow="For customers"
            title="From need to done"
            description="Five steps from finding the right professional to leaving a review."
          />
          <div className="steps" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
            {CUSTOMER_STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="step__num">{step.num}</span>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-10)' }}>
            <Button to="/services" variant="primary">
              Explore Services
            </Button>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="for-professionals">
        <div className="container">
          <SectionHeader
            eyebrow="For professionals"
            title="From skills to a business"
            description="Servix gives professionals the structure to present, sell and deliver their work."
          />
          <div className="steps" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
            {PRO_STEPS.map((step) => (
              <div className="step" key={step.num}>
                <span className="step__num">{step.num}</span>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-10)' }}>
            <Button to="/professionals/join" variant="secondary">
              Become a Professional
            </Button>
          </div>
        </div>
      </section>

      <section className="section section--subtle" aria-labelledby="platform-explainer">
        <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--space-5)' }}>
          <div className="value-item">
            <span className="why-item__icon" style={{ marginBottom: 'var(--space-4)' }}>
              <Icon name="shield" size={18} />
            </span>
            <h3>Trust is structural</h3>
            <p>
              Verification, transparent pricing and reviews from completed
              bookings are built into the platform — not bolted on.
            </p>
          </div>
          <div className="value-item">
            <span className="why-item__icon" style={{ marginBottom: 'var(--space-4)' }}>
              <Icon name="message" size={18} />
            </span>
            <h3>Everything in one place</h3>
            <p>
              Scope, schedule, communication and delivery live inside the
              booking — no scattered emails, chats and invoices.
            </p>
          </div>
          <div className="value-item">
            <span className="why-item__icon" style={{ marginBottom: 'var(--space-4)' }}>
              <Icon name="check-circle" size={18} />
            </span>
            <h3>Accountability both ways</h3>
            <p>
              Clear expectations protect customers and professionals alike.
              Good work gets recognised; problems get resolved with context.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="hiw-faq">
        <div className="container container--narrow">
          <SectionHeader eyebrow="Questions" title="Frequently asked questions" />
          <Accordion items={faqs.general} />
        </div>
      </section>
    </div>
  );
}

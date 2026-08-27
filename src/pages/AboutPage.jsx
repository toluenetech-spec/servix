import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';

const VALUES = [
  {
    title: 'Trust before transactions',
    desc: 'A marketplace only works when both sides can rely on it. Verification, transparency and honest reviews come before growth metrics.',
  },
  {
    title: 'Respect for the craft',
    desc: 'Professional work deserves professional presentation. Servix treats service providers as businesses, not gig listings.',
  },
  {
    title: 'Simplicity is a feature',
    desc: 'Finding, comparing and booking a service should be simple. Every feature must earn its complexity.',
  },
  {
    title: 'Accountability both ways',
    desc: 'Clear expectations protect customers and professionals alike. Good work is recognised; problems are resolved with context.',
  },
];

export default function AboutPage() {
  useDocumentMeta({
    title: 'About',
    description:
      'Servix is building a professional services marketplace where trust, quality and simplicity come first. Learn about our mission and values.',
  });

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero">
          <span className="eyebrow">About Servix</span>
          <h1>Professional services deserve a professional platform</h1>
          <p className="page-hero__desc">
            Servix is a technology company building the marketplace where
            customers and professional service providers meet, agree and get
            work done — properly.
          </p>
        </header>
      </div>

      <section className="section section--surface" aria-labelledby="story">
        <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--space-16)' }}>
          <div>
            <SectionHeader eyebrow="Our story" title="Why Servix exists" />
            <div className="prose">
              <p>
                Finding a skilled professional still relies too much on luck —
                a friend&rsquo;s recommendation, a social media post, an
                unanswered phone call. Skilled professionals, meanwhile,
                spend more time chasing work than doing it.
              </p>
              <p>
                Servix exists to close that gap: a single platform where
                professional services are presented clearly, compared fairly
                and booked with confidence.
              </p>
              <p>
                <strong>We are early.</strong> The platform is in active
                development, and this website is the first public step. The
                detailed company story will be written here as it happens.
              </p>
            </div>
          </div>
          <div>
            <SectionHeader eyebrow="Mission" title="What we're building toward" />
            <div className="prose">
              <p>
                <strong>
                  Make professional services as reliable to buy as any product.
                </strong>
              </p>
              <p>
                That means real profiles instead of anonymous listings, agreed
                scope instead of vague promises, and a booking flow that
                respects everyone&rsquo;s time.
              </p>
              <p>
                Our vision is a marketplace where the best professionals are
                easy to find and rewarding to be — starting with the categories
                people need most, then growing carefully.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="values">
        <div className="container">
          <SectionHeader eyebrow="Values" title="How we work" />
          <div className="values-grid">
            {VALUES.map((v) => (
              <div className="value-item" key={v.title}>
                <h3>{v.title}</h3>
                <p>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--subtle" aria-labelledby="team">
        <div className="container container--narrow" style={{ textAlign: 'center' }}>
          <SectionHeader
            layout="center"
            eyebrow="Team"
            title="The people behind Servix"
            description="Team profiles will be published here as the company grows. We don't list placeholder people — when you see a face on this page, it's real."
          />
          <div
            className="state-block"
            style={{ background: 'transparent' }}
          >
            <div className="state-block__icon">
              <Icon name="users" size={22} />
            </div>
            <h3>Team section coming soon</h3>
            <p>
              Interested in what we&rsquo;re building? We&rsquo;d love to hear
              from you.
            </p>
            <Button to="/contact" variant="secondary">
              Get in touch
            </Button>
          </div>
        </div>
      </section>

      <section className="section--dark on-dark cta-final" aria-labelledby="about-cta">
        <div className="container container--narrow">
          <h2 id="about-cta">Be part of it from the start.</h2>
          <p>Explore the platform or join as a professional ahead of launch.</p>
          <div className="cta-final__actions">
            <Button to="/services" variant="on-dark" size="lg">
              Explore Services
            </Button>
            <Button to="/professionals/join" variant="outline-dark" size="lg">
              Become a Professional
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Accordion } from '../components/ui/Accordion.jsx';
import { ErrorState, Skeleton } from '../components/ui/States.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { getPricingPlans } from '../lib/api.js';
import { formatPrice } from '../lib/format.js';
import { faqs } from '../data/faqs.js';

export default function PricingPage() {
  useDocumentMeta({
    title: 'Pricing for Professionals',
    description:
      'Servix pricing plans for professionals — start free, upgrade for more listings, visibility and business tools. Introductory pricing, subject to change.',
  });

  const { data: plans, loading, error, retry } = useFetch(() => getPricingPlans(), []);

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero" style={{ textAlign: 'center', maxWidth: '42rem', marginInline: 'auto' }}>
          <span className="eyebrow">Pricing</span>
          <h1>Simple plans for professionals</h1>
          <p className="page-hero__desc" style={{ marginInline: 'auto' }}>
            Browsing and booking is always free for customers. Professionals
            choose the plan that fits their practice.
          </p>
          <p className="trust-strip__note" style={{ marginTop: 'var(--space-4)' }}>
            Introductory pricing shown — plans and prices are subject to change before launch.
          </p>
        </header>

        <section className="section" style={{ paddingTop: 'var(--space-6)' }} aria-label="Plans">
          {loading && (
            <div className="pricing-grid">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height="28rem" />
              ))}
            </div>
          )}

          {error && (
            <ErrorState
              message="We couldn't load the pricing plans. Please try again."
              onRetry={retry}
            />
          )}

          {plans && (
            <div className="pricing-grid">
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  className={`plan ${plan.highlighted ? 'plan--highlight' : ''}`}
                >
                  {plan.highlighted && <span className="plan__flag">Most popular</span>}
                  <div>
                    <h2 className="plan__name">{plan.name}</h2>
                    <p className="plan__tagline">{plan.tagline}</p>
                  </div>
                  <p className="plan__price">
                    <strong>{plan.price === 0 ? 'Free' : formatPrice(plan.price)}</strong>
                    <span>{plan.price === 0 ? plan.period : plan.period}</span>
                  </p>
                  <ul className="plan__features">
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <Icon name="check" size={16} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    to={plan.id === 'business' ? '/contact' : '/register'}
                    variant={plan.highlighted ? 'primary' : 'secondary'}
                    block
                  >
                    {plan.cta}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="section section--surface" aria-labelledby="pricing-faq">
        <div className="container container--narrow">
          <SectionHeader eyebrow="Questions" title="Pricing FAQs" />
          <Accordion
            items={[
              {
                q: 'Is Servix free for customers?',
                a: 'Yes. Browsing, comparing and booking on Servix is free for customers — you only pay the price of the service you book.',
              },
              {
                q: 'Can I change plans later?',
                a: 'Yes. You will be able to upgrade or downgrade at any time once billing launches, with changes applied at your next billing cycle.',
              },
              {
                q: 'Is this final pricing?',
                a: 'No — the plans shown are introductory placeholders and may change before the platform launches. Billing is not yet enabled.',
              },
              ...faqs.professionals.slice(1, 3),
            ]}
          />
        </div>
      </section>
    </div>
  );
}

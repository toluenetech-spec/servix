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
      'Servix plans — Free, Go, Pro, Team and Enterprise. Start free; upgrade for more capacity, advanced tools, team workspaces and more Servix AI.',
  });

  const { data: plans, loading, error, retry } = useFetch(() => getPricingPlans(), []);

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero" style={{ textAlign: 'center', maxWidth: '42rem', marginInline: 'auto' }}>
          <span className="eyebrow">Pricing</span>
          <h1>Simple plans for everyone on Servix</h1>
          <p className="page-hero__desc" style={{ marginInline: 'auto' }}>
            Browsing and booking is always free. Every account starts on Free; upgrade for more capacity,
            advanced tools, a team workspace and more Servix AI each month.
          </p>
          <p className="trust-strip__note" style={{ marginTop: 'var(--space-4)' }}>
            Billed monthly through the Servix payment provider. No auto-renewal — you are never charged without choosing to pay.
          </p>
        </header>

        <section className="section" style={{ paddingTop: 'var(--space-6)' }} aria-label="Plans">
          {loading && (
            <div className="pricing-grid">
              {[1, 2, 3, 4, 5].map((i) => (
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
                    <strong>{plan.price === 0 ? (plan.id === 'enterprise' ? 'Custom' : 'Free') : formatPrice(plan.price)}</strong>
                    <span>{plan.id === 'enterprise' ? 'arranged with Servix' : plan.period}</span>
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
                    to={plan.id === 'enterprise' ? '/contact?topic=enterprise' : plan.id === 'free' ? '/register' : '/dashboard/plan'}
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
                a: 'Yes. Upgrade at any time from Plan & usage in your workspace; a new plan starts a fresh 30-day term immediately. You can move back to Free whenever you like — nothing is deleted, you simply cannot add items above the Free limits until you are under them again.',
              },
              {
                q: 'What are Servix AI tokens?',
                a: 'Every Servix AI request (assistant, drafts, matching, coaching) uses tokens for the question and the answer. Each plan includes a monthly allowance that resets on the 1st; you can see exactly how much you have used in your workspace, with a heads-up at 75% and 90%. Failed requests are never counted.',
              },
              {
                q: 'How do Team and Enterprise work?',
                a: 'Team gives you a workspace for up to 5 people who share one plan and one AI token pool, with a team dashboard and shared view of live work. Enterprise adds custom limits, an audit log with export, and priority support — contact Servix to set it up.',
              },
              ...faqs.professionals.slice(1, 3),
            ]}
          />
        </div>
      </section>
    </div>
  );
}

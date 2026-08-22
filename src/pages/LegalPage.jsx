import { useDocumentMeta } from '../lib/useDocumentMeta.js';

const CONTENT = {
  privacy: {
    title: 'Privacy Policy',
    description: 'How Servix handles personal information.',
    intro:
      'This is a placeholder privacy policy for the pre-launch Servix website. A complete, legally reviewed policy will be published before the platform launches and before any personal data is collected.',
    sections: [
      {
        h: 'What this website collects today',
        p: 'This public website does not create accounts, process payments or store personal data on a server. Form submissions are validated in your browser only; nothing is transmitted until backend services launch.',
      },
      {
        h: 'What will change at launch',
        p: 'When accounts, bookings and payments go live, this policy will be replaced with a full description of the data we collect, why we collect it, how long we keep it and the choices you have.',
      },
      {
        h: 'Questions',
        p: 'If you have questions about privacy at Servix, use the contact page and choose "General enquiry".',
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    description: 'The terms governing use of the Servix platform.',
    intro:
      'These are placeholder terms for the pre-launch Servix website. Complete terms of service will be published before bookings, payments or professional accounts are enabled.',
    sections: [
      {
        h: 'Current status',
        p: 'The Servix platform is in development. Content on this website — including services, professionals, prices and statistics — is demonstration material and does not constitute an offer.',
      },
      {
        h: 'What will change at launch',
        p: 'Full terms covering bookings, payments, cancellations, professional obligations and dispute resolution will be published and versioned here.',
      },
      {
        h: 'Questions',
        p: 'For questions about these terms, use the contact page.',
      },
    ],
  },
};

export default function LegalPage({ kind }) {
  const content = CONTENT[kind];
  useDocumentMeta({ title: content.title, description: content.description });

  return (
    <div className="page container container--narrow">
      <header className="page-hero">
        <span className="eyebrow">Legal</span>
        <h1>{content.title}</h1>
        <p className="page-hero__desc">{content.intro}</p>
      </header>
      <div style={{ paddingBottom: 'var(--space-20)', display: 'grid', gap: 'var(--space-8)' }}>
        {content.sections.map((s) => (
          <section key={s.h}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>{s.h}</h2>
            <p className="text-muted" style={{ maxWidth: '62ch' }}>
              {s.p}
            </p>
          </section>
        ))}
        <p className="trust-strip__note">Last updated: August 2026 · Placeholder document</p>
      </div>
    </div>
  );
}

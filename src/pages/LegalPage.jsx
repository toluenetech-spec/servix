import { Link } from 'react-router-dom';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { LEGAL_CONTENT, LEGAL_UPDATED, LEGAL_CONTACT } from '../content/legal.js';
export default function LegalPage({ kind }) {
  const content = LEGAL_CONTENT[kind];
  useDocumentMeta({ title: content.title, description: content.description });
  return <div className="page container container--narrow">
    <header className="page-hero"><span className="eyebrow">Trust & transparency</span><h1>{content.title}</h1><p className="page-hero__desc">{content.intro}</p><p>Effective and last updated: {LEGAL_UPDATED}</p></header>
    <nav aria-label="Legal policies" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 32 }}><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Service</Link><Link to="/cookies">Cookie Policy</Link></nav>
    {kind === 'cookies' && <button className="btn btn--secondary" onClick={() => window.dispatchEvent(new Event('servix:cookie-settings'))}>Manage cookie settings</button>}
    <div style={{ paddingBottom: 'var(--space-20)', display: 'grid', gap: 'var(--space-8)', marginTop: 24 }}>
      {content.sections.map(([h, p], i) => <section key={h}><h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>{i + 1}. {h}</h2><p className="text-muted" style={{ maxWidth: '68ch', lineHeight: 1.85 }}>{p}</p></section>)}
      <aside className="security-note"><h2>Contact the operator</h2><p>Toluwalase O. Samuel · <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a></p><p>Privacy regulator: <a href="https://ndpc.gov.ng/" target="_blank" rel="noopener noreferrer">Nigeria Data Protection Commission</a></p>{kind === 'cookies' && <p><a href="https://vercel.com/docs/analytics/privacy-policy">Vercel Analytics privacy</a> · <a href="https://vercel.com/docs/speed-insights/privacy-policy">Speed Insights privacy</a></p>}</aside>
    </div>
  </div>;
}

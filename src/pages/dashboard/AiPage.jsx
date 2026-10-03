/**
 * Servix AI hub (/dashboard/ai). Role-aware: customers get the assistant + budget guide; professionals also get
 * opportunity matching, the weekly radar and the profile coach. Hidden entirely when the `ai` flag is off.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useFeatures } from '../../lib/useFeatures.js';
import { getCategories } from '../../lib/api.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useWorkspace } from '../../components/dashboard/WorkspaceShell.jsx';
import { PageHead, Empty } from './shared.jsx';
import { PageSkeleton } from '../../components/ui/States.jsx';
import { AiChat } from '../../components/ai/AiAssistant.jsx';
import { PricingGuide } from '../../components/ai/AiInsights.jsx';
import { OpportunityMatches, OpportunityRadar, ProfileCoach } from '../../components/ai/AiProTools.jsx';
import { AiNote } from '../../components/ai/AiBits.jsx';
import '../../components/marketplace/marketplace.css';

export default function AiPage() {
  useDocumentMeta({ title: 'Servix AI', description: 'Your AI helper for finding work, pricing and getting things done on Servix.' });
  const { user } = useAuth();
  const { ai, requests, ready } = useFeatures();
  const ws = useWorkspace();
  const professional = Boolean(ws?.overview?.canManageServices);
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  useEffect(() => { getCategories().then((c) => setCategories(c.items ?? c)).catch(() => setCategories([])); }, []);
  if (!ready) return <PageSkeleton variant="panel" label="Loading Servix AI…" />;
  if (!ai) return <><PageHead title="Servix AI" description="Not switched on yet." /><section className="ws-panel"><Empty icon="sparkle" title="Coming soon" description="Servix AI helpers are not enabled on this account yet." to="/dashboard" label="Back to overview" /></section></>;

  const tabs = professional
    ? [['assistant', 'Assistant'], ...(requests ? [['opportunities', 'Opportunities']] : []), ['profile', 'Profile coach'], ['pricing', 'Pricing guide']]
    : [['assistant', 'Assistant'], ['pricing', 'Budget guide']];
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0][0];
  const role = user?.role === 'admin' ? 'admin' : professional ? 'professional' : 'customer';

  return <>
    <PageHead eyebrow="SERVIX AI" title="Your AI helper" description={professional ? 'Find the requests that fit you, sharpen your profile, price with confidence and ask anything about Servix — grounded in real Servix data.' : 'Ask anything about professionals, prices or how Servix works, and get budget guidance from real Servix listings.'} />
    <div className="ws-tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => { const n = new URLSearchParams(params); n.set('tab', k); setParams(n, { replace: true }); }}>{l}</button>)}</div>

    {tab === 'assistant' && <section className="ws-panel" style={{ minHeight: 480, display: 'flex', flexDirection: 'column' }}><AiChat role={role} /></section>}
    {tab === 'opportunities' && <>
      <OpportunityMatches />
      <OpportunityRadar />
      <p className="ws-muted">Prefer to look yourself? <Link to="/dashboard/proposals">Browse all open requests</Link>.</p>
    </>}
    {tab === 'profile' && <ProfileCoach />}
    {tab === 'pricing' && <section className="ws-panel"><PricingGuide categories={categories} audience={professional ? 'professional' : 'customer'} /></section>}

    <AiNote>Servix AI never books, pays, moves money or edits your account. It drafts, explains and suggests — you decide. Answers can take up to a minute while we are on a shared AI provider.</AiNote>
  </>;
}

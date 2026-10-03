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
import { AiAvatar, AiNote } from '../../components/ai/AiBits.jsx';
import { useAiMeter, AiUsageCard, AiQuotaBanner } from '../../components/ai/AiUsage.jsx';
import { useEntitlements, minPlanFor } from '../../lib/useEntitlements.js';
import { PlanTag, UpgradeNotice } from '../../components/plans/PlanBits.jsx';
import '../../components/marketplace/marketplace.css';

const TAB_COPY = {
  assistant: { title: 'Assistant', lead: 'Ask in plain language. Servix AI looks things up in real Servix data before it answers.' },
  opportunities: { title: 'Opportunities', lead: 'Open requests ranked by how well they fit your gigs, plus what is moving in your category this week.' },
  profile: { title: 'Profile coach', lead: 'An honest read of your profile against what customers look for, with wording you can paste in.' },
  pricing: { title: 'Pricing guide', lead: 'Price ranges drawn from real Servix listings in each category — never invented numbers.' },
};

export default function AiPage() {
  useDocumentMeta({ title: 'Servix AI', description: 'Your AI helper for finding work, pricing and getting things done on Servix.' });
  const { user } = useAuth();
  const { ai, requests, ready } = useFeatures();
  const ws = useWorkspace();
  const professional = Boolean(ws?.overview?.canManageServices);
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const ent = useEntitlements();
  const meter = useAiMeter();
  useEffect(() => { getCategories().then((c) => setCategories(c.items ?? c)).catch(() => setCategories([])); }, []);
  // Which AI tools the plan includes (the API enforces the same list). Locked tabs stay visible with a plan tag.
  const TAB_DEPTS = { assistant: ['assistant'], opportunities: ['job_matching'], profile: ['profile_analysis'], pricing: ['pricing_guidance'] };
  const unlocked = (k) => !ent.ready || TAB_DEPTS[k].every((d) => ent.canUseAi(d));
  const neededPlan = (k) => minPlanFor(ent.entitlements, { department: TAB_DEPTS[k][0] });
  if (!ready) return <PageSkeleton variant="panel" label="Loading Servix AI…" />;
  if (!ai) return <><PageHead title="Servix AI" description="Not switched on yet." /><section className="ws-panel"><Empty icon="sparkle" title="Coming soon" description="Servix AI helpers are not enabled on this account yet." to="/dashboard" label="Back to overview" /></section></>;

  const tabs = professional
    ? [['assistant', 'Assistant'], ...(requests ? [['opportunities', 'Opportunities']] : []), ['profile', 'Profile coach'], ['pricing', 'Pricing guide']]
    : [['assistant', 'Assistant'], ['pricing', 'Budget guide']];
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0][0];
  const role = user?.role === 'admin' ? 'admin' : professional ? 'professional' : 'customer';
  const select = (k) => { const n = new URLSearchParams(params); n.set('tab', k); setParams(n, { replace: true }); };
  const firstName = (user?.fullName ?? user?.name ?? '').split(' ')[0];
  const copy = tab === 'pricing' && !professional ? { title: 'Budget guide', lead: 'What similar work costs on Servix right now, from real listings — so you can set a fair budget.' } : TAB_COPY[tab];

  return <>
    <section className="ai-hero" data-testid="ai-hero">
      <div className="ai-hero__inner">
        <AiAvatar size={64} state="idle" />
        <div>
          <p className="ai-hero__eyebrow">Servix AI</p>
          <h1>{firstName ? `Good to see you, ${firstName}.` : 'Your AI helper'}</h1>
          <p>{professional ? 'Find the requests that fit you, sharpen your profile, price with confidence and ask anything about Servix — all grounded in real Servix data.' : 'Ask anything about professionals, prices or how Servix works, and get budget guidance from real Servix listings.'}</p>
        </div>
        <div className="ai-hero__chips" role="tablist" aria-label="Servix AI tools">
          {tabs.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} onClick={() => select(k)} style={tab === k ? { background: '#f7f4ec', color: '#12372a', fontWeight: 600 } : undefined}>{l}{!unlocked(k) && <PlanTag plan={neededPlan(k)} />}</button>)}
        </div>
        <div className="ai-hero__status"><i aria-hidden="true" />Private to your account · never books, pays or edits anything for you</div>
      </div>
    </section>

    <div className="ai-layout">
      <div className="ai-main">
        <AiQuotaBanner meter={meter} />
        <div>
          <h2 style={{ fontSize: 18, margin: '0 0 4px', color: '#12372a' }}>{copy.title}</h2>
          <p className="ws-muted" style={{ margin: 0 }}>{copy.lead}</p>
        </div>
        {!unlocked(tab) ? <UpgradeNotice title={`${copy.title} is part of the ${neededPlan(tab) ? neededPlan(tab)[0].toUpperCase() + neededPlan(tab).slice(1) : 'Go'} plan`} body="Your plan includes the assistant, explanations, smart search and the pricing guide. Upgrade to add this tool — nothing else changes." upgradeTo={neededPlan(tab)} />
          : <>
            {tab === 'assistant' && <section className="ai-card ai-card--chat"><AiChat role={role} /></section>}
            {tab === 'opportunities' && <>
              <OpportunityMatches />
              {ent.canUseAi('opportunity_radar') ? <OpportunityRadar /> : <UpgradeNotice title="Weekly opportunity radar" body="What is moving in your category this week — part of the Pro plan." upgradeTo={minPlanFor(ent.entitlements, { department: 'opportunity_radar' })} compact />}
              <p className="ws-muted">Prefer to look yourself? <Link to="/dashboard/proposals">Browse all open requests</Link>.</p>
            </>}
            {tab === 'profile' && <ProfileCoach improveAllowed={ent.canUseAi('profile_improvement')} improvePlan={minPlanFor(ent.entitlements, { department: 'profile_improvement' })} />}
            {tab === 'pricing' && <section className="ai-card"><PricingGuide categories={categories} audience={professional ? 'professional' : 'customer'} /></section>}
          </>}
      </div>

      <aside className="ai-rail" aria-label="About Servix AI">
        <AiUsageCard meter={meter} />
        <section className="ai-card">
          <h3>What it can do</h3>
          <ul>
            <li>Find professionals and open requests using live Servix data.</li>
            <li>Explain bookings, payments, trust and verification in plain words.</li>
            <li>Draft requests, proposals, gig descriptions and messages for you to edit.</li>
            <li>Suggest prices and budgets from real listings in each category.</li>
          </ul>
        </section>
        <section className="ai-card ai-card--guard">
          <h3>What it never does</h3>
          <ul>
            <li>Move money, pay, refund or touch your wallet.</li>
            <li>Book, cancel or change anything on your behalf.</li>
            <li>Invent professionals, prices, ratings or categories.</li>
          </ul>
        </section>
        <section className="ai-card ai-card--links">
          <h3>Shortcuts</h3>
          <ul>
            {professional ? <>
              {requests && <li><Link to="/dashboard/proposals">Open requests<small>Draft a proposal with AI on any request</small></Link></li>}
              <li><Link to="/dashboard/gigs">My gigs<small>Draft descriptions with AI in the editor</small></Link></li>
              <li><Link to="/dashboard/profile">My profile<small>Apply the coach’s suggestions</small></Link></li>
            </> : <>
              {requests && <li><Link to="/dashboard/requests/new">Post a request<small>Describe it in your words — AI structures it</small></Link></li>}
              <li><Link to="/professionals">Find a professional<small>Smart search understands plain language</small></Link></li>
              <li><Link to="/bookings">My bookings<small>Ask what any status means</small></Link></li>
            </>}
          </ul>
        </section>
        <AiNote>Servix AI drafts, explains and suggests — you decide. Answers stream in as they are written; the whole reply can still take a little while on busy days.</AiNote>
      </aside>
    </div>
  </>;
}

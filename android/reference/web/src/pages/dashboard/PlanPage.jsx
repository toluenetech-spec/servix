/**
 * Plan page for every account (customers, professionals, team members). Everything shown here comes from
 * `GET /billing/plan` — the same entitlement engine the API enforces with — so the page never promises
 * something the platform does not actually do. Payments open the Servix payment provider; Servix AI
 * never participates in checkout.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getPlan, startPlanCheckout, verifyPlan, downgradePlan } from '../../lib/workspaceApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import { refreshEntitlements, PLAN_LABELS } from '../../lib/useEntitlements.js';
import { UsageMeter, AiQuotaWarning } from '../../components/plans/PlanBits.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useResource, PageHead, LoadState, dateLabel } from './shared.jsx';
import '../../components/plans/plans.css';

const num = (v) => (v === null || v === undefined ? 'Unlimited' : Number(v).toLocaleString('en-NG'));
const LIMIT_ROWS = [
  ['monthly_ai_tokens', 'Servix AI tokens / month'], ['listings', 'Service listings'], ['portfolio_items', 'Portfolio items'],
  ['monthly_proposals', 'Proposals / month'], ['active_proposals', 'Live proposals at once'], ['monthly_requests', 'Requests posted / month'],
  ['active_requests', 'Open requests at once'], ['saved_professionals', 'Saved professionals'], ['saved_searches', 'Saved searches'],
  ['profile_versions', 'Profile versions'], ['monthly_exports', 'CSV exports / month'], ['team_members', 'Team members'],
];
const FEATURE_ROWS = [
  ['advanced_filters', 'Advanced request filters & sorting'], ['proposal_organization', 'Proposal labels & private notes'], ['proposal_pipeline', 'Proposal pipeline view'],
  ['profile_versions', 'Multiple profile versions'], ['analytics_detailed', 'Detailed analytics'], ['analytics_advanced', 'Application & profile performance'],
  ['profile_badge', 'Plan badge on public profile'], ['priority_ai', 'Priority AI routing'], ['team_workspace', 'Team workspace'], ['team_analytics', 'Team dashboard & AI usage'],
  ['org_custom_limits', 'Custom organisation limits'], ['org_audit_log', 'Audit log & export'],
];
/* Usage cards shown on the page: key → label (professional-only keys are skipped when the account has no profile). */
const USAGE_CARDS = [
  ['listings', 'Service listings', true], ['portfolio_items', 'Portfolio items', true], ['monthly_proposals', 'Proposals this month', true], ['active_proposals', 'Live proposals', true],
  ['monthly_requests', 'Requests this month', false], ['active_requests', 'Open requests', false], ['saved_professionals', 'Saved professionals', false],
  ['saved_searches', 'Saved searches', false], ['profile_versions', 'Profile versions', true], ['monthly_exports', 'Exports this month', false],
];

export default function PlanPage() {
  useDocumentMeta({ title: 'Your Servix plan', description: 'Your plan, usage and upgrade options on Servix.' });
  const r = useResource(getPlan);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState(null); const [confirmDowngrade, setConfirmDowngrade] = useState(false);
  const reference = params.get('reference'); const highlight = params.get('highlight');
  useEffect(() => {
    if (!reference) return; let alive = true; setBusy('verify');
    verifyPlan(reference).then((result) => {
      if (!alive) return; r.setData(result.plan); refreshEntitlements();
      setNotice(result.status === 'active' ? { kind: 'ok', text: 'Your payment was confirmed and your plan is active.' } : result.status === 'failed' ? { kind: 'warn', text: 'That payment did not complete. You have not been charged for an active plan.' } : { kind: 'warn', text: 'Your payment is still being confirmed. Refresh in a moment — the plan activates automatically once the provider confirms it.' });
    }).catch((e) => { if (alive) setNotice({ kind: 'warn', text: e.message }); }).finally(() => { if (alive) { setBusy(''); const n = new URLSearchParams(params); n.delete('reference'); setParams(n, { replace: true }); } });
    return () => { alive = false; };
  }, [reference]);
  async function upgrade(slug) { setBusy(slug); setNotice(null); try { const { authorizationUrl } = await startPlanCheckout(slug); window.location.assign(authorizationUrl); } catch (e) { setNotice({ kind: 'warn', text: e.message }); setBusy(''); } }
  async function downgrade() { setBusy('downgrade'); setNotice(null); try { const result = await downgradePlan(); r.setData(result.plan); refreshEntitlements(); setConfirmDowngrade(false); setNotice({ kind: 'ok', text: 'You are on the Free plan. Nothing was deleted — items above the Free limits stay visible and you can upgrade again any time.' }); } catch (e) { setNotice({ kind: 'warn', text: e.message }); } finally { setBusy(''); } }

  return <><PageHead eyebrow="YOUR ACCOUNT" title="Plan & usage" description="Plans are billed monthly through the Servix payment provider and never auto-renew. Changing plan never deletes your data or affects your bookings." /><LoadState skeleton="cards" label="Loading your plan…" resource={r}>{(plan) => <PlanBody plan={plan} busy={busy} notice={notice} highlight={highlight} onUpgrade={upgrade} confirmDowngrade={confirmDowngrade} setConfirmDowngrade={setConfirmDowngrade} onDowngrade={downgrade} />}</LoadState></>;
}

function PlanBody({ plan, busy, notice, highlight, onUpgrade, confirmDowngrade, setConfirmDowngrade, onDowngrade }) {
  const current = plan.plans.find((p) => p.slug === plan.current);
  const fromTeam = plan.source === 'organization';
  const professional = 'listings' in (plan.usage ?? {});
  const bestUpgrade = useMemo(() => plan.plans.filter((p) => p.purchasable && p.rank > (current?.rank ?? 0)).sort((a, b) => a.rank - b.rank)[0] ?? null, [plan]);
  const cards = USAGE_CARDS.filter(([, , proOnly]) => professional || !proOnly);
  return <>
    {notice && <div className="ws-alert" role={notice.kind === 'warn' ? 'alert' : 'status'} style={notice.kind === 'ok' ? { background: '#eef6e8', borderColor: '#cfe2c2' } : undefined}>{notice.text}</div>}
    {busy === 'verify' && <p className="ws-muted" role="status">Confirming your payment…</p>}
    <AiQuotaWarning meter={plan.ai} upgradeTo={bestUpgrade?.slug ?? null} />

    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Current plan</span><strong style={{ fontSize: 22 }} data-testid="plan-current">{plan.label}</strong><small>{fromTeam ? `Shared by your team “${plan.organization?.name}” (${plan.organization?.role})` : plan.source === 'admin' ? 'Assigned by Servix' : plan.expiresAt ? `Active until ${dateLabel(plan.expiresAt)}` : plan.expired ? 'Your paid plan expired — you are on Free' : 'No expiry'}</small></div>
      <div className="ws-stat"><span>Servix AI this month</span><strong style={{ fontSize: 22 }}>{plan.ai?.allowed === null ? 'Unlimited' : `${Math.round(plan.ai?.percent ?? 0)}%`}</strong><small>{plan.ai ? `${Number(plan.ai.used).toLocaleString('en-NG')} of ${num(plan.ai.allowed)} tokens · resets ${dateLabel(plan.period.resetAt)}` : '—'}</small></div>
      <div className="ws-stat"><span>Analytics</span><strong style={{ fontSize: 22 }}>{plan.features.includes('analytics_advanced') ? 'Advanced' : plan.features.includes('analytics_detailed') ? 'Detailed' : 'Basic'}</strong><small>{plan.features.includes('analytics_advanced') ? 'Application and profile performance unlocked' : plan.features.includes('analytics_detailed') ? 'Trends and breakdowns unlocked' : 'Upgrade for trends and breakdowns'}</small></div>
      <div className="ws-stat"><span>Renewal</span><strong style={{ fontSize: 22 }}>Manual</strong><small>Plans do not auto-renew; you are never charged without choosing to pay</small></div>
    </div>

    <section className="ws-panel">
      <h2>Usage on your {plan.label} plan</h2>
      <UsageMeter meter={plan.ai} label={plan.ai?.subject === 'org' ? 'Team AI token pool' : 'Servix AI tokens'} data-testid="ai-meter" />
      {plan.ai?.member && plan.ai.member.allowed !== null && <div style={{ marginTop: 10 }}><UsageMeter meter={plan.ai.member} label="Your personal AI cap (set by your team admin)" compact /></div>}
      <div className="plan-usage-grid">{cards.map(([key, label]) => { const used = plan.usage[key] ?? 0; const allowed = plan.limits[key]; const full = allowed !== null && allowed !== undefined && used >= allowed; return <div className={`plan-usage${full ? ' is-full' : ''}`} key={key}><span>{label}</span><strong>{used.toLocaleString('en-NG')}{allowed === null || allowed === undefined ? <small style={{ fontWeight: 400, color: '#84917d' }}> · unlimited</small> : <small style={{ fontWeight: 400, color: '#84917d' }}> / {Number(allowed).toLocaleString('en-NG')}</small>}</strong></div>; })}</div>
      <p className="ws-muted" style={{ marginTop: 10 }}>Monthly counters reset on {dateLabel(plan.period.resetAt)}. If you ever move to a smaller plan, existing items above the new limits stay exactly where they are — you simply cannot add more until you are under the limit again.</p>
    </section>

    <h2 style={{ fontSize: 17, margin: '6px 0 12px' }}>Plans</h2>
    <div className="plan-grid">{plan.plans.map((p) => {
      const isCurrent = p.slug === plan.current;
      const lower = p.rank < (current?.rank ?? 0);
      return <article className={`plan-card ${isCurrent ? 'is-current' : ''} ${highlight === p.slug ? 'is-highlight' : ''}`} key={p.slug} aria-current={isCurrent ? 'true' : undefined} data-testid={`plan-card-${p.slug}`}>
        <span className="eyebrow">{p.name}</span>
        <div className="price">{p.price ? formatPrice(p.price) : p.slug === 'enterprise' ? 'Custom' : 'Free'}{p.price ? <small> / month</small> : null}</div>
        <p className="ws-muted" style={{ fontSize: 12 }}>{p.tagline}</p>
        <span className="plan-card__ai">{p.limits.monthly_ai_tokens === null ? 'Custom AI allowance' : `${Number(p.limits.monthly_ai_tokens).toLocaleString('en-NG')} AI tokens / month`}</span>
        <ul>{(p.features || []).slice(0, 6).map((f) => <li key={f}>{f}</li>)}</ul>
        {isCurrent ? <span className="ws-chip">Your current plan</span>
          : fromTeam && plan.organization?.role !== 'owner' ? <span className="ws-muted" style={{ fontSize: 11 }}>Managed by your team</span>
          : p.purchasable ? <button className="btn btn--primary" disabled={Boolean(busy)} onClick={() => onUpgrade(p.slug)}>{busy === p.slug ? 'Opening secure checkout…' : lower ? `Switch to ${p.name}` : `Upgrade to ${p.name}`}</button>
          : p.slug === 'enterprise' ? <Link className="btn btn--secondary" to="/contact?topic=enterprise">Contact Servix</Link>
          : p.slug === 'free' && plan.current !== 'free' && !fromTeam ? <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => setConfirmDowngrade(true)}>Move to Free</button>
          : <span className="ws-muted" style={{ fontSize: 11 }}>Included</span>}
      </article>;
    })}</div>
    {confirmDowngrade && <div className="ws-alert" role="alertdialog" aria-label="Confirm moving to Free" data-testid="downgrade-confirm"><strong>Move to the Free plan now?</strong><p style={{ margin: '6px 0 10px' }}>Nothing is deleted. Items above the Free limits stay visible and keep working; you will not be able to add new ones until you are under the limit, and higher-plan tools pause. {plan.organization?.role === 'owner' ? 'Your team members lose the shared plan immediately. ' : ''}You can upgrade again at any time.</p><div className="ws-actions"><button className="btn btn--primary" disabled={busy === 'downgrade'} onClick={onDowngrade} data-testid="downgrade-confirm-button">{busy === 'downgrade' ? 'Switching…' : 'Yes, move to Free'}</button><button className="btn btn--secondary" onClick={() => setConfirmDowngrade(false)}>Keep my plan</button></div></div>}

    <section className="ws-panel">
      <h2>What each plan includes</h2>
      <div className="plan-compare"><table>
        <thead><tr><th>Capability</th>{plan.plans.map((p) => <th key={p.slug}>{p.name}</th>)}</tr></thead>
        <tbody>
          {LIMIT_ROWS.map(([key, label]) => <tr key={key}><td>{label}</td>{plan.plans.map((p) => <td key={p.slug}>{num(p.limits?.[key])}</td>)}</tr>)}
          {FEATURE_ROWS.map(([key, label]) => <tr key={key}><td>{label}</td>{plan.plans.map((p) => { const yes = p.capabilities?.includes(key); return <td key={p.slug} className={yes ? 'yes' : 'no'}>{yes ? <Icon name="check" size={14} label="Included" /> : '—'}</td>; })}</tr>)}
          <tr><td>Servix AI tools</td>{plan.plans.map((p) => <td key={p.slug}>{(p.aiDepartments || []).length} of 11</td>)}</tr>
        </tbody>
      </table></div>
      <p className="ws-muted">Limits marked “Unlimited” have no cap. Enterprise limits are agreed with Servix and can be adjusted per organisation.</p>
    </section>

    {plan.subscriptions.length > 0 && <section className="ws-panel"><h2>Plan payment history</h2><div className="ws-record-table"><table><thead><tr><th>REFERENCE</th><th>PLAN</th><th>AMOUNT</th><th>STATUS</th><th>PERIOD</th></tr></thead><tbody>{plan.subscriptions.map((s) => <tr key={s.id}><td>{s.reference}<small>{dateLabel(s.createdAt)}</small></td><td>{PLAN_LABELS[s.plan] ?? s.plan}</td><td>{formatPrice(s.amount)}</td><td><span className={`ws-chip ${s.status === 'active' ? '' : s.status === 'initiated' ? 'warn' : 'gray'}`}>{s.status}</span></td><td>{s.startsAt ? `${dateLabel(s.startsAt)} – ${dateLabel(s.endsAt)}` : '—'}</td></tr>)}</tbody></table></div></section>}
    <p className="ws-muted">Payments are processed by the Servix payment provider; Servix does not store your card details and Servix AI never takes part in payments. Questions about a charge? <Link to="/contact">Contact support</Link> with the reference.</p>
  </>;
}

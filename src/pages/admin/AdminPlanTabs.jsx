/**
 * Admin console: plan catalogue & overrides, organisations (Team / Enterprise) with custom limits and plan
 * assignment, per-account plan grants, and the AI usage analytics dashboard. Everything comes from
 * /admin/plans, /admin/organizations, /admin/users/:id/plan and /admin/ai/usage — aggregates only, never
 * prompts, answers or provider keys.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Skeleton, EmptyState, ErrorState, StatsSkeleton, TableSkeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { LineChart, BarChart, HBars } from '../../components/dashboard/Charts.jsx';
import { formatPrice } from '../../lib/format.js';
import * as adminApi from '../../lib/adminApi.js';
import '../../components/plans/plans.css';

const n = (v) => (v === null || v === undefined ? '∞' : Number(v).toLocaleString('en-NG'));
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const PLAN_VARIANT = { free: 'neutral', go: 'accent', pro: 'brand', team: 'brand', enterprise: 'brand' };

/* ------------------------------------------------------------------ Plans & organisations */

export function PlansTab() {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); adminApi.getPlans().then(setData).catch(setError); }, []);
  useEffect(load, [load]);
  if (error) return <ErrorState message="We couldn't load the plan catalogue." onRetry={load} />;
  if (!data) return <><StatsSkeleton label="Loading plans…" /><Skeleton height="14rem" /></>;
  const limitKeys = Object.keys(data.catalog.limits); const featureKeys = Object.keys(data.catalog.features);
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
    <div className="ws-stat-grid" style={{ margin: 0 }}>{data.plans.map((p) => <div className="ws-stat" key={p.slug}><span>{p.name}</span><strong>{p.accounts}</strong><small>{p.price ? `${formatPrice(p.price)} / month` : p.slug === 'enterprise' ? 'Custom pricing' : 'Free'} · {Object.keys(p.overrides.limits ?? {}).length + Object.keys(p.overrides.features ?? {}).length + (p.overrides.aiDepartments ? 1 : 0)} override{(Object.keys(p.overrides.limits ?? {}).length + Object.keys(p.overrides.features ?? {}).length + (p.overrides.aiDepartments ? 1 : 0)) === 1 ? '' : 's'}</small></div>)}</div>
    <section className="ws-panel" style={{ marginBottom: 0 }}>
      <h2>Effective entitlements</h2>
      <p className="ws-muted" style={{ marginBottom: 12 }}>Defaults live in code (<code>api/src/lib/entitlements/catalog.ts</code>); overrides are stored per plan and take effect within a minute without a deploy. Changing a price only affects new checkouts.</p>
      <div className="plan-compare"><table>
        <thead><tr><th>Limit</th>{data.plans.map((p) => <th key={p.slug}>{p.name}</th>)}</tr></thead>
        <tbody>
          {limitKeys.map((k) => <tr key={k}><td>{data.catalog.limits[k].label}</td>{data.plans.map((p) => { const over = p.overrides.limits && k in p.overrides.limits; return <td key={p.slug} style={over ? { fontWeight: 700, color: '#a06f42' } : undefined} title={over ? `Override (default ${n(p.defaults.limits[k])})` : undefined}>{n(p.effective.limits[k])}{over && '*'}</td>; })}</tr>)}
          {featureKeys.map((k) => <tr key={k}><td>{data.catalog.features[k].label}</td>{data.plans.map((p) => { const yes = p.effective.features.includes(k); const over = p.overrides.features && k in p.overrides.features; return <td key={p.slug} className={yes ? 'yes' : 'no'} style={over ? { fontWeight: 700, color: '#a06f42' } : undefined}>{yes ? '✓' : '—'}{over && '*'}</td>; })}</tr>)}
          <tr><td>AI tools</td>{data.plans.map((p) => <td key={p.slug} title={p.effective.aiDepartments.join(', ')}>{p.effective.aiDepartments.length} / {data.catalog.departments.length}{p.overrides.aiDepartments && '*'}</td>)}</tr>
        </tbody>
      </table></div>
      <p className="ws-muted">* = overridden by an administrator.</p>
    </section>
    <PlanEditor plans={data.plans} catalog={data.catalog} onSaved={load} />
    <OrganizationsPanel />
    <GrantPlanPanel />
  </div>;
}

function PlanEditor({ plans, catalog, onSaved }) {
  const toast = useToast();
  const [slug, setSlug] = useState('go'); const [price, setPrice] = useState(''); const [tagline, setTagline] = useState(''); const [limitKey, setLimitKey] = useState('monthly_ai_tokens'); const [limitValue, setLimitValue] = useState(''); const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.slug === slug);
  useEffect(() => { if (plan) { setPrice(String(plan.price)); setTagline(plan.tagline ?? ''); } }, [slug, plan?.price, plan?.tagline]);
  async function save(body, ok) { setBusy(true); try { await adminApi.updatePlan(slug, body); toast(ok, 'success'); onSaved(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }
  return <section className="ws-panel" style={{ marginBottom: 0 }} data-testid="admin-plan-editor">
    <h2>Edit a plan</h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, alignItems: 'end' }}>
      <Field label="Plan">{(props) => <select {...props} className="select" value={slug} onChange={(e) => setSlug(e.target.value)}>{plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>}</Field>
      <Field label="Monthly price (₦)" hint={slug === 'free' ? 'The Free plan stays free.' : 'Affects new checkouts only.'}>{(props) => <input {...props} className="input" type="number" min={0} step={500} value={price} disabled={slug === 'free'} onChange={(e) => setPrice(e.target.value)} />}</Field>
      <Field label="Tagline">{(props) => <input {...props} className="input" value={tagline} maxLength={160} onChange={(e) => setTagline(e.target.value)} />}</Field>
      <Button variant="secondary" disabled={busy} onClick={() => save({ ...(slug !== 'free' ? { price: Number(price) } : {}), tagline }, 'Plan updated.')}>Save price & tagline</Button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, alignItems: 'end', marginTop: 14 }}>
      <Field label="Override a limit">{(props) => <select {...props} className="select" value={limitKey} onChange={(e) => setLimitKey(e.target.value)}>{Object.keys(catalog.limits).map((k) => <option key={k} value={k}>{catalog.limits[k].label}</option>)}</select>}</Field>
      <Field label="New value" hint={`Default ${n(plan?.defaults.limits[limitKey])} · leave empty for unlimited`}>{(props) => <input {...props} className="input" type="number" min={0} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />}</Field>
      <Button variant="secondary" disabled={busy} onClick={() => save({ overrides: { limits: { [limitKey]: limitValue === '' ? null : Number(limitValue) } } }, 'Limit override saved.')}>Save override</Button>
      <Button variant="ghost" disabled={busy || !plan || !Object.keys(plan.overrides.limits ?? {}).length && !Object.keys(plan.overrides.features ?? {}).length && !plan.overrides.aiDepartments} onClick={() => save({ overrides: { limits: Object.fromEntries(Object.keys(plan.overrides.limits ?? {}).map((k) => [k, undefined])), features: {}, aiDepartments: null } }, 'Overrides cleared.')}>Clear overrides</Button>
    </div>
    <p className="ws-muted" style={{ marginTop: 10 }}>Feature and AI-tool overrides are supported by the API (<code>PATCH /admin/plans/:slug</code> with <code>overrides.features</code> / <code>overrides.aiDepartments</code>) for Servix engineers; this form covers prices, copy and limits.</p>
  </section>;
}

function OrganizationsPanel() {
  const toast = useToast();
  const [q, setQ] = useState(''); const [data, setData] = useState(null); const [error, setError] = useState(null); const [editing, setEditing] = useState(null); const [form, setForm] = useState({ plan: '', days: '365', monthly_ai_tokens: '', team_members: '', listings: '', monthly_exports: '' }); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(null); adminApi.getOrganizations({ q: q || undefined, pageSize: 50 }).then(setData).catch(setError); }, [q]);
  useEffect(load, [load]);
  function startEdit(o) { setEditing(o.id); const l = o.customLimits?.limits ?? {}; setForm({ plan: o.assignedPlan ?? '', days: '365', monthly_ai_tokens: l.monthly_ai_tokens ?? '', team_members: l.team_members ?? '', listings: l.listings ?? '', monthly_exports: l.monthly_exports ?? '' }); }
  async function save() {
    setBusy(true);
    try {
      const limits = {}; for (const k of ['monthly_ai_tokens', 'team_members', 'listings', 'monthly_exports']) if (form[k] !== '' && form[k] !== null && form[k] !== undefined) limits[k] = Number(form[k]);
      const body = { customLimits: Object.keys(limits).length ? { limits } : null, ...(form.plan ? { plan: form.plan, days: Number(form.days) || 365 } : { plan: null }) };
      await adminApi.updateOrganization(editing, body); toast('Organisation updated.', 'success'); setEditing(null); load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return <section className="ws-panel" style={{ marginBottom: 0 }} data-testid="admin-organizations">
    <h2>Teams & enterprise organisations</h2>
    <div style={{ maxWidth: '20rem', marginBottom: 12 }}><Field label="Search by team or owner email">{(props) => <input {...props} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />}</Field></div>
    {error && <ErrorState message="We couldn't load organisations." onRetry={load} />}
    {!error && !data && <TableSkeleton rows={4} cols={6} label="Loading organisations…" />}
    {data && data.items.length === 0 && <EmptyState title="No organisations yet" message="Teams appear here as soon as a Team-plan account creates a workspace. Assign Enterprise to one from this table." />}
    {data && data.items.length > 0 && <div className="earnings"><table><thead><tr><th>Team</th><th>Owner</th><th>Plan</th><th>Members</th><th>AI this month</th><th>Custom limits</th><th></th></tr></thead><tbody>{data.items.map((o) => <tr key={o.id}>
      <td>{o.name}<br /><small>{new Date(o.createdAt).toLocaleDateString('en-GB')}</small></td><td>{o.owner.name}<br /><small>{o.owner.email}</small></td>
      <td><Badge variant={PLAN_VARIANT[o.effectivePlan] ?? 'neutral'}>{o.effectivePlan}</Badge>{o.assignedPlan && <><br /><small>assigned{o.assignedPlanExpiresAt ? ` until ${new Date(o.assignedPlanExpiresAt).toLocaleDateString('en-GB')}` : ''}</small></>}</td>
      <td>{o.members}</td><td>{n(o.aiTokensThisPeriod)} tokens<br /><small>{o.aiRequestsThisPeriod} requests</small></td>
      <td style={{ fontSize: 'var(--text-xs)' }}>{o.customLimits?.limits ? Object.entries(o.customLimits.limits).map(([k, v]) => `${k}: ${n(v)}`).join(' · ') : '—'}</td>
      <td><Button size="sm" variant="secondary" onClick={() => startEdit(o)}>Manage</Button></td>
    </tr>)}</tbody></table></div>}
    {editing && <div className="ws-alert" role="dialog" aria-label="Manage organisation" style={{ marginTop: 14, background: '#f3f7ee', borderColor: '#d7e3cc' }}>
      <strong>Assign plan and custom limits</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, alignItems: 'end', marginTop: 10 }}>
        <Field label="Organisation plan" hint="Empty = follow the owner's own plan">{(props) => <select {...props} className="select" value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}><option value="">Owner's plan</option><option value="team">Team</option><option value="enterprise">Enterprise</option></select>}</Field>
        <Field label="Valid for (days)">{(props) => <input {...props} className="input" type="number" min={1} max={3660} value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />}</Field>
        <Field label="AI tokens / month" hint="Enterprise only">{(props) => <input {...props} className="input" type="number" min={0} value={form.monthly_ai_tokens} onChange={(e) => setForm((f) => ({ ...f, monthly_ai_tokens: e.target.value }))} />}</Field>
        <Field label="Team members">{(props) => <input {...props} className="input" type="number" min={0} value={form.team_members} onChange={(e) => setForm((f) => ({ ...f, team_members: e.target.value }))} />}</Field>
        <Field label="Listings per member">{(props) => <input {...props} className="input" type="number" min={0} value={form.listings} onChange={(e) => setForm((f) => ({ ...f, listings: e.target.value }))} />}</Field>
        <Field label="Exports / month">{(props) => <input {...props} className="input" type="number" min={0} value={form.monthly_exports} onChange={(e) => setForm((f) => ({ ...f, monthly_exports: e.target.value }))} />}</Field>
      </div>
      <div className="ws-actions" style={{ marginTop: 12 }}><Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
      <p className="ws-muted" style={{ marginTop: 8 }}>Custom limits apply only while the organisation is on Enterprise. Every change is written to the audit log.</p>
    </div>}
  </section>;
}

function GrantPlanPanel() {
  const toast = useToast();
  const [email, setEmail] = useState(''); const [plan, setPlan] = useState('pro'); const [days, setDays] = useState('30'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState(null);
  async function grant(e) {
    e.preventDefault(); setBusy(true); setResult(null);
    try {
      const users = await adminApi.getUsers({ q: email.trim(), pageSize: 5 });
      const user = (users.items ?? []).find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
      if (!user) throw new Error('No account with that email.');
      await adminApi.grantUserPlan(user.id, { plan, days: Number(days), ...(note.trim() ? { note: note.trim() } : {}) });
      setResult(`${user.fullName ?? user.email} is now on ${plan} for ${days} days.`); toast('Plan assigned.', 'success');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  return <section className="ws-panel" style={{ marginBottom: 0 }} data-testid="admin-grant-plan">
    <h2>Assign a plan to an account</h2>
    <p className="ws-muted" style={{ marginBottom: 12 }}>For Enterprise contracts, goodwill extensions or support cases. No payment is involved; the grant is audited and expires automatically.</p>
    <form onSubmit={grant} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, alignItems: 'end' }}>
      <Field label="Account email">{(props) => <input {...props} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Plan">{(props) => <select {...props} className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>{['free', 'go', 'pro', 'team', 'enterprise'].map((p) => <option key={p} value={p}>{p}</option>)}</select>}</Field>
      <Field label="Days">{(props) => <input {...props} className="input" type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
      <Field label="Note (audit)">{(props) => <input {...props} className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>
      <Button type="submit" disabled={busy}>{busy ? 'Assigning…' : 'Assign plan'}</Button>
    </form>
    {result && <p className="ws-muted" role="status" style={{ marginTop: 10 }}>{result}</p>}
  </section>;
}

/* ------------------------------------------------------------------ AI usage analytics */

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];

export function AiUsageTab() {
  const [filters, setFilters] = useState({ days: 30, plan: '', department: '', status: '', model: '', granularity: 'day' });
  const [data, setData] = useState(null); const [error, setError] = useState(null); const [events, setEvents] = useState(null);
  const load = useCallback(() => { setError(null); setData(null); adminApi.getAiUsage({ ...filters, plan: filters.plan || undefined, department: filters.department || undefined, status: filters.status || undefined, model: filters.model || undefined }).then(setData).catch(setError); adminApi.getAiUsageEvents({ days: filters.days, plan: filters.plan || undefined, department: filters.department || undefined, status: filters.status || undefined, model: filters.model || undefined, pageSize: 25 }).then(setEvents).catch(() => setEvents({ items: [] })); }, [filters]);
  useEffect(load, [load]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  if (error) return <ErrorState message="We couldn't load AI usage." onRetry={load} />;
  const t = data?.totals;
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }} data-testid="admin-ai-usage">
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
      <div className="ws-range" role="group" aria-label="Period">{RANGES.map(([d, l]) => <button key={d} aria-pressed={filters.days === d} onClick={() => setFilters((f) => ({ ...f, days: d, granularity: d >= 365 ? 'month' : d >= 90 ? 'week' : 'day' }))}>{l}</button>)}</div>
      <Field label="Plan">{(props) => <select {...props} className="select" value={filters.plan} onChange={set('plan')}><option value="">All</option>{(data?.filters?.plans ?? ['free', 'go', 'pro', 'team', 'enterprise']).map((p) => <option key={p} value={p}>{p}</option>)}</select>}</Field>
      <Field label="AI tool">{(props) => <select {...props} className="select" value={filters.department} onChange={set('department')}><option value="">All</option>{(data?.filters?.departments ?? []).map((d) => <option key={d} value={d}>{d.replaceAll('_', ' ')}</option>)}</select>}</Field>
      <Field label="Status">{(props) => <select {...props} className="select" value={filters.status} onChange={set('status')}><option value="">All</option><option value="ok">Succeeded</option><option value="failed">Failed</option></select>}</Field>
      <Field label="Model">{(props) => <select {...props} className="select" value={filters.model} onChange={set('model')}><option value="">All</option>{(data?.byModel ?? []).map((m) => <option key={m.alias} value={m.alias}>{m.alias}</option>)}</select>}</Field>
    </div>
    {!data ? <><StatsSkeleton label="Loading AI usage…" /><Skeleton height="14rem" /></> : <>
      <div className="ws-stat-grid" style={{ margin: 0 }}>
        <div className="ws-stat"><span>AI requests</span><strong>{n(t.requests)}</strong><small>{n(t.succeeded)} succeeded · {n(t.failed)} failed{t.successRate !== null ? ` · ${t.successRate}% success` : ''}</small></div>
        <div className="ws-stat"><span>Tokens</span><strong>{n(t.tokens)}</strong><small>{n(t.promptTokens)} prompt · {n(t.completionTokens)} completion · {n(t.tokensOnFailures)} on failures (not charged)</small></div>
        <div className="ws-stat"><span>Average latency</span><strong>{t.avgLatencyMs === null ? '—' : `${(t.avgLatencyMs / 1000).toFixed(1)} s`}</strong><small>{t.avgLatencySuccessMs === null ? 'No successful requests' : `${(t.avgLatencySuccessMs / 1000).toFixed(1)} s on successes`}</small></div>
        <div className="ws-stat"><span>Fallback used</span><strong>{n(t.fallbacks)}</strong><small>{t.fallbackRate !== null ? `${t.fallbackRate}% of requests needed a backup model` : '—'}</small></div>
      </div>
      {data.series.length > 0 && <div className="ws-chart-grid">
        <section className="ws-panel" style={{ marginBottom: 0 }}><BarChart data={data.series} y="tokens" label="Tokens" /></section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><LineChart data={data.series} y="requests" label="Requests" /></section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><LineChart data={data.series} y="failed" label="Failed requests" color="#c84b3c" /></section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><LineChart data={data.series} y="avgLatencyMs" label="Average latency (ms)" color="#a06f42" /></section>
      </div>}
      <div className="ws-chart-grid">
        <section className="ws-panel" style={{ marginBottom: 0 }}><HBars label="Tokens by plan" items={data.byPlan.map((p) => ({ label: p.label, value: p.tokens }))} /></section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><HBars label="Tokens by AI tool" items={data.byDepartment.map((d) => ({ label: d.department.replaceAll('_', ' '), value: d.tokens }))} /></section>
      </div>
      <section className="ws-panel" style={{ marginBottom: 0 }}><h2>By model</h2>{data.byModel.length === 0 ? <p className="ws-muted">No requests in this period.</p> : <div className="earnings"><table><thead><tr><th>Model</th><th>Requests</th><th>Succeeded</th><th>Tokens</th><th>Avg latency</th></tr></thead><tbody>{data.byModel.map((m) => <tr key={m.alias}><td>{m.alias}<br /><small>{m.model}</small></td><td>{n(m.requests)}</td><td>{n(m.succeeded)}</td><td>{n(m.tokens)}</td><td>{m.avgLatencyMs === null ? '—' : `${(m.avgLatencyMs / 1000).toFixed(1)} s`}</td></tr>)}</tbody></table></div>}</section>
      <div className="ws-chart-grid">
        <section className="ws-panel" style={{ marginBottom: 0 }}><h2>By AI tool</h2>{data.byDepartment.length === 0 ? <p className="ws-muted">No requests in this period.</p> : <div className="earnings"><table><thead><tr><th>Tool</th><th>Requests</th><th>Success</th><th>Tokens</th><th>Latency</th></tr></thead><tbody>{data.byDepartment.map((d) => <tr key={d.department}><td>{d.department.replaceAll('_', ' ')}</td><td>{n(d.requests)}</td><td>{d.requests ? `${Math.round((d.succeeded / d.requests) * 100)}%` : '—'}</td><td>{n(d.tokens)}</td><td>{d.avgLatencyMs === null ? '—' : `${(d.avgLatencyMs / 1000).toFixed(1)} s`}</td></tr>)}</tbody></table></div>}</section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><h2>Provider errors</h2>{data.errors.length === 0 ? <p className="ws-muted">No failures in this period.</p> : <div className="earnings"><table><thead><tr><th>Error code</th><th>Count</th></tr></thead><tbody>{data.errors.map((e) => <tr key={e.code}><td>{e.code}</td><td>{n(e.count)}</td></tr>)}</tbody></table></div>}<p className="ws-muted" style={{ marginTop: 8 }}>Codes only — prompts, answers and provider messages are never stored.</p></section>
      </div>
      <div className="ws-chart-grid">
        <section className="ws-panel" style={{ marginBottom: 0 }}><h2>Top users</h2>{data.topUsers.length === 0 ? <p className="ws-muted">No usage yet.</p> : <div className="earnings"><table><thead><tr><th>Account</th><th>Plan</th><th>Requests</th><th>Tokens</th></tr></thead><tbody>{data.topUsers.map((u) => <tr key={u.userId}><td>{u.name}<br /><small>{u.email}</small></td><td><Badge variant={PLAN_VARIANT[u.plan] ?? 'neutral'}>{u.plan ?? '—'}</Badge></td><td>{n(u.requests)}</td><td>{n(u.tokens)}</td></tr>)}</tbody></table></div>}</section>
        <section className="ws-panel" style={{ marginBottom: 0 }}><h2>Top teams</h2>{data.topOrganizations.length === 0 ? <p className="ws-muted">No team usage yet.</p> : <div className="earnings"><table><thead><tr><th>Team</th><th>Requests</th><th>Tokens</th></tr></thead><tbody>{data.topOrganizations.map((o) => <tr key={o.organizationId}><td>{o.name}</td><td>{n(o.requests)}</td><td>{n(o.tokens)}</td></tr>)}</tbody></table></div>}</section>
      </div>
      <section className="ws-panel" style={{ marginBottom: 0 }}><h2>Recent AI requests</h2>{!events ? <TableSkeleton rows={5} cols={7} label="Loading events…" /> : events.items.length === 0 ? <p className="ws-muted">Nothing in this period.</p> : <div className="earnings"><table><thead><tr><th>When</th><th>Account</th><th>Plan</th><th>Tool</th><th>Model</th><th>Tokens</th><th>Result</th></tr></thead><tbody>{events.items.map((e) => <tr key={e.id}><td style={{ fontSize: 'var(--text-xs)' }}>{fmtWhen(e.at)}</td><td>{e.user ? <>{e.user.name}<br /><small>{e.user.email}</small></> : <small>anonymous</small>}{e.organization && <><br /><small>team: {e.organization}</small></>}</td><td>{e.plan ?? '—'}</td><td>{e.department.replaceAll('_', ' ')}</td><td>{e.alias}{e.fallbackUsed && <><br /><small>fallback · {e.attempts} attempts</small></>}</td><td>{n(e.totalTokens)}</td><td><Badge variant={e.ok ? 'brand' : 'neutral'}>{e.ok ? `ok · ${(e.durationMs / 1000).toFixed(1)} s` : e.errorCode ?? 'failed'}</Badge></td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>;
}

/**
 * Admin console additions: analytics charts, in-app notification broadcasts
 * and plan subscription monitoring. Figures come from /admin/analytics,
 * computed from real users, bookings, payments, ledger and plan rows.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Skeleton, EmptyState, ErrorState, StatsSkeleton, TableSkeleton, ListSkeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { LineChart, BarChart, Donut, HBars } from '../../components/dashboard/Charts.jsx';
import { formatPrice } from '../../lib/format.js';
import * as adminApi from '../../lib/adminApi.js';
const fmtWhen = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_LABEL = { pending_payment: 'Awaiting payment', requested: 'Requested', accepted: 'Accepted', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled', disputed: 'Disputed', refunded: 'Refunded' };

export function AnalyticsTab() {
  const [days, setDays] = useState(30); const [data, setData] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); setData(null); adminApi.getAnalytics(days).then(setData).catch(setError); }, [days]);
  useEffect(load, [load]);
  if (error) return <ErrorState message="We couldn't load analytics." onRetry={load} />;
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
    <div className="ws-range" role="group" aria-label="Period">{[7, 30, 90, 365].map(d => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div>
    {!data ? <><StatsSkeleton label="Loading analytics…" /><Skeleton height="14rem" style={{ marginBottom: 22 }} /></> : <>
      <div className="ws-stat-grid" style={{ margin: 0 }}>
        <div className="ws-stat"><span>Payments captured (GMV)</span><strong style={{ fontSize: 24 }}>{formatPrice(data.totals.gmv)}</strong><small>{formatPrice(data.totals.refunds)} refunded in period</small></div>
        <div className="ws-stat"><span>Platform fees earned</span><strong style={{ fontSize: 24 }}>{formatPrice(data.totals.platformFees)}</strong><small>Ledger: platform revenue credits</small></div>
        <div className="ws-stat"><span>Plan revenue</span><strong style={{ fontSize: 24 }}>{formatPrice(data.totals.planRevenue)}</strong><small>{data.totals.planPurchases} Servix Pro purchase{data.totals.planPurchases === 1 ? '' : 's'}</small></div>
        <div className="ws-stat"><span>New accounts</span><strong>{data.totals.signups}</strong><small>{data.totals.customers} customers · {data.totals.professionals} professionals</small></div>
        <div className="ws-stat"><span>Bookings created</span><strong>{data.totals.bookings}</strong><small>{data.totals.completed} completed in period</small></div>
        <div className="ws-stat"><span>Applications</span><strong>{data.applications.under_review ?? 0}</strong><small>awaiting review · {data.applications.approved ?? 0} approved all-time</small></div>
        <div className="ws-stat"><span>Professionals on paid plans</span><strong>{data.plans.filter(p => p.slug !== 'free').reduce((s, p) => s + p.count, 0)}</strong><small>of {data.plans.reduce((s, p) => s + p.count, 0)} profiles</small></div>
        <div className="ws-stat"><span>Services booked</span><strong>{data.servicesBooked}</strong><small>Distinct services with bookings</small></div>
      </div>
      <div className="ws-chart-grid" style={{ margin: 0 }}>
        <section className="ws-panel"><LineChart data={data.series} y="gmv" label="Payments captured per day" money /></section>
        <section className="ws-panel"><BarChart data={data.series} y="bookings" label="Bookings created per day" /></section>
        <section className="ws-panel"><BarChart data={data.series} y="signups" label="New accounts per day" color="#2f6b4f" /></section>
        <section className="ws-panel"><Donut label="Bookings by status" segments={Object.entries(data.statusCounts).map(([k, v]) => ({ label: STATUS_LABEL[k] || k, value: v }))} /></section>
        <section className="ws-panel"><HBars label="Bookings by category" items={data.categories.map(c => ({ label: c.name, value: c.count }))} /></section>
        <section className="ws-panel"><HBars label="Top professionals by completed bookings" items={data.topProfessionals.map(p => ({ label: p.name, value: p.completed }))} /><Donut label="Profiles by plan" segments={data.plans.map(p => ({ label: p.label, value: p.count }))} size={110} /></section>
      </div>
      <p className="ws-muted">Period starts {new Date(data.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Amounts are in NGN from verified payment and ledger records; test-mode transactions are included while the payment provider is in test mode.</p>
    </>}
  </div>;
}

export function NotificationsTab() {
  const showToast = useToast();
  const [form, setForm] = useState({ audience: 'all', email: '', title: '', body: '', link: '' }); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [errors, setErrors] = useState({});
  const [history, setHistory] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); adminApi.getBroadcasts({ pageSize: 20 }).then(setHistory).catch(setError); }, []);
  useEffect(load, [load]);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  async function send(e) {
    e.preventDefault(); setErrors({});
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      const result = await adminApi.sendBroadcast({ audience: form.audience, title: form.title.trim(), body: form.body.trim(), ...(form.link.trim() ? { link: form.link.trim() } : {}), ...(form.audience === 'user' ? { email: form.email.trim() } : {}) });
      showToast(`Notification sent to ${result.recipientCount} account${result.recipientCount === 1 ? '' : 's'}.`, 'success');
      setForm({ audience: 'all', email: '', title: '', body: '', link: '' }); setConfirm(false); load();
    } catch (err) { setErrors(err.errors ?? {}); showToast(err.message ?? 'Could not send.', 'error'); setConfirm(false); }
    finally { setBusy(false); }
  }
  const audienceLabel = { all: 'every active account', customers: 'all customers', professionals: 'all professionals', user: form.email || 'one account' }[form.audience];
  return <div className="ws-two-col">
    <section className="ws-panel"><h2>Send an in-app notification</h2><p className="ws-muted" style={{ marginBottom: 16 }}>Recipients see it in their bell and on their Notifications page. This does not send email or SMS. Keep it short, factual and never include codes, passwords or payment requests.</p>
      <form className="ws-form" onSubmit={send} onChange={() => setConfirm(false)}>
        <Field label="Audience">{props => <select {...props} className="select" value={form.audience} onChange={set('audience')}><option value="all">Everyone</option><option value="customers">Customers only</option><option value="professionals">Professionals only</option><option value="user">One account (by email)</option></select>}</Field>
        {form.audience === 'user' && <Field label="Account email" error={errors.email}>{props => <input {...props} className="input" type="email" required value={form.email} onChange={set('email')} />}</Field>}
        <Field label="Title" hint="3–120 characters" error={errors.title}>{props => <input {...props} className="input" required minLength={3} maxLength={120} value={form.title} onChange={set('title')} />}</Field>
        <Field label="Message" hint="3–2000 characters, plain text" error={errors.body}>{props => <textarea {...props} className="textarea" required minLength={3} maxLength={2000} rows={5} value={form.body} onChange={set('body')} />}</Field>
        <Field label="Link (optional)" hint="A Servix page such as /pricing or /dashboard/plan" error={errors.link}>{props => <input {...props} className="input" maxLength={300} placeholder="/dashboard" value={form.link} onChange={set('link')} />}</Field>
        {confirm && <div className="ws-alert" role="status">You are about to notify <strong>{audienceLabel}</strong>. This cannot be recalled once sent. Click again to confirm.</div>}
        <div className="ws-actions"><Button type="submit" disabled={busy}>{busy ? 'Sending…' : confirm ? 'Confirm and send' : 'Review and send'}</Button>{confirm && <Button type="button" variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>}</div>
      </form>
    </section>
    <section className="ws-panel"><h2>Sent notifications</h2>
      {error && <ErrorState message="We couldn't load the history." onRetry={load} />}
      {!error && !history && <ListSkeleton rows={3} avatar={false} label="Loading sent notifications…" />}
      {history && history.items.length === 0 && <EmptyState title="Nothing sent yet" message="Broadcasts you send will be listed here with delivery and read counts." />}
      {history && history.items.map(b => <article className="ws-review" key={b.id}><header><span><strong>{b.title}</strong></span><Badge variant="neutral">{b.audience}</Badge></header><p>{b.body}</p><small>{fmtWhen(b.createdAt)} · by {b.sentBy} · {b.recipientCount} recipient{b.recipientCount === 1 ? '' : 's'} · {b.readCount} read{b.link ? ` · ${b.link}` : ''}</small></article>)}
    </section>
  </div>;
}

export function SubscriptionsTab() {
  const [status, setStatus] = useState(''); const [data, setData] = useState(null); const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); setData(null); adminApi.getSubscriptions({ status: status || undefined, pageSize: 50 }).then(setData).catch(setError); }, [status]);
  useEffect(load, [load]);
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
    <div style={{ maxWidth: '16rem' }}><Field label="Status filter">{props => <select {...props} className="select" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{['initiated', 'active', 'failed', 'expired', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}</select>}</Field></div>
    {error && <ErrorState message="We couldn't load plan subscriptions." onRetry={load} />}
    {!error && !data && <TableSkeleton rows={6} cols={5} label="Loading subscriptions…" />}
    {data && data.items.length === 0 && <EmptyState title="No plan purchases" message="When a professional upgrades to Servix Pro, the purchase and its verification status appear here." />}
    {data && data.items.length > 0 && <div className="earnings"><table><thead><tr><th>Reference</th><th>Professional</th><th>Plan</th><th>Amount</th><th>Status</th><th>Period</th></tr></thead><tbody>{data.items.map(s => <tr key={s.id}><td style={{ fontSize: 'var(--text-xs)' }}>{s.reference}<br /><small>{fmtWhen(s.createdAt)}</small></td><td>{s.professional.name}<br /><small>{s.professional.email ?? 'unclaimed profile'} · now on {s.professional.currentPlan}</small></td><td>{s.plan}</td><td>{formatPrice(s.amount)}</td><td><Badge variant={s.status === 'active' ? 'brand' : s.status === 'initiated' ? 'accent' : 'neutral'}>{s.status}</Badge></td><td>{s.startsAt ? `${new Date(s.startsAt).toLocaleDateString('en-GB')} – ${new Date(s.endsAt).toLocaleDateString('en-GB')}` : '—'}</td></tr>)}</tbody></table></div>}
    <p className="ws-muted">Plans activate only after the payment provider confirms the charge (return verification or signed webhook). Plans do not auto-renew.</p>
  </div>;
}

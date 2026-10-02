import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getProAnalytics, getPlan } from '../../lib/workspaceApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import { LineChart, BarChart, Donut, HBars } from '../../components/dashboard/Charts.jsx';
import { useResource, PageHead, LoadState } from './shared.jsx';
const STATUS_LABEL = { pending_payment: 'Awaiting payment', requested: 'Requested', accepted: 'Accepted', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled', disputed: 'Disputed', refunded: 'Refunded' };
export default function AnalyticsPage() {
  useDocumentMeta({ title: 'Analytics', description: 'Your Servix performance metrics.' });
  const [days, setDays] = useState(30); const r = useResource(() => Promise.all([getProAnalytics(days), getPlan()]).then(([analytics, plan]) => ({ ...analytics, plan })), [days]);
  const a = r.data; const t = a?.totals; const detailed = a?.plan?.limits?.analytics;
  return <><PageHead title="Analytics" description="Every figure below is calculated from your own bookings, ledger entries and reviews. Nothing is estimated."><div className="ws-range" role="group" aria-label="Period">{[7, 30, 90, 365].map(d => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div></PageHead><LoadState skeleton="stats" label="Loading your analytics…" resource={r}>{() => <>
    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Bookings</span><strong>{t.bookings}</strong><small>{t.completed} completed · {t.cancelled} cancelled or declined</small></div>
      <div className="ws-stat"><span>Earnings released</span><strong style={{ fontSize: 24 }}>{formatPrice(t.earnings)}</strong><small>Credited to your payable balance in this period</small></div>
      <div className="ws-stat"><span>Rating</span><strong>{t.reviewCount ? t.ratingAvg.toFixed(2) : '—'}</strong><small>{t.reviewCount} published review{t.reviewCount === 1 ? '' : 's'} overall</small></div>
      <div className="ws-stat"><span>Response rate</span><strong>{t.responseRate === null ? '—' : `${t.responseRate}%`}</strong><small>{t.medianResponseHours === null ? 'No paid requests in this period' : `Median ${t.medianResponseHours} h to accept or decline`}</small></div>
    </div>
    {!detailed && <div className="ws-alert"><strong>Basic analytics.</strong> You are seeing headline numbers for your account. <Link to="/dashboard/plan">Upgrade to Servix Pro</Link> to unlock trends, status breakdowns and per-service performance.</div>}
    {detailed && <>
      <div className="ws-chart-grid">
        <section className="ws-panel"><LineChart data={a.series} y="earnings" label="Earnings released per day" money /></section>
        <section className="ws-panel"><BarChart data={a.series} y="bookings" label="New bookings per day" /></section>
        <section className="ws-panel"><Donut label="Bookings by status" segments={Object.entries(a.statusCounts).map(([k, v]) => ({ label: STATUS_LABEL[k] || k, value: v }))} /></section>
        <section className="ws-panel"><HBars label="Rating breakdown (all time)" items={a.ratingBreakdown.map(b => ({ label: `${b.stars} star${b.stars === 1 ? '' : 's'}`, value: b.count }))} /></section>
      </div>
      <section className="ws-panel"><h2>Service performance</h2>{!a.services.length ? <p className="ws-muted">No bookings for your services in this period.</p> : <div className="ws-record-table"><table><thead><tr><th>SERVICE</th><th>BOOKINGS</th><th>REVENUE (COMPLETED, AFTER FEES)</th></tr></thead><tbody>{a.services.map(s => <tr key={s.id}><td>{s.title}</td><td>{s.bookings}</td><td>{formatPrice(s.revenue)}</td></tr>)}</tbody></table></div>}</section>
    </>}
    <div className="ws-stat-grid"><div className="ws-stat"><span>Unique clients</span><strong>{t.uniqueClients}</strong><small>Distinct customers who booked in this period</small></div><div className="ws-stat"><span>Active services</span><strong>{t.activeServices}<small style={{ fontSize: 16 }}> / {t.totalServices}</small></strong><small>Published out of all listings</small></div><div className="ws-stat"><span>Completed projects</span><strong>{t.completedProjects}</strong><small>Shown on your public profile</small></div><div className="ws-stat"><span>Period</span><strong style={{ fontSize: 22 }}>{days === 365 ? '1 year' : `${days} days`}</strong><small>Since {new Date(a.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div></div>
  </>}</LoadState></>;
}

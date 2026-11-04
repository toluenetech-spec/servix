import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getProAnalytics } from '../../lib/workspaceApi.js';
import { UpgradeNotice } from '../../components/plans/PlanBits.jsx';
import { ExportButton } from './TeamPage.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import { LineChart, BarChart, Donut, HBars } from '../../components/dashboard/Charts.jsx';
import { useResource, PageHead, LoadState } from './shared.jsx';
import { getVerifiableBookings, addVerifiedProject, getAchievementCatalog, NOT_ENOUGH } from '../../lib/marketplaceApi.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { Achievements } from '../../components/marketplace/TrustPanel.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
const STATUS_LABEL = { pending_payment: 'Awaiting payment', requested: 'Requested', accepted: 'Accepted', in_progress: 'In progress', delivered: 'Delivered', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled', disputed: 'Disputed', refunded: 'Refunded' };
export default function AnalyticsPage() {
  useDocumentMeta({ title: 'Analytics', description: 'Your Servix performance metrics.' });
  const [days, setDays] = useState(30); const r = useResource(() => getProAnalytics(days), [days]);
  // Depth is decided by the API from the account's plan (`access`): basic for Free, detailed on Go+, advanced on Pro+.
  const a = r.data; const t = a?.totals; const detailed = Boolean(a?.access?.detailed); const advanced = Boolean(a?.access?.advanced);
  const exportBase = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1/exports`;
  const features = useFeatures();
  return <><PageHead title="Analytics" description="Every figure below is calculated from your own bookings, ledger entries and reviews. Nothing is estimated."><div className="ws-range" role="group" aria-label="Period">{[7, 30, 90, 365].map(d => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div></PageHead><LoadState skeleton="stats" label="Loading your analytics…" resource={r}>{() => <>
    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Bookings</span><strong>{t.bookings}</strong><small>{t.completed} completed · {t.cancelled} cancelled or declined</small></div>
      <div className="ws-stat"><span>Earnings released</span><strong style={{ fontSize: 24 }}>{formatPrice(t.earnings)}</strong><small>Credited to your payable balance in this period</small></div>
      <div className="ws-stat"><span>Rating</span><strong>{t.reviewCount ? t.ratingAvg.toFixed(2) : '—'}</strong><small>{t.reviewCount} published review{t.reviewCount === 1 ? '' : 's'} overall</small></div>
      <div className="ws-stat"><span>Response rate</span><strong>{t.responseRate === null ? '—' : `${t.responseRate}%`}</strong><small>{t.medianResponseHours === null ? 'No paid requests in this period' : `Median ${t.medianResponseHours} h to accept or decline`}</small></div>
    </div>
    {!detailed && <UpgradeNotice title="Basic analytics" body="You are seeing headline numbers for your account. Trends, status breakdowns and per-service performance are included from the Go plan; application and profile performance from Pro." upgradeTo="go" />}
    {detailed && <>
      <div className="ws-chart-grid">
        <section className="ws-panel"><LineChart data={a.series} y="earnings" label="Earnings released per day" money /></section>
        <section className="ws-panel"><BarChart data={a.series} y="bookings" label="New bookings per day" /></section>
        <section className="ws-panel"><Donut label="Bookings by status" segments={Object.entries(a.statusCounts).map(([k, v]) => ({ label: STATUS_LABEL[k] || k, value: v }))} /></section>
        <section className="ws-panel"><HBars label="Rating breakdown (all time)" items={a.ratingBreakdown.map(b => ({ label: `${b.stars} star${b.stars === 1 ? '' : 's'}`, value: b.count }))} /></section>
      </div>
      <section className="ws-panel"><h2>Service performance</h2>{!a.services.length ? <p className="ws-muted">No bookings for your services in this period.</p> : <div className="ws-record-table"><table><thead><tr><th>SERVICE</th><th>BOOKINGS</th><th>REVENUE (COMPLETED, AFTER FEES)</th></tr></thead><tbody>{a.services.map(s => <tr key={s.id}><td>{s.title}</td><td>{s.bookings}</td><td>{formatPrice(s.revenue)}</td></tr>)}</tbody></table></div>}</section>
    </>}
    {detailed && !advanced && <UpgradeNotice title="Application & profile performance" body="See your proposal acceptance rate, decision times, weekly trend, profile-view changes and view-to-booking rate on the Pro plan." upgradeTo="pro" compact />}
    {advanced && a.performance && <PerformancePanel p={a.performance} />}
    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Profile views</span><strong>{a.views?.profile ?? 0}</strong><small>{a.views?.services ?? 0} gig views in this period</small></div>
      <div className="ws-stat"><span>Delivery reliability</span><strong>{a.reliability?.measurable >= 5 && a.reliability.percent != null ? `${a.reliability.percent}%` : <small style={{ fontSize: 14 }}>{NOT_ENOUGH}</small>}</strong><small>{a.reliability?.measurable ? `${a.reliability.onTime} on time, ${a.reliability.late} late of ${a.reliability.measurable} with a deadline` : 'Counts deliveries made by the agreed deadline (needs 5)'}</small></div>
      <div className="ws-stat"><span>Repeat customers</span><strong>{a.repeatCustomers?.customers >= 5 && a.repeatCustomers.percent != null ? `${a.repeatCustomers.percent}%` : <small style={{ fontSize: 14 }}>{NOT_ENOUGH}</small>}</strong><small>{a.repeatCustomers?.customers ? `${a.repeatCustomers.repeat} of ${a.repeatCustomers.customers} customers booked again` : 'Shown after 5 customers'}</small></div>
      <div className="ws-stat"><span>Verified projects</span><strong>{a.verifiedProjects ?? 0}</strong><small>Completed bookings shown as Verified Servix Projects</small></div>
    </div>
    {features.achievements && <AchievementsPanel earned={a.achievements ?? []} />}
    <section className="ws-panel"><h2>Export your records</h2><p className="ws-muted" style={{ marginBottom: 12 }}>Download CSV files of your bookings, proposals and earnings. Exports count towards your plan's monthly allowance.</p><div className="ws-actions"><ExportButton href={`${exportBase}/bookings.csv`} label="Bookings CSV" /><ExportButton href={`${exportBase}/proposals.csv`} label="Proposals CSV" /><ExportButton href={`${exportBase}/earnings.csv`} label="Earnings CSV" /></div></section>
    <VerifiedProjectsPanel />
    <div className="ws-stat-grid"><div className="ws-stat"><span>Unique clients</span><strong>{t.uniqueClients}</strong><small>Distinct customers who booked in this period</small></div><div className="ws-stat"><span>Active services</span><strong>{t.activeServices}<small style={{ fontSize: 16 }}> / {t.totalServices}</small></strong><small>Published out of all listings</small></div><div className="ws-stat"><span>Completed projects</span><strong>{t.completedProjects}</strong><small>Shown on your public profile</small></div><div className="ws-stat"><span>Period</span><strong style={{ fontSize: 22 }}>{days === 365 ? '1 year' : `${days} days`}</strong><small>Since {new Date(a.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div></div>
  </>}</LoadState></>;
}

function PerformancePanel({ p }) {
  const ap = p.applications; const pf = p.profile;
  return <section className="ws-panel" data-testid="performance-panel"><h2>Application & profile performance</h2>
    <div className="ws-stat-grid" style={{ marginTop: 6 }}>
      <div className="ws-stat"><span>Proposals sent</span><strong>{ap.sent}</strong><small>{ap.pending} awaiting a decision · {ap.withdrawn} withdrawn</small></div>
      <div className="ws-stat"><span>Acceptance rate</span><strong>{ap.acceptanceRate === null ? '—' : `${ap.acceptanceRate}%`}</strong><small>{ap.accepted} accepted · {ap.rejected} declined</small></div>
      <div className="ws-stat"><span>Decision time</span><strong>{ap.medianDecisionHours === null ? '—' : `${ap.medianDecisionHours} h`}</strong><small>Median time until customers decided</small></div>
      <div className="ws-stat"><span>Average proposal</span><strong style={{ fontSize: 22 }}>{ap.averagePrice === null ? '—' : formatPrice(ap.averagePrice)}</strong><small>{ap.bookingsFromProposals} became bookings</small></div>
    </div>
    {ap.weekly.length > 0 && <div className="ws-chart-grid"><section className="ws-panel" style={{ marginBottom: 0 }}><BarChart data={ap.weekly} x="week" y="sent" label="Proposals sent per week" /></section><section className="ws-panel" style={{ marginBottom: 0 }}><BarChart data={ap.weekly} x="week" y="accepted" label="Accepted per week" color="#2f6b4f" /></section></div>}
    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Profile views</span><strong>{pf.views}</strong><small>{pf.viewsChangePercent === null ? `${pf.previousViews} in the previous period` : `${pf.viewsChangePercent > 0 ? '+' : ''}${pf.viewsChangePercent}% vs the previous period`}</small></div>
      <div className="ws-stat"><span>View → booking</span><strong>{pf.viewToBookingRate === null ? '—' : `${pf.viewToBookingRate}%`}</strong><small>Bookings per 100 profile views</small></div>
      <div className="ws-stat"><span>Saved by customers</span><strong>{pf.savedByCustomers}</strong><small>Customers who shortlisted you</small></div>
      <div className="ws-stat"><span>Repeat customers</span><strong>{pf.repeatCustomerRate?.percent != null ? `${pf.repeatCustomerRate.percent}%` : '—'}</strong><small>{pf.repeatCustomerRate?.customers ? `${pf.repeatCustomerRate.repeat} of ${pf.repeatCustomerRate.customers} booked again` : 'Shown after 5 customers'}</small></div>
    </div>
  </section>;
}

function AchievementsPanel({ earned }) {
  const c = useResource(getAchievementCatalog);
  return <section className="ws-panel"><h2>Achievements</h2><p className="ws-muted" style={{ marginBottom: 14 }}>Earned automatically from your real activity; each one shows exactly what it takes. They appear on your public profile.</p>{c.data ? <Achievements items={earned} catalog={c.data.items} title={`${earned.length} of ${c.data.items.length} earned`} /> : <Achievements items={earned} />}</section>;
}

function VerifiedProjectsPanel() {
  const toast = useToast(); const r = useResource(getVerifiableBookings); const [busy, setBusy] = useState('');
  async function add(b) { setBusy(b.bookingId); try { await addVerifiedProject(b.bookingId); toast('Added to your portfolio as a Verified Servix Project.', 'success'); r.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); } }
  if (!r.data?.items?.length) return null;
  return <section className="ws-panel"><h2>Turn completed bookings into Verified Servix Projects</h2><p className="ws-muted" style={{ marginBottom: 14 }}>These completed bookings aren’t in your portfolio yet. Verified projects carry a badge customers can trust because Servix saw the work paid for and completed. You can edit the title afterwards under Profile &amp; portfolio.</p>
    <div className="ws-record-table"><table><thead><tr><th>BOOKING</th><th>CATEGORY</th><th>COMPLETED</th><th></th></tr></thead><tbody>{r.data.items.map(b => <tr key={b.bookingId}><td>{b.title}</td><td>{b.category}</td><td>{b.completedAt ? new Date(b.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td><td><button className="btn btn--secondary" disabled={busy === b.bookingId} onClick={() => add(b)}>{busy === b.bookingId ? 'Adding…' : 'Add to portfolio'}</button></td></tr>)}</tbody></table></div></section>;
}

/** Admin · Requests & proposals (read-only oversight) and Trust & achievements (metrics, badge history, recompute). No CRM notes are ever shown here. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminRequests, adminProposals, adminTrustList, adminTrustDetail, adminRecomputeTrust, REQUEST_STATUS, PROPOSAL_STATUS, NOT_ENOUGH } from '../../lib/marketplaceApi.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { useResource, LoadState, Empty, dateLabel } from '../dashboard/shared.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { formatPrice } from '../../lib/format.js';
import { Achievements } from '../../components/marketplace/TrustPanel.jsx';
import '../../components/marketplace/marketplace.css';

export function RequestsTab() {
  const { requests, ready } = useFeatures();
  const [view, setView] = useState('requests'); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const r = useResource(() => (view === 'requests' ? adminRequests({ q, status, page }) : adminProposals({ q, status, page })).then((res) => ({ ...res, view })), [view, q, status, page]);
  if (ready && !requests) return <section className="ws-panel"><Empty icon="inbox" title="Request marketplace is off" description="Set REQUESTS_ENABLED=true on the API to turn on customer requests and proposals." /></section>;
  const statuses = view === 'requests' ? Object.keys(REQUEST_STATUS) : Object.keys(PROPOSAL_STATUS);
  return <>
    <div className="ws-tabs"><button aria-pressed={view === 'requests'} onClick={() => { setView('requests'); setStatus(''); setPage(1); }}>Requests</button><button aria-pressed={view === 'proposals'} onClick={() => { setView('proposals'); setStatus(''); setPage(1); }}>Proposals</button></div>
    <div className="ws-input-search"><input placeholder={view === 'requests' ? 'Search title or customer email' : 'Search request, professional or customer'} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /><select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ maxWidth: 180 }}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{view === 'requests' ? REQUEST_STATUS[s].label : PROPOSAL_STATUS[s]}</option>)}</select></div>
    <LoadState skeleton="table" label="Loading…" resource={r}>{(data) => data.view !== view ? null : (
      !data.items.length ? <section className="ws-panel"><Empty icon="inbox" title="Nothing here yet" description="Requests and proposals appear as customers and professionals use the marketplace." /></section>
        : <section className="ws-panel"><div className="ws-record-table"><table>
          {view === 'requests' ? <>
            <thead><tr><th>REQUEST</th><th>CUSTOMER</th><th>BUDGET</th><th>STATUS</th><th>PROPOSALS</th><th>UPDATED</th></tr></thead>
            <tbody>{data.items.map((x) => <tr key={x.id}><td>{x.title}<small>{x.category?.name} · {x.isRemote ? 'Remote' : x.location || 'On-site'}</small></td><td>{x.customer?.fullName}<small>{x.customer?.email}</small></td><td>{x.budgetMin != null || x.budgetMax != null ? `${formatPrice(x.budgetMin ?? x.budgetMax)}${x.budgetMax != null && x.budgetMin !== x.budgetMax && x.budgetMin != null ? ` – ${formatPrice(x.budgetMax)}` : ''}` : '—'}</td><td><span className={`ws-chip ${REQUEST_STATUS[x.status]?.tone ?? 'gray'}`}>{REQUEST_STATUS[x.status]?.label ?? x.status}</span></td><td>{x.proposalCount}</td><td>{dateLabel(x.updatedAt)}</td></tr>)}</tbody>
          </> : <>
            <thead><tr><th>REQUEST</th><th>PROFESSIONAL</th><th>PRICE</th><th>DELIVERY</th><th>STATUS</th><th>BOOKING</th></tr></thead>
            <tbody>{data.items.map((x) => <tr key={x.id}><td>{x.request?.title}<small>{x.request?.customer?.fullName} · request {REQUEST_STATUS[x.request?.status]?.label}</small></td><td><Link to={`/professionals/${encodeURIComponent(x.professional.id)}`}>{x.professional.name}</Link></td><td>{formatPrice(x.price)}</td><td>{x.deliveryDays} d</td><td><span className={`ws-chip ${x.status === 'accepted' ? '' : 'gray'}`}>{PROPOSAL_STATUS[x.status]}</span></td><td>{x.booking ? <Link to={`/bookings/${x.booking.id}`}>{x.booking.reference}</Link> : '—'}</td></tr>)}</tbody>
          </>}
        </table></div>
        {data.total > data.pageSize && <div className="ws-actions" style={{ marginTop: 16 }}><button className="btn btn--secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="ws-muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span><button className="btn btn--secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </section>
    )}</LoadState>
  </>;
}

export function TrustTab() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [slug, setSlug] = useState('');
  const r = useResource(() => adminTrustList({ q, page }), [q, page]);
  return <>
    <div className="ws-input-search"><input placeholder="Search professional name or slug" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
    <div className="ws-two-col">
      <LoadState skeleton="table" label="Loading…" resource={r}>{(data) => (
        <section className="ws-panel"><div className="ws-record-table"><table><thead><tr><th>PROFESSIONAL</th><th>STATUS</th><th>COMPLETED</th><th>RATING</th><th>BADGES</th></tr></thead><tbody>
          {data.items.map((x) => <tr key={x.slug}><td><button className="ws-muted" style={{ color: '#315632', textDecoration: 'underline' }} onClick={() => setSlug(x.slug)}>{x.name}</button><small>{x.title}</small></td><td>{x.verification}{x.kycStatus === 'verified' ? ' · ID' : ''}</td><td>{x.completedProjects}</td><td>{x.reviewCount >= 3 ? x.rating.toFixed(2) : NOT_ENOUGH}</td><td>{x.achievements.length}</td></tr>)}
        </tbody></table></div>
        {data.total > data.pageSize && <div className="ws-actions" style={{ marginTop: 16 }}><button className="btn btn--secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="ws-muted">Page {data.page}</span><button className="btn btn--secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </section>
      )}</LoadState>
      <aside>{slug ? <TrustDetail slug={slug} onClose={() => setSlug('')} /> : <section className="ws-panel"><h2>Trust & achievements</h2><p className="ws-muted">Pick a professional to see every metric with its sample size, badge history (including revoked badges) and the data it came from. Metrics are never edited by hand — “Recompute” simply re-runs the rules.</p></section>}</aside>
    </div>
  </>;
}

function TrustDetail({ slug, onClose }) {
  const toast = useToast(); const r = useResource(() => adminTrustDetail(slug), [slug]); const [busy, setBusy] = useState(false);
  async function recompute() { setBusy(true); try { const res = await adminRecomputeTrust(slug); toast(`Recomputed: ${res.earned.length} earned, ${res.revoked.length} revoked.`, 'success'); r.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }
  return <LoadState skeleton="panel" label="Loading…" resource={r}>{({ professional, metrics: m, history, catalog, source }) => (
    <section className="ws-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><h2 style={{ margin: 0 }}>{professional.name}</h2><button className="ws-muted" onClick={onClose}>Close</button></div>
      <dl className="trust-grid" style={{ gridTemplateColumns: '1fr 1fr', margin: '14px 0' }}>
        <div className="trust-grid__item"><dt>Reliability</dt><dd>{m.reliability.percent == null ? NOT_ENOUGH : `${m.reliability.percent}%`}</dd><small>{m.reliability.onTime} on time · {m.reliability.late} late · {m.reliability.against} cancelled/refunded · {m.reliability.measurable} measurable</small></div>
        <div className="trust-grid__item"><dt>Response</dt><dd>{m.response.ratePercent == null ? NOT_ENOUGH : `${m.response.ratePercent}%`}</dd><small>{m.response.sample} paid requests · median {m.response.medianHours ?? '—'} h</small></div>
        <div className="trust-grid__item"><dt>Repeat</dt><dd>{m.repeatCustomers.percent == null ? NOT_ENOUGH : `${m.repeatCustomers.percent}%`}</dd><small>{m.repeatCustomers.repeat}/{m.repeatCustomers.customers} customers</small></div>
        <div className="trust-grid__item"><dt>Completed / verified</dt><dd>{m.completedJobs}</dd><small>{m.verifiedProjects} verified projects · {m.disputes.total} disputes · {m.accountAgeDays} days on Servix</small></div>
      </dl>
      <div className="ws-actions"><button className="btn btn--secondary" disabled={busy} onClick={recompute}>{busy ? 'Recomputing…' : 'Recompute achievements'}</button><Link className="btn btn--ghost" to={`/professionals/${encodeURIComponent(professional.slug)}`}>Public profile</Link></div>
      <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Badge history</h3>
      {!history.length ? <p className="ws-muted">No badges evaluated yet.</p> : <div className="ws-record-table"><table style={{ minWidth: 0 }}><thead><tr><th>BADGE</th><th>EARNED</th><th>REVOKED</th></tr></thead><tbody>{history.map((h) => <tr key={`${h.slug}-${h.earnedAt}`}><td>{catalog.find((c) => c.slug === h.slug)?.name ?? h.slug}</td><td>{dateLabel(h.earnedAt)}</td><td>{h.revokedAt ? dateLabel(h.revokedAt) : '—'}</td></tr>)}</tbody></table></div>}
      <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Rules</h3>
      <Achievements items={history.filter((h) => !h.revokedAt).map((h) => ({ ...catalog.find((c) => c.slug === h.slug), slug: h.slug }))} catalog={catalog} title="" />
      <p className="ws-muted" style={{ marginTop: 12 }}>Source: {source}</p>
    </section>
  )}</LoadState>;
}

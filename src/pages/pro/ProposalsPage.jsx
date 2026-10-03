/** Professional: browse open requests with filters, submit/edit/withdraw proposals, track outcomes. */
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { browseRequests, getBrowseRequest, submitProposal, updateProposal, withdrawProposal, listMyProposals, PROPOSAL_STATUS, REQUEST_STATUS } from '../../lib/marketplaceApi.js';
import { getCategories } from '../../lib/api.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { formatPrice } from '../../lib/format.js';
import { useResource, PageHead, LoadState, Empty, dateLabel } from '../dashboard/shared.jsx';
import { RequestCard } from '../requests/RequestsPage.jsx';
import { ProposalDraftAssist } from '../../components/ai/AiDrafting.jsx';
import '../../components/marketplace/marketplace.css';

function Disabled() { return <><PageHead title="Requests from customers" description="Not switched on yet." /><section className="ws-panel"><Empty icon="inbox" title="Coming soon" description="Customers will soon be able to post requests you can propose on." to="/dashboard/gigs" label="Manage my gigs" /></section></>; }

export default function ProposalsPage({ section = 'browse' }) {
  const { requests, ready } = useFeatures();
  if (ready && !requests) return <Disabled />;
  if (section === 'mine') return <MyProposals />;
  if (section === 'detail') return <BrowseDetail />;
  return <Browse />;
}

function Tabs({ active }) {
  return <div className="ws-tabs" role="tablist"><Link role="tab" aria-selected={active === 'browse'} className="btn" style={{ padding: '9px 16px', fontSize: 12, background: active === 'browse' ? '#12372a' : '#fff', color: active === 'browse' ? '#fff' : '#78846e' }} to="/dashboard/proposals">Open requests</Link><Link role="tab" aria-selected={active === 'mine'} className="btn" style={{ padding: '9px 16px', fontSize: 12, background: active === 'mine' ? '#12372a' : '#fff', color: active === 'mine' ? '#fff' : '#78846e' }} to="/dashboard/proposals/mine">My proposals</Link></div>;
}

function Browse() {
  useDocumentMeta({ title: 'Open requests', description: 'Customer requests you can propose on.' });
  const [params, setParams] = useSearchParams();
  const filters = { category: params.get('category') || '', remote: params.get('remote') || 'any', sort: params.get('sort') || 'newest', q: params.get('q') || '', minBudget: params.get('minBudget') || '', maxBudget: params.get('maxBudget') || '', page: Number(params.get('page') || 1) };
  const [categories, setCategories] = useState([]);
  useEffect(() => { getCategories().then((c) => setCategories(c.items ?? c)).catch(() => {}); }, []);
  const r = useResource(() => browseRequests({ ...filters, pageSize: 12 }), [params.toString()]);
  const setF = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setParams(n, { replace: true }); };
  return <>
    <PageHead title="Requests from customers" description="Customers describe what they need and a budget; you reply with a price, timeline and approach. One live proposal per request." />
    <Tabs active="browse" />
    <section className="ws-panel">
      <div className="req-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Search<input value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="Keyword" /></label>
        <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Category<select value={filters.category} onChange={(e) => setF('category', e.target.value)}><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Work<select value={filters.remote} onChange={(e) => setF('remote', e.target.value)}><option value="any">Remote or on-site</option><option value="remote">Remote only</option><option value="onsite">On-site only</option></select></label>
        <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Min budget (₦)<input type="number" inputMode="numeric" value={filters.minBudget} onChange={(e) => setF('minBudget', e.target.value)} /></label>
        <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Sort<select value={filters.sort} onChange={(e) => setF('sort', e.target.value)}><option value="newest">Newest</option><option value="deadline">Deadline soonest</option><option value="budget-high">Budget high → low</option><option value="budget-low">Budget low → high</option></select></label>
      </div>
    </section>
    <LoadState skeleton="cards" label="Loading open requests…" resource={r}>{(data) => (
      !data.items.length ? <section className="ws-panel"><Empty icon="inbox" title="No open requests match" description="Try widening the filters, or check back later — new requests appear here as soon as customers publish them." /></section>
        : <>
          <div className="req-grid">{data.items.map((item) => <RequestCard key={item.id} r={item} to={`/dashboard/proposals/requests/${item.id}`} extra={<div className="ws-actions" style={{ alignItems: 'center' }}>{item.myProposal ? <span className="ws-chip">You proposed</span> : <Link className="btn btn--primary" to={`/dashboard/proposals/requests/${item.id}`}>View &amp; propose</Link>}<small className="ws-muted" style={{ marginLeft: 'auto' }}>Posted {dateLabel(item.publishedAt || item.createdAt)} · {item.customer?.displayName}</small></div>} />)}</div>
          {data.total > data.pageSize && <div className="ws-actions" style={{ marginTop: 20, justifyContent: 'center' }}><button className="btn btn--secondary" disabled={filters.page <= 1} onClick={() => setF('page', String(filters.page - 1))}>Previous</button><span className="ws-muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span><button className="btn btn--secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => setF('page', String(filters.page + 1))}>Next</button></div>}
        </>
    )}</LoadState>
  </>;
}

const EMPTY = { cover: '', price: '', deliveryDays: '', serviceSlug: '', milestones: '' };

function BrowseDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const toast = useToast(); const { ai } = useFeatures();
  const r = useResource(() => getBrowseRequest(id), [id]);
  const [form, setForm] = useState(EMPTY); const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(''); const [errors, setErrors] = useState({});
  useDocumentMeta({ title: r.data?.title ?? 'Request', description: 'Customer request details.' });
  useEffect(() => { const p = r.data?.myProposal; if (p && p.status === 'submitted') setForm({ cover: p.cover, price: String(p.price), deliveryDays: String(p.deliveryDays), serviceSlug: p.service?.id ?? '', milestones: (p.milestones ?? []).map((m) => `${m.title}${m.amount ? ` | ${m.amount}` : ''}${m.days ? ` | ${m.days}` : ''}`).join('\n') }); }, [r.data?.myProposal?.id]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  function body() {
    const milestones = form.milestones.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10).map((l) => { const [title, amount, days] = l.split('|').map((x) => x.trim()); return { title, ...(amount && Number(amount) ? { amount: Number(amount) } : {}), ...(days && Number(days) ? { days: Number(days) } : {}) }; });
    return { cover: form.cover.trim(), price: Number(form.price), deliveryDays: Number(form.deliveryDays), serviceSlug: form.serviceSlug || null, milestones };
  }
  async function submit(e) {
    e.preventDefault(); setBusy('submit'); setErrors({});
    try {
      const mine = r.data.myProposal;
      if (mine && mine.status === 'submitted') { await updateProposal(mine.id, body()); toast('Proposal updated.', 'success'); setEditing(false); }
      else { await submitProposal(id, body()); toast('Proposal sent. The customer has been notified.', 'success'); }
      r.reload();
    } catch (err) { if (err.errors) setErrors(err.errors); toast(err.message, 'error'); } finally { setBusy(''); }
  }
  async function withdraw() {
    if (!window.confirm('Withdraw this proposal? You can submit a new one while the request stays open.')) return;
    setBusy('withdraw'); try { await withdrawProposal(r.data.myProposal.id); toast('Proposal withdrawn.', 'success'); setForm(EMPTY); r.reload(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  }
  const err = (k) => errors[k] && <span className="field-error" role="alert">{errors[k]}</span>;
  return <LoadState skeleton="panel" label="Loading request…" resource={r}>{(q) => {
    const st = REQUEST_STATUS[q.status] || { label: q.status, tone: 'gray' };
    const mine = q.myProposal; const canPropose = q.status === 'open' && (!mine || mine.status !== 'submitted' && mine.status !== 'accepted');
    const showForm = canPropose || (mine?.status === 'submitted' && editing);
    return <>
      <PageHead eyebrow="OPEN REQUESTS" title={q.title} description={`${q.category?.name} · ${q.isRemote ? 'Remote' : q.location || 'On-site'} · posted by ${q.customer?.displayName} (member since ${q.customer?.memberSince})`}><div className="ws-actions"><span className={`ws-chip ${st.tone}`}>{st.label}</span><button className="btn btn--ghost" onClick={() => navigate(-1)}>Back</button></div></PageHead>
      <div className="ws-two-col">
        <div>
          <section className="ws-panel">
            <h2>What the customer needs</h2>
            <p className="ws-muted" style={{ whiteSpace: 'pre-wrap' }}>{q.description}</p>
            {q.extraRequirements && <><h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Additional notes</h3><p className="ws-muted" style={{ whiteSpace: 'pre-wrap' }}>{q.extraRequirements}</p></>}
            <div className="req-meta" style={{ marginTop: 14 }}>
              <span><Icon name="wallet" size={13} /> Budget {q.budgetMin != null && q.budgetMax != null && q.budgetMin !== q.budgetMax ? `${formatPrice(q.budgetMin)} – ${formatPrice(q.budgetMax)}` : formatPrice(q.budgetMax ?? q.budgetMin ?? 0)}</span>
              {q.deadlineAt && <span><Icon name="calendar" size={13} /> Needed by {dateLabel(q.deadlineAt)}</span>}
              <span><Icon name="inbox" size={13} /> {q.proposalCount} proposal{q.proposalCount === 1 ? '' : 's'} so far</span>
            </div>
            {!!q.requiredSkills?.length && <div className="ws-actions" style={{ marginTop: 12 }}>{q.requiredSkills.map((s) => <span className="ws-chip gray" key={s}>{s}</span>)}</div>}
            {!!q.attachments?.length && <ul style={{ marginTop: 12, paddingLeft: 18, fontSize: 12 }}>{q.attachments.map((a, i) => <li key={i}><a href={a.url} target="_blank" rel="noreferrer">{a.name || 'Attachment'}</a></li>)}</ul>}
          </section>
          {mine && !showForm && (
            <section className={`ws-panel${mine.status === 'accepted' ? '' : ''}`}>
              <h2>Your proposal <span className={`ws-chip ${mine.status === 'accepted' ? '' : 'gray'}`} style={{ marginLeft: 8 }}>{PROPOSAL_STATUS[mine.status]}</span></h2>
              <p className="ws-muted"><strong>{formatPrice(mine.price)}</strong> · {mine.deliveryDays} day{mine.deliveryDays === 1 ? '' : 's'}{mine.service ? ` · ${mine.service.title}` : ' · Custom work'}</p>
              <blockquote style={{ margin: '10px 0', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{mine.cover}</blockquote>
              {mine.status === 'rejected' && mine.rejectedReason && <p className="ws-muted">Customer’s note: {mine.rejectedReason}</p>}
              {mine.status === 'accepted' && mine.booking && <p className="ws-muted">Booking <Link to={`/bookings/${mine.booking.id}`}>{mine.booking.reference}</Link> — {mine.booking.status.replaceAll('_', ' ')}. It appears under <Link to="/dashboard/work">Client bookings</Link> once the customer pays.</p>}
              {mine.status === 'submitted' && q.status === 'open' && <div className="ws-actions"><button className="btn btn--secondary" onClick={() => setEditing(true)}>Edit proposal</button><button className="btn btn--ghost" disabled={Boolean(busy)} onClick={withdraw}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}</button></div>}
            </section>
          )}
          {showForm && (
            <section className="ws-panel">
              <h2>{mine?.status === 'submitted' ? 'Edit your proposal' : 'Send a proposal'}</h2>
              {ai && <div style={{ marginBottom: 16 }}><ProposalDraftAssist requestId={q.id} form={form} onFill={(next) => { setForm(next); setErrors({}); toast('Draft placed in the form — adjust the price and wording before sending.', 'success'); }} /></div>}
              <form className="ws-form" style={{ maxWidth: 'none' }} onSubmit={submit} noValidate>
                <label>Your approach
                  <textarea rows={6} value={form.cover} onChange={set('cover')} maxLength={5000} placeholder="How would you tackle this? What will the customer receive, and what do you need from them?" aria-invalid={Boolean(errors.cover)} />
                  <small className="ws-muted">{form.cover.trim().length}/30 characters minimum.</small>{err('cover')}
                </label>
                <div className="req-form-grid">
                  <label>Total price (₦)<input type="number" inputMode="numeric" min={1000} step={500} value={form.price} onChange={set('price')} aria-invalid={Boolean(errors.price)} />{err('price')}</label>
                  <label>Delivery (days)<input type="number" inputMode="numeric" min={1} max={365} value={form.deliveryDays} onChange={set('deliveryDays')} aria-invalid={Boolean(errors.deliveryDays)} />{err('deliveryDays')}</label>
                  <label className="full">Attach to one of your gigs (optional)
                    <select value={form.serviceSlug} onChange={set('serviceSlug')} aria-invalid={Boolean(errors.serviceSlug)}><option value="">Custom work (no gig)</option>{(q.myServices ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                    <small className="ws-muted">The booking is created against this gig if the customer accepts; the agreed price above is what they pay.</small>{err('serviceSlug')}
                  </label>
                  <label className="full">Milestones (optional, one per line: title | amount | days)<textarea rows={3} value={form.milestones} onChange={set('milestones')} placeholder={'Discovery & moodboard | 20000 | 2\nLogo concepts | 40000 | 4'} /></label>
                </div>
                <div className="ws-actions"><button className="btn btn--primary" type="submit" disabled={Boolean(busy)}>{busy === 'submit' ? 'Sending…' : mine?.status === 'submitted' ? 'Save changes' : 'Send proposal'}</button>{editing && <button type="button" className="btn btn--secondary" onClick={() => setEditing(false)}>Cancel</button>}</div>
              </form>
            </section>
          )}
          {q.status !== 'open' && !mine && <div className="ws-alert">This request is {st.label.toLowerCase()} and not accepting proposals.</div>}
        </div>
        <aside><section className="ws-panel"><h2>Tips</h2><ul className="ws-muted" style={{ paddingLeft: 18 }}><li>Quote the full price for the described scope; the customer pays it up front into escrow.</li><li>Lead with how you would solve it, not with a biography.</li><li>You can edit or withdraw while the request stays open.</li></ul></section></aside>
      </div>
    </>;
  }}</LoadState>;
}

function MyProposals() {
  useDocumentMeta({ title: 'My proposals', description: 'Proposals you sent on Servix requests.' });
  const r = useResource(listMyProposals);
  return <>
    <PageHead title="My proposals" description="Every proposal you sent, with its outcome. Accepted proposals become bookings in Client bookings once the customer pays." />
    <Tabs active="mine" />
    <LoadState skeleton="cards" label="Loading proposals…" resource={r}>{(data) => (
      !data.items.length ? <section className="ws-panel"><Empty icon="inbox" title="No proposals yet" description="Browse open requests and send your first proposal." to="/dashboard/proposals" label="See open requests" /></section>
        : <section className="ws-panel"><div className="ws-record-table"><table><thead><tr><th>REQUEST</th><th>YOUR PRICE</th><th>DELIVERY</th><th>STATUS</th><th>SENT</th></tr></thead><tbody>
          {data.items.map((p) => <tr key={p.id}><td><Link to={`/dashboard/proposals/requests/${p.request.id}`}>{p.request.title}</Link><small>{p.request.category?.name} · request {REQUEST_STATUS[p.request.status]?.label}</small></td><td>{formatPrice(p.price)}</td><td>{p.deliveryDays} d</td><td><span className={`ws-chip ${p.status === 'accepted' ? '' : 'gray'}`}>{PROPOSAL_STATUS[p.status]}</span>{p.booking && <small><Link to={`/bookings/${p.booking.id}`}>{p.booking.reference}</Link></small>}</td><td>{dateLabel(p.createdAt)}</td></tr>)}
        </tbody></table></div></section>
    )}</LoadState>
  </>;
}

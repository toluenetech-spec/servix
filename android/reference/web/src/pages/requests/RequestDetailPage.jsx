/** Customer: one request — status actions, proposals side by side, accept → booking → payment. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { listRequestProposals, requestAction, acceptProposal, rejectProposal, REQUEST_STATUS, PROPOSAL_STATUS } from '../../lib/marketplaceApi.js';
import { payBooking } from '../../lib/bookingApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { formatPrice } from '../../lib/format.js';
import { useResource, PageHead, LoadState, Empty, dateLabel } from '../dashboard/shared.jsx';
import { budgetLabel } from './RequestsPage.jsx';
import '../../components/marketplace/marketplace.css';

export default function RequestDetailPage() {
  const { id } = useParams(); const navigate = useNavigate(); const toast = useToast();
  const r = useResource(() => listRequestProposals(id), [id]);
  const [busy, setBusy] = useState(''); const [confirm, setConfirm] = useState(null); const [rejecting, setRejecting] = useState(null); const [reason, setReason] = useState('');
  useDocumentMeta({ title: r.data?.request?.title ?? 'Request', description: 'Your service request and proposals.' });

  async function act(action) {
    setBusy(action);
    try { await requestAction(id, action); toast({ publish: 'Request published.', pause: 'Request paused — professionals can no longer see it.', close: 'Request closed.', cancel: 'Request cancelled.' }[action], 'success'); r.reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }
  async function accept(p) {
    setBusy(`accept-${p.id}`);
    try {
      const res = await acceptProposal(id, p.id);
      toast('Proposal accepted. Complete payment to start the booking.', 'success');
      try { const { authorizationUrl } = await payBooking(res.bookingId); window.location.href = authorizationUrl; return; } catch { navigate(`/bookings/${res.bookingId}`); }
    } catch (e) { toast(e.message, 'error'); r.reload(); } finally { setBusy(''); setConfirm(null); }
  }
  async function reject() {
    const p = rejecting; setBusy(`reject-${p.id}`);
    try { await rejectProposal(id, p.id, reason.trim() || undefined); toast('Proposal declined.', 'success'); setRejecting(null); setReason(''); r.reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  return <LoadState skeleton="panel" label="Loading request…" resource={r}>{({ request: q, items }) => {
    const st = REQUEST_STATUS[q.status] || { label: q.status, tone: 'gray' };
    const live = items.filter((p) => p.status === 'submitted');
    const accepted = items.find((p) => p.status === 'accepted');
    const can = (a) => ({ publish: ['draft', 'paused'], pause: ['open'], close: ['open', 'paused'], cancel: ['draft', 'open', 'paused'] }[a].includes(q.status));
    return <>
      <PageHead eyebrow="MY REQUESTS" title={q.title} description={`${q.category?.name} · ${budgetLabel(q)} · ${q.isRemote ? 'Remote' : q.location || 'On-site'}${q.deadlineAt ? ` · due ${dateLabel(q.deadlineAt)}` : ''}`}>
        <div className="ws-actions">
          <span className={`ws-chip ${st.tone}`} style={{ alignSelf: 'center' }}>{st.label}</span>
          {['draft', 'open', 'paused'].includes(q.status) && <Link className="btn btn--secondary" to={`/dashboard/requests/${q.id}/edit`}>Edit</Link>}
          {can('publish') && <button className="btn btn--primary" disabled={Boolean(busy)} onClick={() => act('publish')}>{busy === 'publish' ? 'Publishing…' : q.status === 'paused' ? 'Reopen' : 'Publish'}</button>}
          {can('pause') && <button className="btn btn--secondary" disabled={Boolean(busy)} onClick={() => act('pause')}>Pause</button>}
          {can('close') && <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => act('close')}>Close</button>}
          {can('cancel') && q.status === 'draft' && <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => act('cancel')}>Delete draft</button>}
        </div>
      </PageHead>
      {q.status === 'draft' && Object.keys(q.publishProblems ?? {}).length > 0 && <div className="ws-alert"><strong>Before publishing:</strong> {Object.values(q.publishProblems).join(' ')} <Link to={`/dashboard/requests/${q.id}/edit`}>Edit request</Link>.</div>}
      <div className="ws-two-col">
        <div>
          {accepted && (
            <section className="ws-panel" style={{ borderColor: '#4f8a5a' }}>
              <h2>Awarded to {accepted.professional.name}</h2>
              <p className="ws-muted">{formatPrice(accepted.price)} · {accepted.deliveryDays} day{accepted.deliveryDays === 1 ? '' : 's'}. {accepted.booking ? <>Booking <Link to={`/bookings/${accepted.booking.id}`}>{accepted.booking.reference}</Link> is <strong>{accepted.booking.status.replaceAll('_', ' ')}</strong>.{accepted.booking.status === 'pending_payment' && ' Complete payment to start the work.'}</> : null}</p>
              {accepted.booking && <div className="ws-actions"><Link className="btn btn--primary" to={`/bookings/${accepted.booking.id}`}>Open booking</Link></div>}
            </section>
          )}
          <section className="ws-panel">
            <h2>Proposals ({items.length})</h2>
            {!items.length && <Empty icon="inbox" title={q.status === 'open' ? 'No proposals yet' : 'No proposals'} description={q.status === 'open' ? 'Your request is visible to professionals in this category. Proposals usually arrive within a day or two.' : q.status === 'draft' ? 'Publish the request to start receiving proposals.' : 'This request is not open for proposals.'} />}
            {live.length > 1 && (
              <div className="proposal-compare" style={{ marginBottom: 20 }}>
                <div className="ws-record-table"><table><thead><tr><th>PROFESSIONAL</th><th>PRICE</th><th>DELIVERY</th><th>RATING</th><th>COMPLETED</th><th>VERIFIED</th></tr></thead><tbody>
                  {live.map((p) => <tr key={p.id}><td><Link to={`/professionals/${encodeURIComponent(p.professional.id)}`}>{p.professional.name}</Link></td><td>{formatPrice(p.price)}</td><td>{p.deliveryDays} d</td><td>{p.professional.reviewCount ? `★ ${p.professional.rating.toFixed(1)} (${p.professional.reviewCount})` : 'Not enough data'}</td><td>{p.professional.completedProjects}</td><td>{p.professional.verified ? 'Servix' : '—'}{p.professional.identityVerified ? ' · ID' : ''}</td></tr>)}
                </tbody></table></div>
              </div>
            )}
            <div style={{ display: 'grid', gap: 14 }}>
              {items.map((p) => (
                <article className={`proposal-card${p.status === 'accepted' ? ' is-accepted' : ''}`} key={p.id}>
                  <div className="proposal-card__head">
                    {p.professional.image ? <img src={p.professional.image} alt="" /> : <span className="ws-avatar">{p.professional.name.slice(0, 1)}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong><Link to={`/professionals/${encodeURIComponent(p.professional.id)}`}>{p.professional.name}</Link></strong>
                      <div className="req-meta"><span>{p.professional.title}</span>{p.professional.verified && <span className="ws-chip">Servix Verified</span>}{p.professional.identityVerified && <span className="ws-chip">ID verified</span>}<span>{p.professional.completedProjects} completed</span><span>{p.professional.reviewCount ? `★ ${p.professional.rating.toFixed(1)} (${p.professional.reviewCount})` : 'No reviews yet'}</span></div>
                    </div>
                    <div style={{ textAlign: 'right' }}><div className="proposal-card__price">{formatPrice(p.price)}</div><small className="ws-muted">{p.deliveryDays} day{p.deliveryDays === 1 ? '' : 's'}{p.service ? ` · ${p.service.title}` : ' · Custom work'}</small></div>
                  </div>
                  <blockquote>{p.cover}</blockquote>
                  {!!p.milestones?.length && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#51645a' }}>{p.milestones.map((m, i) => <li key={i}>{m.title}{m.amount ? ` — ${formatPrice(m.amount)}` : ''}{m.days ? ` (${m.days} d)` : ''}</li>)}</ul>}
                  <div className="ws-actions" style={{ alignItems: 'center' }}>
                    <span className={`ws-chip ${p.status === 'accepted' ? '' : 'gray'}`}>{PROPOSAL_STATUS[p.status]}</span>
                    {p.status === 'submitted' && ['open', 'paused'].includes(q.status) && <>
                      <button className="btn btn--primary" disabled={Boolean(busy)} onClick={() => setConfirm(p)}>Accept proposal</button>
                      <button className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => setRejecting(p)}>Decline</button>
                    </>}
                    <small className="ws-muted" style={{ marginLeft: 'auto' }}>{dateLabel(p.createdAt)}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <aside>
          <section className="ws-panel">
            <h2>Request details</h2>
            <p className="ws-muted" style={{ whiteSpace: 'pre-wrap' }}>{q.description || 'No description.'}</p>
            {q.extraRequirements && <><h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Additional notes</h3><p className="ws-muted" style={{ whiteSpace: 'pre-wrap' }}>{q.extraRequirements}</p></>}
            {!!q.requiredSkills?.length && <div className="ws-actions" style={{ marginTop: 12 }}>{q.requiredSkills.map((s) => <span className="ws-chip gray" key={s}>{s}</span>)}</div>}
            <p className="ws-muted" style={{ marginTop: 14 }}><Icon name="info" size={13} /> Payment is held by Servix after you accept a proposal and only released when you confirm the work is complete.</p>
          </section>
        </aside>
      </div>

      <Modal open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title="Accept this proposal?">
        {confirm && <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>You are choosing <strong>{confirm.professional.name}</strong> for <strong>{formatPrice(confirm.price)}</strong>, delivered in {confirm.deliveryDays} day{confirm.deliveryDays === 1 ? '' : 's'}. Other proposals will be declined automatically and a booking will be created for you to pay.</p>
          <div className="ws-actions"><button className="btn btn--primary" disabled={Boolean(busy)} onClick={() => accept(confirm)}>{busy ? 'Creating booking…' : 'Accept and continue to payment'}</button><button className="btn btn--secondary" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Not yet</button></div>
        </div>}
      </Modal>
      <Modal open={Boolean(rejecting)} onClose={() => !busy && setRejecting(null)} title="Decline proposal">
        {rejecting && <div className="ws-form">
          <label>Reason (optional, shared with the professional)<textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="ws-actions"><button className="btn btn--primary" disabled={Boolean(busy)} onClick={reject}>{busy ? 'Declining…' : 'Decline proposal'}</button><button className="btn btn--secondary" disabled={Boolean(busy)} onClick={() => setRejecting(null)}>Cancel</button></div>
        </div>}
      </Modal>
    </>;
  }}</LoadState>;
}

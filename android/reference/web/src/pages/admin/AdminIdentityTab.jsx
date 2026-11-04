/**
 * Admin · Identity (KYC) review.
 *
 * Queue (pending first) → split-screen case view:
 *   left   profile + submitted details
 *   centre ID document with zoom / pan (PDF embeds inline)
 *   right  selfie, plus Approve / Reject
 * File links are signed by the API and expire after 20 minutes; a countdown
 * shows how long they remain valid and a refresh re-mints them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { EmptyState, ErrorState, TableSkeleton, Skeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import * as adminApi from '../../lib/adminApi.js';
import '../../components/dashboard/charts.css';
import '../../components/dashboard/kyc.css';

const fmtWhen = iso => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_VARIANT = { pending: 'accent', approved: 'verified', rejected: 'neutral' };
const STANDARD_REASONS = ['Document blurry', 'Name mismatch', 'Selfie does not match ID', 'Expired document'];

export function IdentityTab() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('kyc');
  const open = id => setParams(p => { const next = new URLSearchParams(p); if (id) next.set('kyc', id); else next.delete('kyc'); return next; });
  if (selected) return <CaseView id={selected} onBack={() => open(null)} />;
  return <Queue onOpen={open} />;
}

function Queue({ onOpen }) {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); setData(null); adminApi.getKycQueue({ status, page, pageSize: 20 }).then(setData).catch(setError); }, [status, page]);
  useEffect(load, [load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
    <div className="ws-range" role="group" aria-label="Filter">{['pending', 'approved', 'rejected', 'all'].map(s => <button key={s} aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}{data?.counts && s !== 'all' && data.counts[s] ? ` (${data.counts[s]})` : ''}</button>)}</div>
    {error ? <ErrorState message="We couldn't load identity verifications." onRetry={load} />
      : !data ? <TableSkeleton rows={6} cols={5} label="Loading verifications…" />
      : data.items.length === 0 ? <EmptyState title={status === 'pending' ? 'No verifications waiting' : 'Nothing here yet'} message={status === "pending" ? "New submissions appear here the moment someone uploads their documents." : "Reviewed submissions will be listed here."} />
      : <div className="ws-record-table" data-testid="kyc-queue"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Document</th><th>ID number</th><th>Submitted</th><th>Status</th><th /></tr></thead>
        <tbody>{data.items.map(item => <tr key={item.id}>
          <td><strong>{item.user.fullName}</strong><small>{item.user.role}</small></td>
          <td>{item.user.email}</td>
          <td>{item.documentTypeLabel}</td>
          <td><code>{item.idNumber}</code></td>
          <td>{fmtWhen(item.submittedAt)}</td>
          <td><Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge></td>
          <td><Button variant="secondary" size="sm" onClick={() => onOpen(item.id)}>{item.status === 'pending' ? 'Review' : 'View'}</Button></td>
        </tr>)}</tbody>
      </table></div>}
    {data && pages > 1 && <div className="ws-actions" style={{ justifyContent: 'center' }}><Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="ws-muted">Page {page} of {pages}</span><Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
  </div>;
}

function CaseView({ id, onBack }) {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);
  const load = useCallback(() => { setError(null); adminApi.getKycCase(id).then(setData).catch(setError); }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!data?.files?.expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(data.files.expiresAt).getTime() - Date.now()) / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [data?.files?.expiresAt]);

  async function review(action, rejectionReason) {
    setBusy(true);
    try {
      await adminApi.reviewKyc(id, action, rejectionReason);
      showToast(action === 'approve' ? `${data.user.fullName} is now verified.` : 'Verification rejected — the user has been notified.', 'success');
      setRejecting(false);
      load();
    } catch (err) {
      showToast(err.message ?? 'Review failed.', 'error');
    } finally { setBusy(false); }
  }

  if (error) return <ErrorState message="We couldn't load this verification." onRetry={load} />;
  if (!data) return <div className="kyc-split"><Skeleton height="22rem" /><Skeleton height="22rem" /><Skeleton height="22rem" /></div>;
  const expired = left === 0;
  return <div style={{ display: 'grid', gap: 'var(--space-5)' }} data-testid="kyc-case">
    <div className="ws-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Button variant="ghost" size="sm" onClick={onBack}>← Back to queue</Button>
      <span className="ws-muted" data-testid="kyc-link-expiry">{expired ? 'Secure links expired.' : `Secure file links expire in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}{' '}<button type="button" className="kyc-link-btn" onClick={load}>Refresh links</button></span>
    </div>
    <div className="kyc-split">
      <section className="ws-panel kyc-col" aria-label="Profile details">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2>{data.user.fullName}</h2><Badge variant={STATUS_VARIANT[data.status]}>{data.status}</Badge></div>
        <dl className="kyc-meta">
          <div><dt>Email</dt><dd>{data.user.email}{data.user.emailVerified ? ' ✓' : ' (unverified)'}</dd></div>
          <div><dt>Role</dt><dd>{data.user.role}{data.user.professional ? ` · ${data.user.professional.title}` : ''}</dd></div>
          {data.user.professional?.location && <div><dt>Location</dt><dd>{data.user.professional.location}</dd></div>}
          <div><dt>Member since</dt><dd>{fmtWhen(data.user.memberSince)}</dd></div>
          <div><dt>Document</dt><dd>{data.documentTypeLabel}</dd></div>
          <div><dt>ID number</dt><dd><code data-testid="kyc-id-number">{data.idNumber}</code></dd></div>
          {data.dateOfBirth && <div><dt>Date of birth</dt><dd>{data.dateOfBirth}</dd></div>}
          {data.phone && <div><dt>Phone</dt><dd>{data.phone}</dd></div>}
          <div><dt>Submitted</dt><dd>{fmtWhen(data.submittedAt)}</dd></div>
          <div><dt>Consent</dt><dd>Given {fmtWhen(data.consentAt)}</dd></div>
          {data.reviewedAt && <div><dt>Reviewed</dt><dd>{fmtWhen(data.reviewedAt)}{data.reviewedBy ? ` by ${data.reviewedBy.fullName}` : ''}</dd></div>}
          {data.rejectionReason && <div><dt>Rejection reason</dt><dd>{data.rejectionReason}</dd></div>}
        </dl>
        <p className="ws-muted" style={{ marginTop: 12 }}>Check: name on the document matches the account, the selfie shows the same person, the paper shows today's date and the full name, and the document is not expired.</p>
      </section>
      <section className="ws-panel kyc-col kyc-doc" aria-label="Identity document">
        <h2>{data.documentTypeLabel}</h2>
        {data.files.document.contentType === 'application/pdf'
          ? <div className="kyc-pdf-frame"><iframe title="Identity document (PDF)" src={data.files.document.url} /><a className="btn btn--secondary" href={data.files.document.url} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a></div>
          : <ZoomPan src={data.files.document.url} alt="Identity document" />}
      </section>
      <section className="ws-panel kyc-col" aria-label="Selfie and decision">
        <h2>Selfie</h2>
        <ZoomPan src={data.files.selfie.url} alt="Selfie holding dated paper" compact />
        {data.status === 'pending' ? <div className="kyc-decision">
          <Button variant="primary" className="kyc-approve" disabled={busy} onClick={() => review('approve')} data-testid="kyc-approve">{busy ? 'Working…' : 'Approve'}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)} data-testid="kyc-reject">Reject…</Button>
        </div> : <p className="ws-muted" style={{ marginTop: 16 }}>This verification was {data.status}. Decisions are final; the user can re-submit only after a rejection.</p>}
      </section>
    </div>
    <RejectModal open={rejecting} busy={busy} reasons={data.reasons || STANDARD_REASONS} onClose={() => setRejecting(false)} onConfirm={reason => review('reject', reason)} />
  </div>;
}

function RejectModal({ open, busy, reasons, onClose, onConfirm }) {
  const [choice, setChoice] = useState(reasons[0]);
  const [custom, setCustom] = useState('');
  useEffect(() => { if (open) { setChoice(reasons[0]); setCustom(''); } }, [open, reasons]);
  const reason = choice === '__other' ? custom.trim() : choice;
  return <Modal open={open} onClose={onClose} title="Reject verification">
    <p className="ws-muted" style={{ marginBottom: 14 }}>The person sees this reason in-app and by email, and can submit new documents straight away.</p>
    <div className="kyc-reasons" role="radiogroup" aria-label="Rejection reason">
      {reasons.map(r => <label key={r}><input type="radio" name="kyc-reason" value={r} checked={choice === r} onChange={() => setChoice(r)} /> {r}</label>)}
      <label><input type="radio" name="kyc-reason" value="__other" checked={choice === '__other'} onChange={() => setChoice('__other')} /> Other reason</label>
      {choice === '__other' && <textarea rows={3} maxLength={500} value={custom} placeholder="Describe what needs fixing…" onChange={e => setCustom(e.target.value)} />}
    </div>
    <div className="ws-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="secondary" className="kyc-danger" disabled={busy || reason.length < 3} onClick={() => onConfirm(reason)} data-testid="kyc-reject-confirm">{busy ? 'Rejecting…' : 'Reject verification'}</Button>
    </div>
  </Modal>;
}

/** Image viewer: wheel / buttons zoom, drag to pan, double-click resets. */
function ZoomPan({ src, alt, compact = false }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const drag = useRef(null);
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };
  useEffect(() => { reset(); setFailed(false); }, [src]);
  const zoom = delta => setScale(s => Math.min(6, Math.max(1, +(s + delta).toFixed(2))));
  return <div className={`kyc-viewer ${compact ? 'is-compact' : ''}`}>
    <div className="kyc-viewer-tools"><button type="button" onClick={() => zoom(-0.5)} aria-label="Zoom out">−</button><span>{Math.round(scale * 100)}%</span><button type="button" onClick={() => zoom(0.5)} aria-label="Zoom in">+</button><button type="button" onClick={reset}>Reset</button><a href={src} target="_blank" rel="noopener noreferrer">Open <Icon name="eye" size={12} /></a></div>
    <div className="kyc-viewer-stage" onWheel={e => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.25 : -0.25); }} onDoubleClick={reset}
      onPointerDown={e => { drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {failed ? <p className="ws-muted" style={{ padding: 20 }}>The secure link has expired or the file could not be loaded. Use “Refresh links”.</p>
        : <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, cursor: scale > 1 ? 'grab' : 'zoom-in' }} />}
    </div>
  </div>;
}

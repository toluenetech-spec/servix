/**
 * SERVIX ADMIN CONSOLE — Phase E.
 *
 * Replaces the retired X-Servix-Review-Key operational bridge with a real
 * authenticated admin dashboard: application review, service moderation,
 * user management, booking/dispute monitoring, payout monitoring and the
 * audit-log viewer. Built entirely from the existing Servix design system
 * (Tabs, Field, Button, Badge, Modal, cards, state blocks).
 *
 * Authorization is entirely server-side: every call re-checks the admin
 * role against the database. This page only renders what the API returns.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Skeleton, EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import * as adminApi from '../../lib/adminApi.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'applications', label: 'Applications' },
  { id: 'services', label: 'Services' },
  { id: 'users', label: 'Users' },
  { id: 'bookings', label: 'Bookings & Disputes' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'audit', label: 'Audit Log' },
];

const BOOKING_STATUS = {
  pending_payment: { label: 'Awaiting payment', variant: 'accent' },
  requested: { label: 'Requested', variant: 'neutral' },
  accepted: { label: 'Accepted', variant: 'brand' },
  in_progress: { label: 'In progress', variant: 'brand' },
  delivered: { label: 'Delivered', variant: 'accent' },
  completed: { label: 'Completed', variant: 'brand' },
  declined: { label: 'Declined', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  disputed: { label: 'DISPUTED', variant: 'accent' },
  refunded: { label: 'Refunded', variant: 'outline' },
};

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/* ================= overview ================= */

function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    adminApi.getStats().then(setStats).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message="We couldn't load platform stats." onRetry={load} />;
  if (!stats) return <Skeleton height="10rem" />;

  const items = [
    { label: 'Users', value: stats.users },
    { label: 'Professionals', value: stats.professionals },
    { label: 'Pending applications', value: stats.pendingApplications, alert: stats.pendingApplications > 0 },
    { label: 'Active services', value: stats.activeServices },
    { label: 'Bookings', value: stats.bookings },
    { label: 'Open disputes', value: stats.openDisputes, alert: stats.openDisputes > 0 },
    { label: 'Failed payouts', value: stats.failedPayouts, alert: stats.failedPayouts > 0 },
    { label: 'Dead jobs', value: stats.deadJobs, alert: stats.deadJobs > 0 },
  ];

  return (
    <div>
      <div className="grid-4">
        {items.map((s) => (
          <div key={s.label} className="card card--flat" style={{ padding: 'var(--space-5)' }}>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: s.alert ? 'var(--danger, #B3372A)' : 'var(--color-deep-forest)' }}>
              {s.value}
            </div>
            <div className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{s.label}</div>
          </div>
        ))}
      </div>
      <p className="trust-strip__note" style={{ marginTop: 'var(--space-6)' }}>
        Live operational counters. Items in red need attention.
      </p>
    </div>
  );
}

/* ================= applications ================= */

function ApplicationsTab() {
  const showToast = useToast();
  const [status, setStatus] = useState('under_review');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getApplications({ status: status || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  async function approve(id) {
    setBusy(true);
    try {
      await adminApi.approveApplication(id);
      showToast('Application approved — professional profile created.', 'success');
      load();
    } catch (err) {
      showToast(err.message ?? 'Approval failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await adminApi.rejectApplication(rejecting.id, reason.trim() || undefined);
      showToast('Application rejected.', 'success');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      showToast(err.message ?? 'Rejection failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ maxWidth: '16rem' }}>
        <Field label="Status filter">
          {(props) => (
            <select {...props} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="under_review">Under review</option>
              <option value="pending">Draft</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="">All</option>
            </select>
          )}
        </Field>
      </div>

      {error && <ErrorState message="We couldn't load applications." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && (
        <EmptyState title="Nothing here" message="No applications match this filter." />
      )}

      {data && data.items.map((a) => (
        <article key={a.id} className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '16rem' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Badge variant={a.status === 'approved' ? 'brand' : a.status === 'rejected' ? 'outline' : 'accent'}>{a.status}</Badge>
                <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{a.applicant} · {a.email}</span>
              </div>
              <h3 style={{ fontSize: 'var(--text-base)' }}>{a.title}</h3>
              {a.about && <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{a.about}</p>}
              {Array.isArray(a.skills) && a.skills.length > 0 && (
                <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                  Skills: {a.skills.join(', ')}
                </p>
              )}
              {a.rejectionReason && (
                <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                  Feedback: {a.rejectionReason}
                </p>
              )}
            </div>
            {a.status === 'under_review' && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => approve(a.id)}>Approve</Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejecting(a)}>Reject</Button>
              </div>
            )}
          </div>
        </article>
      ))}

      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title="Reject this application?">
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            The applicant stays a customer and can re-apply. Your feedback is shown to them.
          </p>
          <Field label="Feedback (optional)">
            {(props) => <textarea {...props} className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button variant="primary" disabled={busy} onClick={reject}>Reject Application</Button>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Back</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= services ================= */

function ServicesTab() {
  const showToast = useToast();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getServices({ status: status || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  async function moderate(fn, slug, msg) {
    setBusy(true);
    try {
      await fn(slug);
      showToast(msg, 'success');
      load();
    } catch (err) {
      showToast(err.message ?? 'Moderation failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ maxWidth: '16rem' }}>
        <Field label="Status filter">
          {(props) => (
            <select {...props} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          )}
        </Field>
      </div>

      {error && <ErrorState message="We couldn't load services." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && <EmptyState title="No services" message="No services match this filter." />}

      {data && data.items.map((s) => (
        <article key={s.id} className="card" style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '16rem' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <Badge variant={s.status === 'active' ? 'brand' : 'outline'}>{s.status}</Badge>
                <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>by {s.professional}</span>
              </div>
              <h3 style={{ fontSize: 'var(--text-base)' }}>{s.title}</h3>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{formatPrice(s.price)}</p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
              {s.status === 'active' && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => moderate(adminApi.pauseService, s.id, 'Service paused (removed from catalogue).')}>
                  Pause
                </Button>
              )}
              {s.status === 'paused' && (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => moderate(adminApi.unpauseService, s.id, 'Service reinstated.')}>
                  Unpause
                </Button>
              )}
              {s.status === 'active' && (
                <Button variant="ghost" size="sm" to={`/services/${s.id}`}>View</Button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ================= users ================= */

function UsersTab() {
  const showToast = useToast();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getUsers({ q: query || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [query]);
  useEffect(load, [load]);

  async function setUserStatus(fn, id, msg) {
    setBusy(true);
    try {
      await fn(id);
      showToast(msg, 'success');
      load();
    } catch (err) {
      showToast(err.message ?? 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
        style={{ display: 'flex', gap: 'var(--space-3)', maxWidth: '30rem' }}
      >
        <input
          className="input"
          type="search"
          placeholder="Search name or email…"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {error && <ErrorState message="We couldn't load users." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && <EmptyState title="No users found" message="Try a different search." />}

      {data && data.items.length > 0 && (
        <div className="earnings">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{u.email}</td>
                  <td><Badge variant={u.role === 'admin' ? 'brand' : u.role === 'professional' ? 'accent' : 'neutral'}>{u.role}</Badge></td>
                  <td><Badge variant={u.status === 'active' ? 'brand' : 'outline'}>{u.status}</Badge></td>
                  <td>
                    {u.role !== 'admin' && u.status !== 'suspended' && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setUserStatus(adminApi.suspendUser, u.id, 'User suspended — sessions revoked.')}>
                        Suspend
                      </Button>
                    )}
                    {u.status === 'suspended' && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setUserStatus(adminApi.reinstateUser, u.id, 'User reinstated.')}>
                        Reinstate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================= bookings & disputes ================= */

function BookingsTab() {
  const showToast = useToast();
  const [status, setStatus] = useState('disputed');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [resolving, setResolving] = useState(null); // { id, decision }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getBookings({ status: status || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  async function openDetail(id) {
    try {
      setDetail(await adminApi.getBooking(id));
    } catch (err) {
      showToast(err.message ?? 'Could not load booking.', 'error');
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      await adminApi.resolveDispute(resolving.id, resolving.decision, note);
      showToast(
        resolving.decision === 'release'
          ? 'Dispute resolved — funds released to the professional.'
          : 'Dispute resolved — customer refunded in full.',
        'success',
      );
      setResolving(null);
      setNote('');
      setDetail(null);
      load();
    } catch (err) {
      showToast(err.message ?? 'Resolution failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ maxWidth: '16rem' }}>
        <Field label="Status filter">
          {(props) => (
            <select {...props} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="disputed">Disputed</option>
              <option value="">All</option>
              {Object.keys(BOOKING_STATUS)
                .filter((s) => s !== 'disputed')
                .map((s) => (
                  <option key={s} value={s}>{BOOKING_STATUS[s].label}</option>
                ))}
            </select>
          )}
        </Field>
      </div>

      {error && <ErrorState message="We couldn't load bookings." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && (
        <EmptyState title="Nothing here" message={status === 'disputed' ? 'No open disputes — good news.' : 'No bookings match this filter.'} />
      )}

      {data && data.items.map((b) => {
        const meta = BOOKING_STATUS[b.status] ?? { label: b.status, variant: 'neutral' };
        return (
          <article key={b.id} className="card" style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '16rem' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{b.reference}</span>
                </div>
                <h3 style={{ fontSize: 'var(--text-base)' }}>{b.serviceTitle}</h3>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {b.customer} → {b.professional} · {fmtWhen(b.scheduledAt)} · {formatPrice(b.amount)}
                </p>
                {b.disputeReason && (
                  <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                    Dispute: “{b.disputeReason}”
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {b.status === 'disputed' && (
                  <>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => setResolving({ id: b.id, decision: 'release' })}>
                      Release Funds
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setResolving({ id: b.id, decision: 'refund' })}>
                      Refund Customer
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => openDetail(b.id)}>Timeline</Button>
              </div>
            </div>
          </article>
        );
      })}

      {/* timeline modal */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `Booking ${detail.reference}` : ''}>
        {detail && (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {detail.serviceTitle} · {formatPrice(detail.amount)} · {detail.customer} ({detail.customerEmail}) → {detail.professional}
            </p>
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              {detail.events.map((e, i) => (
                <div key={i} className="dash-row" style={{ fontSize: 'var(--text-sm)' }}>
                  <span>{e.event}</span>
                  <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{fmtWhen(e.at)}</span>
                </div>
              ))}
            </div>
            {detail.payments.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {detail.payments.map((p) => (
                  <div key={p.reference} className="dash-row" style={{ fontSize: 'var(--text-sm)' }}>
                    <span>Payment {p.reference}</span>
                    <span>{formatPrice(p.amount)} · {p.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* resolve modal */}
      <Modal
        open={Boolean(resolving)}
        onClose={() => setResolving(null)}
        title={resolving?.decision === 'release' ? 'Release funds to the professional?' : 'Refund the customer in full?'}
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {resolving?.decision === 'release'
              ? 'The booking completes and escrow is released to the professional (minus the platform fee). This is recorded in the audit log.'
              : 'The booking is marked refunded and the full amount is returned to the customer. This is recorded in the audit log.'}
          </p>
          <Field label="Resolution note (optional)">
            {(props) => <textarea {...props} className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button variant="primary" disabled={busy} onClick={resolve}>
              {resolving?.decision === 'release' ? 'Release Funds' : 'Refund Customer'}
            </Button>
            <Button variant="secondary" onClick={() => setResolving(null)}>Back</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= payouts ================= */

function PayoutsTab() {
  const showToast = useToast();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getPayouts({ status: status || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  async function retry(id) {
    setBusy(true);
    try {
      const res = await adminApi.retryPayout(id);
      showToast(`Payout retried — status: ${res.status}.`, 'success');
      load();
    } catch (err) {
      showToast(err.message ?? 'Retry failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ maxWidth: '16rem' }}>
        <Field label="Status filter">
          {(props) => (
            <select {...props} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="processing">Processing</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
            </select>
          )}
        </Field>
      </div>

      {error && <ErrorState message="We couldn't load payouts." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && <EmptyState title="No payouts" message="No payouts match this filter." />}

      {data && data.items.length > 0 && (
        <div className="earnings">
          <table>
            <thead>
              <tr><th>Reference</th><th>Professional</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{p.reference}</td>
                  <td>{p.professional}</td>
                  <td>{formatPrice(p.amount)}</td>
                  <td><Badge variant={p.status === 'paid' ? 'brand' : p.status === 'failed' ? 'accent' : 'neutral'}>{p.status}</Badge></td>
                  <td>
                    {p.status === 'failed' && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => retry(p.id)}>Retry</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================= audit log ================= */

function AuditTab() {
  const [entity, setEntity] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    adminApi.getAudit({ entity: entity || undefined, pageSize: 50 }).then(setData).catch(setError);
  }, [entity]);
  useEffect(load, [load]);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ maxWidth: '16rem' }}>
        <Field label="Entity filter">
          {(props) => (
            <select {...props} className="select" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All</option>
              <option value="professional_application">Applications</option>
              <option value="service">Services</option>
              <option value="user">Users</option>
              <option value="booking">Bookings</option>
              <option value="payout">Payouts</option>
              <option value="storage">Uploads</option>
            </select>
          )}
        </Field>
      </div>

      {error && <ErrorState message="We couldn't load the audit log." onRetry={load} />}
      {!error && !data && <Skeleton height="10rem" />}
      {data && data.items.length === 0 && <EmptyState title="No entries" message="No audit entries match this filter." />}

      {data && data.items.length > 0 && (
        <div className="earnings">
          <table>
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{fmtWhen(r.createdAt)}</td>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{r.actor}</td>
                  <td><Badge variant="neutral">{r.action}</Badge></td>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{r.entity}{r.entityId ? ` · ${r.entityId.slice(0, 8)}…` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="trust-strip__note" style={{ margin: 0 }}>
        Every admin mutation is recorded server-side. This log is read-only.
      </p>
    </div>
  );
}

/* ================= page ================= */

export default function AdminPage() {
  useDocumentMeta({
    title: 'Admin Console',
    description: 'Servix administration.',
  });

  const { user, initializing, authAvailable } = useAuth();
  const [tab, setTab] = useState('overview');

  if (!authAvailable) {
    return (
      <div className="page container container--narrow section">
        <EmptyState
          title="Admin console"
          message="Administration requires the live Servix API."
          action={<Button to="/" variant="secondary">Back to Home</Button>}
        />
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="page container section" aria-busy="true">
        <Skeleton height="2rem" width="40%" style={{ marginBottom: '1rem' }} />
        <Skeleton height="16rem" />
      </div>
    );
  }

  // The server is the authority; this only avoids a useless render.
  if (!user || user.role !== 'admin') {
    return (
      <div className="page container container--narrow section">
        <EmptyState
          title="Admin access required"
          message="Sign in with an administrator account to open the console. Access is verified by the server on every request."
          action={<Button to="/login" variant="primary">Sign In</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page container" style={{ paddingBlock: 'var(--space-10) var(--space-20)' }}>
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <span className="eyebrow">Servix operations</span>
        <h1 style={{ fontSize: 'var(--text-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          Admin Console
          <Badge variant="brand"><Icon name="shield" size={14} /> {user.email}</Badge>
        </h1>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Admin sections" />

      <div style={{ paddingTop: 'var(--space-8)' }}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'applications' && <ApplicationsTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'bookings' && <BookingsTab />}
        {tab === 'payouts' && <PayoutsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}

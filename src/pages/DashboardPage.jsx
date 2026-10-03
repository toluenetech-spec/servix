import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getAccountOverview, completeOnboarding } from '../lib/authApi.js';
import { getMyBookings, getProBookings } from '../lib/bookingApi.js';
import { getInsights, getProAnalytics, getUnreadCount } from '../lib/workspaceApi.js';
import { formatPrice } from '../lib/format.js';
import { LineChart, BarChart } from '../components/dashboard/Charts.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { Button } from '../components/ui/Button.jsx';
import { DashboardSkeleton, ListSkeleton, StatsSkeleton } from '../components/ui/States.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { useFeatures } from '../lib/useFeatures.js';
import './dashboard.css';
const applicationLabels = { pending: 'Draft', under_review: 'Under review', approved: 'Approved', rejected: 'Needs attention' };
export default function DashboardPage() {
  useDocumentMeta({ title: 'Your Dashboard', description: 'Your private Servix account overview.' });
  const { user, initializing, authAvailable } = useAuth();
  const { ai } = useFeatures();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [bookingsError, setBookingsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [retry, setRetry] = useState(0);
  const [extra, setExtra] = useState(null); // role-specific metrics from real records (insights or analytics)
  useEffect(() => {
    if (!overview || overview.kind === 'admin') return;
    let alive = true; setExtra(null);
    const load = overview.canManageServices ? getProAnalytics(30) : getInsights();
    Promise.all([load, getUnreadCount().catch(() => ({ unread: null }))]).then(([metrics, unread]) => { if (alive) setExtra({ metrics, unread: unread.unread }); }).catch(() => { if (alive) setExtra({ metrics: null, unread: null }); });
    return () => { alive = false; };
  }, [overview?.kind, overview?.canManageServices, retry]);
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  useEffect(() => {
    if (initializing || !user || !authAvailable) return;
    let alive = true; setError(''); setOverview(null); setBookings(null); setBookingsError(false);
    getAccountOverview().then(value => { if (alive) { setOverview(value); setOpen(value.needsChoice); } return (value.canManageServices ? getProBookings() : getMyBookings()).then(rows => { if (alive) setBookings(rows); }).catch(() => { if (alive) setBookingsError(true); }); }).catch(() => { if (alive) setError('We couldn’t load your dashboard. Please try again.'); });
    return () => { alive = false; };
  }, [user?.id, initializing, authAvailable, retry]);
  async function choose() {
    if (!choice || busy) return;
    setBusy(true); setError('');
    try {
      const result = await completeOnboarding(choice);
      setOverview(result); setOpen(false);
      if (result.kind === 'applicant') navigate('/professionals/apply');
    } catch { setError('Your choice could not be saved. Please try again.'); }
    finally { setBusy(false); }
  }
  if (initializing) return <DashboardSkeleton label="Loading your account…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!overview) return <div className="container section"><h1>Your dashboard</h1>{error ? <><p role="alert">{error}</p><Button onClick={() => setRetry(x => x + 1)}>Try again</Button></> : <DashboardSkeleton label="Loading your dashboard…" />}</div>;
  const kind = overview.kind;
  if (kind === 'admin') return <Navigate to="/admin" replace />;
  const primary = kind === 'admin' ? ['/admin', 'Open admin console'] : kind === 'professional' ? ['/pro', 'Open professional workspace'] : kind === 'applicant' ? ['/professionals/apply', 'Continue professional application'] : ['/dashboard/search', 'Find a professional'];
  return <div className="dashboard container">
    <header className="dashboard-hero"><div><span className="eyebrow">Your Servix dashboard</span><h1>Welcome back, {user.fullName.split(' ')[0]}.</h1><p>{kind === 'professional' ? 'Your work, clients and business—all in one place.' : kind === 'admin' ? 'Keep an eye on your platform and manage what needs attention.' : kind === 'applicant' ? 'Take the next step towards offering your services.' : 'Find the right help. Keep track of every booking.'}</p></div><Button to={primary[0]}>{primary[1]}</Button></header>
    {overview.needsChoice && <section className="dashboard-notice"><div><strong>How would you like to use Servix?</strong><p>Choose booking services or applying as a professional to finish your welcome setup.</p></div><Button onClick={() => setOpen(true)}>Choose my path</Button></section>}
    {!overview.emailVerified && <section className="dashboard-notice"><p>Verify your email to finish setting up your account.</p><Button to="/verify-email">Verify email</Button></section>}
    <div className="ws-stat-grid" aria-label="Booking overview">
      {[['Bookings', bookings?.length], ['In progress', bookings?.filter(b => ['accepted','in_progress','delivered'].includes(b.status)).length], ['Needs attention', bookings?.filter(b => b.status === (overview.canManageServices ? 'requested' : 'pending_payment')).length], ['Completed', bookings?.filter(b => b.status === 'completed').length]].map(([label,number]) => <div className="ws-stat" key={label}><span>{label}</span><strong>{bookingsError ? '—' : number ?? '…'}</strong><small>{overview.canManageServices ? 'From your loaded client bookings' : 'From your loaded bookings'}</small></div>)}
    </div>
    {overview.canManageServices ? <ProHighlights extra={extra} plan={overview.plan} /> : <CustomerHighlights extra={extra} />}
    <div className="dashboard-grid">
      <Link to={overview.canManageServices ? "/dashboard/work" : "/bookings"} className="dashboard-card"><span className="eyebrow">My bookings</span><h2>Your services, organised.</h2><p>Track requests, review progress and find your booking details.</p><span className="dashboard-arrow">View bookings →</span></Link>
      <Link to={kind === 'professional' ? (overview.plan === 'free' ? '/dashboard/plan' : '/dashboard/gigs') : '/professionals/apply'} className="dashboard-card"><span className="eyebrow">{kind === 'professional' ? (overview.plan === 'free' ? 'Your plan' : 'Professional space') : 'Professional space'}</span><h2>{kind === 'professional' ? (overview.plan === 'free' ? 'More room to grow.' : 'Make room for your next client.') : 'Share what you do best.'}</h2><p>{kind === 'professional' ? (overview.plan === 'free' ? 'More listings, proposals and AI tokens, advanced filters and detailed analytics from ₦5,000 a month — no auto-renewal.' : 'Manage services, bookings, earnings and your public profile.') : `Application: ${applicationLabels[overview.applicationStatus] || 'Not started'}. Approval is required before you can offer services.`}</p><span className="dashboard-arrow">{kind === 'professional' ? (overview.plan === 'free' ? 'See plans' : 'Open workspace') : 'View application'} →</span></Link>
      {ai && <Link to="/dashboard/ai" className="dashboard-card" data-testid="ai-dashboard-card"><span className="eyebrow">Servix AI</span><h2>{overview.canManageServices ? 'Find the work that fits you.' : 'Ask Servix anything.'}</h2><p>{overview.canManageServices ? 'Matching requests, a profile check-up, pricing guidance and an assistant — all grounded in real Servix data.' : 'Describe what you need, get budget guidance from real listings, and understand every step of a booking.'}</p><span className="dashboard-arrow">Open Servix AI →</span></Link>}
      <Link to="/dashboard/verification" className="dashboard-card"><span className="eyebrow">Account security</span><h2>Stay connected. Stay protected.</h2><p>{overview.emailVerified ? 'Email verified.' : 'Email verification needed.'} Manage Google/GitHub connections. Keep your authenticator, passkey and recovery codes private.</p><span className="dashboard-arrow">Manage sign-in →</span></Link>
    </div>
    <section className="dashboard-recent"><div className="dashboard-section-head"><h2>{overview.canManageServices ? "Recent client bookings" : "Recent bookings"}</h2><Link to={overview.canManageServices ? "/dashboard/work" : "/bookings"}>View all →</Link></div>
      {bookingsError ? <p role="alert">Your bookings could not be loaded. <button onClick={() => setRetry(x => x + 1)}>Try again</button></p> : !bookings ? <ListSkeleton rows={3} panel={false} label="Loading bookings…" /> : bookings.length === 0 ? <div className="dashboard-empty"><h3>{overview.canManageServices ? "Your next client starts here." : "Your first booking starts here."}</h3><p>{overview.canManageServices ? "Create and publish your services so customers can discover your work." : "Explore services and choose a professional when you’re ready."}</p><Button to={overview.canManageServices ? "/dashboard/gigs" : "/dashboard/search"} variant="secondary">{overview.canManageServices ? "Manage my gigs" : "Explore services"}</Button></div> : <div>{bookings.slice(0, 5).map(booking => <Link className="dashboard-booking" key={booking.id} to={`/bookings/${encodeURIComponent(booking.id)}`}><div><strong>{booking.serviceTitle}</strong><p>{booking.reference}</p></div><span>{booking.status.replaceAll('_', ' ')}</span></Link>)}</div>}
    </section>
    <div className="ws-card-grid" style={{marginTop:24}}>
      <section className="ws-mini-card"><span className="ws-chip">Conversations</span><h2>Keep the details together.</h2><p>Discuss a booking or start a private conversation with an accepted connection.</p><Link to="/dashboard/messages">Open messages →</Link></section>
      <section className="ws-mini-card"><span className="ws-chip">Your network</span><h2>Good work starts with people.</h2><p>Connect with professionals you want to work with. You decide which requests to accept.</p><Link to="/dashboard/network">Explore your network →</Link></section>
      <section className="ws-mini-card"><span className="ws-chip">{overview.canManageServices ? 'Earnings' : 'Payments'}</span><h2>{overview.canManageServices ? 'Every project, accounted for.' : 'Know where every payment stands.'}</h2><p>{overview.canManageServices ? 'Review your ledger-derived earnings and payout records in one place.' : 'Check payment references, refund records and booking details.'}</p><Link to={overview.canManageServices ? '/dashboard/earnings' : '/dashboard/payments'}>View financial records →</Link></section>
    </div>
    <p className="dashboard-help">Need a hand? <Link to="/contact">Contact support</Link>. Never share your password or verification codes.</p>
    <Modal open={open} onClose={close} title="How would you like to use Servix?">
      <p>Your sign-in checks are complete. Choose what you’d like to do next. You can still book services while applying as a professional.</p>
      <fieldset className="dashboard-choices" disabled={busy}><legend>Choose your account path</legend>
        <label><input type="radio" name="account-path" value="customer" checked={choice === 'customer'} onChange={() => setChoice('customer')} /><span><strong>Book services</strong><small>Find professionals and manage your bookings.</small></span></label>
        <label><input type="radio" name="account-path" value="professional" checked={choice === 'professional'} onChange={() => setChoice('professional')} /><span><strong>Apply as a professional</strong><small>Submit your details for review. This does not grant approval automatically.</small></span></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <Button block disabled={busy || !choice} onClick={choose}>{busy ? 'Saving your choice…' : 'Continue'}</Button>
    </Modal>
  </div>;
}

function ProHighlights({ extra, plan }) {
  const m = extra?.metrics; const t = m?.totals;
  return <section className="ws-panel" aria-label="Performance, last 30 days">
    <div className="ws-row" style={{ paddingTop: 0 }}><div><h2 style={{ marginBottom: 4 }}>Last 30 days</h2><p>Calculated from your own bookings, ledger and reviews.</p></div><div className="ws-actions"><Link className="btn btn--secondary" to="/dashboard/analytics">Full analytics</Link>{extra?.unread > 0 && <Link className="btn btn--secondary" to="/dashboard/notifications">{extra.unread} unread notification{extra.unread === 1 ? '' : 's'}</Link>}</div></div>
    {extra === null ? <div style={{ marginTop: 16 }}><StatsSkeleton label="Loading your metrics…" /></div> : !m ? <p className="ws-muted" role="alert">Your metrics could not be loaded right now.</p> : <>
      <div className="ws-stat-grid" style={{ marginTop: 16 }}><div className="ws-stat"><span>Earnings released</span><strong style={{ fontSize: 24 }}>{formatPrice(t.earnings)}</strong><small>Credited to payable balance</small></div><div className="ws-stat"><span>New bookings</span><strong>{t.bookings}</strong><small>{t.completed} completed</small></div><div className="ws-stat"><span>Response rate</span><strong>{t.responseRate === null ? '—' : `${t.responseRate}%`}</strong><small>{t.medianResponseHours === null ? 'No paid requests yet' : `Median ${t.medianResponseHours} h`}</small></div><div className="ws-stat"><span>Rating</span><strong>{t.reviewCount ? t.ratingAvg.toFixed(2) : '—'}</strong><small>{t.reviewCount} review{t.reviewCount === 1 ? '' : 's'} overall</small></div></div>
      {plan !== 'free' ? <LineChart data={m.series} y="earnings" label="Earnings released per day" money height={140} /> : <p className="ws-muted">Daily trends, status breakdowns and per-service performance are included from the <Link to="/dashboard/plan">Go plan</Link>.</p>}
    </>}
  </section>;
}
function CustomerHighlights({ extra }) {
  const m = extra?.metrics;
  return <section className="ws-panel" aria-label="Your activity">
    <div className="ws-row" style={{ paddingTop: 0 }}><div><h2 style={{ marginBottom: 4 }}>Your activity</h2><p>Spending and upcoming bookings from your real records.</p></div><div className="ws-actions"><Link className="btn btn--secondary" to="/dashboard/payments">Payments</Link>{extra?.unread > 0 && <Link className="btn btn--secondary" to="/dashboard/notifications">{extra.unread} unread notification{extra.unread === 1 ? '' : 's'}</Link>}</div></div>
    {extra === null ? <div style={{ marginTop: 16 }}><StatsSkeleton label="Loading your activity…" /></div> : !m ? <p className="ws-muted" role="alert">Your activity could not be loaded right now.</p> : <div className="ws-two-col" style={{ marginTop: 16 }}>
      <BarChart data={m.monthly} x="month" y="spent" label="Spent per month (captured payments)" money height={150} />
      <div><h3 style={{ fontSize: 14, marginBottom: 10 }}>Upcoming</h3>{!m.upcoming.length ? <p className="ws-muted">No upcoming bookings. <Link to="/dashboard/search">Find a professional</Link>.</p> : m.upcoming.map(b => <Link className="dashboard-booking" key={b.id} to={`/bookings/${b.id}`}><div><strong>{b.serviceTitle}</strong><p>{new Date(b.scheduledAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p></div><span>{b.status.replaceAll('_', ' ')}</span></Link>)}{m.pendingReviews > 0 && <p className="ws-muted" style={{ marginTop: 12 }}>You have {m.pendingReviews} completed booking{m.pendingReviews === 1 ? '' : 's'} waiting for a review. <Link to="/bookings">Leave a review</Link>.</p>}</div>
    </div>}
  </section>;
}

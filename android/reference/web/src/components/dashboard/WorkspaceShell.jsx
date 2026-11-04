import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { getAccountOverview } from '../../lib/authApi.js';
import { getNotifications, getUnreadCount, markNotificationsRead } from '../../lib/workspaceApi.js';
import { Logo } from '../brand/Logo.jsx';
import { Icon } from '../ui/Icon.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { DashboardSkeleton, ListSkeleton, Skeleton } from '../ui/States.jsx';
import { useFeatures } from '../../lib/useFeatures.js';
import { useEntitlements } from '../../lib/useEntitlements.js';
import { AiAssistantLauncher } from '../ai/AiAssistant.jsx';
import './workspace.css';
import './kyc.css';
const Context = createContext(null);
export const useWorkspace = () => useContext(Context);
export const NOTIFICATIONS_EVENT = 'servix:notifications-changed';

/* Navigation is role-aware: only sections the account can actually use are shown. */
function buildNavigation({ user, overview, features = {}, plan = {} }) {
  const admin = user.role === 'admin';
  const professional = Boolean(overview?.canManageServices);
  const onFreePlan = (plan.plan ?? overview?.plan ?? 'free') === 'free';
  const planLink = ['/dashboard/plan', onFreePlan ? 'Upgrade your plan' : `${plan.label ?? 'Your'} plan`, 'crown'];
  const teamLink = plan.organization || plan.can?.('team_workspace') ? [['/dashboard/team', 'Team workspace', 'users']] : [];
  if (admin) return [
    ['Platform', [
      ['/admin', 'Overview', 'grid', 'overview'],
      ['/admin?tab=analytics', 'Analytics & charts', 'bar-chart', 'analytics'],
      ['/admin?tab=applications', 'Applications', 'file', 'applications'],
      ['/admin?tab=users', 'Users', 'users', 'users'],
      ['/admin?tab=services', 'Services', 'layers', 'services'],
      ['/admin?tab=bookings', 'Bookings & disputes', 'calendar', 'bookings'],
      ['/admin?tab=requests', 'Requests & proposals', 'inbox', 'requests'],
      ['/admin?tab=trust', 'Trust & achievements', 'shield', 'trust'],
      ['/admin?tab=payouts', 'Payouts', 'wallet', 'payouts'],
      ['/admin?tab=subscriptions', 'Plan subscriptions', 'crown', 'subscriptions'],
      ['/admin?tab=plans', 'Plans & organisations', 'layers', 'plans'],
      ...(features.ai ? [['/dashboard/ai', 'Servix AI', 'sparkle']] : []),
      ['/admin?tab=ai', 'AI usage', 'sparkle', 'ai'],
      ['/admin?tab=notifications', 'Send notification', 'megaphone', 'notifications'],
      ['/admin?tab=audit', 'Audit log', 'shield', 'audit'],
    ]],
    ['Account', [
      ['/dashboard/notifications', 'My notifications', 'bell'],
      ['/dashboard/messages', 'Messages', 'mail'],
      ['/dashboard/settings', 'Settings', 'settings'],
    ]],
  ];
  if (professional) return [
    ['Business', [
      ['/dashboard', 'Overview', 'grid'],
      ['/dashboard/work', 'Client bookings', 'briefcase'],
      ...(features.requests ? [['/dashboard/proposals', 'Requests & proposals', 'inbox']] : []),
      ['/dashboard/gigs', 'My gigs', 'layers'],
      ['/dashboard/availability', 'Availability', 'calendar-check'],
      ['/dashboard/analytics', 'Analytics', 'bar-chart'],
      ...(features.ai ? [['/dashboard/ai', 'Servix AI', 'sparkle']] : []),
      ['/dashboard/reviews', 'Reviews', 'star'],
      ['/dashboard/earnings', 'Earnings & payouts', 'wallet'],
      ['/dashboard/profile', 'Profile & portfolio', 'user'],
    ]],
    ['Workspace', [
      ['/dashboard/messages', 'Messages', 'mail'],
      ['/dashboard/network', 'My network', 'users'],
      ['/dashboard/notifications', 'Notifications', 'bell'],
      ['/bookings', 'Bookings I made', 'calendar'],
      ...(features.requests ? [['/dashboard/requests', 'My requests', 'inbox']] : []),
      ['/dashboard/saved', 'Saved professionals', 'bookmark'],
      ['/dashboard/payments', 'Payments', 'credit-card'],
      ...teamLink,
    ]],
    ['Account', [
      planLink,
      ['/dashboard/identity', 'Identity verification', 'shield'],
      ['/dashboard/verification', 'Verification', 'shield'],
      ['/dashboard/settings', 'Settings', 'settings'],
    ]],
  ];
  return [
    ['Workspace', [
      ['/dashboard', 'Overview', 'grid'],
      ['/bookings', 'My bookings', 'calendar'],
      ...(features.requests ? [['/dashboard/requests', 'My requests', 'inbox']] : []),
      ...(features.ai ? [['/dashboard/ai', 'Servix AI', 'sparkle']] : []),
      ['/dashboard/saved', 'Saved professionals', 'bookmark'],
      ['/dashboard/messages', 'Messages', 'mail'],
      ['/dashboard/network', 'My network', 'users'],
      ['/dashboard/payments', 'Payments', 'credit-card'],
      ['/dashboard/notifications', 'Notifications', 'bell'],
      ...teamLink,
    ]],
    ['Account', [
      planLink,
      ['/professionals/apply', overview?.kind === 'applicant' ? 'My professional application' : 'Become a professional', 'briefcase'],
      ['/dashboard/identity', 'Identity verification', 'shield'],
      ['/dashboard/verification', 'Verification', 'shield'],
      ['/dashboard/settings', 'Settings', 'settings'],
    ]],
  ];
}

function isActive(to, location) {
  const [path, query] = to.split('?');
  if (location.pathname !== path && !(path !== '/dashboard' && path !== '/admin' && location.pathname.startsWith(`${path}/`))) return false;
  if (path === '/admin') { const tab = new URLSearchParams(location.search).get('tab') || 'overview'; return (new URLSearchParams(query).get('tab') || 'overview') === tab; }
  return true;
}

export function WorkspaceShell({ children }) {
  const { user, initializing, logout } = useAuth(); const navigate = useNavigate(); const location = useLocation(); const { pathname } = location;
  const features = useFeatures();
  const plan = useEntitlements();
  const [overview, setOverview] = useState(null); const [menu, setMenu] = useState(false); const [query, setQuery] = useState(''); const [signingOut, setSigningOut] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let alive = true; if (user) getAccountOverview().then(value => { if (alive) setOverview(value); }).catch(() => { if (alive) setOverview(null); }); return () => { alive = false; }; }, [user?.id, pathname]);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => { const close = e => { if (e.key === 'Escape') setMenu(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  if (initializing) return <div className="ws-layout"><aside className="ws-sidebar" aria-hidden="true"><Skeleton height="1.6rem" width="6rem" style={{ margin: '0 12px 30px' }} />{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height="2.4rem" style={{ marginBottom: 6, borderRadius: 7 }} />)}</aside><div className="ws-body"><header className="ws-topbar" aria-hidden="true"><Skeleton height="2rem" width="40%" /></header><main className="ws-content"><DashboardSkeleton label="Loading your workspace…" /></main></div></div>;
  if (!user) return <Navigate to="/login" replace />;
  const professional = overview?.canManageServices; const role = user.role === 'admin' ? 'Administrator' : professional ? (plan.plan !== 'free' ? `Servix ${plan.label} professional` : 'Professional') : overview?.kind === 'applicant' ? 'Professional applicant' : 'Customer';
  const sections = buildNavigation({ user, overview, features, plan });
  const kyc = user.role === 'admin' ? null : (overview?.kycStatus ?? user.kycStatus ?? null);
  return <Context.Provider value={{ overview, user, plan }}><div className="ws-layout">
    <a className="skip-link" href="#workspace-main">Skip to workspace</a>
    {menu && <button className="ws-menu-scrim" onClick={() => setMenu(false)} aria-label="Close navigation" />}
    <aside className={`ws-sidebar ${menu ? 'is-open' : ''}`} aria-label="Workspace navigation" id="workspace-navigation">
      <Link to="/dashboard" className="ws-logo"><Logo height={28} /></Link>
      <nav>{sections.map(([title, links]) => <div className="ws-nav-section" key={title}><div className="ws-space-label">{title.toUpperCase()} <span>●</span></div>{links.map(([to, label, icon]) => <Link to={to} key={to} className={isActive(to, location) ? 'active' : undefined} aria-current={isActive(to, location) ? 'page' : undefined}><Icon name={icon} size={18} /><span>{label}</span></Link>)}</div>)}</nav>
      <div className="ws-side-bottom"><Link to="/dashboard/search"><Icon name="search" size={17} />Explore marketplace</Link><Link to="/contact"><Icon name="help-circle" size={17} />Help & support</Link><button className="cookie-settings" onClick={() => window.dispatchEvent(new Event('servix:cookie-settings'))}>Cookie settings</button><div className="ws-person"><Avatar src={user.avatarUrl} name={user.fullName} /><div><strong>{user.fullName}</strong><small>{role}</small></div></div><button className="ws-signout" disabled={signingOut} onClick={async () => { setSigningOut(true); try { await logout(); navigate('/login'); } catch { setError('Could not sign out. Try again.'); } finally { setSigningOut(false); } }}>{signingOut ? 'Signing out…' : 'Sign out'}</button>{error && <p role="alert">{error}</p>}</div>
    </aside>
    <div className="ws-body"><header className="ws-topbar"><button className="ws-menu-toggle" aria-label="Open navigation" aria-expanded={menu} aria-controls="workspace-navigation" onClick={() => setMenu(!menu)}><Icon name="menu" /></button><form className="ws-search" role="search" onSubmit={e => { e.preventDefault(); navigate(`/dashboard/search?q=${encodeURIComponent(query.trim())}`); }}><Icon name="search" size={19} /><input aria-label="Search services and professionals" placeholder="Search services and professionals…" value={query} onChange={e => setQuery(e.target.value)} /><button type="submit">Search</button></form>{user.role !== 'admin' && (kyc === 'verified' ? <Link className="ws-top-security is-verified" to="/dashboard/identity" data-testid="kyc-verified-badge"><Icon name="check-circle" size={18} /><span>Identity verified</span></Link> : <Link className="ws-top-security" to="/dashboard/verification"><Icon name="shield" size={18} /><span>{overview?.emailVerified ? 'Email verified' : 'Account security'}</span></Link>)}<NotificationBell userId={user.id} /><Link to="/dashboard/settings" className="ws-avatar-link" aria-label="Account settings"><Avatar src={user.avatarUrl} name={user.fullName} /></Link></header><KycBanner status={kyc} pathname={pathname} /><main id="workspace-main" className="ws-content">{children}</main>{features.ai && pathname !== '/dashboard/ai' && <AiAssistantLauncher role={user.role === 'admin' ? 'admin' : professional ? 'professional' : 'customer'} />}<footer className="ws-footer"><span>© {new Date().getFullYear()} Servix</span><div><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/cookies">Cookies</Link></div></footer></div>
  </div></Context.Provider>;
}

/* Identity verification banner: pending → waiting notice; rejected → reason + re-submit link. Hidden on the identity page itself. */
function KycBanner({ status, pathname }) {
  if (pathname === '/dashboard/identity') return null;
  if (status === 'pending') return <div className="ws-kyc-banner is-pending" role="status" data-testid="kyc-banner"><Icon name="clock" size={16} /><span>Your identity verification is under review. This usually takes 12–24 hours.</span></div>;
  if (status === 'rejected') return <div className="ws-kyc-banner is-rejected" role="alert" data-testid="kyc-banner"><Icon name="alert" size={16} /><span>Verification failed. <Link to="/dashboard/identity">Click here to re-submit.</Link></span></div>;
  return null;
}

/* Bell: unread badge polled every 30s, latest items on open, mark-as-read on click. */
function NotificationBell({ userId }) {
  const [unread, setUnread] = useState(null); const [open, setOpen] = useState(false); const [items, setItems] = useState(null); const [failed, setFailed] = useState(false); const ref = useRef(null); const navigate = useNavigate(); const { pathname } = useLocation();
  const refreshCount = useCallback(() => { getUnreadCount().then(r => setUnread(r.unread)).catch(() => {}); }, []);
  useEffect(() => { refreshCount(); const timer = setInterval(() => { if (!document.hidden) refreshCount(); }, 30000); window.addEventListener(NOTIFICATIONS_EVENT, refreshCount); return () => { clearInterval(timer); window.removeEventListener(NOTIFICATIONS_EVENT, refreshCount); }; }, [userId, pathname, refreshCount]);
  useEffect(() => { if (!open) return; setItems(null); setFailed(false); getNotifications().then(r => { setItems(r.items.slice(0, 8)); setUnread(r.unread); }).catch(() => setFailed(true)); const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; const esc = e => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('mousedown', away); document.addEventListener('keydown', esc); return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); }; }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);
  async function openItem(item) { setOpen(false); if (!item.readAt) { try { const r = await markNotificationsRead([item.id]); setUnread(r.unread); window.dispatchEvent(new Event(NOTIFICATIONS_EVENT)); } catch { /* still navigate */ } } navigate(item.link || '/dashboard/notifications'); }
  async function readAll() { try { const r = await markNotificationsRead(); setUnread(r.unread); setItems(list => list?.map(i => ({ ...i, readAt: i.readAt || new Date().toISOString() }))); window.dispatchEvent(new Event(NOTIFICATIONS_EVENT)); } catch { setFailed(true); } }
  return <div className="ws-bell-wrap" ref={ref}>
    <button type="button" className="ws-bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}><Icon name="bell" size={20} />{unread > 0 && <span className="ws-bell-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</button>
    {open && <div className="ws-notif-pop" role="dialog" aria-label="Recent notifications">
      <div className="ws-notif-head"><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={readAll}>Mark all read</button>}</div>
      {failed ? <p className="ws-muted" role="alert">Notifications could not be loaded.</p> : items === null ? <ListSkeleton rows={3} avatar={false} panel={false} label="Loading notifications…" /> : items.length === 0 ? <p className="ws-muted">You're all caught up. Booking updates, messages and announcements will appear here.</p> : <ul>{items.map(item => <li key={item.id}><button type="button" className={item.readAt ? '' : 'is-unread'} onClick={() => openItem(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></button></li>)}</ul>}
      <Link to="/dashboard/notifications" className="ws-notif-all">View all notifications →</Link>
    </div>}
  </div>;
}

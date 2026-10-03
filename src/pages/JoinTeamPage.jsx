/**
 * /join-team?token=… — lands from the invitation email. Shows who invited you and to which team, then accepts.
 * Signed-out visitors are sent to sign in (or register with the invited email) and brought back here.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { previewTeamInvite, acceptTeamInvite } from '../lib/workspaceApi.js';
import { refreshEntitlements } from '../lib/useEntitlements.js';
import { Icon } from '../components/ui/Icon.jsx';
import { PageSkeleton } from '../components/ui/States.jsx';

export default function JoinTeamPage() {
  useDocumentMeta({ title: 'Join a team on Servix', description: 'Accept an invitation to a Servix team workspace.' });
  const { user, initializing } = useAuth(); const navigate = useNavigate();
  const [params] = useSearchParams(); const token = params.get('token') || '';
  const [preview, setPreview] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initializing || !user || !token) return; let alive = true;
    previewTeamInvite(token).then((p) => { if (alive) setPreview(p); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [user?.id, initializing, token]);
  async function accept() { setBusy(true); setError(''); try { await acceptTeamInvite(token); await refreshEntitlements(); navigate('/dashboard/team', { replace: true }); } catch (e) { setError(e.message); setBusy(false); } }
  const next = `/join-team?token=${encodeURIComponent(token)}`;
  return <div className="container section" style={{ maxWidth: 560 }}>
    <span className="eyebrow">TEAM INVITATION</span>
    <h1 style={{ margin: '8px 0 10px' }}>Join a team on Servix</h1>
    {!token ? <p className="ws-muted">This link is missing its invitation code. Ask the person who invited you to send it again.</p>
      : initializing ? <PageSkeleton variant="panel" label="Checking your invitation…" />
      : !user ? <div className="card" style={{ padding: 22, display: 'grid', gap: 12 }}><p>Sign in with the email address the invitation was sent to, then you can accept it.</p><div className="ws-actions"><Link className="btn btn--primary" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link><Link className="btn btn--secondary" to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></div></div>
      : error ? <div className="ws-alert" role="alert">{error}<div className="ws-actions" style={{ marginTop: 12 }}><Link className="btn btn--secondary" to="/dashboard">Go to my workspace</Link></div></div>
      : !preview ? <PageSkeleton variant="panel" label="Checking your invitation…" />
      : <div className="card" style={{ padding: 22, display: 'grid', gap: 12 }} data-testid="join-team-card">
        <p style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="users" size={20} /><span><strong>{preview.invitedBy}</strong> invited you to join <strong>{preview.team}</strong> as {preview.role === 'admin' ? 'an admin' : 'a member'}.</span></p>
        <p className="ws-muted">Invitation for {preview.email}, valid until {new Date(preview.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Joining shares the team's plan and Servix AI allowance with you; your own profile, bookings and earnings stay yours.</p>
        {preview.email && user.email && preview.email.toLowerCase() !== user.email.toLowerCase() && <div className="ws-alert" role="alert">You are signed in as {user.email}. This invitation was sent to {preview.email} — sign in with that account to accept it.</div>}
        <div className="ws-actions"><button className="btn btn--primary" disabled={busy} onClick={accept} data-testid="join-team-accept">{busy ? 'Joining…' : 'Accept and join'}</button><Link className="btn btn--ghost" to="/dashboard">Not now</Link></div>
      </div>}
  </div>;
}

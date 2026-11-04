/**
 * Team workspace (/dashboard/team) — Team and Enterprise plans. Owners/admins manage members, invitations,
 * roles and per-member AI caps and see the team dashboard (activity, AI usage by member, shared work).
 * Members see the roster and the pool, never the admin controls. The API refuses every admin action for
 * members regardless of what the UI shows.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useEntitlements, minPlanFor, refreshEntitlements } from '../../lib/useEntitlements.js';
import { getTeam, createTeam, renameTeam, inviteTeamMember, updateTeamMember, removeTeamMember, leaveTeam, getTeamActivity, getTeamAiUsage, getTeamWork, getTeamAudit } from '../../lib/workspaceApi.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { UsageMeter, UpgradeNotice, LimitChip } from '../../components/plans/PlanBits.jsx';
import { BarChart } from '../../components/dashboard/Charts.jsx';
import { formatPrice } from '../../lib/format.js';
import { useResource, PageHead, LoadState, Empty, dateLabel } from './shared.jsx';
import '../../components/plans/plans.css';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const when = (v) => new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function TeamPage() {
  useDocumentMeta({ title: 'Team workspace', description: 'Your Servix team: members, invitations, activity and AI usage.' });
  const ent = useEntitlements();
  const r = useResource(getTeam);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'members';
  const select = (k) => { const n = new URLSearchParams(params); n.set('tab', k); setParams(n, { replace: true }); };
  return <>
    <PageHead eyebrow="TEAM" title="Team workspace" description="Work as one account family: shared plan, pooled Servix AI tokens, a shared view of live proposals and requests, and a team dashboard." />
    <LoadState skeleton="panel" label="Loading your team…" resource={r}>{(data) => (
      !data.team ? <NoTeam data={data} ent={ent} reload={r.reload} />
        : <>
          <TeamHeader data={data} reload={r.reload} />
          <div className="ws-tabs" role="tablist">{[['members', 'Members'], ...(data.me.isAdmin ? [['dashboard', 'Dashboard'], ['ai', 'AI usage']] : []), ['work', 'Shared work'], ...(data.me.isAdmin && ent.can('org_audit_log') ? [['audit', 'Audit log']] : [])].map(([k, l]) => <button key={k} type="button" role="tab" aria-pressed={tab === k} aria-selected={tab === k} onClick={() => select(k)}>{l}</button>)}</div>
          {tab === 'members' && <Members data={data} reload={r.reload} />}
          {tab === 'dashboard' && data.me.isAdmin && <Dashboard />}
          {tab === 'ai' && data.me.isAdmin && <AiUsage data={data} />}
          {tab === 'work' && <SharedWork />}
          {tab === 'audit' && data.me.isAdmin && <Audit />}
        </>
    )}</LoadState>
  </>;
}

function NoTeam({ data, ent, reload }) {
  const toast = useToast(); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  const upgradeTo = minPlanFor(ent.entitlements, { feature: 'team_workspace' }) ?? 'team';
  if (!data.canCreate) return <section className="ws-panel"><Empty icon="users" title="Team workspaces are part of the Team plan" description="Invite colleagues, share one AI token pool, see everyone's live proposals and requests in one place, and get a team dashboard." /><UpgradeNotice title="Available on Team and above" body="Upgrade to Team (₦35,000 / month, 5 members) or talk to Servix about Enterprise." upgradeTo={upgradeTo} /></section>;
  async function create(e) { e.preventDefault(); setBusy(true); try { await createTeam(name.trim()); await refreshEntitlements(); toast('Your team workspace is ready.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); } }
  return <section className="ws-panel"><h2>Create your team workspace</h2><p className="ws-muted">You will be the owner. Members you invite share your plan and the team's Servix AI allowance; they keep their own profiles, bookings and earnings.</p><form className="ws-form" onSubmit={create}><label>Team name<input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required placeholder="e.g. Studio Ibadan" /></label><div className="ws-actions"><button className="btn btn--primary" disabled={busy || name.trim().length < 2} type="submit">{busy ? 'Creating…' : 'Create team'}</button></div></form></section>;
}

function TeamHeader({ data, reload }) {
  const toast = useToast(); const [editing, setEditing] = useState(false); const [name, setName] = useState(data.team.name); const [busy, setBusy] = useState(false);
  async function save(e) { e.preventDefault(); setBusy(true); try { await renameTeam(name.trim()); toast('Team renamed.', 'success'); setEditing(false); reload(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); } }
  const members = data.members.length; const pending = data.members.filter((m) => m.status === 'invited').length;
  return <>
    {!data.team.active && <div className="ws-alert" role="alert">The team's plan is not active right now, so shared tools pause until the owner renews. Nothing has been deleted.</div>}
    <div className="ws-stat-grid">
      <div className="ws-stat"><span>Team</span>{editing ? <form onSubmit={save} className="ws-actions" style={{ marginTop: 10 }}><input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} aria-label="Team name" style={{ border: '1px solid #d7dfd0', borderRadius: 6, padding: '7px 9px', fontSize: 13 }} /><button className="btn btn--primary" disabled={busy} type="submit">Save</button><button className="btn btn--ghost" type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <strong style={{ fontSize: 20 }} data-testid="team-name">{data.team.name}</strong>}<small>{data.team.planLabel} plan · you are {ROLE_LABEL[data.me.role].toLowerCase()}{data.me.role === 'owner' && !editing && <> · <button type="button" className="ai-link" onClick={() => setEditing(true)} style={{ fontSize: 10 }}>Rename</button></>}</small></div>
      <div className="ws-stat"><span>Members</span><strong>{members}{data.limits.members !== null && <small style={{ fontSize: 16 }}> / {data.limits.members}</small>}</strong><small>{pending ? `Including ${pending} pending invitation${pending === 1 ? '' : 's'} (they count towards the limit)` : 'Including you'}</small></div>
      <div className="ws-stat"><span>Team AI pool</span><strong>{data.ai?.allowed === null ? 'Custom' : `${Math.round(data.ai?.percent ?? 0)}%`}</strong><small>{data.ai?.used !== undefined ? `${Number(data.ai.used).toLocaleString('en-NG')} of ${data.ai.allowed === null ? 'unlimited' : Number(data.ai.allowed).toLocaleString('en-NG')} tokens used this month` : `${Number(data.ai.allowed ?? 0).toLocaleString('en-NG')} tokens shared by the team each month`}</small></div>
      <div className="ws-stat"><span>Your AI usage</span><strong>{data.myAi ? Number(data.myAi.used).toLocaleString('en-NG') : '—'}</strong><small>{data.myAi?.allowed !== null && data.myAi?.allowed !== undefined ? `Personal cap ${Number(data.myAi.allowed).toLocaleString('en-NG')} tokens / month` : 'Tokens this month, drawn from the team pool'}</small></div>
    </div>
  </>;
}

function Members({ data, reload }) {
  const toast = useToast(); const { user } = useAuth();
  const [email, setEmail] = useState(''); const [role, setRole] = useState('member'); const [busy, setBusy] = useState(''); const [planError, setPlanError] = useState(null); const [capFor, setCapFor] = useState(null); const [capValue, setCapValue] = useState('');
  const admin = data.me.isAdmin;
  async function invite(e) { e.preventDefault(); setBusy('invite'); setPlanError(null); try { await inviteTeamMember(email.trim(), role); toast(`Invitation sent to ${email.trim()}.`, 'success'); setEmail(''); reload(); } catch (err) { if (err.meta) setPlanError(err); else toast(err.message, 'error'); } finally { setBusy(''); } }
  async function act(label, fn, ok) { setBusy(label); try { await fn(); if (ok) toast(ok, 'success'); reload(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); } }
  async function saveCap(m) { const v = capValue.trim(); await act(`cap-${m.id}`, () => updateTeamMember(m.id, { aiTokenCap: v === '' ? null : Number(v) }), v === '' ? 'Personal cap removed.' : 'Personal AI cap saved.'); setCapFor(null); }
  const activeCount = data.members.length;
  return <>
    {admin && <section className="ws-panel"><h2>Invite a member <LimitChip used={activeCount} allowed={data.limits.members} unit="seats" /></h2><p className="ws-muted">They receive an email with a link that works for their Servix account only. Invitations expire after 7 days and count towards your member limit until accepted or cancelled.</p>
      {planError && <UpgradeNotice error={planError} onDismiss={() => setPlanError(null)} />}
      <form className="ws-form" style={{ maxWidth: 'none' }} onSubmit={invite}><div className="req-form-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 12, alignItems: 'end' }}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="colleague@company.com" /></label><label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></label><button className="btn btn--primary" disabled={busy === 'invite' || !email.trim()} type="submit">{busy === 'invite' ? 'Sending…' : 'Send invitation'}</button></div></form></section>}
    <section className="ws-panel"><h2>Members</h2><div className="team-members">{data.members.map((m) => {
      const isMe = m.userId === user?.id; const canEdit = admin && m.role !== 'owner' && !isMe;
      return <div className="team-member" key={m.id} data-testid={`team-member-${m.status}`}>
        <div><strong>{m.name}{isMe && <span className="ws-chip gray" style={{ marginLeft: 8 }}>You</span>}</strong><small>{ROLE_LABEL[m.role]}{m.email ? ` · ${m.email}` : ''}{m.professional ? ` · ${m.professional.title}` : ''}</small></div>
        <div><span className={`ws-chip ${m.status === 'active' ? '' : 'warn'}`}>{m.status === 'active' ? `Joined ${dateLabel(m.joinedAt || m.invitedAt)}` : `Invited ${dateLabel(m.invitedAt)}`}</span>{admin && m.status === 'active' && m.aiTokenCap !== null && m.aiTokenCap !== undefined && <small style={{ display: 'block', fontSize: 11, color: '#84917d', marginTop: 4 }}>AI cap {Number(m.aiTokenCap).toLocaleString('en-NG')} tokens / month</small>}</div>
        <div className="ws-actions">
          {canEdit && m.status === 'active' && data.me.role === 'owner' && <select aria-label={`Role for ${m.name}`} value={m.role} disabled={Boolean(busy)} onChange={(e) => act(`role-${m.id}`, () => updateTeamMember(m.id, { role: e.target.value }), 'Role updated.')}><option value="member">Member</option><option value="admin">Admin</option></select>}
          {canEdit && m.status === 'active' && (capFor === m.id ? <form onSubmit={(e) => { e.preventDefault(); saveCap(m); }} className="ws-actions"><input aria-label="Personal AI token cap" type="number" min={0} step={1000} placeholder="No cap" value={capValue} onChange={(e) => setCapValue(e.target.value)} /><button className="btn btn--primary" type="submit" disabled={Boolean(busy)}>Save</button><button className="btn btn--ghost" type="button" onClick={() => setCapFor(null)}>Cancel</button></form> : <button className="btn btn--secondary" type="button" onClick={() => { setCapFor(m.id); setCapValue(m.aiTokenCap ?? ''); }}>AI cap</button>)}
          {canEdit && <button className="btn btn--ghost" type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(m.status === 'active' ? `Remove ${m.name} from the team? Their own profile, bookings and data are untouched.` : 'Cancel this invitation?')) act(`remove-${m.id}`, () => removeTeamMember(m.id), m.status === 'active' ? 'Member removed.' : 'Invitation cancelled.'); }}>{m.status === 'active' ? 'Remove' : 'Cancel invite'}</button>}
          {isMe && m.role !== 'owner' && <button className="btn btn--ghost" type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Leave this team? You go back to your own plan immediately.')) act('leave', async () => { await leaveTeam(); await refreshEntitlements(); }, 'You left the team.'); }}>Leave team</button>}
        </div>
      </div>;
    })}</div></section>
    {!admin && <p className="ws-muted">Only the team owner and admins can invite, remove or change members. Ask them if you need a change.</p>}
  </>;
}

function Dashboard() {
  const [days, setDays] = useState(30);
  const r = useResource(() => getTeamActivity(days), [days]);
  return <LoadState skeleton="cards" label="Loading team dashboard…" resource={r}>{(d) => <>
    <div className="ws-actions" style={{ marginBottom: 14 }}>{[7, 30, 90].map((n) => <button key={n} type="button" className={`btn ${days === n ? 'btn--primary' : 'btn--secondary'}`} style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => setDays(n)}>{n} days</button>)}</div>
    <div className="ws-stat-grid"><div className="ws-stat"><span>Proposals sent</span><strong>{d.totals.proposalsSent}</strong><small>{d.totals.proposalsAccepted} accepted</small></div><div className="ws-stat"><span>Requests posted</span><strong>{d.totals.requestsPosted}</strong><small>By team members</small></div><div className="ws-stat"><span>Bookings</span><strong>{d.totals.bookings}</strong><small>Created in the period</small></div><div className="ws-stat"><span>Booking volume</span><strong style={{ fontSize: 22 }}>{formatPrice(d.totals.bookingVolume)}</strong><small>Gross, before fees</small></div></div>
    <section className="ws-panel"><h2>By member</h2><div className="ws-record-table"><table><thead><tr><th>MEMBER</th><th>ROLE</th><th>PROPOSALS</th><th>ACCEPTED</th><th>REQUESTS</th><th>BOOKINGS</th><th>VOLUME</th></tr></thead><tbody>{d.members.map((m) => <tr key={m.memberId}><td>{m.name}</td><td>{ROLE_LABEL[m.role]}</td><td>{m.proposalsSent}</td><td>{m.proposalsAccepted}</td><td>{m.requestsPosted}</td><td>{m.bookings}</td><td>{formatPrice(m.bookingVolume)}</td></tr>)}</tbody></table></div></section>
    <section className="ws-panel"><h2>Recent activity</h2>{d.activity.length === 0 ? <p className="ws-muted">No team activity in this period yet.</p> : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.activity.map((a) => <li key={a.id} className="ws-row"><div><h3 style={{ fontSize: 13 }}>{a.actor} · {a.action.replaceAll('.', ' › ').replaceAll('_', ' ')}</h3><p>{a.entity}{a.entityId ? ` · ${String(a.entityId).slice(0, 8)}` : ''}</p></div><small className="ws-muted">{when(a.at)}</small></li>)}</ul>}</section>
  </>}</LoadState>;
}

function AiUsage({ data }) {
  const r = useResource(getTeamAiUsage);
  return <LoadState skeleton="cards" label="Loading AI usage…" resource={r}>{(d) => <>
    <section className="ws-panel"><h2>Team AI pool</h2><UsageMeter meter={d.pool} label="Team AI tokens this month" />{d.pool.level !== 'ok' && <p className="ws-muted" style={{ marginTop: 10 }}>{d.pool.level === 'exhausted' ? 'The pool is used up — Servix AI pauses for everyone until the reset date. Everything else keeps working.' : 'The pool is running low. You can set personal caps below so one member cannot use everything.'}</p>}</section>
    {d.daily.length > 0 && <section className="ws-panel"><h2>Tokens per day</h2><BarChart data={d.daily} x="date" y="tokens" label="AI tokens" /></section>}
    <section className="ws-panel"><h2>By member</h2><div className="ws-record-table"><table><thead><tr><th>MEMBER</th><th>ROLE</th><th>REQUESTS</th><th>TOKENS</th><th>SHARE</th><th>PERSONAL CAP</th></tr></thead><tbody>{d.members.map((m) => <tr key={m.memberId}><td>{m.name}</td><td>{ROLE_LABEL[m.role] ?? m.role}</td><td>{m.requests}</td><td>{Number(m.tokens).toLocaleString('en-NG')}</td><td>{d.pool.used ? `${Math.round((m.tokens / d.pool.used) * 100)}%` : '—'}</td><td>{m.cap === null || m.cap === undefined ? 'None' : `${Number(m.capMeter?.used ?? 0).toLocaleString('en-NG')} / ${Number(m.cap).toLocaleString('en-NG')}`}</td></tr>)}</tbody></table></div><p className="ws-muted">Set or change a member's cap from the Members tab. Caps count tokens inside the pool; they never add to it.</p></section>
    <section className="ws-panel"><h2>By AI tool</h2><div className="ws-record-table"><table><thead><tr><th>TOOL</th><th>REQUESTS</th><th>TOKENS</th></tr></thead><tbody>{d.departments.map((x) => <tr key={x.department}><td>{x.department.replaceAll('_', ' ')}</td><td>{x.requests}</td><td>{Number(x.tokens).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div></section>
    {data.limits.aiTokens !== null && <p className="ws-muted">Need more than {Number(data.limits.aiTokens).toLocaleString('en-NG')} tokens a month? <Link to="/contact?topic=enterprise">Talk to Servix about Enterprise</Link>.</p>}
  </>}</LoadState>;
}

function SharedWork() {
  const r = useResource(getTeamWork);
  return <LoadState skeleton="cards" label="Loading shared work…" resource={r}>{(d) => <>
    <section className="ws-panel"><h2>Live proposals from the team</h2>{!d.proposals?.length ? <p className="ws-muted">No live proposals right now.</p> : <div className="ws-record-table"><table><thead><tr><th>MEMBER</th><th>REQUEST</th><th>PRICE</th><th>DELIVERY</th><th>SENT</th></tr></thead><tbody>{d.proposals.map((p) => <tr key={p.id}><td>{p.member}</td><td>{p.request?.title}<small>Request {p.request?.status}{p.label ? ` · ${p.label}` : ''}</small></td><td>{formatPrice(p.price)}</td><td>{p.deliveryDays} d</td><td>{dateLabel(p.createdAt)}</td></tr>)}</tbody></table></div>}</section>
    <section className="ws-panel"><h2>Open requests posted by the team</h2>{!d.requests?.length ? <p className="ws-muted">No open requests right now.</p> : <div className="ws-record-table"><table><thead><tr><th>MEMBER</th><th>REQUEST</th><th>NEEDED BY</th><th>PROPOSALS</th><th>POSTED</th></tr></thead><tbody>{d.requests.map((q) => <tr key={q.id}><td>{q.member}</td><td>{q.title}<small>{q.status}</small></td><td>{q.deadlineAt ? dateLabel(q.deadlineAt) : '—'}</td><td>{q.proposalCount}</td><td>{dateLabel(q.createdAt)}</td></tr>)}</tbody></table></div>}</section>
    <p className="ws-muted">This is a read-only view so the team can coordinate. Each member still edits their own proposals and requests.</p>
  </>}</LoadState>;
}

function Audit() {
  const r = useResource(getTeamAudit);
  const base = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1/team/audit?format=csv`;
  return <LoadState skeleton="panel" label="Loading audit log…" resource={r}>{(d) => <section className="ws-panel"><h2>Organisation audit log</h2><p className="ws-muted">Membership, role and plan changes, invitations, AI caps and admin actions. Enterprise organisations can export it as CSV (counts towards your monthly exports).</p><div className="ws-actions" style={{ marginBottom: 12 }}><ExportButton href={base} /></div>{!d.items?.length ? <p className="ws-muted">Nothing recorded yet.</p> : <div className="ws-record-table"><table><thead><tr><th>WHEN</th><th>WHO</th><th>ACTION</th><th>ENTITY</th></tr></thead><tbody>{d.items.map((e) => <tr key={e.id}><td>{when(e.at)}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.entity}{e.entityId ? ` · ${String(e.entityId).slice(0, 8)}` : ''}</td></tr>)}</tbody></table></div>}</section>}</LoadState>;
}

/** Downloads through authorizedFetch (the session lives in memory, not a cookie) and respects the export allowance. */
export function ExportButton({ href, label = 'Export CSV', filename }) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [planError, setPlanError] = useState(null);
  async function download() {
    setBusy(true); setPlanError(null);
    try {
      const { authorizedFetch } = await import('../../lib/authApi.js');
      const res = await authorizedFetch(href, { method: 'GET' });
      if (!res.ok) { const data = await res.json().catch(() => ({})); const e = new Error(data.error?.message || 'Export failed.'); e.meta = data.error?.meta; throw e; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || (res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? 'servix-export.csv'); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Export downloaded.', 'success');
    } catch (e) { if (e.meta) setPlanError(e); else toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return <>{planError && <UpgradeNotice error={planError} compact onDismiss={() => setPlanError(null)} />}<button type="button" className="btn btn--secondary" disabled={busy} onClick={download}><Icon name="upload" size={14} /> {busy ? 'Preparing…' : label}</button></>;
}

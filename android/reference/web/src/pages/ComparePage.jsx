/** Side-by-side comparison of up to 4 professionals — every cell is real data or "Not enough data". */
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { useFeatures } from '../lib/useFeatures.js';
import { compare as compareApi, NOT_ENOUGH } from '../lib/marketplaceApi.js';
import { removeCompare } from '../lib/compareStore.js';
import { formatPrice } from '../lib/format.js';
import { Breadcrumb } from '../components/ui/Breadcrumb.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { Skeleton, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { trustRows } from '../components/marketplace/TrustPanel.jsx';
import '../components/marketplace/marketplace.css';

const numeric = (v) => (typeof v === 'number' ? v : null);

export default function ComparePage() {
  useDocumentMeta({ title: 'Compare professionals', description: 'Compare Servix professionals side by side using real booking data.' });
  const [params, setParams] = useSearchParams();
  const { compare: enabled, ready } = useFeatures();
  const slugs = useMemo(() => (params.get('professionals') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4), [params]);
  const { data, loading, error, retry } = useFetch(() => (slugs.length ? compareApi({ professionals: slugs }) : Promise.resolve(null)), [slugs.join(',')]);

  function remove(slug) { removeCompare(slug); const next = slugs.filter((s) => s !== slug); setParams(next.length ? { professionals: next.join(',') } : {}); }

  if (ready && !enabled) return <div className="container section"><EmptyState title="Comparison is not available yet" message="This feature is switched off on Servix at the moment." action={<Button to="/professionals" variant="secondary">Browse professionals</Button>} /></div>;
  if (!slugs.length) return <div className="container section"><EmptyState title="Nothing to compare yet" message="Tick “Compare” on two to four professionals, then come back here." action={<Button to="/professionals" variant="primary">Find professionals</Button>} /></div>;

  const pros = data?.professionals ?? [];
  const best = (key, pick) => { const vals = pros.map((p) => numeric(pick(p))); const m = vals.filter((v) => v != null); if (m.length < 2) return -1; const target = key === 'price' ? Math.min(...m) : Math.max(...m); return vals.indexOf(target); };
  const rows = [
    { label: 'Headline', cell: (p) => <span>{p.title}<br /><small className="text-muted">{p.location}</small></span> },
    { label: 'Starting price', key: 'price', pick: (p) => p.startingPrice, cell: (p) => (p.startingPrice != null ? formatPrice(p.startingPrice) : <span className="is-empty">No active gigs</span>) },
    ...['rating', 'reliability', 'response', 'repeat', 'jobs', 'age'].map((k) => ({ label: labelFor(k), key: k, pick: (p) => pickFor(k, p.trust), cell: (p) => { const r = trustRows(p.trust).find((x) => x.key === k); return r ? (r.value === NOT_ENOUGH ? <span className="is-empty">{NOT_ENOUGH}</span> : <span>{r.value}<br /><small className="text-muted">{r.hint}</small></span>) : '—'; } })),
    { label: 'Verification', cell: (p) => <span>{p.verified ? <span className="badge badge--verified">Servix Verified</span> : <span className="is-empty">Not verified</span>}{p.identityVerified && <><br /><span className="badge badge--brand" style={{ marginTop: 4 }}>Identity verified</span></>}</span> },
    { label: 'Next availability', cell: (p) => { const a = p.availabilityNext; if (!a?.nextAvailableAt) return <span className="is-empty">No open slots in 14 days</span>; const when = a.availableToday ? 'Today' : a.availableTomorrow ? 'Tomorrow' : a.availableThisWeek ? 'This week' : 'Later'; return <span><span className="avail-chip">{when}</span><br /><small className="text-muted">{new Date(a.nextAvailableAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span>; } },
    { label: 'Achievements', cell: (p) => (p.achievements?.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{p.achievements.map((a) => <li key={a.slug} title={a.description}>{a.name}</li>)}</ul> : <span className="is-empty">None yet</span>) },
    { label: 'Skills', cell: (p) => (p.skills?.length ? p.skills.slice(0, 8).join(', ') : <span className="is-empty">Not listed</span>) },
    { label: 'Languages', cell: (p) => (p.languages?.length ? p.languages.join(', ') : <span className="is-empty">Not listed</span>) },
    { label: 'Services', cell: (p) => (p.services?.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{p.services.slice(0, 5).map((s) => <li key={s.id}><Link to={`/services/${encodeURIComponent(s.id)}`}>{s.title}</Link> — {formatPrice(s.price)}</li>)}</ul> : <span className="is-empty">No active gigs</span>) },
    { label: 'Verified projects', cell: (p) => { const n = p.portfolio?.filter((i) => i.verified).length ?? 0; return n ? `${n} Verified Servix Project${n === 1 ? '' : 's'}` : <span className="is-empty">None yet</span>; } },
  ];

  return (
    <div className="page container" style={{ paddingBottom: 'var(--space-20)' }}>
      <div style={{ paddingTop: 'var(--space-6)' }}><Breadcrumb items={[{ label: 'Home', to: '/' }, { label: 'Professionals', to: '/professionals' }, { label: 'Compare' }]} /></div>
      <header className="section-header" style={{ marginBottom: 'var(--space-6)' }}>
        <h1>Compare professionals</h1>
        <p className="text-muted">Everything below is calculated from real Servix activity. Where there isn’t enough history we say so rather than guess.</p>
      </header>
      {loading && <Skeleton height="22rem" />}
      {error && <ErrorState message="We couldn't load the comparison." onRetry={retry} />}
      {data && pros.length === 0 && <EmptyState title="No matching professionals" message="The profiles you picked may have been removed." action={<Button to="/professionals" variant="secondary">Browse professionals</Button>} />}
      {data && pros.length > 0 && (
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Attribute</span></th>
                {pros.map((p) => (
                  <th scope="col" key={p.id}>
                    <div className="compare-head">
                      {p.image ? <img src={p.image} alt="" /> : <span className="ws-avatar">{p.name.slice(0, 1)}</span>}
                      <strong>{p.name}</strong>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Link className="btn btn--primary btn--sm" to={`/professionals/${encodeURIComponent(p.id)}`}>View profile</Link>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(p.id)} aria-label={`Remove ${p.name} from comparison`}><Icon name="close" size={14} /> Remove</button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => { const b = row.key ? best(row.key, row.pick) : -1; return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {pros.map((p, i) => <td key={p.id} className={i === b ? 'is-best' : ''}>{row.cell(p)}</td>)}
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      {pros.length > 0 && pros.length < 4 && <p className="text-muted" style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>You can compare up to four. <Link to="/professionals">Add another professional</Link>.</p>}
    </div>
  );
}

function labelFor(k) { return { rating: 'Rating', reliability: 'Delivery reliability', response: 'Response rate', repeat: 'Repeat customers', jobs: 'Completed jobs', age: 'Time on Servix' }[k]; }
function pickFor(k, t) {
  if (!t) return null;
  switch (k) {
    case 'rating': return t.rating?.enough ? Number(t.rating.average) : null;
    case 'reliability': return t.reliability?.enough ? t.reliability.percent : null;
    case 'response': return t.responseRate?.enough ? t.responseRate.percent : null;
    case 'repeat': return t.repeatCustomers?.enough ? t.repeatCustomers.percent : null;
    case 'jobs': return t.completedJobs ?? null;
    case 'age': return t.accountAgeDays ?? null;
    default: return null;
  }
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getSaved, unsaveProfessional } from '../../lib/workspaceApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import { useResource, PageHead, LoadState, Empty, dateLabel } from './shared.jsx';
export default function SavedPage() {
  useDocumentMeta({ title: 'Saved professionals', description: 'Professionals you saved on Servix.' });
  const r = useResource(getSaved); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function remove(slug) { setBusy(slug); setError(''); try { await unsaveProfessional(slug); r.setData(list => list.filter(i => i.professional.slug !== slug)); } catch (e) { setError(e.message); } finally { setBusy(''); } }
  return <><PageHead title="Saved professionals" description="Shortlist people you want to work with. Saving is private — professionals are not told who saved them." /><LoadState skeleton="cards" label="Loading saved professionals…" resource={r}>
    {error && <div className="ws-alert" role="alert">{error}</div>}
    {!r.data?.length ? <section className="ws-panel"><Empty icon="bookmark" title="No saved professionals yet" description="Use the Save button on any professional's profile to keep them here for later." to="/dashboard/search" label="Browse professionals" /></section> :
      <div className="ws-pro-grid">{r.data.map(({ id, savedAt, professional: p }) => <article className="ws-pro-card" key={id}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="ws-avatar">{p.name.slice(0, 1)}</span>}
        <h3>{p.name}</h3><p>{p.title}{p.locationCity ? ` · ${p.locationCity}` : ''}</p>
        <p>{p.reviewCount ? `★ ${p.ratingAvg.toFixed(1)} (${p.reviewCount} reviews)` : 'No reviews yet'}{p.startingPrice != null ? ` · from ${formatPrice(p.startingPrice)}` : ''}</p>
        <p><span className={`ws-chip ${p.availability === 'available' ? '' : 'gray'}`}>{p.availability.replaceAll('_', ' ')}</span>{p.verification === 'verified' && <span className="ws-chip" style={{ marginLeft: 6 }}>Verified</span>}</p>
        <small className="ws-muted">Saved {dateLabel(savedAt)}</small>
        <div className="ws-actions"><Link className="btn btn--secondary" to={`/professionals/${encodeURIComponent(p.slug)}`}>View profile</Link><Link className="btn btn--secondary" to={`/dashboard/network?connect=${encodeURIComponent(p.slug)}`}>Connect</Link><button className="ws-muted" disabled={busy === p.slug} onClick={() => remove(p.slug)}>{busy === p.slug ? 'Removing…' : 'Remove'}</button></div>
      </article>)}</div>}
  </LoadState></>;
}

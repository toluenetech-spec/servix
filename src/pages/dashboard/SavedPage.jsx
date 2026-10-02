import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getSaved, unsaveProfessional } from '../../lib/workspaceApi.js';
import { updateSavedProfessional } from '../../lib/marketplaceApi.js';
import { Icon } from '../../components/ui/Icon.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { formatPrice } from '../../lib/format.js';
import { useResource, PageHead, LoadState, Empty, dateLabel } from './shared.jsx';
export default function SavedPage() {
  useDocumentMeta({ title: 'Saved professionals', description: 'Professionals you saved on Servix.' });
  const r = useResource(getSaved); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function remove(slug) { setBusy(slug); setError(''); try { await unsaveProfessional(slug); r.setData(list => list.filter(i => i.professional.slug !== slug)); } catch (e) { setError(e.message); } finally { setBusy(''); } }
  async function patch(slug, body) { setBusy(slug); setError(''); try { const row = await updateSavedProfessional(slug, body); r.setData(list => list.map(i => i.professional.slug === slug ? { ...i, preferred: row.preferred, note: row.note } : i)); } catch (e) { setError(e.message); } finally { setBusy(''); } }
  const [noteFor, setNoteFor] = useState(''); const [noteText, setNoteText] = useState('');
  const sorted = (r.data ?? []).slice().sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return <><PageHead title="Saved professionals" description="Shortlist people you want to work with. Saving and notes are private. Marking someone as preferred keeps them at the top and lets them know you would book again." /><LoadState skeleton="cards" label="Loading saved professionals…" resource={r}>
    {error && <div className="ws-alert" role="alert">{error}</div>}
    {!r.data?.length ? <section className="ws-panel"><Empty icon="bookmark" title="No saved professionals yet" description="Use the Save button on any professional's profile to keep them here for later." to="/dashboard/search" label="Browse professionals" /></section> :
      <div className="ws-pro-grid">{sorted.map(({ id, savedAt, preferred, note, professional: p }) => <article className="ws-pro-card" key={id} style={preferred ? { borderColor: '#4f8a5a' } : undefined}>
        {preferred && <span className="ws-chip" style={{ marginBottom: 8 }}><Icon name="star" size={11} /> Preferred</span>}
        {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="ws-avatar">{p.name.slice(0, 1)}</span>}
        <h3>{p.name}</h3><p>{p.title}{p.locationCity ? ` · ${p.locationCity}` : ''}</p>
        <p>{p.reviewCount ? `★ ${p.ratingAvg.toFixed(1)} (${p.reviewCount} reviews)` : 'No reviews yet'}{p.startingPrice != null ? ` · from ${formatPrice(p.startingPrice)}` : ''}</p>
        <p><span className={`ws-chip ${p.availability === 'available' ? '' : 'gray'}`}>{p.availability.replaceAll('_', ' ')}</span>{p.verification === 'verified' && <span className="ws-chip" style={{ marginLeft: 6 }}>Verified</span>}</p>
        <small className="ws-muted">Saved {dateLabel(savedAt)}</small>
        {noteFor === p.slug ? <form className="ws-form" style={{ gap: 8, marginTop: 8 }} onSubmit={e => { e.preventDefault(); patch(p.slug, { note: noteText }).then(() => setNoteFor('')); }}><label>Private note<textarea rows={2} maxLength={500} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Only you can see this." /></label><div className="ws-actions"><button className="btn btn--primary" type="submit" disabled={busy === p.slug}>Save note</button><button type="button" className="btn btn--ghost" onClick={() => setNoteFor('')}>Cancel</button></div></form>
          : note ? <p className="ws-muted" style={{ fontStyle: 'italic', marginTop: 6 }}>“{note}” <button className="ws-muted" style={{ textDecoration: 'underline' }} onClick={() => { setNoteFor(p.slug); setNoteText(note); }}>edit</button></p> : null}
        <div className="ws-actions"><Link className="btn btn--secondary" to={`/professionals/${encodeURIComponent(p.slug)}`}>View profile</Link><button className="btn btn--secondary" disabled={busy === p.slug} aria-pressed={Boolean(preferred)} onClick={() => patch(p.slug, { preferred: !preferred })}>{preferred ? 'Preferred ✓' : 'Mark preferred'}</button>{!note && noteFor !== p.slug && <button className="ws-muted" onClick={() => { setNoteFor(p.slug); setNoteText(''); }}>Add note</button>}<button className="ws-muted" disabled={busy === p.slug} onClick={() => remove(p.slug)}>{busy === p.slug ? 'Removing…' : 'Remove'}</button></div>
      </article>)}</div>}
  </LoadState></>;
}

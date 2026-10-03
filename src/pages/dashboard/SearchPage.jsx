import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getServices, getProfessionals } from '../../lib/httpApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useResource, PageHead, LoadState, Empty } from './shared.jsx';
import { formatPrice } from '../../lib/format.js';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Icon } from '../../components/ui/Icon.jsx';

const PAGE_SIZE = 12;

function ProfessionalCard({ item }) {
  return (
    <article className="ws-mini-card ws-result" key={item.id}>
      <div className="ws-result__head">
        <Link to={`/professionals/${encodeURIComponent(item.id)}`} className="ws-avatar-link" aria-label={`View ${item.name}'s profile`}>
          <Avatar src={item.image} name={item.name} size={56} />
        </Link>
        <div className="ws-result__who">
          <h2>
            <Link to={`/professionals/${encodeURIComponent(item.id)}`}>{item.name}</Link>
            {item.verified && <span className="ws-result__verified" title="Verified professional"><Icon name="check" size={12} /></span>}
          </h2>
          <strong>{item.title}</strong>
          {item.location && <p><Icon name="map-pin" size={12} /> {item.location}</p>}
        </div>
      </div>
      <div className="ws-result__meta">
        {item.reviewCount > 0 ? (
          <span><Icon name="star" size={12} /> {Number(item.rating).toFixed(1)} · {item.reviewCount} review{item.reviewCount === 1 ? '' : 's'}</span>
        ) : (
          <span className="ws-muted">New on Servix</span>
        )}
        {item.plan && ['pro', 'team', 'enterprise'].includes(item.plan) && <span className="ws-chip">Servix {item.plan === 'pro' ? 'Pro' : item.plan === 'team' ? 'Team' : 'Enterprise'}</span>}
        {item.availability === 'available' && <span className="ws-chip">Available</span>}
      </div>
      <div className="ws-actions">
        <Link className="btn btn--secondary" to={`/professionals/${encodeURIComponent(item.id)}`}>View profile ↗</Link>
        <Link className="btn btn--ghost" to={`/dashboard/network?profile=${encodeURIComponent(item.id)}`}>Connect →</Link>
      </div>
    </article>
  );
}

function ServiceCard({ item }) {
  return (
    <article className="ws-mini-card ws-result" key={item.id}>
      {item.image ? (
        <Link to={`/services/${encodeURIComponent(item.id)}`} className="ws-result__cover" tabIndex={-1} aria-hidden="true">
          <img src={item.image} alt="" loading="lazy" />
        </Link>
      ) : (
        <div className="ws-result__cover ws-result__cover--empty" aria-hidden="true"><Icon name="briefcase" size={22} /></div>
      )}
      <span className="ws-chip">{item.category || 'Service'}</span>
      <h2><Link to={`/services/${encodeURIComponent(item.id)}`}>{item.title}</Link></h2>
      {item.professional && (
        <div className="ws-result__by">
          <Avatar src={item.professional.image} name={item.professional.name} size={24} />
          <span>{item.professional.name}</span>
        </div>
      )}
      <p>{item.shortDescription || item.location || 'View details to explore this listing.'}</p>
      {typeof item.price === 'number' && <p className="ws-result__price">{formatPrice(item.price)} {item.priceUnit}</p>}
      <Link className="btn btn--secondary" to={`/services/${encodeURIComponent(item.id)}`}>View service ↗</Link>
    </article>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [input, setInput] = useState(q);
  const [kind, setKind] = useState('services');
  const [page, setPage] = useState(1);
  useDocumentMeta({ title: 'Search marketplace', description: 'Find services and professionals on Servix.' });
  const r = useResource(
    () => (kind === 'services' ? getServices({ q, page, pageSize: PAGE_SIZE }) : getProfessionals({ q, page, pageSize: PAGE_SIZE })),
    [q, kind, page],
  );
  const items = r.data?.items ?? [];

  return (
    <>
      <PageHead title="Find your next great fit" description="Search the live marketplace for services and professional expertise." />
      <form
        className="ws-input-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setParams(input.trim() ? { q: input.trim() } : {});
        }}
      >
        <input aria-label="Marketplace search" placeholder="Try design, development or home services…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn--primary">Search</button>
      </form>
      <div className="ws-tabs">
        {['services', 'professionals'].map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>
            {k === 'services' ? 'Services' : 'Professionals'}
          </button>
        ))}
      </div>
      <LoadState skeleton="cards" label="Searching…" resource={r}>
        {!items.length ? (
          <section className="ws-panel">
            <Empty title="No matches yet" description="Try a different keyword or broaden your search. No sample results are substituted." />
          </section>
        ) : (
          <div className="ws-card-grid">
            {items.map((item) => (kind === 'services' ? <ServiceCard key={item.id} item={item} /> : <ProfessionalCard key={item.id} item={item} />))}
          </div>
        )}
        <div className="ws-actions" style={{ marginTop: 24 }}>
          <button className="btn btn--secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="ws-muted">Page {page}</span>
          <button className="btn btn--secondary" disabled={items.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </LoadState>
    </>
  );
}

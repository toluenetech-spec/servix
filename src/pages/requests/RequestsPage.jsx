/** Customer: "My requests" — post what you need and let professionals propose. */
import { Link } from 'react-router-dom';
import { listMyRequests, REQUEST_STATUS } from '../../lib/marketplaceApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { formatPrice } from '../../lib/format.js';
import { Icon } from '../../components/ui/Icon.jsx';
import { useResource, PageHead, LoadState, Empty, dateLabel } from '../dashboard/shared.jsx';
import '../../components/marketplace/marketplace.css';

export function budgetLabel(r) {
  if (r.budgetMin == null && r.budgetMax == null) return 'Budget not set';
  if (r.budgetType === 'range' && r.budgetMin != null && r.budgetMax != null && r.budgetMin !== r.budgetMax) return `${formatPrice(r.budgetMin)} – ${formatPrice(r.budgetMax)}`;
  return formatPrice(r.budgetMax ?? r.budgetMin);
}

export function RequestCard({ r, to, extra }) {
  const st = REQUEST_STATUS[r.status] || { label: r.status, tone: 'gray' };
  return (
    <article className="req-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <h3><Link to={to}>{r.title}</Link></h3>
        <span className={`ws-chip ${st.tone}`}>{st.label}</span>
      </div>
      <p>{r.description ? (r.description.length > 160 ? `${r.description.slice(0, 160)}…` : r.description) : 'No description yet.'}</p>
      <div className="req-meta">
        <span><Icon name="wallet" size={13} /> {budgetLabel(r)}</span>
        <span><Icon name="layout" size={13} /> {r.category?.name}</span>
        {r.deadlineAt && <span><Icon name="calendar" size={13} /> Due {dateLabel(r.deadlineAt)}</span>}
        <span><Icon name={r.isRemote ? 'compass' : 'map-pin'} size={13} /> {r.isRemote ? 'Remote' : r.location || 'On-site'}</span>
        <span><Icon name="inbox" size={13} /> {r.proposalCount} proposal{r.proposalCount === 1 ? '' : 's'}</span>
      </div>
      {extra}
    </article>
  );
}

export default function RequestsPage() {
  useDocumentMeta({ title: 'My requests', description: 'Service requests you posted on Servix.' });
  const { requests, ready } = useFeatures();
  const r = useResource(listMyRequests);
  if (ready && !requests) return <><PageHead title="Service requests" description="Posting requests is not switched on yet." /><section className="ws-panel"><Empty icon="inbox" title="Coming soon" description="Posting a request and receiving proposals will be available shortly. In the meantime you can book any professional directly." to="/services" label="Browse services" /></section></>;
  return <>
    <PageHead title="My requests" description="Describe what you need, set a budget, and let professionals come to you with proposals. You choose who to work with — payment only happens when you accept one.">
      <Link className="btn btn--primary" to="/dashboard/requests/new">Post a request</Link>
    </PageHead>
    <LoadState skeleton="cards" label="Loading your requests…" resource={r}>{(data) => (
      !data.items.length
        ? <section className="ws-panel"><Empty icon="inbox" title="No requests yet" description="Post a request when you know what you need but not who should do it. Professionals send proposals with a price and timeline, and you pick the best fit." to="/dashboard/requests/new" label="Post your first request" /></section>
        : <div className="req-grid">{data.items.map((item) => <RequestCard key={item.id} r={item} to={`/dashboard/requests/${item.id}`} extra={<small className="ws-muted">Updated {dateLabel(item.updatedAt)}</small>} />)}</div>
    )}</LoadState>
  </>;
}

import { Link } from 'react-router-dom';
import { getProReviews } from '../../lib/workspaceApi.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { HBars } from '../../components/dashboard/Charts.jsx';
import { useResource, PageHead, LoadState, Empty, dateLabel } from './shared.jsx';
export default function ReviewsPage() {
  useDocumentMeta({ title: 'Reviews', description: 'Reviews customers left for your work on Servix.' });
  const r = useResource(getProReviews); const rows = r.data ?? []; const avg = rows.length ? rows.reduce((s, x) => s + x.rating, 0) / rows.length : 0;
  return <><PageHead title="Reviews" description="Reviews are written by customers after a completed booking. They cannot be edited or removed by professionals." /><LoadState skeleton="list" label="Loading reviews…" resource={r}>{() => <>
    <div className="ws-stat-grid"><div className="ws-stat"><span>Average rating</span><strong>{rows.length ? avg.toFixed(2) : '—'}</strong><small>Across {rows.length} review{rows.length === 1 ? '' : 's'}</small></div><div className="ws-stat"><span>5-star reviews</span><strong>{rows.filter(x => x.rating === 5).length}</strong><small>{rows.length ? `${Math.round(rows.filter(x => x.rating === 5).length / rows.length * 100)}% of all reviews` : 'No reviews yet'}</small></div><div className="ws-stat"><span>Latest review</span><strong style={{ fontSize: 22 }}>{rows[0] ? dateLabel(rows[0].reviewedAt) : '—'}</strong><small>{rows[0] ? `${rows[0].rating} stars from ${rows[0].author}` : 'Complete bookings to receive reviews'}</small></div><div className="ws-stat"><span>Unpublished</span><strong>{rows.filter(x => !x.isPublished).length}</strong><small>Hidden by Servix moderation</small></div></div>
    <div className="ws-two-col">
      <section className="ws-panel"><h2>All reviews</h2>{!rows.length ? <Empty icon="star" title="No reviews yet" description="When a customer confirms a completed booking they can leave a review. It appears here and on your public profile." to="/dashboard/work" label="View client bookings" /> : rows.map(x => <article className="ws-review" key={x.id}><header><span><strong>{x.author}</strong> · {x.service?.title}</span><span className="stars" aria-label={`${x.rating} out of 5 stars`}>{'★'.repeat(x.rating)}{'☆'.repeat(5 - x.rating)}</span></header><p>{x.text || <em className="ws-muted">No written comment.</em>}</p><small>{dateLabel(x.reviewedAt)}{x.booking && <> · <Link to={`/bookings/${x.booking.id}`}>{x.booking.reference}</Link></>}{!x.isPublished && ' · Not published'}</small></article>)}</section>
      <section className="ws-panel"><HBars label="Rating breakdown" items={[5, 4, 3, 2, 1].map(s => ({ label: `${s} star${s === 1 ? '' : 's'}`, value: rows.filter(x => x.rating === s).length }))} /><p className="ws-muted" style={{ marginTop: 16 }}>Think a review breaks the rules? <Link to="/contact">Report it to support</Link> with the booking reference.</p></section>
    </div>
  </>}</LoadState></>;
}

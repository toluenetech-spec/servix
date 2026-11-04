/**
 * Trust & Performance — shows only what the server computed from real
 * bookings, events and reviews. Anything under the minimum sample says
 * "Not enough data" instead of a number. Formulas: api/docs/TRUST.md.
 */
import { Icon } from '../ui/Icon.jsx';
import { NOT_ENOUGH } from '../../lib/marketplaceApi.js';
import './marketplace.css';

const pct = (v) => (v == null ? NOT_ENOUGH : `${v}%`);

export function trustRows(t) {
  if (!t) return [];
  return [
    { key: 'reliability', label: 'Delivery reliability', value: t.reliability?.enough ? pct(t.reliability.percent) : NOT_ENOUGH, hint: t.reliability?.enough ? `Based on ${t.reliability.measurable} deliveries with an agreed deadline` : `Shown after ${t.reliability?.minimum ?? 5} deliveries with an agreed deadline`, icon: 'check-circle' },
    { key: 'response', label: 'Response rate', value: t.responseRate?.enough ? pct(t.responseRate.percent) : NOT_ENOUGH, hint: t.responseRate?.enough ? (t.responseRate.medianHours != null ? `Median ${t.responseRate.medianHours} h to accept or decline` : 'Replies to paid requests') : `Shown after ${t.responseRate?.minimum ?? 5} paid requests`, icon: 'clock' },
    { key: 'repeat', label: 'Repeat customers', value: t.repeatCustomers?.enough ? pct(t.repeatCustomers.percent) : NOT_ENOUGH, hint: t.repeatCustomers?.enough ? `Of ${t.repeatCustomers.customers} customers, this share booked again` : `Shown after ${t.repeatCustomers?.minimum ?? 5} customers`, icon: 'users' },
    { key: 'rating', label: 'Rating', value: t.rating?.enough ? `${Number(t.rating.average).toFixed(1)} / 5` : NOT_ENOUGH, hint: t.rating?.enough ? `${t.rating.count} published reviews` : `Shown after ${t.rating?.minimum ?? 3} reviews`, icon: 'star' },
    { key: 'jobs', label: 'Completed jobs', value: String(t.completedJobs ?? 0), hint: `${t.verifiedProjects ?? 0} shown as Verified Servix Projects`, icon: 'briefcase' },
    { key: 'age', label: 'On Servix', value: ageLabel(t.accountAgeDays), hint: t.identityVerified ? 'Identity verified' : 'Identity not verified yet', icon: 'calendar' },
  ];
}

function ageLabel(days) {
  if (days == null) return '—';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'}`;
  const y = Math.floor(days / 365); return `${y} year${y === 1 ? '' : 's'}`;
}

export function TrustPanel({ trust, compact = false, title = 'Trust & performance' }) {
  if (!trust) return null;
  const rows = trustRows(trust);
  return (
    <section className={`trust-panel${compact ? ' trust-panel--compact' : ''}`} aria-labelledby="trust-h">
      <div className="trust-panel__head">
        <h2 id="trust-h">{title}</h2>
        <p>Calculated from real Servix bookings and reviews — nothing is self-reported.</p>
      </div>
      <div className="trust-panel__badges">
        {trust.servixVerified && <span className="badge badge--verified"><Icon name="shield" size={13} /> Servix Verified</span>}
        {trust.identityVerified && <span className="badge badge--brand"><Icon name="check" size={13} /> Identity verified</span>}
      </div>
      <dl className="trust-grid">
        {rows.map((r) => (
          <div className={`trust-grid__item${r.value === NOT_ENOUGH ? ' is-empty' : ''}`} key={r.key}>
            <dt><Icon name={r.icon} size={14} /> {r.label}</dt>
            <dd>{r.value}</dd>
            <small>{r.hint}</small>
          </div>
        ))}
      </dl>
      {!!trust.achievements?.length && <Achievements items={trust.achievements} />}
    </section>
  );
}

export function Achievements({ items, catalog, title = 'Achievements' }) {
  const list = items ?? [];
  if (!list.length && !catalog) return null;
  return (
    <div className="achievements">
      <h3>{title}</h3>
      <ul className="achievements__list">
        {list.map((a) => (
          <li className="achievement" key={a.slug} title={a.description}>
            <span className="achievement__icon" aria-hidden="true"><Icon name={a.icon || 'star'} size={16} /></span>
            <span><strong>{a.name}</strong><small>{a.description}</small></span>
          </li>
        ))}
        {catalog?.filter((c) => !list.some((a) => a.slug === c.slug)).map((c) => (
          <li className="achievement achievement--locked" key={c.slug}>
            <span className="achievement__icon" aria-hidden="true"><Icon name="lock" size={14} /></span>
            <span><strong>{c.name}</strong><small>{c.description}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VerifiedProjectBadge({ item }) {
  if (!item?.verified) return null;
  return <span className="badge badge--verified" title="Completed through a paid Servix booking"><Icon name="shield" size={12} /> Verified Servix Project</span>;
}

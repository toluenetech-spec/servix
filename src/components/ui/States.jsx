import { Icon } from './Icon.jsx';
import { Button } from './Button.jsx';

/** Loading skeleton block. */
export function Skeleton({ height = '1rem', width = '100%', style, className = '' }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ height, width, ...style }}
      aria-hidden="true"
    />
  );
}

/** Skeleton mimic of a card grid while listings load. */
export function CardGridSkeleton({ count = 6, kind = 'service' }) {
  return (
    <div className="results-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" style={{ padding: kind === 'pro' ? '1.25rem' : 0 }}>
          {kind === 'service' && <Skeleton height="10rem" style={{ borderRadius: 0 }} />}
          <div style={{ padding: kind === 'service' ? '1.25rem' : 0, display: 'grid', gap: '0.6rem' }}>
            {kind === 'pro' && (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <Skeleton height="4rem" width="4rem" style={{ borderRadius: '999px', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'grid', gap: '0.5rem' }}>
                  <Skeleton height="0.9rem" width="60%" />
                  <Skeleton height="0.75rem" width="40%" />
                </div>
              </div>
            )}
            <Skeleton height="0.8rem" width="35%" />
            <Skeleton height="1rem" width="85%" />
            <Skeleton height="0.8rem" width="55%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page-level skeletons. Every variant announces itself once to screen  */
/* readers (role="status") and hides the decorative blocks (aria-hidden). */
/* ------------------------------------------------------------------ */

function Wrap({ label, children, className = '', style }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className} style={style}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** A few lines of text with varied widths. */
export function SkeletonText({ lines = 3, widths = ['90%', '70%', '50%'], gap = '0.6rem', height = '0.8rem' }) {
  return (
    <div style={{ display: 'grid', gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} height={height} width={widths[i % widths.length]} />)}
    </div>
  );
}

/** Four KPI tiles (dashboard / analytics / admin overview). */
export function StatsSkeleton({ count = 4, label = 'Loading figures…' }) {
  return (
    <Wrap label={label}>
      <div className="ws-stat-grid">
        {Array.from({ length: count }, (_, i) => (
          <div className="ws-stat" key={i}>
            <Skeleton height="0.7rem" width="55%" />
            <Skeleton height="1.8rem" width="45%" style={{ margin: '14px 0 8px' }} />
            <Skeleton height="0.6rem" width="65%" />
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/** A white panel with a heading bar and a few rows (settings, verification…). */
export function PanelSkeleton({ rows = 3, heading = true, label = 'Loading…', style }) {
  return (
    <Wrap label={label} className="ws-panel" style={style}>
      {heading && <Skeleton height="1.1rem" width="35%" style={{ marginBottom: '1.2rem' }} />}
      {Array.from({ length: rows }, (_, i) => (
        <div className="ws-row" key={i}>
          <div style={{ flex: 1, display: 'grid', gap: '0.5rem' }}>
            <Skeleton height="0.9rem" width={`${55 - (i % 3) * 10}%`} />
            <Skeleton height="0.7rem" width={`${80 - (i % 2) * 20}%`} />
          </div>
          <Skeleton height="2rem" width="6rem" style={{ borderRadius: '999px' }} />
        </div>
      ))}
    </Wrap>
  );
}

/** Rows with an avatar, two lines and a status chip (notifications, reviews, network). */
export function ListSkeleton({ rows = 5, avatar = true, label = 'Loading list…', panel = true }) {
  const body = Array.from({ length: rows }, (_, i) => (
    <div className="ws-row" key={i}>
      {avatar && <Skeleton height="2.6rem" width="2.6rem" style={{ borderRadius: '999px', flexShrink: 0 }} />}
      <div style={{ flex: 1, display: 'grid', gap: '0.5rem' }}>
        <Skeleton height="0.9rem" width={`${45 + (i % 3) * 12}%`} />
        <Skeleton height="0.7rem" width={`${70 + (i % 2) * 15}%`} />
      </div>
      <Skeleton height="1.4rem" width="4.5rem" style={{ borderRadius: '999px' }} />
    </div>
  ));
  return <Wrap label={label} className={panel ? 'ws-panel' : ''}>{body}</Wrap>;
}

/** A data table (payments, admin lists, earnings). */
export function TableSkeleton({ rows = 6, cols = 4, label = 'Loading records…', panel = true }) {
  return (
    <Wrap label={label} className={panel ? 'ws-panel' : ''}>
      <div className="ws-record-table">
        <table>
          <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}><Skeleton height="0.6rem" width="60%" /></th>)}</tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><Skeleton height="0.8rem" width={c === 0 ? '85%' : `${45 + ((r + c) % 3) * 15}%`} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Wrap>
  );
}

/** Label + input pairs (availability, profile editors, onboarding steps). */
export function FormSkeleton({ fields = 4, label = 'Loading form…', panel = true, button = true }) {
  return (
    <Wrap label={label} className={panel ? 'ws-panel' : ''}>
      <div className="ws-form">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} style={{ display: 'grid', gap: '0.5rem' }}>
            <Skeleton height="0.7rem" width={`${25 + (i % 3) * 10}%`} />
            <Skeleton height={i % 4 === 3 ? '6rem' : '2.8rem'} />
          </div>
        ))}
        {button && <Skeleton height="2.6rem" width="9rem" style={{ borderRadius: '7px' }} />}
      </div>
    </Wrap>
  );
}

/** Three info cards (plan, saved professionals, verification, search). */
export function CardsSkeleton({ count = 3, label = 'Loading…', tall = false }) {
  return (
    <Wrap label={label}>
      <div className="ws-card-grid">
        {Array.from({ length: count }, (_, i) => (
          <div className="ws-mini-card" key={i}>
            <Skeleton height="1.3rem" width="5rem" style={{ borderRadius: '999px' }} />
            <Skeleton height="1.1rem" width="70%" style={{ margin: '16px 0 10px' }} />
            <SkeletonText lines={tall ? 4 : 2} />
            <Skeleton height="0.8rem" width="40%" style={{ marginTop: '1rem' }} />
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/** Conversation list + message pane. */
export function ChatSkeleton({ label = 'Loading conversations…' }) {
  return (
    <Wrap label={label}>
      <div className="ws-two-col">
        <div className="ws-panel" style={{ marginBottom: 0 }}>
          <Skeleton height="2.6rem" style={{ marginBottom: '1rem' }} />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: i % 2 ? 0 : 'auto' }}>
              <Skeleton height="2.2rem" width={`${40 + (i % 3) * 15}%`} style={{ borderRadius: 14, marginBottom: '0.8rem', marginLeft: i % 2 ? 'auto' : 0 }} />
            </div>
          ))}
        </div>
        <div className="ws-panel" style={{ marginBottom: 0 }}>
          <ListSkeleton rows={4} panel={false} label="" />
        </div>
      </div>
    </Wrap>
  );
}

/** Hero block + stats + cards — the workspace overview. */
export function DashboardSkeleton({ label = 'Loading your dashboard…' }) {
  return (
    <Wrap label={label} className="container section">
      <Skeleton height="7rem" style={{ borderRadius: 13, marginBottom: '1.5rem' }} />
      <StatsSkeleton label="" />
      <PanelSkeleton rows={2} label="" />
      <CardsSkeleton label="" />
    </Wrap>
  );
}

/** Page heading + panel; used by workspace pages that have no better match. */
export function PageSkeleton({ variant = 'panel', label = 'Loading…', ...rest }) {
  switch (variant) {
    case 'stats': return <><StatsSkeleton label={label} /><TableSkeleton rows={4} panel label="" /></>;
    case 'table': return <TableSkeleton label={label} {...rest} />;
    case 'list': return <ListSkeleton label={label} {...rest} />;
    case 'form': return <FormSkeleton label={label} {...rest} />;
    case 'cards': return <CardsSkeleton label={label} {...rest} />;
    case 'chat': return <ChatSkeleton label={label} />;
    case 'dashboard': return <DashboardSkeleton label={label} />;
    case 'detail': return (
      <Wrap label={label}>
        <Skeleton height="1rem" width="30%" style={{ marginBottom: '0.8rem' }} />
        <Skeleton height="2rem" width="60%" style={{ marginBottom: '1.5rem' }} />
        <div className="ws-two-col"><PanelSkeleton rows={4} label="" /><PanelSkeleton rows={2} heading={false} label="" /></div>
      </Wrap>
    );
    default: return <PanelSkeleton label={label} {...rest} />;
  }
}

/** Empty state — e.g. "No services found." */
export function EmptyState({ title, message, action }) {
  return (
    <div className="state-block">
      <div className="state-block__icon">
        <Icon name="search" size={22} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Error state with retry. */
export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="state-block" role="alert">
      <div className="state-block__icon">
        <Icon name="alert" size={22} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

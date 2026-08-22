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

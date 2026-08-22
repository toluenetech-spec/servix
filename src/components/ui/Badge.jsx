import { Icon } from './Icon.jsx';

export function Badge({ variant = 'neutral', children }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

/** Verification indicator used on professional cards and profiles. */
export function VerifiedBadge({ compact = false }) {
  if (compact) {
    return (
      <span className="verified" title="Verified professional">
        <Icon name="shield" size={15} label="Verified professional" />
      </span>
    );
  }
  return (
    <span className="verified">
      <Icon name="shield" size={15} />
      Verified
    </span>
  );
}

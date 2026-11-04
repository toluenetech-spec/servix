import { Icon } from './Icon.jsx';
import { formatRating } from '../../lib/format.js';

/** Compact star rating with value and optional review count. */
export function Rating({ value, count, showCount = true }) {
  return (
    <span className="rating">
      <Icon name="star" size={15} className="rating__star" strokeWidth={0} />
      <span className="rating__value">{formatRating(value)}</span>
      {showCount && count != null && (
        <span className="rating__count">({count} reviews)</span>
      )}
      <span className="sr-only">Rated {formatRating(value)} out of 5</span>
    </span>
  );
}

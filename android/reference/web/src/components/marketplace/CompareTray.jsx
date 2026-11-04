/** Floating tray listing professionals picked for comparison (max 4). Hidden when the compare flag is off or the tray is empty. */
import { Link } from 'react-router-dom';
import { useCompare, clearCompare, toggleCompare, COMPARE_MAX } from '../../lib/compareStore.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { Icon } from '../ui/Icon.jsx';
import './marketplace.css';

export function CompareTray() {
  const list = useCompare();
  const { compare } = useFeatures();
  if (!compare || list.length === 0) return null;
  return (
    <div className="compare-tray" role="region" aria-label="Compare professionals">
      <span className="compare-tray__names">{list.length} of {COMPARE_MAX} selected</span>
      <Link className="btn btn--on-dark" to={`/compare?professionals=${list.map(encodeURIComponent).join(',')}`} aria-disabled={list.length < 2}>
        Compare{list.length < 2 ? ' (pick 2+)' : ''}
      </Link>
      <button type="button" className="compare-tray__clear" onClick={clearCompare} aria-label="Clear comparison"><Icon name="close" size={14} /></button>
    </div>
  );
}

/** Checkbox used on cards and profiles. `slug` is the professional slug. */
export function CompareToggle({ slug, name, onFull }) {
  const list = useCompare();
  const { compare } = useFeatures();
  if (!compare || !slug) return null;
  const checked = list.includes(slug);
  return (
    <label className="compare-toggle" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={() => { const r = toggleCompare(slug); if (r.full && onFull) onFull(); }} aria-label={`Add ${name || slug} to comparison`} />
      Compare
    </label>
  );
}

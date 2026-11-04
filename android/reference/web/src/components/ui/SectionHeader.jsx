import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';

/**
 * Consistent section heading block.
 * layout: "left" (default) | "center" | "row" (heading left, link right)
 */
export function SectionHeader({ eyebrow, title, description, layout = 'left', link }) {
  const cls = [
    'section-header',
    layout === 'center' && 'section-header--center',
    layout === 'row' && 'section-header--row',
  ]
    .filter(Boolean)
    .join(' ');

  const heading = (
    <div style={layout === 'row' ? { maxWidth: '40rem' } : undefined}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );

  if (layout === 'row') {
    return (
      <div className={cls}>
        {heading}
        {link && (
          <Link to={link.to} className="section-header__link">
            {link.label} <Icon name="arrow-right" size={16} />
          </Link>
        )}
      </div>
    );
  }

  return <div className={cls}>{heading}</div>;
}

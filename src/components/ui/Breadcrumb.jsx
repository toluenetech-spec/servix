import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * Breadcrumb navigation.
 * items: [{ label, to }] — the last item is the current page.
 */
export function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={item.label}>
              <li>
                {isLast || !item.to ? (
                  <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
                ) : (
                  <Link to={item.to}>{item.label}</Link>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="breadcrumb__sep">
                  /
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

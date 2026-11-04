import { Icon } from './Icon.jsx';

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="pagination__btn"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={16} />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className="pagination__btn"
          aria-current={p === page ? 'page' : undefined}
          aria-label={`Page ${p}`}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        className="pagination__btn"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  );
}

import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';

/** Service category discovery card. */
export function CategoryCard({ category }) {
  return (
    <Link
      to={`/services?category=${category.id}`}
      className="category-card"
      aria-label={`Browse ${category.name} services`}
    >
      <span className="category-card__icon">
        <Icon name={category.icon} size={20} />
      </span>
      <h3 className="category-card__name">{category.name}</h3>
      <p className="category-card__desc">{category.description}</p>
      <span className="category-card__meta">
        <span>{category.serviceCount} services</span>
        <Icon name="arrow-right" size={16} className="category-card__arrow" />
      </span>
    </Link>
  );
}

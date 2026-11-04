import { Link } from 'react-router-dom';
import { Rating } from '../ui/Rating.jsx';
import { formatPrice } from '../../lib/format.js';
import { categories } from '../../data/categories.js';
import { professionals } from '../../data/professionals.js';

/** Marketplace service card. */
export function ServiceCard({ service }) {
  const category = categories.find((c) => c.id === service.categoryId);
  const pro = professionals.find((p) => p.id === service.professionalId);

  return (
    <article className="card card--interactive service-card">
      <Link
        to={`/services/${service.id}`}
        aria-label={`${service.title} — from ${formatPrice(service.price)}`}
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <div className="service-card__media">
          <img src={service.image} alt="" loading="lazy" width="640" height="400" />
        </div>
        <div className="service-card__body">
          <span className="service-card__category">{category?.name}</span>
          <h3 className="service-card__title">{service.title}</h3>
          {pro && <p className="service-card__pro">by {pro.name}</p>}
          <Rating value={service.rating} count={service.reviewCount} />
          <div className="service-card__foot">
            <span className="service-card__price">
              From <strong>{formatPrice(service.price)}</strong>
            </span>
            <span className="section-header__link" aria-hidden="true">
              View
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

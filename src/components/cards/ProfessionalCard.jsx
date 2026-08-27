import { Link } from 'react-router-dom';
import { Rating } from '../ui/Rating.jsx';
import { VerifiedBadge } from '../ui/Badge.jsx';
import { Icon } from '../ui/Icon.jsx';
import { formatPrice } from '../../lib/format.js';

/** Professional directory card. */
export function ProfessionalCard({ professional: pro }) {
  return (
    <article className="card card--interactive pro-card">
      <Link
        to={`/professionals/${pro.id}`}
        aria-label={`View profile of ${pro.name}, ${pro.title}`}
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <div className="pro-card__top">
          <img
            className="pro-card__avatar"
            src={pro.image}
            alt=""
            loading="lazy"
            width="64"
            height="64"
          />
          <div>
            <h3 className="pro-card__name">
              {pro.name}
              {pro.verified && <VerifiedBadge compact />}
            </h3>
            <p className="pro-card__title">{pro.title}</p>
          </div>
        </div>
        <div className="pro-card__body">
          <div className="pro-card__meta">
            <span className="pro-card__meta-item">
              <Icon name="map-pin" size={14} />
              {pro.location}
            </span>
            <Rating value={pro.rating} count={pro.reviewCount} />
          </div>
          <div className="pro-card__foot">
            <span className="pro-card__price">
              Starting at <strong>{formatPrice(pro.startingPrice)}</strong>
            </span>
            <span className="section-header__link" aria-hidden="true">
              View profile <Icon name="arrow-right" size={14} />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

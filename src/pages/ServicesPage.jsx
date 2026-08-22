import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { Drawer } from '../components/ui/Drawer.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ServiceCard } from '../components/cards/ServiceCard.jsx';
import { CardGridSkeleton, EmptyState, ErrorState } from '../components/ui/States.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { getServices } from '../lib/api.js';
import { categories } from '../data/categories.js';

const PAGE_SIZE = 6;

const PRICE_RANGES = [
  { id: 'all', label: 'Any price', min: null, max: null },
  { id: 'under-150', label: 'Under ₦150,000', min: null, max: 150000 },
  { id: '150-300', label: '₦150,000 – ₦300,000', min: 150000, max: 300000 },
  { id: '300-500', label: '₦300,000 – ₦500,000', min: 300000, max: 500000 },
  { id: 'over-500', label: 'Over ₦500,000', min: 500000, max: null },
];

const RATING_OPTIONS = [
  { id: 'all', label: 'Any rating', value: null },
  { id: '4.5', label: '4.5 and above', value: 4.5 },
  { id: '4.8', label: '4.8 and above', value: 4.8 },
];

const AVAILABILITY_OPTIONS = [
  { id: 'all', label: 'Any availability', value: '' },
  { id: 'available', label: 'Available now', value: 'available' },
  { id: 'limited', label: 'Limited availability', value: 'limited' },
];

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'rating', label: 'Highest rated' },
  { id: 'reviews', label: 'Most reviewed' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
];

function FilterGroups({ filters, setFilter }) {
  return (
    <>
      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Category</legend>
        <label className="filters__option">
          <input
            type="radio"
            name="category"
            checked={!filters.category}
            onChange={() => setFilter('category', '')}
          />
          All categories
        </label>
        {categories.map((cat) => (
          <label className="filters__option" key={cat.id}>
            <input
              type="radio"
              name="category"
              checked={filters.category === cat.id}
              onChange={() => setFilter('category', cat.id)}
            />
            {cat.name}
          </label>
        ))}
      </fieldset>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Price</legend>
        {PRICE_RANGES.map((range) => (
          <label className="filters__option" key={range.id}>
            <input
              type="radio"
              name="price"
              checked={filters.price === range.id}
              onChange={() => setFilter('price', range.id)}
            />
            {range.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Rating</legend>
        {RATING_OPTIONS.map((opt) => (
          <label className="filters__option" key={opt.id}>
            <input
              type="radio"
              name="rating"
              checked={filters.rating === opt.id}
              onChange={() => setFilter('rating', opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <div className="filters__group">
        <label className="filters__legend" htmlFor="filter-location">
          Location
        </label>
        <input
          id="filter-location"
          className="input"
          type="text"
          placeholder="e.g. Lagos or Remote"
          value={filters.location}
          onChange={(e) => setFilter('location', e.target.value)}
        />
      </div>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Availability</legend>
        {AVAILABILITY_OPTIONS.map((opt) => (
          <label className="filters__option" key={opt.id}>
            <input
              type="radio"
              name="availability"
              checked={filters.availability === opt.id}
              onChange={() => setFilter('availability', opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export default function ServicesPage() {
  useDocumentMeta({
    title: 'Browse Services',
    description:
      'Discover professional services on Servix — web development, design, photography, marketing, writing, consulting and more.',
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);

  const filters = {
    q: searchParams.get('q') || '',
    category: searchParams.get('category') || '',
    price: searchParams.get('price') || 'all',
    rating: searchParams.get('rating') || 'all',
    location: searchParams.get('location') || '',
    availability: searchParams.get('availability') || 'all',
    sort: searchParams.get('sort') || 'recommended',
  };

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  function clearFilters() {
    const next = new URLSearchParams();
    if (filters.q) next.set('q', filters.q);
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  const priceRange = PRICE_RANGES.find((r) => r.id === filters.price) || PRICE_RANGES[0];
  const ratingOpt = RATING_OPTIONS.find((r) => r.id === filters.rating) || RATING_OPTIONS[0];
  const availOpt =
    AVAILABILITY_OPTIONS.find((a) => a.id === filters.availability) || AVAILABILITY_OPTIONS[0];

  const queryKey = JSON.stringify(filters);
  const { data, loading, error, retry } = useFetch(
    () =>
      getServices({
        query: filters.q || undefined,
        category: filters.category || undefined,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        minRating: ratingOpt.value,
        location: filters.location || undefined,
        availability: availOpt.value || undefined,
        sort: filters.sort,
      }),
    [queryKey]
  );

  const activeFilterCount = [
    filters.category,
    filters.price !== 'all',
    filters.rating !== 'all',
    filters.location,
    filters.availability !== 'all',
  ].filter(Boolean).length;

  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero">
          <span className="eyebrow">Services</span>
          <h1>Browse professional services</h1>
          <p className="page-hero__desc">
            Compare services across {categories.length} categories. All listings
            shown are demonstration content for the pre-launch platform.
          </p>
        </header>

        <div className="toolbar" role="search">
          <div className="input-wrap">
            <span className="input-wrap__icon">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              className="input"
              placeholder="Search services…"
              aria-label="Search services"
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            className="filters-toggle"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open filters${activeFilterCount ? ` (${activeFilterCount} active)` : ''}`}
          >
            <Icon name="filter" size={16} />
            Filters
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Button>
        </div>

        <div className="marketplace">
          <aside className="filters filters--sidebar" aria-label="Service filters">
            <FilterGroups filters={filters} setFilter={setFilter} />
            {activeFilterCount > 0 && (
              <button className="filters__clear" onClick={clearFilters}>
                Clear all filters
              </button>
            )}
          </aside>

          <div>
            <div className="results-head">
              <p className="results-head__count" aria-live="polite">
                {loading ? 'Loading services…' : `${items.length} service${items.length === 1 ? '' : 's'} found`}
              </p>
              <div className="results-head__controls">
                <label className="sr-only" htmlFor="sort-services">
                  Sort services
                </label>
                <select
                  id="sort-services"
                  className="select"
                  value={filters.sort}
                  onChange={(e) => setFilter('sort', e.target.value)}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading && <CardGridSkeleton count={6} />}

            {error && (
              <ErrorState
                message="We couldn't load the services. Please try again."
                onRetry={retry}
              />
            )}

            {!loading && !error && items.length === 0 && (
              <EmptyState
                title="No services found"
                message="Try adjusting your search or clearing some filters."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            )}

            {!loading && !error && pageItems.length > 0 && (
              <>
                <div className="results-grid">
                  {pageItems.map((service) => (
                    <ServiceCard key={service.id} service={service} />
                  ))}
                </div>
                <div style={{ marginTop: 'var(--space-10)' }}>
                  <Pagination page={page} totalPages={totalPages} onChange={setPage} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        footer={
          <>
            <Button variant="secondary" onClick={clearFilters}>
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setDrawerOpen(false)}>
              Show results
            </Button>
          </>
        }
      >
        <div className="filters">
          <FilterGroups filters={filters} setFilter={setFilter} />
        </div>
      </Drawer>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { Drawer } from '../components/ui/Drawer.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ProfessionalCard } from '../components/cards/ProfessionalCard.jsx';
import { CardGridSkeleton, EmptyState, ErrorState } from '../components/ui/States.jsx';
import { useFetch } from '../lib/useFetch.js';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { getProfessionals } from '../lib/api.js';
import { categories } from '../data/categories.js';

const PAGE_SIZE = 6;

const RATING_OPTIONS = [
  { id: 'all', label: 'Any rating', value: null },
  { id: '4.8', label: '4.8 and above', value: 4.8 },
  { id: '4.5', label: '4.5 and above', value: 4.5 },
];

const PRICE_OPTIONS = [
  { id: 'all', label: 'Any starting price', value: null },
  { id: '150', label: 'Up to ₦150,000', value: 150000 },
  { id: '250', label: 'Up to ₦250,000', value: 250000 },
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
  { id: 'price-asc', label: 'Starting price: low to high' },
  { id: 'price-desc', label: 'Starting price: high to low' },
];

function FilterGroups({ filters, setFilter }) {
  return (
    <>
      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Category</legend>
        <label className="filters__option">
          <input
            type="radio"
            name="pro-category"
            checked={!filters.category}
            onChange={() => setFilter('category', '')}
          />
          All categories
        </label>
        {categories.map((cat) => (
          <label className="filters__option" key={cat.id}>
            <input
              type="radio"
              name="pro-category"
              checked={filters.category === cat.id}
              onChange={() => setFilter('category', cat.id)}
            />
            {cat.name}
          </label>
        ))}
      </fieldset>

      <div className="filters__group">
        <label className="filters__legend" htmlFor="pro-location">
          Location
        </label>
        <input
          id="pro-location"
          className="input"
          type="text"
          placeholder="e.g. Lagos"
          value={filters.location}
          onChange={(e) => setFilter('location', e.target.value)}
        />
      </div>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Rating</legend>
        {RATING_OPTIONS.map((opt) => (
          <label className="filters__option" key={opt.id}>
            <input
              type="radio"
              name="pro-rating"
              checked={filters.rating === opt.id}
              onChange={() => setFilter('rating', opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Starting price</legend>
        {PRICE_OPTIONS.map((opt) => (
          <label className="filters__option" key={opt.id}>
            <input
              type="radio"
              name="pro-price"
              checked={filters.price === opt.id}
              onChange={() => setFilter('price', opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="filters__group" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="filters__legend">Availability</legend>
        {AVAILABILITY_OPTIONS.map((opt) => (
          <label className="filters__option" key={opt.id}>
            <input
              type="radio"
              name="pro-availability"
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

export default function ProfessionalsPage() {
  useDocumentMeta({
    title: 'Find Professionals',
    description:
      'Browse the Servix professional directory — verified developers, designers, photographers, marketers, writers and consultants.',
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);

  const filters = {
    q: searchParams.get('q') || '',
    category: searchParams.get('category') || '',
    location: searchParams.get('location') || '',
    rating: searchParams.get('rating') || 'all',
    price: searchParams.get('price') || 'all',
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

  const ratingOpt = RATING_OPTIONS.find((r) => r.id === filters.rating) || RATING_OPTIONS[0];
  const priceOpt = PRICE_OPTIONS.find((p) => p.id === filters.price) || PRICE_OPTIONS[0];
  const availOpt =
    AVAILABILITY_OPTIONS.find((a) => a.id === filters.availability) || AVAILABILITY_OPTIONS[0];

  const queryKey = JSON.stringify(filters);
  const { data, loading, error, retry } = useFetch(
    () =>
      getProfessionals({
        query: filters.q || undefined,
        category: filters.category || undefined,
        location: filters.location || undefined,
        minRating: ratingOpt.value,
        maxPrice: priceOpt.value,
        availability: availOpt.value || undefined,
        sort: filters.sort,
      }),
    [queryKey]
  );

  const activeFilterCount = [
    filters.category,
    filters.location,
    filters.rating !== 'all',
    filters.price !== 'all',
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
          <span className="eyebrow">Professionals</span>
          <h1>Find the right professional</h1>
          <p className="page-hero__desc">
            A directory of skilled professionals across every Servix category.
            Profiles shown are demonstration content for the pre-launch platform.
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
              placeholder="Search by name, title or skill…"
              aria-label="Search professionals"
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
          <aside className="filters filters--sidebar" aria-label="Professional filters">
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
                {loading
                  ? 'Loading professionals…'
                  : `${items.length} professional${items.length === 1 ? '' : 's'} found`}
              </p>
              <div className="results-head__controls">
                <label className="sr-only" htmlFor="sort-pros">
                  Sort professionals
                </label>
                <select
                  id="sort-pros"
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

            {loading && <CardGridSkeleton count={4} kind="pro" />}

            {error && (
              <ErrorState
                message="We couldn't load the professionals. Please try again."
                onRetry={retry}
              />
            )}

            {!loading && !error && items.length === 0 && (
              <EmptyState
                title="No professionals found"
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
                <div className="results-grid results-grid--pros">
                  {pageItems.map((pro) => (
                    <ProfessionalCard key={pro.id} professional={pro} />
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

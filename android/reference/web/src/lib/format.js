/** Formatting helpers shared across the interface. */

const ngn = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

export function formatPrice(value) {
  return ngn.format(value);
}

export function formatRating(value) {
  return value.toFixed(1);
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

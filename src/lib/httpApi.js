/**
 * SERVIX LIVE API PROVIDER.
 *
 * Talks to the Servix backend over HTTPS. Endpoints and parameters mirror
 * ./demoApi.js exactly, so the two providers are interchangeable behind
 * the facade in ./api.js.
 */

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

async function toApiError(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const err = new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  return err;
}

async function get(path, params) {
  const qs = params
    ? `?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
        ),
      )}`
    : '';
  const res = await fetch(`${V1}${path}${qs}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export async function getCategories() {
  return get('/categories');
}

export async function getServices(params = {}) {
  return get('/services', params);
}

export async function getService(id) {
  return get(`/services/${encodeURIComponent(id)}`);
}

export async function getServiceReviews(serviceId) {
  return get(`/services/${encodeURIComponent(serviceId)}/reviews`);
}

export async function getProfessionals(params = {}) {
  return get('/professionals', params);
}

export async function getProfessional(id) {
  return get(`/professionals/${encodeURIComponent(id)}`);
}

export async function getProfessionalReviews(professionalId) {
  return get(`/professionals/${encodeURIComponent(professionalId)}/reviews`);
}

export async function getProfessionalServices(professionalId) {
  return get(`/professionals/${encodeURIComponent(professionalId)}/services`);
}

export async function getTestimonials() {
  return get('/testimonials');
}

export async function getPricingPlans() {
  return get('/plans');
}

export async function getStats() {
  return get('/stats');
}

export async function submitContact(payload) {
  const res = await fetch(`${V1}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

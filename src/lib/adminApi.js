/**
 * SERVIX ADMIN API — Phase E client.
 *
 * Authenticated admin console calls. Admin access is decided by the
 * SERVER against the database role — this client only carries the access
 * token; a non-admin gets 403 regardless of anything set in the browser.
 */
import { authorizedFetch } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const adminAvailable = Boolean(import.meta.env.VITE_API_URL);

async function toApiError(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }
  const err = new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  if (payload?.error?.meta) err.meta = payload.error.meta;
  return err;
}

async function call(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await authorizedFetch(`${V1}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

/* overview */
export const getStats = () => call('GET', '/admin/stats');

/* applications */
export const getApplications = (params) => call('GET', `/admin/applications${qs(params)}`);
export const approveApplication = (id) => call('POST', `/admin/applications/${id}/approve`);
export const rejectApplication = (id, reason) =>
  call('POST', `/admin/applications/${id}/reject`, reason ? { reason } : {});

/* services */
export const getServices = (params) => call('GET', `/admin/services${qs(params)}`);
export const pauseService = (slug) => call('POST', `/admin/services/${slug}/pause`);
export const unpauseService = (slug) => call('POST', `/admin/services/${slug}/unpause`);
export const getService = (slug) => call('GET', `/admin/services/${slug}`);
export const approveService = (slug, note) => call('POST', `/admin/services/${slug}/approve`, note ? { note } : {});
export const rejectService = (slug, reason) => call('POST', `/admin/services/${slug}/reject`, { reason });

/* users */
export const getUsers = (params) => call('GET', `/admin/users${qs(params)}`);
export const suspendUser = (id) => call('POST', `/admin/users/${id}/suspend`);
export const reinstateUser = (id) => call('POST', `/admin/users/${id}/reinstate`);

/* bookings & disputes */
export const getBookings = (params) => call('GET', `/admin/bookings${qs(params)}`);
export const getBooking = (id) => call('GET', `/admin/bookings/${id}`);
export const resolveDispute = (id, decision, note) =>
  call('POST', `/admin/bookings/${id}/resolve`, { decision, note: note || undefined });

/* payouts */
export const getPayouts = (params) => call('GET', `/admin/payouts${qs(params)}`);
export const retryPayout = (id) => call('POST', `/admin/payouts/${id}/retry`);

/* audit log */
export const getAudit = (params) => call('GET', `/admin/audit${qs(params)}`);

/* ---------------- analytics, notifications, plan subscriptions ---------------- */
export const getAnalytics = (days = 30) => call('GET', `/admin/analytics?days=${days}`);
export const getBroadcasts = (params) => call('GET', `/admin/notifications${qs(params)}`);
export const sendBroadcast = (body) => call('POST', '/admin/notifications', body);
export const getSubscriptions = (params) => call('GET', `/admin/subscriptions${qs(params)}`);

/* plans, organisations, per-account plan grants, AI usage analytics */
export const getPlans = () => call('GET', '/admin/plans');
export const updatePlan = (slug, body) => call('PATCH', `/admin/plans/${encodeURIComponent(slug)}`, body);
export const getOrganizations = (params) => call('GET', `/admin/organizations${qs(params)}`);
export const updateOrganization = (id, body) => call('PATCH', `/admin/organizations/${encodeURIComponent(id)}`, body);
export const grantUserPlan = (id, body) => call('POST', `/admin/users/${encodeURIComponent(id)}/plan`, body);
export const getUserAiUsage = (id) => call('GET', `/admin/users/${encodeURIComponent(id)}/ai-usage`);
export const getAiUsage = (params) => call('GET', `/admin/ai/usage${qs(params)}`);
export const getAiUsageEvents = (params) => call('GET', `/admin/ai/usage/events${qs(params)}`);

/* identity verification (KYC) */
export const getKycQueue = (params) => call('GET', `/admin/kyc/pending${qs(params)}`);
export const getKycCase = (id) => call('GET', `/admin/kyc/${encodeURIComponent(id)}`);
export const reviewKyc = (id, action, rejectionReason) =>
  call('POST', `/admin/kyc/${encodeURIComponent(id)}/review`, rejectionReason ? { action, rejectionReason } : { action });

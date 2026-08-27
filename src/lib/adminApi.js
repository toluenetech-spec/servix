/**
 * SERVIX ADMIN API — Phase E client.
 *
 * Authenticated admin console calls. Admin access is decided by the
 * SERVER against the database role — this client only carries the access
 * token; a non-admin gets 403 regardless of anything set in the browser.
 */
import { getAccessToken } from './authApi.js';

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
  return err;
}

async function call(method, path, body) {
  const headers = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${V1}${path}`, {
    method,
    headers,
    credentials: 'include',
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

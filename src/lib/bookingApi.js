/**
 * SERVIX BOOKING API — Phase D client.
 * Real bookings only; requires the live API and authentication.
 */
import { getAccessToken } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const bookingAvailable = Boolean(import.meta.env.VITE_API_URL);

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

async function call(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
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

/* customer */
export const getAvailability = (serviceId, days = 14) =>
  call('GET', `/services/${encodeURIComponent(serviceId)}/availability?days=${days}`);
export const createBooking = (data, idempotencyKey) =>
  call('POST', '/bookings', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});
export const payBooking = (id) => call('POST', `/bookings/${id}/pay`);
export const getMyBookings = () => call('GET', '/bookings');
export const getBooking = (id) => call('GET', `/bookings/${id}`);
export const cancelBooking = (id, reason) => call('POST', `/bookings/${id}/cancel`, { reason });
export const confirmBooking = (id) => call('POST', `/bookings/${id}/confirm`);
export const disputeBooking = (id, reason) => call('POST', `/bookings/${id}/dispute`, { reason });
export const reviewBooking = (id, data) => call('POST', `/bookings/${id}/review`, data);

/* professional */
export const getProBookings = () => call('GET', '/pro/bookings');
export const acceptBooking = (id) => call('POST', `/pro/bookings/${id}/accept`);
export const declineBooking = (id, reason) => call('POST', `/pro/bookings/${id}/decline`, { reason });
export const startBooking = (id) => call('POST', `/pro/bookings/${id}/start`);
export const deliverBooking = (id) => call('POST', `/pro/bookings/${id}/deliver`);
export const proCancelBooking = (id, reason) => call('POST', `/pro/bookings/${id}/cancel`, { reason });
export const getEarnings = () => call('GET', '/pro/earnings');
export const requestPayout = () => call('POST', '/pro/payouts');

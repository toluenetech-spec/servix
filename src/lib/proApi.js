/**
 * SERVIX PRO API — Phase C client for professional onboarding/management.
 * Authenticated calls only; requires a live API (no demo fallback — the
 * professional workspace is real or honestly unavailable).
 */
import { getAccessToken } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const proAvailable = Boolean(import.meta.env.VITE_API_URL);

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

/* -------- applications -------- */
export const createApplication = (data) => call('POST', '/applications', data);
export const getMyApplication = () => call('GET', '/applications/me');
export const updateApplication = (id, data) => call('PATCH', `/applications/${id}`, data);
export const submitApplication = (id) => call('POST', `/applications/${id}/submit`);

/* -------- profile -------- */
export const getMyProfile = () => call('GET', '/pro/profile');
export const updateMyProfile = (data) => call('PATCH', '/pro/profile', data);
export const replaceSkills = (skills) => call('PUT', '/pro/skills', { skills });
export const addPortfolioItem = (data) => call('POST', '/pro/portfolio', data);
export const removePortfolioItem = (id) => call('DELETE', `/pro/portfolio/${id}`);

/* -------- services -------- */
export const getMyServices = () => call('GET', '/pro/services');
export const getMyService = (id) => call('GET', `/pro/services/${id}`);
export const createService = (data) => call('POST', '/pro/services', data);
export const updateService = (id, data) => call('PATCH', `/pro/services/${id}`, data);
export const publishService = (id) => call('POST', `/pro/services/${id}/publish`);
export const unpublishService = (id) => call('POST', `/pro/services/${id}/unpublish`);
export const archiveService = (id) => call('DELETE', `/pro/services/${id}`);

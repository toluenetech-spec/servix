/**
 * SERVIX AUTH API — Phase B client.
 *
 * Talks to /api/v1/auth on the live backend. Unlike the catalogue data
 * layer there is NO demo fallback here: authentication is either real or
 * clearly unavailable — the UI shows an honest "accounts unavailable"
 * message when no API is configured or reachable. No fake logins.
 *
 * Session model:
 *  - access token kept in memory only (never localStorage)
 *  - refresh token lives in an httpOnly cookie set by the API
 *  - on app load, sessions resume via POST /auth/refresh (credentials)
 */

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;

export const authAvailable = Boolean(import.meta.env.VITE_API_URL);

let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

async function toApiError(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }
  const err = new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  return err;
}

async function post(path, body, { auth = false } = {}) {
  const headers = {};
  // Only send a JSON content type when there IS a body — Fastify rejects
  // an empty body with application/json set (e.g. /auth/refresh, /auth/logout).
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${V1}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include', // refresh cookie
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/* ---------------- auth operations ---------------- */

export async function register({ fullName, email, password, accountType }) {
  const data = await post('/auth/register', { fullName, email, password, accountType });
  accessToken = data.accessToken;
  return data.user;
}

export async function login({ email, password }) {
  const data = await post('/auth/login', { email, password });
  accessToken = data.accessToken;
  return data.user;
}

export async function logout() {
  try {
    await post('/auth/logout');
  } finally {
    accessToken = null;
  }
}

/** Resume a session from the refresh cookie. Returns user or null.
 * Single-flight: concurrent calls (e.g. React StrictMode double-effects)
 * share ONE request — two parallel refreshes would otherwise trip the
 * token-rotation reuse detection and revoke the whole session family. */
let resumeInFlight = null;

export function resumeSession() {
  if (!authAvailable) return Promise.resolve(null);
  if (!resumeInFlight) {
    resumeInFlight = post('/auth/refresh')
      .then((data) => {
        accessToken = data.accessToken;
        return data.user;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        // allow future explicit resumes (e.g. after logout+login)
        setTimeout(() => {
          resumeInFlight = null;
        }, 1000);
      });
  }
  return resumeInFlight;
}

export async function verifyEmail(token) {
  const data = await post('/auth/verify-email', { token });
  return data.user;
}

export async function resendVerification() {
  return post('/auth/verify-email/resend', null, { auth: true });
}

export async function forgotPassword(email) {
  return post('/auth/forgot-password', { email });
}

export async function resetPassword({ token, password }) {
  return post('/auth/reset-password', { token, password });
}

export async function fetchMe() {
  if (!accessToken) return null;
  const res = await fetch(`${V1}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

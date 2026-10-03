/**
 * Servix AI client. Every call goes to the backend router (`/api/v1/ai/*`); the browser never sees a provider,
 * a model name beyond the alias the API returns, or any key. Everything except search intent needs a session.
 * Requests are abortable (the UI cancels when a panel closes) and capped client-side at 75 s so a slow provider
 * never leaves a spinner running forever — the backend itself stops at 60 s.
 */
import { authorizedFetch } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;
export const aiAvailable = Boolean(import.meta.env.VITE_API_URL);
const CLIENT_TIMEOUT_MS = 75_000;

async function toError(res) {
  const payload = await res.json().catch(() => null);
  const err = new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  return err;
}

function withTimeout(signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), CLIENT_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function post(path, body, { auth = true, signal } = {}) {
  const t = withTimeout(signal);
  try {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: t.signal };
    const res = auth ? await authorizedFetch(`${V1}${path}`, init) : await fetch(`${V1}${path}`, init);
    if (!res.ok) throw await toError(res);
    return res.json();
  } catch (e) {
    if (e?.name === 'AbortError' || t.signal.aborted) { const err = new Error('Stopped.'); err.code = signal?.aborted ? 'CANCELLED' : 'AI_TIMEOUT'; err.status = 504; throw err; }
    throw e;
  } finally { t.done(); }
}

/* ---------- everyone ---------- */
export const searchIntent = (query, opts) => post('/ai/search/intent', { query }, { auth: false, ...opts });

/* ---------- signed in ---------- */
export const askAssistant = (messages, opts) => post('/ai/assistant', { messages }, opts);
export const explain = (topic, context, opts) => post('/ai/explain', { topic, ...(context ? { context } : {}) }, opts);
export const pricingGuidance = (body, opts) => post('/ai/pricing/guidance', body, opts);
export const bookingHealth = (bookingId, opts) => post(`/ai/bookings/${encodeURIComponent(bookingId)}/health`, {}, opts);
export const draft = (kind, input, tone = 'friendly', opts) => post('/ai/drafts', { kind, input, tone }, opts);

/* ---------- professionals ---------- */
export const matchOpportunities = (opts) => post('/ai/opportunities/match', {}, opts);
export const opportunityRadar = (opts) => post('/ai/opportunities/radar', {}, opts);
export const profileAnalysis = (opts) => post('/ai/profile/analysis', {}, opts);
export const profileImprove = (focus = 'all', opts) => post('/ai/profile/improve', { focus }, opts);
export const draftProposal = (requestId, notes, opts) => post('/ai/proposals/draft', { requestId, ...(notes ? { notes } : {}) }, opts);

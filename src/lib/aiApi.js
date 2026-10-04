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
  if (payload?.error?.meta) err.meta = payload.error.meta;
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

/**
 * Streamed text answers (assistant, explain). The API sends server-sent events; words are forwarded to `onDelta`
 * as they arrive and the resolved value matches the non-streamed shape `{ answer, ai }`. If the server does not
 * stream (older API, proxy stripping the event stream) we fall back to the plain endpoint transparently.
 */
async function streamPost(path, fallbackPath, body, { signal, onDelta } = {}) {
  const t = withTimeout(signal);
  try {
    const res = await authorizedFetch(`${V1}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body ?? {}), signal: t.signal });
    if (res.status === 404) return post(fallbackPath, body, { signal });
    if (!res.ok) throw await toError(res);
    if (!res.headers.get('content-type')?.includes('text/event-stream') || !res.body) return res.json();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let done = null; let error = null;
    const handle = (event) => {
      if (event.type === 'delta') onDelta?.(event.text);
      else if (event.type === 'done') done = { answer: event.answer, ai: event.ai };
      else if (event.type === 'error') { error = new Error(event.message ?? 'Servix AI is unavailable.'); error.code = event.code; error.status = event.status; }
    };
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) if (line.startsWith('data: ')) { try { handle(JSON.parse(line.slice(6))); } catch { /* ignore malformed frame */ } }
      }
    }
    if (error) throw error;
    if (!done) { const e = new Error('The answer was cut off. Please try again.'); e.code = 'AI_UNAVAILABLE'; e.status = 503; throw e; }
    return done;
  } catch (e) {
    if (e?.name === 'AbortError' || t.signal.aborted) { const err = new Error('Stopped.'); err.code = signal?.aborted ? 'CANCELLED' : 'AI_TIMEOUT'; err.status = 504; throw err; }
    throw e;
  } finally { t.done(); }
}

/* ---------- everyone ---------- */
export const searchIntent = (query, opts) => post('/ai/search/intent', { query }, { auth: false, ...opts });
/** Thumbs up/down on an answer. Question + answer are only sent (and stored) for a thumbs-down. */
export const sendAiFeedback = ({ rating, department = 'assistant', comment, prompt, answer, modelAlias }) => post('/ai/feedback', {
  rating,
  department,
  ...(rating === 'down' ? { ...(comment ? { comment } : {}), ...(prompt ? { prompt: String(prompt).slice(0, 4000) } : {}), ...(answer ? { answer: String(answer).slice(0, 12000) } : {}) } : {}),
  ...(modelAlias ? { modelAlias } : {}),
});
export const aiUsage = () => authorizedFetch(`${V1}/ai/usage`).then(async (res) => { if (!res.ok) throw await toError(res); return res.json(); });

/* ---------- signed in ---------- */
export const askAssistant = (messages, opts) => (opts?.onDelta ? streamPost('/ai/assistant/stream', '/ai/assistant', { messages }, opts) : post('/ai/assistant', { messages }, opts));
export const explain = (topic, context, opts) => (opts?.onDelta ? streamPost('/ai/explain/stream', '/ai/explain', { topic, ...(context ? { context } : {}) }, opts) : post('/ai/explain', { topic, ...(context ? { context } : {}) }, opts));
export const pricingGuidance = (body, opts) => post('/ai/pricing/guidance', body, opts);
export const bookingHealth = (bookingId, opts) => post(`/ai/bookings/${encodeURIComponent(bookingId)}/health`, {}, opts);
export const draft = (kind, input, tone = 'friendly', opts) => post('/ai/drafts', { kind, input, tone }, opts);

/* ---------- professionals ---------- */
export const matchOpportunities = (opts) => post('/ai/opportunities/match', {}, opts);
export const opportunityRadar = (opts) => post('/ai/opportunities/radar', {}, opts);
export const profileAnalysis = (opts) => post('/ai/profile/analysis', {}, opts);
export const profileImprove = (focus = 'all', opts) => post('/ai/profile/improve', { focus }, opts);
export const draftProposal = (requestId, notes, opts) => post('/ai/proposals/draft', { requestId, ...(notes ? { notes } : {}) }, opts);

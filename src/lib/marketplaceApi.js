/**
 * Next-gen marketplace client: feature flags, trust & achievements, comparison,
 * availability discovery, service requests + proposals, book again, preferred.
 * Public reads use plain fetch (no account needed); everything else is
 * authenticated through the shared token refresh in authApi.
 */
import { authorizedFetch } from './authApi.js';

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const V1 = `${BASE}/api/v1`;
export const marketplaceAvailable = Boolean(import.meta.env.VITE_API_URL);

async function toError(res) {
  const payload = await res.json().catch(() => null);
  const err = new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  err.status = payload?.error?.status ?? res.status;
  err.code = payload?.error?.code;
  if (payload?.error?.errors) err.errors = payload.error.errors;
  return err;
}

async function publicGet(path, params) {
  const qs = params ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')))}` : '';
  const res = await fetch(`${V1}${path}${qs}`);
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? null : res.json();
}

async function call(method, path, body) {
  const res = await authorizedFetch(`${V1}${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? null : res.json();
}

const enc = encodeURIComponent;

/* ---------- features ---------- */
export const getFeatures = () => publicGet('/features');

/* ---------- trust / achievements / availability / views ---------- */
export const getTrust = (slug) => publicGet(`/professionals/${enc(slug)}/trust`);
export const getAchievementCatalog = () => publicGet('/achievements/catalog');
export const getAvailabilitySummary = (slug) => publicGet(`/professionals/${enc(slug)}/availability/summary`);
export function countView(type, slug) {
  if (!marketplaceAvailable) return;
  try {
    const body = JSON.stringify({ type, slug });
    fetch(`${V1}/views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}

/* ---------- comparison ---------- */
export const compare = ({ professionals = [], services = [] }) => publicGet('/compare', { professionals: professionals.join(','), services: services.join(',') });

/* ---------- professional: own trust, verified portfolio, analytics extras ---------- */
export const getMyTrust = () => call('GET', '/pro/trust');
export const getVerifiableBookings = () => call('GET', '/pro/portfolio/verifiable');
export const addVerifiedProject = (bookingId, body = {}) => call('POST', `/pro/portfolio/from-booking/${enc(bookingId)}`, body);

/* ---------- book again / preferred ---------- */
export const getRebookDraft = (bookingId) => call('GET', `/bookings/${enc(bookingId)}/rebook`);
export const updateSavedProfessional = (slug, body) => call('PATCH', `/account/saved/${enc(slug)}`, body);

/* ---------- service requests (customer) ---------- */
export const listMyRequests = () => call('GET', '/requests');
export const createRequest = (body) => call('POST', '/requests', body);
export const getRequest = (id) => call('GET', `/requests/${enc(id)}`);
export const updateRequest = (id, body) => call('PATCH', `/requests/${enc(id)}`, body);
export const requestAction = (id, action) => call('POST', `/requests/${enc(id)}/${action}`, {});
export const listRequestProposals = (id) => call('GET', `/requests/${enc(id)}/proposals`);
export const acceptProposal = (id, pid, body = {}) => call('POST', `/requests/${enc(id)}/proposals/${enc(pid)}/accept`, body);
export const rejectProposal = (id, pid, reason) => call('POST', `/requests/${enc(id)}/proposals/${enc(pid)}/reject`, reason ? { reason } : {});

/* ---------- service requests (professional) ---------- */
export const browseRequests = (params) => call('GET', `/requests/browse${params ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')))}` : ''}`);
export const getBrowseRequest = (id) => call('GET', `/requests/browse/${enc(id)}`);
export const submitProposal = (requestId, body) => call('POST', `/requests/${enc(requestId)}/proposals`, body);
export const listMyProposals = () => call('GET', '/proposals/mine');
export const updateProposal = (id, body) => call('PATCH', `/proposals/${enc(id)}`, body);
export const withdrawProposal = (id) => call('POST', `/proposals/${enc(id)}/withdraw`, {});

/* ---------- admin ---------- */
export const adminRequests = (params) => call('GET', `/admin/requests?${new URLSearchParams(Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v)))}`);
export const adminProposals = (params) => call('GET', `/admin/proposals?${new URLSearchParams(Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v)))}`);
export const adminTrustList = (params) => call('GET', `/admin/trust?${new URLSearchParams(Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v)))}`);
export const adminTrustDetail = (slug) => call('GET', `/admin/trust/${enc(slug)}`);
export const adminRecomputeTrust = (slug) => call('POST', `/admin/trust/${enc(slug)}/recompute`, {});

/* ---------- labels shared by pages ---------- */
export const REQUEST_STATUS = {
  draft: { label: 'Draft', tone: 'gray' }, open: { label: 'Open', tone: '' }, paused: { label: 'Paused', tone: 'gray' },
  closed: { label: 'Closed', tone: 'gray' }, awarded: { label: 'Awarded', tone: '' }, cancelled: { label: 'Cancelled', tone: 'gray' },
};
export const PROPOSAL_STATUS = { submitted: 'Submitted', withdrawn: 'Withdrawn', rejected: 'Not selected', accepted: 'Accepted' };
export const NOT_ENOUGH = 'Not enough data';

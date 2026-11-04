/**
 * Effective plan + capabilities for the signed-in account (`GET /api/v1/me/entitlements`).
 * The server is the source of truth and enforces everything; this hook only lets the UI *explain* and *shape*
 * what is shown (hide a tab, label a button "Available on Go and above", show a token meter). Cached per
 * page load and refreshed when something plan-related happens (`refreshEntitlements()` or the DOM event).
 */
import { useEffect, useState } from 'react';
import { getEntitlements } from './workspaceApi.js';
import { getAccessToken } from './authApi.js';
import { useAuth } from './AuthContext.jsx';

export const ENTITLEMENTS_EVENT = 'servix:entitlements-changed';
export const PLAN_LABELS = { free: 'Free', go: 'Go', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
export const PLAN_ORDER = ['free', 'go', 'pro', 'team', 'enterprise'];

let cache = null; let inflight = null; let cachedToken = null;

export function loadEntitlements(force = false) {
  const token = getAccessToken();
  if (!token) { cache = null; return Promise.resolve(null); }
  if (token !== cachedToken) { cache = null; inflight = null; cachedToken = token; }
  if (cache && !force) return Promise.resolve(cache);
  if (!inflight || force) {
    inflight = getEntitlements().then((e) => { cache = e && typeof e.current === 'string' ? e : null; inflight = null; return cache; }).catch(() => { inflight = null; return cache; });
  }
  return inflight;
}

export function refreshEntitlements() {
  return loadEntitlements(true).then((e) => { window.dispatchEvent(new Event(ENTITLEMENTS_EVENT)); return e; });
}

/** Returns `{ ready, entitlements, plan, label, can(feature), limit(key), usage(key), ai, organization, refresh }`. */
export function useEntitlements() {
  const { user, initializing } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState(cache);
  const [ready, setReady] = useState(Boolean(cache));
  useEffect(() => {
    let alive = true;
    // Wait for the session to be restored (hard reload) so the first request carries a token.
    if (initializing) return undefined;
    const sync = () => loadEntitlements().then((e) => { if (alive) { setState(e); setReady(true); } });
    sync();
    const onChange = () => { if (alive) { setState(cache); } };
    window.addEventListener(ENTITLEMENTS_EVENT, onChange);
    return () => { alive = false; window.removeEventListener(ENTITLEMENTS_EVENT, onChange); };
  }, [initializing, userId]);
  const e = state;
  return {
    ready, entitlements: e,
    plan: e?.current ?? 'free', label: e?.label ?? 'Free', source: e?.source ?? 'account', organization: e?.organization ?? null,
    features: e?.features ?? [], limits: e?.limits ?? {}, usage: e?.usage ?? {}, ai: e?.ai ?? null, aiDepartments: e?.aiDepartments ?? [],
    // Unknown state (not loaded / request failed) never locks the UI: the API enforces every boundary itself.
    can: (feature) => (e ? Boolean(e.features?.includes(feature)) : true),
    canUseAi: (department) => (e ? Boolean(e.aiDepartments?.includes(department)) : true),
    limit: (key) => (e ? e.limits?.[key] ?? null : null),
    used: (key) => e?.usage?.[key] ?? 0,
    refresh: refreshEntitlements,
  };
}

/** The lowest plan on which a feature/department is included, derived from the catalogue returned by the API. */
export function minPlanFor(entitlements, { feature, department } = {}) {
  const plans = entitlements?.plans ?? [];
  const hit = [...plans].sort((a, b) => a.rank - b.rank).find((p) => (feature ? p.capabilities?.includes(feature) : department ? p.aiDepartments?.includes(department) : false));
  return hit?.slug ?? null;
}

/** Human message for a limit/feature/quota error returned by the API (uses the server's `meta` when present). */
export function planErrorCopy(err) {
  const meta = err?.meta;
  if (!meta) return null;
  const to = meta.upgradeToLabel || PLAN_LABELS[meta.upgradeTo] || null;
  if (meta.kind === 'ai_quota') return { title: meta.scope === 'member' ? 'Your personal AI allowance for this month is used up' : 'Your AI allowance for this month is used up', body: `${(meta.used ?? 0).toLocaleString('en-NG')} / ${(meta.allowed ?? 0).toLocaleString('en-NG')} tokens used. It resets on ${meta.resetAt ? new Date(meta.resetAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'the 1st of next month'}.`, upgradeTo: meta.upgradeTo, upgradeToLabel: to };
  if (meta.kind === 'ai_department') return { title: 'This AI tool is not on your plan', body: to ? `Available on ${to} and above.` : 'Not included in your plan.', upgradeTo: meta.upgradeTo, upgradeToLabel: to };
  if (meta.kind === 'feature') return { title: 'Not included in your plan', body: to ? `Available on ${to} and above.` : 'Not included in your plan.', upgradeTo: meta.upgradeTo, upgradeToLabel: to };
  if (meta.kind === 'limit') return { title: 'You have reached a limit on your plan', body: `${err.message}${to ? ` Upgrade to ${to} for more room.` : ''}`, upgradeTo: meta.upgradeTo, upgradeToLabel: to };
  return null;
}

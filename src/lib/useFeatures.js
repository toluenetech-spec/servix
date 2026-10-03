/** Feature flags served by the API (`GET /api/v1/features`). Cached per page load;
 *  everything defaults to OFF until the snapshot arrives, so gated UI never flashes on. */
import { useEffect, useState } from 'react';
import { getFeatures, marketplaceAvailable } from './marketplaceApi.js';

const OFF = Object.freeze({ requests: false, compare: false, achievements: false, trust: false, projects: false, crm: false, packages: false, business: false, pricing: false, community: false, ai: false });
let cache = null; let inflight = null;
export function loadFeatures() {
  if (cache) return Promise.resolve(cache);
  if (!marketplaceAvailable) return Promise.resolve(OFF);
  inflight ??= getFeatures().then((f) => { cache = { ...OFF, ...f }; return cache; }).catch(() => { inflight = null; return OFF; });
  return inflight;
}
export function useFeatures() {
  const [features, setFeatures] = useState(cache ?? OFF);
  const [ready, setReady] = useState(Boolean(cache));
  useEffect(() => { let alive = true; loadFeatures().then((f) => { if (alive) { setFeatures(f); setReady(true); } }); return () => { alive = false; }; }, []);
  return { ...features, ready };
}

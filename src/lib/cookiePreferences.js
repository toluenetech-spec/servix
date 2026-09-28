export const PREFERENCE_KEY = 'servix_cookie_preferences';
export const PREFERENCE_VERSION = '2026-09-28';
export const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
export function parsePreference(raw, now = Date.now()) {
  try {
    const value = JSON.parse(raw);
    return value?.version === PREFERENCE_VERSION && typeof value.optional === 'boolean' && Number.isFinite(value.savedAt) && value.savedAt <= now && now - value.savedAt < MAX_AGE_MS ? value : null;
  } catch { return null; }
}
export const PUBLIC_MEASUREMENT_PATHS = ['/', '/services', '/professionals', '/professionals/join', '/how-it-works', '/pricing', '/about', '/contact', '/privacy', '/terms', '/cookies'];
export function sanitizeMeasurement(event) {
  try {
    // Never measure a private route even if a previous public page loaded the script.
    if (typeof window !== 'undefined' && !PUBLIC_MEASUREMENT_PATHS.includes(window.location.pathname)) return null;
    const url = new URL(event.url);
    if (!PUBLIC_MEASUREMENT_PATHS.includes(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return { ...event, url: url.href };
  } catch { return null; }
}

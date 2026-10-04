/** Pure helpers (no database import) so they can be unit-tested and reused anywhere. */
export interface DeviceInfo { browser: string; os: string; key: string; label: string }

/** Small, dependency-free user-agent summary — enough to tell "Safari on iPhone" from "Chrome on Android". */
export function describeDevice(userAgent: string | undefined | null): DeviceInfo {
  const ua = (userAgent ?? '').slice(0, 300);
  const has = (re: RegExp) => re.test(ua);
  let os = 'Unknown device';
  if (has(/iPhone/i)) os = 'iPhone';
  else if (has(/iPad/i) || (has(/Macintosh/i) && has(/Mobile/i))) os = 'iPad';
  else if (has(/Android/i)) os = 'Android';
  else if (has(/Windows/i)) os = 'Windows';
  else if (has(/CrOS/i)) os = 'ChromeOS';
  else if (has(/Macintosh|Mac OS X/i)) os = 'Mac';
  else if (has(/Linux/i)) os = 'Linux';
  let browser = 'Unknown browser';
  if (has(/Edg(e|A|iOS)?\//i)) browser = 'Microsoft Edge';
  else if (has(/OPR\/|Opera/i)) browser = 'Opera';
  else if (has(/SamsungBrowser\//i)) browser = 'Samsung Internet';
  else if (has(/FxiOS\/|Firefox\//i)) browser = 'Firefox';
  else if (has(/CriOS\//i) || (has(/Chrome\//i) && !has(/Chromium/i))) browser = 'Chrome';
  else if (has(/Chromium\//i)) browser = 'Chromium';
  else if (has(/Safari\//i) && has(/Version\//i)) browser = 'Safari';
  else if (ua === '') browser = 'Unknown browser';
  const key = `${browser}|${os}`;
  return { browser, os, key, label: `${browser} on ${os}` };
}

/** Client address for display only (never for authorisation): first X-Forwarded-For hop, else the socket. */
export function clientAddress(headers: Record<string, unknown>, fallback: string | undefined): string | null {
  const fwd = headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd : '').split(',')[0]?.trim();
  const ip = first || fallback || '';
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}

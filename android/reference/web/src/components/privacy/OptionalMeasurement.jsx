import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { sanitizeMeasurement, parsePreference, PREFERENCE_KEY } from '../../lib/cookiePreferences.js';
function beforeSend(event) {
  try { if (!parsePreference(localStorage.getItem(PREFERENCE_KEY))?.optional) return null; } catch { return null; }
  return sanitizeMeasurement(event);
}
export default function OptionalMeasurement() {
  return <><Analytics beforeSend={beforeSend} /><SpeedInsights beforeSend={beforeSend} /></>;
}

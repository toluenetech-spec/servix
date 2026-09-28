import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PREFERENCE_KEY, PREFERENCE_VERSION, parsePreference, PUBLIC_MEASUREMENT_PATHS } from '../../lib/cookiePreferences.js';
import './cookies.css';
const Measurement = lazy(() => import('./OptionalMeasurement.jsx'));
function read() { try { return parsePreference(localStorage.getItem(PREFERENCE_KEY)); } catch { return null; } }
export function CookiePreferences() {
  const [choice, setChoice] = useState(read);
  const [open, setOpen] = useState(() => !read());
  const [error, setError] = useState('');
  const { pathname } = useLocation();
  useEffect(() => {
    const show = () => { setOpen(true); setError(''); };
    const sync = e => { if (e.key === PREFERENCE_KEY || e.key === null) { const next = read(); if (choice?.optional && !next?.optional) window.location.reload(); setChoice(next); setOpen(!next); } };
    window.addEventListener('servix:cookie-settings', show); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('servix:cookie-settings', show); window.removeEventListener('storage', sync); };
  }, [choice]);
  function save(optional) {
    const next = { version: PREFERENCE_VERSION, optional, savedAt: Date.now() };
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next)); }
    catch { setChoice(null); setError('Your browser could not save this choice. Optional measurement remains off.'); return; }
    setChoice(next); setOpen(false); setError('');
    if (choice?.optional && !optional) window.location.reload();
  }
  return <>
    {choice?.optional && PUBLIC_MEASUREMENT_PATHS.includes(pathname) && <Suspense fallback={null}><Measurement /></Suspense>}
    {open && <section className="cookie-panel" role="region" aria-label="Cookie preferences">
      <div><span className="eyebrow">Your privacy, your choice</span><h2>Only what you’re comfortable with.</h2><p>Essential storage keeps sign-in secure. With your permission, optional analytics help us understand public-page use and performance. You can say no and still use Servix.</p><p><Link to="/cookies">Cookie Policy</Link> · <Link to="/privacy">Privacy Policy</Link></p>{choice?.optional && <p>Withdrawing optional measurement reloads this page. Save unfinished work first.</p>}{error && <p role="alert">{error}</p>}</div>
      <div className="cookie-actions"><button onClick={() => save(false)}>Essential only</button><button onClick={() => save(true)}>Allow optional</button>{choice && <button onClick={() => setOpen(false)}>Keep current choice</button>}</div>
    </section>}
  </>;
}

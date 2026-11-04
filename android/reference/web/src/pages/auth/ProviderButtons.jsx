import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { oauthProviders, oauthConnections, startProvider } from '../../lib/authApi.js';
import { ProviderLogo } from '../../components/brand/ProviderLogo.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Skeleton } from '../../components/ui/States.jsx';

const messages = {
  cancelled: 'Provider sign-in was cancelled. You can try again or use your password.',
  link_required: 'This email belongs to an existing account. Sign in using your existing method, then open Connected sign-in to link the provider securely.',
  failed: 'Provider sign-in could not be completed. Start again, or use your existing sign-in method.',
};
export function ProviderButtons({ linking = false }) {
  const [providers, setProviders] = useState([]);
  const [connected, setConnected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query] = useSearchParams();
  useEffect(() => {
    let alive = true;
    Promise.all([oauthProviders(), linking ? oauthConnections() : Promise.resolve([])]).then(([list, linked]) => {
      if (alive) { setProviders(list); setConnected(linked); }
    }).catch(() => { if (alive && linking) setError('Could not load your connections. Refresh this page to try again.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [linking]);
  const notice = error || (!linking && messages[query.get('oauth_error')]);
  return <>
    {notice && <p role="alert">{notice}</p>}
    {providers.length > 0 && <div className="security-actions" style={{ display: 'grid', gap: 12, margin: '20px 0' }}>
      {providers.map(provider => <Button key={provider} variant="secondary" block disabled={busy || connected.includes(provider)} onClick={async () => {
        setBusy(true); setError('');
        try { await startProvider(provider, linking); }
        catch { setError('Could not start provider sign-in. Please try again.'); setBusy(false); }
      }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><ProviderLogo provider={provider} /><span>{connected.includes(provider) ? 'Connected:' : linking ? 'Connect' : 'Continue with'} {provider === 'google' ? 'Google' : 'GitHub'}</span></span></Button>)}
      <p style={{ fontSize: 13 }}>By continuing, you agree to the <Link to="/terms">Terms</Link> and acknowledge the <Link to="/privacy">Privacy Policy</Link>. New accounts are for users aged 18 or over.</p>
      <p style={{ fontSize: 13 }}>Your saved security method is still required. New accounts must set one up.</p>
    </div>}
    {loading && linking && <div role="status" aria-busy="true"><span className="sr-only">Loading connections…</span><div aria-hidden="true" style={{ display: 'grid', gap: 10 }}><Skeleton height="2.8rem" /><Skeleton height="2.8rem" /></div></div>}
    {!loading && linking && providers.length === 0 && <p>Provider connections are not available right now.</p>}
  </>;
}

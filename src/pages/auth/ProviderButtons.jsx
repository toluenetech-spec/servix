import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { oauthProviders, oauthConnections, startProvider } from '../../lib/authApi.js';
import { Button } from '../../components/ui/Button.jsx';

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
      }}>{connected.includes(provider) ? 'Connected:' : linking ? 'Connect' : 'Continue with'} {provider === 'google' ? 'Google' : 'GitHub'}</Button>)}
      <p style={{ fontSize: 13 }}>Your saved security method is still required. New accounts must set one up.</p>
    </div>}
    {loading && linking && <p role="status">Loading connections…</p>}
    {!loading && linking && providers.length === 0 && <p>Provider connections are not available right now.</p>}
  </>;
}

import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell.jsx';
import { ProviderButtons } from './ProviderButtons.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
export default function ConnectedSignInPage() {
  const { user, initializing } = useAuth();
  return <AuthShell><h1>Connected sign-in</h1>
    {initializing ? <p role="status">Checking your session…</p> : user ? <><p>Connect Google or GitHub to this Servix account. You’ll authorize the provider, then verify your existing security method before the connection is saved.</p><ProviderButtons linking /></> : <p><Link to="/login">Sign in to your existing account first</Link>, then return here to connect a provider.</p>}
    <p>Accounts are never joined automatically because their email addresses match.</p>
  </AuthShell>;
}

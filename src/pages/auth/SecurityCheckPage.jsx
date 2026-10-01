import { PasswordRequirements } from './PasswordRequirements.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { AuthShell } from './AuthShell.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { securityAction, finishSecurity, clearAccessToken } from '../../lib/authApi.js';
import { resetPasswordRules, passwordsMatch } from '../../lib/registrationValidation.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import './security.css';

export default function SecurityCheckPage() {
  useDocumentMeta({ title: 'Secure your account', description: 'Complete your Servix security checks.' });
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [flow, setFlow] = useState(location.state ?? null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [wait, setWait] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(null);
  const [retry, setRetry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(''); setExpired(false); setLoadFailed(false);
    securityAction('status').then(async state => {
      if (disposed) return;
      setFlow(state);
      if (state.next === 'recovery') {
        const data = await securityAction('recovery/codes');
        if (!disposed) setCodes(data.recoveryCodes);
      }
    }).catch(err => {
      if (!disposed) { setLoadFailed(true); setError(err.status === 401 ? 'Your security session expired. Start again to get a new code.' : 'We could not load your security check. Please try again.'); setExpired(err.status === 401); }
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [retry]);
  useEffect(() => {
    const timer = setInterval(() => setWait(v => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, [flow?.next, success]);

  function handleError(err) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      setError('The passkey prompt was cancelled or timed out. Nothing was changed. You can try again.'); return;
    }
    if (err.status === 401) { setExpired(true); setError('Your verification session expired. Start again.'); return; }
    if (err.status === 429) {
      setWait(err.code === 'SECURITY_LIMIT' ? 3600 : 60);
      setError(err.message || 'Please wait before trying again.'); return;
    }
    setError(err.status ? err.message : 'We could not complete this step. Check your connection and try again.');
  }
  async function run(operation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (err) { handleError(err); }
    finally { lock.current = false; setBusy(false); }
  }
  function move(state) { setFlow(state); setCode(''); setSetup(null); setQr(''); setUseRecovery(false); if (state.recoveryCodes) setCodes(state.recoveryCodes); }
  async function passkey() {
    if (!browserSupportsWebAuthn()) { setError('Passkeys are not supported in this browser. Use a current browser on a secure connection, or choose Google Authenticator during setup.'); return; }
    await run(async () => {
      const data = await securityAction('passkey/options');
      const response = data.enrolling ? await startRegistration({ optionsJSON: data.options }) : await startAuthentication({ optionsJSON: data.options });
      move(await securityAction('passkey/verify', { response }));
    });
  }
  const beginTotp = () => run(async () => {
    const data = await securityAction('totp/setup');
    const image = await QRCode.toDataURL(data.uri, { width: 220, margin: 2 });
    setSetup(data); setQr(image); setCode('');
  });
  const submitCode = event => {
    event.preventDefault();
    if (!useRecovery && !/^\d{6}$/.test(code)) { setError('Enter all six digits.'); return; }
    const action = flow.next === 'email' ? 'email/verify' : setup ? 'totp/enroll' : useRecovery ? 'recovery/verify' : 'totp/verify';
    run(async () => move(await securityAction(action, { code })));
  };
  const complete = () => run(async () => {
    const user = await finishSecurity(saved);
    setUser(user); setCodes([]);
    if (flow?.purpose === 'link') setSuccess('link');
    else navigate('/dashboard', { replace: true });
  });
  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([`Servix recovery codes\nKeep private. Each code works once after your other verification steps.\n\n${codes.join('\n')}\n`], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = 'servix-recovery-codes.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stage = flow?.next;
  const step = stage === 'email' ? 0 : ['enroll', 'factor'].includes(stage) ? 1 : 2;
  const title = stage === 'email' ? 'Check your inbox' : stage === 'enroll' ? 'Choose your security method' : stage === 'factor' ? 'One more check. Then you’re in.' : stage === 'recovery' ? 'Keep a way back in' : stage === 'reset_password' ? 'Choose a new password' : 'Your checks are complete';
  const codeField = <Field label={useRecovery ? 'Recovery code' : stage === 'email' ? 'Email verification code' : 'Google Authenticator code'} required hint={useRecovery ? 'Each recovery code works only once.' : 'Paste or enter the six-digit code.'}>
    {props => <input {...props} className={`input ${useRecovery ? '' : 'security-code'}`} type="text" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code"
      maxLength={useRecovery ? 64 : 6} value={code} onChange={e => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))} />}
  </Field>;
  if (success) return <AuthShell>
    <div className="security-success"><Icon name="check-circle" size={32} /></div>
    <h1 tabIndex={-1} ref={titleRef}>{success === 'reset' ? 'Password updated' : success === 'link' ? 'Sign-in provider connected' : 'You’re securely signed in'}</h1>
    <p role="status">{success === 'reset' ? 'Your other sessions have been signed out. Use your new password and your existing security method to sign in.' : 'Your required checks are complete. Your security method is saved for future sign-ins.'}</p>
    <Button block size="lg" to={success === 'reset' ? '/login' : success === 'link' ? '/connected-sign-in' : '/dashboard'}>{success === 'reset' ? 'Back to sign in' : success === 'link' ? 'View connected sign-in' : 'Go to dashboard'}</Button>
  </AuthShell>;
  return <AuthShell>
    <p className="security-eyebrow">SERVIX · ACCOUNT SECURITY</p>
    {flow?.purpose === 'link' && <p>You are connecting a sign-in provider. Verify your existing security method to approve this change.</p>}
    <ol className="security-progress" aria-label="Verification progress">
      {[flow?.purpose === 'social' || flow?.purpose === 'link' ? 'Provider verified' : 'Verify email', 'Security method', flow?.purpose === 'reset' ? 'New password' : 'Finish'].map((label, i) => <li key={label} data-active={step >= i} aria-current={step === i ? 'step' : undefined}>{i + 1}. {label}</li>)}
    </ol>
    <h1 tabIndex={-1} ref={titleRef}>{loading ? 'Preparing your secure check…' : expired ? 'Let’s start again' : title}</h1>
    {error && <div role="alert" className="security-error">{error}</div>}
    {notice && <div role="status" className="security-note">{notice}</div>}
    {loading && <p role="status">Checking your progress securely.</p>}
    {!loading && (expired || loadFailed || !flow) && <div className="security-actions">
      <Button to={flow?.purpose === 'reset' ? '/forgot-password' : '/login'} block>Start again</Button>
      {!expired && <Button variant="secondary" onClick={() => setRetry(v => v + 1)}>Try loading again</Button>}
    </div>}
    {!loading && !expired && !loadFailed && flow && <div aria-busy={busy}>
      {stage === 'email' && <>
        <p>{flow.purpose === 'reset' ? 'If the account is eligible, a code has been queued for delivery to your email.' : <>A code has been queued for <strong>{flow.email}</strong>.</>} Use the newest code within 10 minutes.</p>
        <form className="auth__form" onSubmit={submitCode}>{codeField}<Button type="submit" block disabled={busy}>Verify email</Button></form>
        <div className="security-actions"><Button variant="secondary" block disabled={busy || wait > 0} onClick={() => run(async () => {
          const result = await securityAction('email/resend'); setWait(result.retryAfterSeconds ?? 60); setNotice(flow.purpose === 'reset' ? 'If eligible, a code will be sent. Check Spam too; recent requests may need a little longer.' : 'A new code is queued. Check Spam too. Only the newest code will work.');
        })}>{wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}</Button></div>
      </>}
      {stage === 'enroll' && <>
        <p>Choose one method. We’ll remember it and ask for it when you sign in. First, let’s prove it works.</p>
        {!setup ? <div className="security-methods">
          <button className="security-method" disabled={busy} onClick={beginTotp}><strong>Google Authenticator</strong><span>Scan a QR code once. Then use the rotating six-digit code in your app—even offline.</span></button>
          <button className="security-method" disabled={busy} onClick={passkey}><strong>Passkey</strong><span>Use your device’s fingerprint, face recognition, security key or PIN. Servix never receives your biometric data.</span></button>
        </div> : <>
          <div className="security-note">Open Google Authenticator → tap + → Scan a QR code. Keep this QR and setup key private.</div>
          {qr && <img className="security-qr" src={qr} alt="Private QR code for setting up your Servix authenticator" />}
          <details><summary>Can’t scan? Use a setup key</summary><code className="security-secret">{setup.secret}</code><p>Choose a time-based code in the app.</p></details>
          <form className="auth__form" onSubmit={submitCode}>{codeField}<Button type="submit" block disabled={busy}>Confirm authenticator</Button></form>
          <Button variant="ghost" disabled={busy} onClick={() => { setSetup(null); setQr(''); setCode(''); }}>Choose a different method</Button>
        </>}
      </>}
      {stage === 'factor' && <>
        <p>{useRecovery ? 'Enter one of the recovery codes you saved during setup.' : flow.method === 'passkey' ? 'Use the passkey you enrolled for this account.' : 'Open Google Authenticator and enter the current code for Servix.'}</p>
        {flow.method === 'passkey' && !useRecovery ? <Button block disabled={busy} onClick={passkey}>Verify with my passkey</Button> :
          <form className="auth__form" onSubmit={submitCode}>{codeField}<Button type="submit" block disabled={busy}>Verify security code</Button></form>}
        <Button variant="ghost" disabled={busy} onClick={() => { setUseRecovery(v => !v); setCode(''); setError(''); }}>{useRecovery ? 'Use my enrolled security method' : 'Lost access? Use a recovery code'}</Button>
      </>}
      {stage === 'recovery' && <>
        <p>Your security method is confirmed. Save these recovery codes in a password manager or a safe offline place before continuing.</p>
        <div className="security-note">Each code works once. Never send these codes to support or include them in screenshots.</div>
        <ul className="security-codes">{codes.map(value => <li key={value}>{value}</li>)}</ul>
        <Button variant="secondary" block onClick={downloadCodes} disabled={!codes.length}>Download recovery codes</Button>
        <label style={{ display: 'flex', gap: 10, marginTop: 20 }}><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />I have saved my recovery codes somewhere private.</label>
        <div className="security-actions"><Button block disabled={busy || !saved || !codes.length} onClick={complete}>Finish securely</Button></div>
      </>}
      {stage === 'finish' && <><p>{flow.purpose === 'social' || flow.purpose === 'link' ? 'Your provider identity and enrolled security method have been verified.' : 'Your email and enrolled security method have been verified.'}</p><Button block disabled={busy} onClick={complete}>{flow.purpose === 'link' ? 'Confirm connection' : 'Finish signing in'}</Button></>}
      {stage === 'reset_password' && <>
        <p>Your email and existing security method are verified. Choose a unique password. Your enrolled security method will stay unchanged.</p>
        <form className="auth__form" onSubmit={e => { e.preventDefault();
          if (!resetPasswordRules(flow?.passwordPolicy).every(rule => rule.test(password)) || !passwordsMatch(password, confirmation)) { setError('Meet every password requirement and make sure both passwords match.'); return; }
          run(async () => { await securityAction('reset-password', { password }); clearAccessToken(); setUser(null); setPassword(''); setConfirmation(''); setSuccess('reset'); });
        }}>
          <Field label="New password" required>{props => <input {...props} className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />}</Field>
          <PasswordRequirements password={password} rules={resetPasswordRules(flow?.passwordPolicy)} />
          <Field label="Confirm password" required hint={confirmation ? passwordsMatch(password, confirmation) ? '✓ Passwords match' : 'Passwords do not match yet' : 'Enter the new password again.'}>{props => <input {...props} className="input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />}</Field>
          <label><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show passwords</label>
          <Button type="submit" block disabled={busy}>Save new password</Button>
        </form>
      </>}
      {busy && <p role="status" className="auth__meta">Completing your check… Please don’t close this page.</p>}
    </div>}
    <p className="auth__meta">Need help? <Link to="/contact">Contact support</Link>. Never share a verification code.</p>
  </AuthShell>;
}

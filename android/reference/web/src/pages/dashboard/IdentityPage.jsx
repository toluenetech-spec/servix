/**
 * Identity verification (manual KYC).
 *
 * States: not_submitted / rejected → submission form; pending → waiting
 * card; approved → verified card. Files are checked by magic bytes in the
 * browser, uploaded to a private key, then referenced from /kyc/submit.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { Icon } from '../../components/ui/Icon.jsx';
import { getKycStatus, submitKyc, uploadKycFile, KYC_DOCUMENT_TYPES, KYC_SELFIE_INSTRUCTION, KYC_CONSENT_TEXT } from '../../lib/kycApi.js';
import { PageHead, LoadState, useResource, dateLabel } from './shared.jsx';

const ID_HINTS = {
  nin_slip: '11-digit National Identification Number.',
  international_passport: 'Passport number as printed (e.g. A12345678).',
  voters_card: 'VIN printed on the card.',
  drivers_license: 'Licence number as printed.',
};

export default function IdentityPage() {
  useDocumentMeta({ title: 'Identity verification', description: 'Verify your identity to unlock publishing and payouts on Servix.' });
  const status = useResource(getKycStatus);
  return <>
    <PageHead title="Identity verification" description="A one-time manual check by the Servix team. Your documents stay private and are only used to confirm who you are." />
    <LoadState skeleton="form" label="Loading verification status…" resource={status}>{data => <IdentityBody data={data} reload={status.reload} />}</LoadState>
  </>;
}

function IdentityBody({ data, reload }) {
  const { refreshUser } = useAuth();
  if (data.status === 'pending') {
    return <div className="ws-two-col"><section className="ws-panel kyc-state" data-kyc-state="pending">
      <span className="ws-chip warn">Under review</span>
      <h2>Your identity verification is under review.</h2>
      <p className="ws-muted">This usually takes 12–24 hours. We will notify you in-app and by email once it is reviewed. You cannot send another submission while this one is pending.</p>
      <dl className="kyc-meta"><div><dt>Document</dt><dd>{data.documentTypeLabel}</dd></div><div><dt>Submitted</dt><dd>{dateLabel(data.submittedAt)}</dd></div></dl>
    </section><PrivacyAside /></div>;
  }
  if (data.status === 'approved') {
    return <div className="ws-two-col"><section className="ws-panel kyc-state" data-kyc-state="approved">
      <span className="ws-chip kyc-verified-chip"><Icon name="check-circle" size={13} /> Identity verified</span>
      <h2>You're verified.</h2>
      <p className="ws-muted">Thanks for confirming your identity. Verified features such as publishing gigs and requesting payouts are open to you.</p>
      <dl className="kyc-meta"><div><dt>Document</dt><dd>{data.documentTypeLabel}</dd></div><div><dt>Verified on</dt><dd>{data.reviewedAt ? dateLabel(data.reviewedAt) : '—'}</dd></div></dl>
    </section><PrivacyAside /></div>;
  }
  return <div className="ws-two-col">
    <div>
      {data.status === 'rejected' && <div className="ws-alert" role="alert" data-kyc-state="rejected"><strong>Verification failed:</strong> {data.rejectionReason || 'The documents could not be verified.'} Please fix the issue and re-submit below.</div>}
      <KycForm onDone={async () => { await reload(); try { await refreshUser(); } catch { /* status card already shows the result */ } }} />
    </div>
    <PrivacyAside />
  </div>;
}

function PrivacyAside() {
  return <aside>
    <section className="ws-panel"><h2>Why we ask</h2><p className="ws-muted">Verification protects customers and professionals from impersonation. It is required before publishing a gig or requesting a payout.</p></section>
    <section className="ws-panel"><h2>How your data is handled</h2><ul className="kyc-list">
      <li>Files are stored in a private bucket — never on a public link.</li>
      <li>Your ID number is encrypted at rest.</li>
      <li>Only Servix administrators can view a submission, through links that expire after 20 minutes. Every view is logged.</li>
      <li>Processing follows the Nigeria Data Protection Act (NDPA) 2023. See our <Link to="/privacy">privacy policy</Link>.</li>
    </ul></section>
  </aside>;
}

function KycForm({ onDone }) {
  const [documentType, setDocumentType] = useState('nin_slip');
  const [idNumber, setIdNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [document, setDocument] = useState(null); // { fileKey, previewUrl, isPdf, fileName }
  const [selfie, setSelfie] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const docAcceptsPdf = documentType === 'nin_slip';
  // Changing the document type invalidates a PDF upload for non-NIN types.
  useEffect(() => { if (document?.isPdf && !docAcceptsPdf) setDocument(null); }, [documentType]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = Boolean(document && selfie && idNumber.trim().length >= 6 && consent) && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError(''); setErrors({});
    try {
      await submitKyc({ documentType, idNumber: idNumber.trim(), documentFileKey: document.fileKey, selfieFileKey: selfie.fileKey, consentGiven: consent, dateOfBirth: dateOfBirth || undefined, phone: phone.trim() || undefined });
      await onDone();
    } catch (err) {
      setErrors(err.errors || {});
      setError(err.message);
    } finally { setBusy(false); }
  }

  return <form className="ws-panel ws-form kyc-form" style={{ maxWidth: 'none' }} onSubmit={submit} noValidate data-testid="kyc-form">
    <h2 style={{ marginBottom: 0 }}>Submit your documents</h2>
    <label>Document type
      <select value={documentType} onChange={e => setDocumentType(e.target.value)} data-testid="kyc-document-type">{KYC_DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      <small className="ws-muted">{KYC_DOCUMENT_TYPES.find(t => t.value === documentType)?.hint}</small>
    </label>
    <label>ID number
      <input value={idNumber} onChange={e => setIdNumber(e.target.value)} maxLength={40} autoComplete="off" inputMode={documentType === 'nin_slip' ? 'numeric' : 'text'} placeholder={documentType === 'nin_slip' ? '12345678901' : ''} aria-invalid={errors.idNumber ? 'true' : undefined} data-testid="kyc-id-number" />
      <small className={errors.idNumber ? 'kyc-error' : 'ws-muted'}>{errors.idNumber || ID_HINTS[documentType]}</small>
    </label>
    <div className="kyc-grid">
      <label>Date of birth <span className="ws-muted">(optional)</span><input type="date" value={dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={e => setDateOfBirth(e.target.value)} />{errors.dateOfBirth && <small className="kyc-error">{errors.dateOfBirth}</small>}</label>
      <label>Phone number <span className="ws-muted">(optional)</span><input type="tel" value={phone} maxLength={32} autoComplete="tel" placeholder="+234…" onChange={e => setPhone(e.target.value)} /></label>
    </div>
    <div className="kyc-uploads">
      <FilePicker part="document" documentType={documentType} label="Document upload" help={`Clear photo${docAcceptsPdf ? ' or PDF' : ''} of your ${KYC_DOCUMENT_TYPES.find(t => t.value === documentType)?.label}. JPEG, PNG${docAcceptsPdf ? ' or PDF' : ''}, up to 5 MB.`} accept={docAcceptsPdf ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png'} value={document} onChange={setDocument} error={errors.documentFileKey} />
      <FilePicker part="selfie" documentType={documentType} label="Selfie upload" help={KYC_SELFIE_INSTRUCTION} accept="image/jpeg,image/png" capture="user" value={selfie} onChange={setSelfie} error={errors.selfieFileKey} />
    </div>
    <label className="kyc-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="kyc-consent" /><span>{KYC_CONSENT_TEXT} {errors.consentGiven && <em className="kyc-error">{errors.consentGiven}</em>}</span></label>
    {error && <p role="alert" className="kyc-error">{error}</p>}
    <div className="ws-actions"><button type="submit" className="btn btn--primary" disabled={!ready} data-testid="kyc-submit">{busy ? 'Submitting…' : 'Submit for verification'}</button><span className="ws-muted">Reviewed manually by the Servix team, usually within 12–24 hours.</span></div>
  </form>;
}

function FilePicker({ part, documentType, label, help, accept, capture, value, onChange, error }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => () => { if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl); }, [value]);
  async function pick(file) {
    if (!file) return;
    setBusy(true); setProblem('');
    try { onChange(await uploadKycFile(file, part, documentType)); }
    catch (err) { setProblem(err.message); onChange(null); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  const message = problem || error;
  return <div className={`kyc-picker ${value ? 'has-file' : ''}`} data-testid={`kyc-${part}`}>
    <strong>{label}</strong>
    <p className="ws-muted">{help}</p>
    <div className="kyc-preview" aria-live="polite">
      {busy ? <span className="ws-muted">Checking and uploading…</span>
        : value ? (value.isPdf ? <span className="kyc-pdf"><Icon name="file-text" size={20} />{value.fileName || 'Document.pdf'}</span> : <img src={value.previewUrl} alt={`${label} preview`} />)
        : <span className="ws-muted">No file chosen yet.</span>}
    </div>
    <div className="ws-actions">
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => input.current?.click()}>{value ? 'Replace file' : (part === 'selfie' ? 'Take or choose selfie' : 'Choose file')}</button>
      {value && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onChange(null)}>Remove</button>}
    </div>
    <input ref={input} type="file" accept={accept} capture={capture} hidden onChange={e => pick(e.target.files?.[0])} data-testid={`kyc-${part}-input`} />
    {message && <small className="kyc-error" role="alert">{message}</small>}
    {value && !message && <small className="kyc-ok"><Icon name="check" size={12} /> Uploaded securely</small>}
  </div>;
}

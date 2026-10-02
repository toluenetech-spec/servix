import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar.jsx';
import { uploadFile, limitsFor } from '../../lib/uploadApi.js';

/**
 * Round profile-photo picker. Uploads immediately through the API and hands
 * the stored URL back via onChange(url | null). Shows honest errors when
 * storage is unavailable rather than pretending the upload worked.
 *
 * onChange may return a promise (e.g. saving the URL to the account); while it
 * is pending the button reads "Saving…" and a failure is shown inline.
 * `status` lets the parent show a confirmation ("Photo saved").
 */
export function PhotoUploader({ value, name, onChange, kind = 'avatar', size = 96, label = 'Profile photo', status = '' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [unreachable, setUnreachable] = useState(false);
  const limits = limitsFor(kind);
  useEffect(() => { setUnreachable(false); }, [value]);

  async function commit(url) {
    setBusy('saving');
    try {
      await onChange(url);
    } catch (err) {
      setError(err?.message || 'The photo was uploaded but could not be saved. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('uploading');
    let stored;
    try {
      stored = await uploadFile(file, kind);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
      setBusy('');
      return;
    }
    await commit(stored.url);
  }

  const buttonLabel = busy === 'uploading' ? 'Uploading…' : busy === 'saving' ? 'Saving…' : value ? 'Change photo' : 'Upload photo';

  return (
    <div className="photo-uploader">
      <Avatar src={value} name={name} size={size} onLoadError={() => setUnreachable(true)} />
      <div className="photo-uploader__controls">
        <input ref={inputRef} type="file" accept={limits.pickerAccept || limits.accept} hidden onChange={pick} aria-label={`${label} file`} />
        <div className="ws-actions">
          <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => inputRef.current?.click()}>
            {buttonLabel}
          </button>
          {value && !busy && (
            <button type="button" className="btn btn--ghost" onClick={() => { setError(''); commit(null); }}>
              Remove
            </button>
          )}
        </div>
        <p className="ws-muted" style={{ margin: 0 }}>{limits.label}. A clear photo of your face builds trust with clients.</p>
        {status && !error && !busy && <p role="status" className="ws-muted" style={{ margin: 0, color: 'var(--color-forest)' }}>{status}</p>}
        {unreachable && !error && (
          <p role="alert" className="field__error" style={{ margin: 0 }}>
            Your photo was saved, but the image link cannot be displayed right now. Try uploading again; if this keeps happening, contact support.
          </p>
        )}
        {error && <p role="alert" className="field__error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}

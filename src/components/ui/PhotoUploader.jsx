import { useRef, useState } from 'react';
import { Avatar } from './Avatar.jsx';
import { uploadFile, limitsFor } from '../../lib/uploadApi.js';

/**
 * Round profile-photo picker. Uploads immediately through the API and hands
 * the stored URL back via onChange(url | null). Shows honest errors when
 * storage is unavailable rather than pretending the upload worked.
 */
export function PhotoUploader({ value, name, onChange, kind = 'avatar', size = 96, label = 'Profile photo' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const limits = limitsFor(kind);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const stored = await uploadFile(file, kind);
      onChange(stored.url);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-uploader">
      <Avatar src={value} name={name} size={size} />
      <div className="photo-uploader__controls">
        <input ref={inputRef} type="file" accept={limits.accept} hidden onChange={pick} aria-label={`${label} file`} />
        <div className="ws-actions">
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : value ? 'Change photo' : 'Upload photo'}
          </button>
          {value && !busy && (
            <button type="button" className="btn btn--ghost" onClick={() => { setError(''); onChange(null); }}>
              Remove
            </button>
          )}
        </div>
        <p className="ws-muted" style={{ margin: 0 }}>{limits.label}. A clear photo of your face builds trust with clients.</p>
        {error && <p role="alert" className="field__error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}

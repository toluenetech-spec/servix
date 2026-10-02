/**
 * Last line of defence: Servix must never show a blank page.
 *
 *  - A failed lazy page download (typically a stale tab after a new deploy:
 *    the old index.html asks for chunk files that no longer exist) reloads
 *    the page ONCE so the browser picks up the fresh build.
 *  - Any other render error shows a small recovery panel with a reload
 *    button and the error text, so it can be reported instead of guessed at.
 *
 * `resetKey` (e.g. the pathname) clears the error when the user navigates.
 */
import { Component } from 'react';

const RELOAD_FLAG = 'servix:chunk-reload';

export function isChunkLoadError(error) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(text);
}

/** Reload once for a stale-build failure; returns true when a reload was triggered. */
export function recoverFromStaleBuild() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* storage unavailable — still try once */ }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (isChunkLoadError(error) && recoverFromStaleBuild()) return;
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', error);
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" style={{ maxWidth: 560, margin: '48px auto', padding: '28px 24px', borderRadius: 14, border: '1px solid var(--color-border, #e3e0d8)', background: 'var(--color-surface, #fff)', fontFamily: 'inherit' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>{stale ? 'Servix was just updated' : 'Something went wrong on this page'}</h1>
        <p style={{ margin: '0 0 18px', color: 'var(--color-text-muted, #5f6b63)' }}>
          {stale ? 'Reload to get the latest version.' : 'The rest of Servix is fine. Reload the page, or go back to the previous one. If it keeps happening, send us the message below.'}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={() => { try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ } window.location.reload(); }}>Reload page</button>
          <button type="button" className="btn btn--secondary" onClick={() => { this.setState({ error: null }); window.history.back(); }}>Go back</button>
          <a className="btn btn--ghost" href="/">Home</a>
        </div>
        {!stale && <pre style={{ marginTop: 18, padding: 12, borderRadius: 8, background: 'var(--color-bg, #f6f4ee)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(error?.message || error)}</pre>}
      </div>
    );
  }
}

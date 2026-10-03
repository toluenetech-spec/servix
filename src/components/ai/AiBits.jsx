/** Small shared pieces for every Servix AI surface: label, wait state, error, disclaimer and the task hook. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { aiErrorMessage } from '../../lib/aiHelpers.js';
import './ai.css';

export function AiTag({ children = 'Servix AI', small = false }) {
  return <span className={`ai-tag${small ? ' ai-tag--sm' : ''}`}><Icon name="sparkle" size={small ? 11 : 13} />{children}</span>;
}

/** Honest wait state: AI answers can take a while on the current provider, so we say so after a few seconds. */
export function AiThinking({ label = 'Thinking…', onCancel }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t); }, []);
  return <div className="ai-thinking" role="status" aria-live="polite"><span className="ai-thinking__dots" aria-hidden="true"><i /><i /><i /></span><span>{label}{slow && ' This can take up to a minute.'}</span>{onCancel && <button type="button" className="ai-link" onClick={onCancel}>Stop</button>}</div>;
}

export function AiError({ error, onRetry }) {
  if (!error || error.code === 'CANCELLED') return null;
  return <div className="ai-error" role="alert"><Icon name="alert" size={15} /><span>{aiErrorMessage(error)}</span>{onRetry && <button type="button" className="ai-link" onClick={onRetry}>Try again</button>}</div>;
}

export function AiNote({ children }) {
  return <p className="ai-note">{children ?? 'AI suggestions are drafts — check them before you rely on them. Servix AI never moves money or changes your bookings.'}</p>;
}

/** Shows which model answered and whether the fallback kicked in (no provider details). */
export function AiMeta({ ai }) {
  if (!ai) return null;
  return <small className="ai-meta">Answered in {Math.max(1, Math.round(ai.durationMs / 1000))} s{ai.fallbackUsed ? ' · backup model used' : ''}</small>;
}

/** run(fn) → { busy, error, data }. `fn` receives an AbortSignal; aborted on unmount, on cancel() and on a new run(). */
export function useAiTask() {
  const [state, setState] = useState({ busy: false, error: null, data: null });
  const ctrl = useRef(null);
  const cancel = useCallback(() => { ctrl.current?.abort(); ctrl.current = null; setState((s) => ({ ...s, busy: false })); }, []);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = useCallback(async (fn) => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setState({ busy: true, error: null, data: null });
    try { const data = await fn(c.signal); if (!c.signal.aborted) setState({ busy: false, error: null, data }); return data; }
    catch (error) { if (!c.signal.aborted) setState({ busy: false, error, data: null }); return null; }
  }, []);
  const reset = useCallback(() => { ctrl.current?.abort(); setState({ busy: false, error: null, data: null }); }, []);
  return { ...state, run, cancel, reset };
}

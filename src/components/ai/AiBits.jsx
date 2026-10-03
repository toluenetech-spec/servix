/** Small shared pieces for every Servix AI surface: label, wait state, error, disclaimer and the task hook. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { aiErrorMessage, parseAiMarkdown } from '../../lib/aiHelpers.js';
import { UpgradeNotice } from '../plans/PlanBits.jsx';
import './ai.css';

/* The "S" of the Servix wordmark (public/brand/favicon.svg), used as the assistant's face. */
const SERVIX_S = 'M33.74 0.98Q24.66 0.98 17.92-1.76Q11.18-4.49 7.42-10.06Q3.66-15.62 3.52-24.02L20.07-24.02Q20.31-20.51 22-18.12Q23.68-15.72 26.64-14.53Q29.59-13.33 33.54-13.33Q37.11-13.33 39.70-14.31Q42.29-15.28 43.68-17.04Q45.07-18.80 45.07-21.14Q45.07-23.24 43.77-24.71Q42.48-26.17 39.89-27.29Q37.30-28.42 33.30-29.30L25.59-31.10Q16.16-33.25 10.79-38.13Q5.42-43.02 5.42-51.22Q5.42-57.96 9.08-63.04Q12.74-68.12 19.12-70.92Q25.49-73.73 33.74-73.73Q42.19-73.73 48.39-70.87Q54.59-68.02 58.01-62.92Q61.43-57.81 61.52-51.07L44.97-51.07Q44.63-55.03 41.75-57.23Q38.87-59.42 33.69-59.42Q30.27-59.42 27.93-58.52Q25.59-57.62 24.41-56.03Q23.24-54.44 23.24-52.39Q23.24-50.15 24.56-48.61Q25.88-47.07 28.32-46.04Q30.76-45.02 33.98-44.29L40.28-42.82Q45.56-41.70 49.68-39.77Q53.81-37.84 56.67-35.16Q59.52-32.47 61.01-28.96Q62.50-25.44 62.50-21.09Q62.50-14.21 59.06-9.25Q55.62-4.30 49.19-1.66Q42.77 0.98 33.74 0.98Z';

/**
 * Servix AI mark: the brand "S" on deep forest with a coral spark. `state` drives the motion —
 * idle = slow breathing halo, thinking = orbiting spark, still = no motion (and always still under
 * prefers-reduced-motion). Purely decorative; the parent supplies the accessible name.
 */
export function AiAvatar({ size = 40, state = 'idle', className = '' }) {
  return <span className={`ai-avatar ai-avatar--${state} ${className}`.trim()} style={{ '--ai-avatar-size': `${size}px` }} aria-hidden="true">
    <span className="ai-avatar__halo" />
    <svg className="ai-avatar__mark" viewBox="0 0 32 32" width={size} height={size} focusable="false">
      <rect width="32" height="32" rx="9" fill="#12372a" />
      <g fill="#f7f4ec" transform="translate(9.6 22.6) scale(0.19)"><path d={SERVIX_S} /></g>
    </svg>
    <svg className="ai-avatar__spark" viewBox="0 0 16 16" width={Math.round(size * 0.42)} height={Math.round(size * 0.42)} focusable="false">
      <path d="M8 0.5l1.9 5.6L15.5 8l-5.6 1.9L8 15.5 6.1 9.9.5 8l5.6-1.9z" fill="#e56b5d" />
    </svg>
  </span>;
}

const Inline = ({ nodes }) => nodes.map((n, i) => (n.t === 'text' ? n.v : n.t === 'b' ? <strong key={i}><Inline nodes={n.c} /></strong> : n.t === 'i' ? <em key={i}><Inline nodes={n.c} /></em> : <code key={i}>{n.v}</code>));

/** Renders AI text (light Markdown) as real elements — never as HTML. `streaming` appends a cursor. */
export function AiMarkdown({ text, streaming = false, className = '', as: Tag = 'div', ...rest }) {
  // While streaming, an opening **bold** or `code` marker may not be closed yet — close it so no raw asterisks flash.
  const src = String(text ?? '');
  const balanced = streaming ? src + ((src.split('**').length - 1) % 2 ? '**' : '') + ((src.split('`').length - 1) % 2 ? '`' : '') : src;
  const blocks = parseAiMarkdown(balanced);
  return <Tag className={`ai-md${streaming ? ' ai-md--streaming' : ''} ${className}`.trim()} {...rest}>
    {blocks.map((b, i) => b.type === 'p'
      ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inline nodes={l} /></span>)}</p>
      : b.type === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</ul> : <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</ol>)}
    {streaming && <span className="ai-md__cursor" aria-hidden="true" />}
  </Tag>;
}

export function AiTag({ children = 'Servix AI', small = false }) {
  return <span className={`ai-tag${small ? ' ai-tag--sm' : ''}`}><AiAvatar size={small ? 14 : 18} state="still" />{children}</span>;
}

/** Honest wait state: AI answers can take a while on the current provider, so we say so after a few seconds. */
export function AiThinking({ label = 'Thinking…', onCancel }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t); }, []);
  return <div className="ai-thinking" role="status" aria-live="polite"><span className="ai-thinking__dots" aria-hidden="true"><i /><i /><i /></span><span>{label}{slow && ' Still working — this can take a little while.'}</span>{onCancel && <button type="button" className="ai-link" onClick={onCancel}>Stop</button>}</div>;
}

export const AI_QUOTA_EVENT = 'servix:ai-quota';

export function AiError({ error, onRetry }) {
  if (!error || error.code === 'CANCELLED') return null;
  // Plan boundaries (allowance used up, tool not on this plan) get the calm upgrade card instead of a red error.
  if (error.meta?.kind) return <UpgradeNotice error={error} compact />;
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
    try {
      const data = await fn(c.signal);
      if (!c.signal.aborted) setState({ busy: false, error: null, data });
      if (data?.ai?.quota) window.dispatchEvent(new CustomEvent(AI_QUOTA_EVENT, { detail: data.ai.quota }));
      return data;
    }
    catch (error) { if (!c.signal.aborted) setState({ busy: false, error, data: null }); return null; }
  }, []);
  const reset = useCallback(() => { ctrl.current?.abort(); setState({ busy: false, error: null, data: null }); }, []);
  return { ...state, run, cancel, reset };
}

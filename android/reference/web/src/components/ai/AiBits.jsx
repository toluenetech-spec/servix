/** Small shared pieces for every Servix AI surface: label, wait state, error, disclaimer and the task hook. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { aiErrorMessage, parseAiMarkdown } from '../../lib/aiHelpers.js';
import { sendAiFeedback } from '../../lib/aiApi.js';
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
/** Copy text to the clipboard; falls back to a hidden textarea on browsers without the async clipboard API. */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [state, setState] = useState('idle');
  useEffect(() => { if (state === 'idle') return undefined; const t = setTimeout(() => setState('idle'), 1600); return () => clearTimeout(t); }, [state]);
  return <button type="button" className={`ai-action${className ? ` ${className}` : ''}`} onClick={async () => setState((await copyText(text)) ? 'done' : 'failed')} aria-label={state === 'done' ? 'Copied' : label} title={label} data-testid="ai-copy">
    <Icon name={state === 'done' ? 'check' : 'copy'} size={14} />
    <span>{state === 'done' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : label}</span>
  </button>;
}

/**
 * Copy + "Was this helpful?" under an AI answer. 👍 sends just the rating; 👎 opens a one-line box and tells the
 * user that the question and answer will be shared with the Servix team before anything is sent.
 */
export function AiAnswerActions({ answer, prompt, ai, department = 'assistant', onFeedback }) {
  const [phase, setPhase] = useState('idle'); // idle | asking | sending | thanks | failed
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState(null);
  async function submit(r, note) {
    setPhase('sending'); setRating(r);
    try {
      await sendAiFeedback({ rating: r, department, comment: note, prompt, answer, modelAlias: ai?.model });
      setPhase('thanks'); onFeedback?.(r);
    } catch (e) { setPhase(e?.status === 503 ? 'unavailable' : 'failed'); }
  }
  return <div className="ai-actions" data-testid="ai-answer-actions">
    <CopyButton text={answer} label="Copy" />
    {phase === 'idle' && <span className="ai-actions__ask">
      <span>Helpful?</span>
      <button type="button" className="ai-action" onClick={() => submit('up')} aria-label="Yes, this was helpful" title="Yes"><Icon name="thumbs-up" size={14} /></button>
      <button type="button" className="ai-action" onClick={() => setPhase('asking')} aria-label="No, this was not helpful" title="No"><Icon name="thumbs-down" size={14} /></button>
    </span>}
    {phase === 'asking' && <form className="ai-feedback-form" onSubmit={(e) => { e.preventDefault(); submit('down', comment.trim() || undefined); }}>
      <label className="ws-muted" htmlFor="ai-feedback-comment">Sorry about that. What was wrong? (optional)</label>
      <textarea id="ai-feedback-comment" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. the answer was outdated / not what I asked" />
      <small className="ws-muted">Your question and this answer will be shared with the Servix team so we can fix it.</small>
      <div className="ai-feedback-form__row">
        <button type="submit" className="ai-action ai-action--primary">Send</button>
        <button type="button" className="ai-link" onClick={() => setPhase('idle')}>Cancel</button>
      </div>
    </form>}
    {phase === 'sending' && <small className="ws-muted">Sending…</small>}
    {phase === 'thanks' && <small className="ai-actions__thanks">{rating === 'up' ? 'Thanks for the feedback!' : 'Thanks — we’ll look into it.'}</small>}
    {phase === 'unavailable' && <small className="ws-muted">Feedback isn’t available right now.</small>}
    {phase === 'failed' && <small className="ws-muted">Couldn’t send feedback. <button type="button" className="ai-link" onClick={() => setPhase('idle')}>Try again</button></small>}
  </div>;
}

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

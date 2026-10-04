/**
 * AI Concierge: a floating chat for signed-in members (workspace pages). The backend grounds answers in real
 * Servix data through read-only tools; this component only renders the text it returns. Nothing here can
 * book, pay or change anything. Conversation lives in memory for the page session only.
 *
 * Answers stream in word by word (server-sent events) so the first words appear in a few seconds even when the
 * provider needs longer for the whole reply; closing the panel or pressing Stop aborts the request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { askAssistant } from '../../lib/aiApi.js';
import { AiAvatar, AiError, AiMarkdown, AiMeta, AiNote, AiThinking, useAiTask } from './AiBits.jsx';

const STARTERS = {
  customer: ['Who can design a logo for a small bakery in Lagos?', 'How does payment protection work on Servix?', 'What does “delivered” mean on my booking?'],
  professional: ['Which open requests fit my skills?', 'How do payouts work?', 'How can I get more bookings?'],
  admin: ['Who created gigs today?', 'What is waiting for review right now?', 'Which accounts signed up this week?', 'Show open disputes.'],
};
const MAX_TURNS = 20;

export function AiChat({ role = 'customer', compact = false }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState('');
  const [lastMeta, setLastMeta] = useState(null);
  const task = useAiTask();
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: draft ? 'auto' : 'smooth' }); }, [messages, task.busy, draft]);

  async function send(content) {
    const q = (content ?? text).trim();
    if (!q || task.busy) return;
    const next = [...messages, { role: 'user', content: q }].slice(-MAX_TURNS);
    setMessages(next); setText(''); setDraft('');
    let partial = '';
    const r = await task.run((signal) => askAssistant(next, { signal, onDelta: (t) => { partial += t; setDraft(partial); } }));
    setDraft('');
    if (r) { setMessages((m) => [...m, { role: 'assistant', content: r.answer }].slice(-MAX_TURNS)); setLastMeta(r.ai); }
  }
  const stop = () => { task.cancel(); setDraft(''); setMessages((m) => (m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m)); };

  return <div className={`ai-chat${compact ? ' ai-chat--compact' : ''}`} data-testid="ai-chat">
    <div className="ai-chat__log" ref={logRef} aria-live="polite" aria-label="Conversation">
      {messages.length === 0 && <div className="ai-chat__welcome">
        <AiAvatar size={44} state="idle" />
        <div>
          <p className="ai-chat__hello">Hi — I’m Servix AI.</p>
          <p className="ws-muted">Ask about professionals, prices, availability, requests or how Servix works. Answers come from real Servix data.</p>
        </div>
        <div className="ai-chat__starters">{(STARTERS[role] ?? STARTERS.customer).map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}</div>
      </div>}
      {messages.map((m, i) => (m.role === 'user'
        ? <div key={i} className="ai-msg ai-msg--user">{m.content}</div>
        : <div key={i} className="ai-msg-row"><AiAvatar size={26} state="still" /><AiMarkdown className="ai-msg ai-msg--ai" text={m.content} /></div>))}
      {task.busy && draft && <div className="ai-msg-row"><AiAvatar size={26} state="thinking" /><AiMarkdown className="ai-msg ai-msg--ai" text={draft} streaming data-testid="ai-streaming" /></div>}
      {task.busy && !draft && <AiThinking label="Looking that up…" onCancel={stop} />}
      {task.busy && draft && <button type="button" className="ai-link ai-chat__stop" onClick={stop}>Stop</button>}
      <AiError error={task.error} onRetry={() => { const last = messages[messages.length - 1]; if (last?.role === 'user') { setMessages((m) => m.slice(0, -1)); send(last.content); } }} />
      {!task.busy && lastMeta && messages.length > 0 && <AiMeta ai={lastMeta} />}
    </div>
    <form className="ai-chat__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea rows={compact ? 1 : 2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Ask Servix AI…" aria-label="Your question" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <button type="submit" className="ai-chat__send" disabled={task.busy || !text.trim()} aria-label="Send"><Icon name="arrow-right" size={16} /></button>
    </form>
    {!compact && <AiNote />}
  </div>;
}

const CLOSE_MS = 260;

/** Floating launcher + panel. Mount once inside the workspace shell when the `ai` flag is on. */
export function AiAssistantLauncher({ role }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [seen, setSeen] = useState(() => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('servix-ai-seen') === '1');
  const timer = useRef(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const close = useCallback(() => {
    if (reduced) { setOpen(false); return; }
    setClosing(true);
    timer.current = setTimeout(() => { setClosing(false); setOpen(false); }, CLOSE_MS);
  }, [reduced]);
  const launch = () => { setOpen(true); setSeen(true); try { sessionStorage.setItem('servix-ai-seen', '1'); } catch { /* private mode */ } };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!open) return; const esc = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [open, close]);

  return <>
    <button type="button" className={`ai-fab${open ? ' ai-fab--hidden' : ''}${seen ? '' : ' ai-fab--new'}`} onClick={launch} aria-haspopup="dialog" aria-expanded={open} aria-label="Ask Servix AI" data-testid="ai-launcher" tabIndex={open ? -1 : 0}>
      <AiAvatar size={38} state="idle" />
      <span className="ai-fab__label"><strong>Servix AI</strong><small>Ask me anything</small></span>
    </button>
    {open && <>
      <div className={`ai-scrim${closing ? ' ai-scrim--out' : ''}`} onClick={close} aria-hidden="true" />
      <section className={`ai-panel-float${closing ? ' ai-panel-float--out' : ''}`} role="dialog" aria-label="Servix AI assistant" data-testid="ai-panel">
        <header className="ai-panel-float__head">
          <div className="ai-panel-float__title"><AiAvatar size={32} state="idle" /><div><strong>Servix AI</strong><small>Grounded in real Servix data</small></div></div>
          <button type="button" className="ai-panel-float__close" onClick={close} aria-label="Close assistant"><Icon name="close" size={18} /></button>
        </header>
        <div className="ai-panel-float__body"><AiChat role={role} compact /></div>
      </section>
    </>}
  </>;
}

/**
 * AI Concierge: a floating chat for signed-in members (workspace pages). The backend grounds answers in real
 * Servix data through read-only tools; this component only renders the text it returns. Nothing here can
 * book, pay or change anything. Conversation lives in memory for the page session only.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { askAssistant } from '../../lib/aiApi.js';
import { AiError, AiMeta, AiNote, AiTag, AiThinking, useAiTask } from './AiBits.jsx';

const STARTERS = {
  customer: ['Who can design a logo for a small bakery in Lagos?', 'How does payment protection work on Servix?', 'What does “delivered” mean on my booking?'],
  professional: ['Which open requests fit my skills?', 'How do payouts work?', 'How can I get more bookings?'],
  admin: ['Explain the Servix trust score.', 'How does the request → proposal flow work?'],
};
const MAX_TURNS = 20;

export function AiChat({ role = 'customer', compact = false }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [lastMeta, setLastMeta] = useState(null);
  const task = useAiTask();
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, task.busy]);

  async function send(content) {
    const q = (content ?? text).trim();
    if (!q || task.busy) return;
    const next = [...messages, { role: 'user', content: q }].slice(-MAX_TURNS);
    setMessages(next); setText('');
    const r = await task.run((signal) => askAssistant(next, { signal }));
    if (r) { setMessages((m) => [...m, { role: 'assistant', content: r.answer }].slice(-MAX_TURNS)); setLastMeta(r.ai); }
  }

  return <div className="ai-chat" data-testid="ai-chat">
    <div className="ai-chat__log" ref={logRef} aria-live="polite" aria-label="Conversation">
      {messages.length === 0 && <div>
        <p className="ws-muted" style={{ marginBottom: 10 }}>Ask about professionals, prices, availability, requests or how Servix works. Answers come from real Servix data.</p>
        <div className="ai-chat__starters">{(STARTERS[role] ?? STARTERS.customer).map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}</div>
      </div>}
      {messages.map((m, i) => <div key={i} className={`ai-msg ai-msg--${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>)}
      {task.busy && <AiThinking label="Looking that up…" onCancel={() => { task.cancel(); setMessages((m) => (m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m)); }} />}
      <AiError error={task.error} onRetry={() => { const last = messages[messages.length - 1]; if (last?.role === 'user') { setMessages((m) => m.slice(0, -1)); send(last.content); } }} />
      {!task.busy && lastMeta && messages.length > 0 && <AiMeta ai={lastMeta} />}
    </div>
    <form className="ai-chat__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea rows={compact ? 1 : 2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Type your question…" aria-label="Your question" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <button type="submit" className="btn btn--primary" disabled={task.busy || !text.trim()} style={{ padding: '9px 14px', fontSize: 12 }}>Send</button>
    </form>
    {!compact && <AiNote />}
  </div>;
}

/** Floating launcher + panel. Mount once inside the workspace shell when the `ai` flag is on. */
export function AiAssistantLauncher({ role }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const esc = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [open]);
  return <>
    {!open && <button type="button" className="ai-fab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} data-testid="ai-launcher"><Icon name="sparkle" size={16} /><span>Ask Servix AI</span></button>}
    {open && <>
      <div className="ai-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <section className="ai-panel-float" role="dialog" aria-label="Servix AI assistant" data-testid="ai-panel">
        <header className="ai-panel-float__head"><strong><AiTag /> Assistant</strong><button type="button" className="modal__close" onClick={() => setOpen(false)} aria-label="Close assistant"><Icon name="close" size={18} /></button></header>
        <div className="ai-panel-float__body"><AiChat role={role} compact /></div>
      </section>
    </>}
  </>;
}

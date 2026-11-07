/* "Servix AI" as a conversation inside Messages. Same streaming endpoint as the AI page; history is kept on this
 * device only (localStorage, last 40 turns) — the assistant is read-only and never acts on your account. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { askAssistant } from '../../lib/aiApi.js';
import { AiAvatar, AiMarkdown, useAiTask } from '../ai/AiBits.jsx';
import { I } from './ChatBits.jsx';
import { timeOf, dayLabel } from './chatUtils.js';

const STARTERS = {
  customer: ['Who can design a logo for a small bakery in Lagos?', 'How does payment protection work on Servix?', 'What does “delivered” mean on my booking?'],
  professional: ['Which open requests fit my skills?', 'How do payouts work?', 'How can I get more bookings?'],
  admin: ['Who created gigs today?', 'What is waiting for review right now?', 'Show open disputes.'],
};
const MAX_TURNS = 40;
const storageKey = (userId) => `servix-ai-messages-${userId}`;

export function loadAiHistory(userId) {
  try { const raw = localStorage.getItem(storageKey(userId)); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; }
}

export function AiThread({ user, role, onBack }) {
  const [messages, setMessages] = useState(() => loadAiHistory(user.id));
  const [text, setText] = useState('');
  const [draft, setDraft] = useState('');
  const task = useAiTask();
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(storageKey(user.id), JSON.stringify(messages.slice(-MAX_TURNS))); } catch { /* quota/private mode */ } }, [messages, user.id]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, draft, task.busy]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  async function send(content) {
    const q = (content ?? text).trim();
    if (!q || task.busy) return;
    const next = [...messages, { role: 'user', content: q, at: new Date().toISOString() }].slice(-MAX_TURNS);
    setMessages(next); setText(''); setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    let partial = '';
    const history = next.map(({ role: rl, content: c }) => ({ role: rl, content: c })).slice(-20);
    const r = await task.run((signal) => askAssistant(history, { signal, onDelta: (t) => { partial += t; setDraft(partial); } }));
    setDraft('');
    if (r) setMessages((m) => [...m, { role: 'assistant', content: r.answer, at: new Date().toISOString() }].slice(-MAX_TURNS));
  }
  const stop = () => { task.cancel(); setDraft(''); };
  const clear = () => { if (window.confirm('Clear your Servix AI chat on this device?')) { setMessages([]); task.reset(); } };

  const grouped = useMemo(() => {
    const out = []; let lastDay = '';
    for (const [i, m] of messages.entries()) {
      const day = m.at ? dayLabel(m.at) : 'Today';
      if (day !== lastDay) { out.push({ kind: 'day', key: `d${i}`, label: day }); lastDay = day; }
      out.push({ kind: 'msg', key: `m${i}`, m, i });
    }
    return out;
  }, [messages]);

  return (
    <>
      <header className="msg-chat-head">
        <button type="button" className="msg-icon-btn msg-back" onClick={onBack} aria-label="Back to conversations">{I.back}</button>
        <span className="msg-chat-person">
          <AiAvatar size={40} state={task.busy ? 'thinking' : 'idle'} />
          <span><strong>Servix AI</strong><small className={task.busy ? 'typing' : ''}>{task.busy ? 'typing…' : 'Always online · answers from real Servix data'}</small></span>
        </span>
        {messages.length > 0 && <button type="button" className="msg-icon-btn" onClick={clear} aria-label="Clear chat" title="Clear chat">{I.broom}</button>}
      </header>
      <div className="msg-scroll ai" ref={logRef} role="log" aria-live="polite" aria-label="Servix AI conversation">
        <div className="msg-notice"><i>{I.shield}</i>Servix AI can look things up for you — professionals, prices, availability, your bookings — but it never books, pays or changes anything.</div>
        {messages.length === 0 && (
          <div className="msg-ai-welcome">
            <p>Hi {user.fullName?.split(' ')[0] || 'there'} — ask me anything about Servix.</p>
            <div>{(STARTERS[role] ?? STARTERS.customer).map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {grouped.map((item) => {
          if (item.kind === 'day') return <div key={item.key} className="msg-day"><span>{item.label}</span></div>;
          const { m } = item; const mine = m.role === 'user';
          return (
            <div key={item.key} className={`msg-row ${mine ? 'mine' : 'theirs'}`}>
              <div className={`msg-bubble ${mine ? 'mine' : 'theirs ai'}`}>
                {mine ? <p>{m.content}</p> : <AiMarkdown className="msg-md" text={m.content} />}
                <span className="msg-meta"><time dateTime={m.at}>{m.at ? timeOf(m.at) : ''}</time>{mine && <svg className="msg-tick double seen" viewBox="0 0 30 24" aria-label="Seen"><path d="M2 12.5l5 5L17 7" /><path d="M10.5 15.5l2.5 2L25 7" /></svg>}</span>
              </div>
            </div>
          );
        })}
        {task.busy && draft && <div className="msg-row theirs"><div className="msg-bubble theirs ai"><AiMarkdown className="msg-md" text={draft} streaming /></div></div>}
        {task.busy && !draft && <div className="msg-row theirs typing"><div className="msg-bubble theirs"><span className="msg-dots"><i /><i /><i /></span></div></div>}
        {task.error && <p className="msg-muted center" role="alert">{task.error.message || 'Servix AI could not answer right now.'} <button type="button" className="msg-link" onClick={() => { const last = messages[messages.length - 1]; if (last?.role === 'user') { setMessages((m) => m.slice(0, -1)); send(last.content); } }}>Retry</button></p>}
      </div>
      <form className="msg-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="ai-message-text">Ask Servix AI</label>
        <div className="msg-compose-row">
        <textarea id="ai-message-text" ref={inputRef} rows={1} maxLength={4000} placeholder="Ask Servix AI…" value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        {task.busy ? <button type="button" className="msg-send stop" onClick={stop} aria-label="Stop"><span /></button> : <button className="msg-send" disabled={!text.trim()} aria-label="Send">{I.send}</button>}
        </div>
      </form>
      <p className="msg-safety">Servix AI is read-only. Kept on this device only — <span className="msg-kbd-hint">Enter to send · </span>answers may be imperfect.</p>
    </>
  );
}

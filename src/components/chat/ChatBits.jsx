/* Presentational pieces of the Messages UI: avatars, ticks, bubbles, attachments, audio player, lightbox, emoji. */
import { useEffect, useRef, useState } from 'react';
import { initials, timeOf, tickState, formatDuration, formatBytes, fileLabel, linkParts, isLocationMessage, LOCATION_PREFIX, QUICK_REACTIONS, EMOJI_GROUPS, mediaSrc } from './chatUtils.js';

/* ---------------- avatar & ticks ---------------- */

export function Avatar({ person, size = 44, online, src: srcProp }) {
  const src = srcProp ?? person?.professionalProfile?.imageUrl ?? person?.avatarUrl;
  return (
    <span className="msg-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : initials(person?.fullName)}
      {online && <i className="msg-online" />}
    </span>
  );
}

export function Ticks({ state }) {
  if (state === 'pending') return <svg className="msg-tick pending" viewBox="0 0 24 24" aria-label="Sending"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  if (state === 'failed') return <svg className="msg-tick failed" viewBox="0 0 24 24" aria-label="Not sent"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16.5h.01" /></svg>;
  if (state === 'sent') return <svg className="msg-tick" viewBox="0 0 24 24" aria-label="Sent"><path d="M4 12.5l5 5L19 7" /></svg>;
  return (
    <svg className={`msg-tick double ${state === 'seen' ? 'seen' : ''}`} viewBox="0 0 30 24" aria-label={state === 'seen' ? 'Seen' : 'Delivered'}>
      <path d="M2 12.5l5 5L17 7" /><path d="M10.5 15.5l2.5 2L25 7" />
    </svg>
  );
}

export function TypingBubble({ name }) {
  return (
    <div className="msg-row theirs typing" aria-live="polite" aria-label={`${name ?? 'They'} is typing`}>
      <div className="msg-bubble theirs"><span className="msg-dots"><i /><i /><i /></span></div>
    </div>
  );
}

export const I = {
  user: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  calendar: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  link: <svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  flag: <svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5" /></svg>,
  info: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
  pin: <svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  photo: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>,
  doc: <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>,
  mic: <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  smile: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  back: <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>,
  block: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  reply: <svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>,
  copy: <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  trash: <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16" /></svg>,
  play: <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></svg>,
  pause: <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></svg>,
  chevron: <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>,
  broom: <svg viewBox="0 0 24 24"><path d="M19 4 9.5 13.5M7 11l6 6-3 3-7-5z" /></svg>,
};

/* ---------------- text ---------------- */

export function MessageText({ body }) {
  return <p>{linkParts(body).map((p, i) => (p.url ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">{p.text.length > 60 ? `${p.text.slice(0, 57)}…` : p.text}</a> : <span key={i}>{p.text}</span>))}</p>;
}

/* ---------------- audio player ---------------- */

export function AudioPlayer({ src, durationMs, mine }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState((durationMs || 0) / 1000);
  const [rate, setRate] = useState(1);
  const [err, setErr] = useState(false);
  useEffect(() => { const a = audio.current; if (!a) return undefined; const stop = () => { setPlaying(false); setT(0); }; a.addEventListener('ended', stop); return () => a.removeEventListener('ended', stop); }, []);
  const toggle = async () => {
    const a = audio.current; if (!a) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    try { document.querySelectorAll('audio.msg-audio-el').forEach((o) => { if (o !== a) o.pause(); }); a.playbackRate = rate; await a.play(); setPlaying(true); } catch { setErr(true); }
  };
  const cycleRate = () => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audio.current) audio.current.playbackRate = next; };
  const seek = (e) => { const a = audio.current; if (!a || !dur) return; const r = e.currentTarget.getBoundingClientRect(); const x = ('clientX' in e ? e.clientX : e.touches?.[0]?.clientX ?? 0) - r.left; a.currentTime = Math.max(0, Math.min(1, x / r.width)) * dur; setT(a.currentTime); };
  const pct = dur ? Math.min(100, (t / dur) * 100) : 0;
  const bars = 28;
  return (
    <div className={`msg-audio ${mine ? 'mine' : ''} ${playing ? 'playing' : ''}`}>
      <audio ref={audio} className="msg-audio-el" src={src} preload="metadata" onTimeUpdate={() => setT(audio.current?.currentTime ?? 0)} onLoadedMetadata={() => { const d = audio.current?.duration; if (d && Number.isFinite(d)) setDur(d); }} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <button type="button" className="msg-audio-btn" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>{playing ? I.pause : I.play}</button>
      <div className="msg-audio-track" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} tabIndex={0}>
        <div className="msg-audio-bars" aria-hidden="true">
          {Array.from({ length: bars }).map((_, i) => <i key={i} style={{ height: `${30 + Math.abs(Math.sin(i * 1.7) * 55 + Math.cos(i * 0.9) * 15)}%` }} className={(i / bars) * 100 <= pct ? 'done' : ''} />)}
        </div>
      </div>
      <div className="msg-audio-meta">
        <span>{formatDuration((playing || t > 0 ? t : dur) * 1000)}</span>
        <button type="button" className="msg-audio-rate" onClick={cycleRate} aria-label="Playback speed">{rate}×</button>
      </div>
      {err && <small className="msg-audio-err">Can’t play here — <a href={src} target="_blank" rel="noopener noreferrer">open</a></small>}
    </div>
  );
}

/* ---------------- lightbox ---------------- */

export function Lightbox({ src, name, onClose }) {
  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  return (
    <div className="msg-lightbox" role="dialog" aria-label="Photo" onClick={onClose}>
      <div className="msg-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>{name || 'Photo'}</span>
        <a className="msg-icon-btn light" href={src} download={name || 'photo'} target="_blank" rel="noopener noreferrer" aria-label="Download">{I.download}</a>
        <button type="button" className="msg-icon-btn light" onClick={onClose} aria-label="Close">{I.close}</button>
      </div>
      <img src={src} alt={name || 'Photo'} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

/* ---------------- emoji ---------------- */

export function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const out = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); }; document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out); }, [onClose]);
  return (
    <div className="msg-emoji" ref={ref} role="dialog" aria-label="Emoji">
      {EMOJI_GROUPS.map((g) => (
        <div key={g.label} className="msg-emoji-group">
          <small>{g.label}</small>
          <div>{g.items.map((e) => <button type="button" key={e} onClick={() => onPick(e)} aria-label={e}>{e}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- action sheet ---------------- */

export function ActionSheet({ message, mine, anchor, onClose, onReact, onReply, onCopy, onDelete }) {
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', out); document.addEventListener('touchstart', out, { passive: true }); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const mobile = typeof window !== 'undefined' && window.innerWidth <= 880;
  const style = mobile || !anchor ? undefined : { left: Math.min(Math.max(12, anchor.x - 120), window.innerWidth - 272), top: Math.min(Math.max(12, anchor.y - 10), window.innerHeight - 260) };
  const mineReaction = Object.keys(message.reactions || {}).find((e) => (message.reactions[e] || []).includes(mine.userId));
  const deleted = message.kind === 'deleted';
  return (
    <>
      <div className="msg-sheet-scrim" aria-hidden="true" />
      <div className={`msg-sheet ${mobile ? 'bottom' : ''}`} style={style} ref={ref} role="menu" aria-label="Message actions">
        {!deleted && <div className="msg-sheet-reactions">{QUICK_REACTIONS.map((e) => <button type="button" key={e} className={mineReaction === e ? 'on' : ''} onClick={() => onReact(e)} aria-label={`React ${e}`}>{e}</button>)}</div>}
        {!deleted && <button type="button" role="menuitem" onClick={onReply}>{I.reply}<span>Reply</span></button>}
        {!deleted && message.body && <button type="button" role="menuitem" onClick={onCopy}>{I.copy}<span>Copy text</span></button>}
        {!deleted && message.attachment?.url && <a role="menuitem" href={mediaSrc(message.attachment.url)} download={message.attachment.name || true} target="_blank" rel="noopener noreferrer" onClick={onClose}>{I.download}<span>Download</span></a>}
        {mine.isMine && !deleted && <button type="button" role="menuitem" className="danger" onClick={onDelete}>{I.trash}<span>Delete for everyone</span></button>}
        {deleted && <p className="msg-sheet-note">This message was deleted.</p>}
        {mobile && <button type="button" role="menuitem" className="cancel" onClick={onClose}>Cancel</button>}
      </div>
    </>
  );
}

/* ---------------- bubble ---------------- */

function ReplyQuote({ replyTo, me, otherName, onJump }) {
  if (!replyTo) return null;
  const who = replyTo.senderId === me ? 'You' : otherName;
  const text = replyTo.kind === 'deleted' ? 'Message deleted' : replyTo.kind === 'image' ? (replyTo.body ? `📷 ${replyTo.body}` : '📷 Photo') : replyTo.kind === 'audio' ? '🎤 Voice note' : replyTo.kind === 'file' ? `📄 ${replyTo.attachmentName || 'File'}` : replyTo.body || 'Message';
  return (
    <button type="button" className="msg-quote" onClick={() => onJump?.(replyTo.id)}>
      <strong>{who}</strong><span>{text}</span>
    </button>
  );
}

export function Reactions({ reactions, me, onToggle }) {
  const entries = Object.entries(reactions || {}).filter(([, users]) => users.length);
  if (!entries.length) return null;
  return (
    <div className="msg-reactions">
      {entries.map(([emoji, users]) => <button type="button" key={emoji} className={users.includes(me) ? 'mine' : ''} onClick={() => onToggle(emoji)} aria-label={`${emoji} ${users.length}`}>{emoji}{users.length > 1 && <small>{users.length}</small>}</button>)}
    </div>
  );
}

export function MessageBubble({ m, mine, grouped, me, otherName, thread, onOpenActions, onOpenImage, onJump, onToggleReaction, onRetry }) {
  const pressTimer = useRef(null);
  const location = isLocationMessage(m);
  const url = location ? m.body.slice(LOCATION_PREFIX.length).trim() : '';
  const deleted = m.kind === 'deleted';
  const open = (e) => { e.preventDefault(); onOpenActions(m, { x: e.clientX ?? 0, y: e.clientY ?? 0 }); };
  const touchStart = (e) => { const t = e.touches[0]; pressTimer.current = setTimeout(() => { onOpenActions(m, { x: t.clientX, y: t.clientY }); }, 450); };
  const touchEnd = () => clearTimeout(pressTimer.current);
  const progress = m.uploadProgress;
  return (
    <div id={`msg-${m.id}`} className={`msg-row ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${m.failed ? 'failed' : ''} ${m.kind === 'image' ? 'has-image' : ''}`}>
      <div className={`msg-bubble ${mine ? 'mine' : 'theirs'} ${m.kind} ${location ? 'location' : ''}`} onContextMenu={open} onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchMove={touchEnd} onTouchCancel={touchEnd}>
        {!deleted && <button type="button" className="msg-more" onClick={open} aria-label="Message options">{I.chevron}</button>}
        {!deleted && <ReplyQuote replyTo={m.replyTo} me={me} otherName={otherName} onJump={onJump} />}
        {deleted && <p className="msg-deleted"><i>{I.block}</i>{mine ? 'You deleted this message' : 'This message was deleted'}</p>}
        {!deleted && m.kind === 'image' && m.attachment?.url && (
          <button type="button" className="msg-image" onClick={() => !m.pending && onOpenImage(m.attachment)} style={m.attachment.width && m.attachment.height ? { aspectRatio: `${m.attachment.width} / ${m.attachment.height}` } : undefined}>
            <img src={mediaSrc(m.attachment.url)} alt={m.body || 'Photo'} loading="lazy" draggable="false" />
            {m.pending && <span className="msg-upload"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="bar" style={{ strokeDashoffset: 94.2 * (1 - (progress ?? 0)) }} /></svg></span>}
          </button>
        )}
        {!deleted && m.kind === 'audio' && m.attachment?.url && (m.pending ? <div className="msg-audio pending"><span className="msg-audio-btn"><svg viewBox="0 0 36 36" className="spin"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="bar" style={{ strokeDashoffset: 94.2 * (1 - (progress ?? 0)) }} /></svg></span><span className="msg-audio-track" /><span className="msg-audio-meta">{formatDuration(m.attachment.durationMs)}</span></div> : <AudioPlayer src={mediaSrc(m.attachment.url)} durationMs={m.attachment.durationMs} mine={mine} />)}
        {!deleted && m.kind === 'file' && m.attachment && (
          <a className="msg-file" href={m.pending ? undefined : mediaSrc(m.attachment.url)} target="_blank" rel="noopener noreferrer" download={m.attachment.name}>
            <span className="msg-file-badge">{m.pending ? <svg viewBox="0 0 36 36" className="spin"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="bar" style={{ strokeDashoffset: 94.2 * (1 - (progress ?? 0)) }} /></svg> : fileLabel(m.attachment.mime, m.attachment.name)}</span>
            <span className="msg-file-text"><strong>{m.attachment.name}</strong><small>{formatBytes(m.attachment.size)}{m.pending ? ' · uploading…' : ''}</small></span>
            {!m.pending && <span className="msg-file-dl">{I.download}</span>}
          </a>
        )}
        {!deleted && location && (
          <a className="msg-location" href={url} target="_blank" rel="noopener noreferrer">
            <span className="msg-location-pin">{I.pin}</span>
            <span><strong>{mine ? 'Your location' : `${(otherName || '').split(' ')[0]}'s location`}</strong><small>Open in Maps</small></span>
          </a>
        )}
        {!deleted && !location && m.kind !== 'file' && m.kind !== 'audio' && m.body && <MessageText body={m.body} />}
        <span className="msg-meta"><time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>{mine && !deleted && <Ticks state={tickState(m, thread)} />}</span>
      </div>
      <Reactions reactions={m.reactions} me={me} onToggle={(e) => onToggleReaction(m, e)} />
      {m.failed && <button type="button" className="msg-retry" onClick={() => onRetry(m)}>Not sent{m.failReason ? ` — ${m.failReason}` : ''} · Tap to retry</button>}
    </div>
  );
}

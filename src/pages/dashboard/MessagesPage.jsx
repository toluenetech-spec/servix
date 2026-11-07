import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useWorkspace } from '../../components/dashboard/WorkspaceShell.jsx';
import { getMyBookings, getProBookings } from '../../lib/bookingApi.js';
import * as api from '../../lib/workspaceApi.js';
import { subscribeChatEvents } from '../../lib/chatRealtime.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { PageHead, LoadState, Empty, useResource } from './shared.jsx';
import { ListSkeleton, Skeleton } from '../../components/ui/States.jsx';
import { CommunityGate } from './NetworkPage.jsx';
import './messages.css';

export default function MessagesPage() {
  useDocumentMeta({ title: 'Messages', description: 'Your private Servix conversations.' });
  return (
    <>
      <PageHead title="Messages" description="Talk to the people behind your bookings and connections — live, private, inside Servix." />
      <CommunityGate><MessagesContent /></CommunityGate>
    </>
  );
}

/* ------------------------------------------------------------------ helpers */

const TYPING_TTL = 4500;
const LOCATION_PREFIX = '📍 My location: ';
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso) {
  const d = new Date(iso); const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function relativeSeen(iso) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const d = new Date(iso); const label = dayLabel(iso);
  return `Last seen ${label === 'Today' ? '' : `${label} at `}${timeOf(d)}`.replace('  ', ' ');
}
function listTime(iso) {
  if (!iso) return '';
  const label = dayLabel(iso);
  return label === 'Today' ? timeOf(iso) : label;
}
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'S';
const sortMessages = (list) => list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const after = (iso, mark) => Boolean(mark) && new Date(mark).getTime() >= new Date(iso).getTime();

function tickState(m, thread) {
  if (m.pending) return 'pending';
  if (m.failed) return 'failed';
  if (after(m.createdAt, thread?.otherReadAt)) return 'seen';
  if (after(m.createdAt, thread?.otherDeliveredAt)) return 'delivered';
  return 'sent';
}

function renderBody(body) {
  const parts = body.split(URL_RE);
  return parts.map((part, i) => (i % 2 === 1
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part.length > 60 ? `${part.slice(0, 57)}…` : part}</a>
    : <span key={i}>{part}</span>));
}

/* ------------------------------------------------------------------ atoms */

function Avatar({ person, size = 44, online }) {
  const src = person?.professionalProfile?.imageUrl;
  return (
    <span className="msg-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : initials(person?.fullName)}
      {online && <i className="msg-online" />}
    </span>
  );
}

function Ticks({ state }) {
  if (state === 'pending') return <svg className="msg-tick pending" viewBox="0 0 24 24" aria-label="Sending"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  if (state === 'failed') return <svg className="msg-tick failed" viewBox="0 0 24 24" aria-label="Not sent"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16.5h.01" /></svg>;
  if (state === 'sent') return <svg className="msg-tick" viewBox="0 0 24 24" aria-label="Sent"><path d="M4 12.5l5 5L19 7" /></svg>;
  return (
    <svg className={`msg-tick double ${state === 'seen' ? 'seen' : ''}`} viewBox="0 0 30 24" aria-label={state === 'seen' ? 'Seen' : 'Delivered'}>
      <path d="M2 12.5l5 5L17 7" /><path d="M10.5 15.5l2.5 2L25 7" />
    </svg>
  );
}

function TypingBubble({ person }) {
  return (
    <div className="msg-row theirs typing" aria-live="polite" aria-label={`${person?.fullName ?? 'They'} is typing`}>
      <div className="msg-bubble theirs"><span className="msg-dots"><i /><i /><i /></span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ main */

function MessagesContent() {
  const { user } = useAuth();
  const { overview } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('thread');

  const [threads, setThreads] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [byThread, setByThread] = useState({}); // id → { messages, before, canSend, loaded, loading, error }
  const [presence, setPresence] = useState({}); // userId → { online, lastSeen }
  const [typing, setTyping] = useState({}); // threadId → expiresAt
  const [stream, setStream] = useState('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [booking, setBooking] = useState('');
  const [query, setQuery] = useState('');

  const activeRef = useRef(activeId); activeRef.current = activeId;
  const listRef = useRef(null);
  const stickToBottom = useRef(true);
  const [unseenBelow, setUnseenBelow] = useState(0);
  const typingSentAt = useRef(0);
  const typingStopTimer = useRef(null);
  const textareaRef = useRef(null);

  const bookings = useResource(async () => {
    const mine = await getMyBookings();
    const work = overview?.canManageServices ? await getProBookings() : [];
    return [...new Map([...mine, ...work].map((b) => [b.id, b])).values()];
  }, [overview?.canManageServices]);

  /* ---- threads ---- */
  const loadThreads = useCallback(async () => {
    try {
      const data = await api.getThreads();
      setThreads(data);
      setThreadError('');
      setPresence((old) => {
        const next = { ...old };
        for (const t of data) next[t.person.id] = { online: t.online, lastSeen: t.lastSeenAt ?? old[t.person.id]?.lastSeen ?? null };
        return next;
      });
    } catch (e) { setThreadError(e.message); }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Fallback polling only while the live stream is not available.
  useEffect(() => {
    if (stream === 'live') return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadThreads();
      if (activeRef.current) loadMessages(activeRef.current, { merge: true });
    }, 15_000);
    return () => clearInterval(timer);
  }, [stream, loadThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- messages ---- */
  const loadMessages = useCallback(async (id, { merge = false } = {}) => {
    setByThread((old) => ({ ...old, [id]: { ...(old[id] ?? { messages: [] }), loading: !merge && !old[id]?.loaded, error: '' } }));
    try {
      const data = await api.getMessages(id);
      setByThread((old) => {
        const prev = old[id] ?? { messages: [] };
        const map = new Map(prev.messages.filter((m) => !m.pending || !data.messages.some((d) => d.clientId === m.clientId)).map((m) => [m.id, m]));
        for (const m of data.messages) map.set(m.id, m);
        return { ...old, [id]: { ...prev, messages: sortMessages([...map.values()]), before: prev.loaded ? prev.before : data.before, canSend: data.canSend, loaded: true, loading: false, error: '', otherReadAt: data.otherReadAt, otherDeliveredAt: data.otherDeliveredAt, otherUserId: data.otherUserId } };
      });
      setPresence((old) => ({ ...old, [data.otherUserId]: { online: data.online, lastSeen: data.lastSeenAt ?? old[data.otherUserId]?.lastSeen ?? null } }));
      return data;
    } catch (e) {
      setByThread((old) => ({ ...old, [id]: { ...(old[id] ?? { messages: [] }), loading: false, error: e.message } }));
      return null;
    }
  }, []);

  const acknowledge = useCallback((id) => {
    api.markDelivered(id).catch(() => {});
    if (!document.hidden) {
      api.markRead(id).then(() => setThreads((old) => old?.map((t) => (t.id === id ? { ...t, unread: false, unreadCount: 0 } : t)))).catch(() => {});
    }
  }, []);

  useEffect(() => {
    setDraft(''); setError(''); setUnseenBelow(0); stickToBottom.current = true;
    if (!activeId) return;
    loadMessages(activeId).then((data) => { if (data && activeRef.current === activeId) acknowledge(activeId); });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [activeId, loadMessages, acknowledge]);

  // When the tab comes back, the open conversation counts as read.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && activeRef.current) acknowledge(activeRef.current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acknowledge]);

  /* ---- realtime ---- */
  useEffect(() => {
    const stop = subscribeChatEvents((ev) => {
      switch (ev.type) {
        case 'hello': {
          setPresence((old) => {
            const next = { ...old };
            for (const id of ev.online ?? []) next[id] = { online: true, lastSeen: null };
            for (const [id, at] of Object.entries(ev.lastSeen ?? {})) if (!next[id]?.online) next[id] = { online: false, lastSeen: at };
            return next;
          });
          // Catch up anything that happened while we were disconnected.
          loadThreads();
          if (activeRef.current) loadMessages(activeRef.current, { merge: true });
          break;
        }
        case 'message': {
          const { threadId, message } = ev;
          const mine = message.senderId === user.id;
          setByThread((old) => {
            const prev = old[threadId];
            if (!prev) return old; // not loaded yet; the list refresh covers it
            const map = new Map(prev.messages.filter((m) => !(m.pending && m.clientId === message.clientId)).map((m) => [m.id, m]));
            map.set(message.id, message);
            return { ...old, [threadId]: { ...prev, messages: sortMessages([...map.values()]) } };
          });
          setThreads((old) => {
            if (!old) return old;
            const idx = old.findIndex((t) => t.id === threadId);
            if (idx < 0) { loadThreads(); return old; }
            const current = old[idx];
            const isOpen = activeRef.current === threadId && !document.hidden;
            const updated = { ...current, lastMessage: message.body, lastMessageAt: message.createdAt, lastMessageSenderId: message.senderId, lastMessageId: message.id, unread: !mine && !isOpen ? true : current.unread && !isOpen, unreadCount: !mine && !isOpen ? (current.unreadCount ?? 0) + 1 : isOpen ? 0 : current.unreadCount };
            return [updated, ...old.slice(0, idx), ...old.slice(idx + 1)];
          });
          if (!mine) {
            setTyping((old) => { const n = { ...old }; delete n[threadId]; return n; });
            if (activeRef.current === threadId) {
              acknowledge(threadId);
              if (!stickToBottom.current) setUnseenBelow((n) => n + 1);
            } else {
              api.markDelivered(threadId).catch(() => {});
            }
          }
          break;
        }
        case 'typing': {
          setTyping((old) => {
            const next = { ...old };
            if (ev.typing) next[ev.threadId] = Date.now() + TYPING_TTL; else delete next[ev.threadId];
            return next;
          });
          break;
        }
        case 'read':
        case 'delivered': {
          const key = ev.type === 'read' ? 'otherReadAt' : 'otherDeliveredAt';
          setByThread((old) => (old[ev.threadId] ? { ...old, [ev.threadId]: { ...old[ev.threadId], [key]: ev.at } } : old));
          setThreads((old) => old?.map((t) => (t.id === ev.threadId ? { ...t, [key]: ev.at } : t)));
          break;
        }
        case 'presence': {
          setPresence((old) => ({ ...old, [ev.userId]: { online: ev.online, lastSeen: ev.lastSeen ?? old[ev.userId]?.lastSeen ?? null } }));
          break;
        }
        case 'thread':
        case 'connection': {
          loadThreads();
          break;
        }
        default:
      }
    }, setStream);
    return stop;
  }, [user.id, loadThreads, loadMessages, acknowledge]);

  // Expire typing indicators.
  useEffect(() => {
    const ids = Object.keys(typing);
    if (!ids.length) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((old) => {
        const next = {}; let changed = false;
        for (const [k, v] of Object.entries(old)) { if (v > now) next[k] = v; else changed = true; }
        return changed ? next : old;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  /* ---- scrolling ---- */
  const active = useMemo(() => threads?.find((t) => t.id === activeId) ?? null, [threads, activeId]);
  const conv = byThread[activeId] ?? null;
  const lastMessageId = conv?.messages[conv.messages.length - 1]?.id;
  const typingHere = Boolean(activeId && typing[activeId] > Date.now());

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickToBottom.current) { el.scrollTop = el.scrollHeight; setUnseenBelow(0); }
  }, [lastMessageId, activeId, typingHere, conv?.loaded]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
    if (nearBottom) setUnseenBelow(0);
  };
  const jumpToBottom = () => { const el = listRef.current; if (el) { stickToBottom.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setUnseenBelow(0); } };

  /* ---- composing ---- */
  const signalTyping = (nextDraft) => {
    if (!activeId || !conv?.canSend) return;
    clearTimeout(typingStopTimer.current);
    if (nextDraft.trim()) {
      const now = Date.now();
      if (now - typingSentAt.current > 2500) { typingSentAt.current = now; api.sendTyping(activeId, true).catch(() => {}); }
      typingStopTimer.current = setTimeout(() => { typingSentAt.current = 0; api.sendTyping(activeId, false).catch(() => {}); }, 3000);
    } else if (typingSentAt.current) {
      typingSentAt.current = 0; api.sendTyping(activeId, false).catch(() => {});
    }
  };

  const send = async (text, clientId = crypto.randomUUID()) => {
    const target = activeId; const body = text.trim();
    if (!target || !body || !conv?.canSend) return;
    clearTimeout(typingStopTimer.current);
    if (typingSentAt.current) { typingSentAt.current = 0; api.sendTyping(target, false).catch(() => {}); }
    const optimistic = { id: `local-${clientId}`, clientId, body, senderId: user.id, createdAt: new Date().toISOString(), pending: true };
    setByThread((old) => ({ ...old, [target]: { ...old[target], messages: sortMessages([...old[target].messages.filter((m) => m.clientId !== clientId), optimistic]) } }));
    stickToBottom.current = true;
    setError(''); setSending(true);
    try {
      const saved = await api.sendMessage(target, body, clientId);
      setByThread((old) => {
        const prev = old[target]; if (!prev) return old;
        const map = new Map(prev.messages.filter((m) => m.clientId !== clientId).map((m) => [m.id, m]));
        map.set(saved.id, { ...saved, clientId });
        return { ...old, [target]: { ...prev, messages: sortMessages([...map.values()]) } };
      });
      setThreads((old) => {
        if (!old) return old;
        const idx = old.findIndex((t) => t.id === target); if (idx < 0) return old;
        const updated = { ...old[idx], lastMessage: body, lastMessageAt: saved.createdAt, lastMessageSenderId: user.id, lastMessageId: saved.id };
        return [updated, ...old.slice(0, idx), ...old.slice(idx + 1)];
      });
    } catch (e) {
      setByThread((old) => ({ ...old, [target]: { ...old[target], messages: old[target].messages.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)) } }));
      setError(e.message);
    } finally { setSending(false); }
  };

  const submit = (e) => { e.preventDefault(); if (!draft.trim()) return; const text = draft; setDraft(''); send(text); };
  const retry = (m) => { setByThread((old) => ({ ...old, [activeId]: { ...old[activeId], messages: old[activeId].messages.filter((x) => x.clientId !== m.clientId) } })); send(m.body, m.clientId); };

  const shareLocation = () => {
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => send(`${LOCATION_PREFIX}https://maps.google.com/?q=${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`),
      () => setError('Could not read your location. Check the browser permission and try again.'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const loadEarlier = async () => {
    const target = activeId; const before = conv?.before; if (!target || !before) return;
    const el = listRef.current; const prevHeight = el?.scrollHeight ?? 0;
    try {
      const data = await api.getMessages(target, before);
      setByThread((old) => { const prev = old[target]; const map = new Map([...data.messages, ...prev.messages].map((m) => [m.id, m])); return { ...old, [target]: { ...prev, messages: sortMessages([...map.values()]), before: data.before } }; });
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } catch (e) { setError(e.message); }
  };

  const openBookingChat = async (e) => {
    e.preventDefault(); if (!booking) return;
    setError('');
    try { const t = await api.openThread({ bookingId: booking }); setNewChat(false); setBooking(''); await loadThreads(); setParams({ thread: t.id }); } catch (err) { setError(err.message); }
  };

  const block = async () => {
    if (!activeId || !window.confirm('Block new messages with this person? Existing messages remain available.')) return;
    try { await api.blockThread(activeId); setByThread((old) => ({ ...old, [activeId]: { ...old[activeId], canSend: false } })); } catch (e) { setError(e.message); }
  };

  /* ---- derived ---- */
  const visibleThreads = useMemo(() => {
    if (!threads) return null;
    const q = query.trim().toLowerCase();
    const list = q ? threads.filter((t) => t.person.fullName.toLowerCase().includes(q) || (t.booking?.serviceTitle ?? '').toLowerCase().includes(q) || (t.booking?.reference ?? '').toLowerCase().includes(q)) : threads;
    return list.slice().sort((a, b) => String(b.lastMessageAt ?? b.updatedAt ?? '').localeCompare(String(a.lastMessageAt ?? a.updatedAt ?? '')));
  }, [threads, query]);
  const totalUnread = useMemo(() => (threads ?? []).reduce((n, t) => n + (t.unreadCount ?? (t.unread ? 1 : 0)), 0), [threads]);
  const otherPresence = active ? presence[active.person.id] : null;
  const statusLine = !active ? '' : typingHere ? 'typing…' : otherPresence?.online ? 'Online' : relativeSeen(otherPresence?.lastSeen) || active.booking?.serviceTitle || (active.connectionId ? 'Connected on Servix' : 'Private Servix messages');

  const grouped = useMemo(() => {
    if (!conv) return [];
    const out = []; let lastDay = ''; let prev = null;
    for (const m of conv.messages) {
      const day = dayLabel(m.createdAt);
      if (day !== lastDay) { out.push({ kind: 'day', key: `day-${day}-${m.id}`, label: day }); lastDay = day; prev = null; }
      const grouped = prev && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000;
      out.push({ kind: 'msg', key: m.id, m, grouped });
      prev = m;
    }
    return out;
  }, [conv]);

  /* ---- render ---- */
  return (
    <>
      {error && <p className="ws-alert" role="alert">{error}</p>}
      <div className={`msg-inbox ${activeId ? 'has-thread' : ''}`}>
        <aside className="msg-list" aria-label="Conversations">
          <div className="msg-list-head">
            <div>
              <strong>Chats</strong>
              {totalUnread > 0 && <span className="msg-badge" aria-label={`${totalUnread} unread`}>{totalUnread > 99 ? '99+' : totalUnread}</span>}
            </div>
            <button type="button" className="msg-icon-btn" onClick={() => setNewChat((v) => !v)} aria-expanded={newChat} aria-label="Start a conversation about a booking" title="New chat">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          {newChat && (
            <form className="msg-newchat" onSubmit={openBookingChat}>
              <label htmlFor="msg-booking">Chat about a booking</label>
              <LoadState skeleton="form" label="Loading your bookings…" resource={bookings}>
                <select id="msg-booking" value={booking} onChange={(e) => setBooking(e.target.value)} required>
                  <option value="">Choose a booking</option>
                  {bookings.data?.map((b) => <option key={b.id} value={b.id}>{b.reference} · {b.serviceTitle}</option>)}
                </select>
                <button className="btn btn--primary" disabled={!booking}>Open chat</button>
              </LoadState>
              <small>To message someone without a booking, <Link to="/dashboard/network">connect with them</Link> first.</small>
            </form>
          )}
          <label className="msg-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search conversations" />
          </label>
          <div className="msg-list-scroll">
            {threadError ? <p className="msg-muted" role="alert">{threadError} <button type="button" className="msg-link" onClick={loadThreads}>Retry</button></p>
              : !visibleThreads ? <ListSkeleton rows={5} panel={false} label="Loading conversations…" />
                : !visibleThreads.length ? <p className="msg-muted">{query ? 'No conversations match.' : 'No conversations yet. Start one from a booking or an accepted connection.'}</p>
                  : visibleThreads.map((t) => {
                    const p = presence[t.person.id];
                    const isTyping = typing[t.id] > Date.now();
                    const mineLast = t.lastMessageSenderId === user.id;
                    const state = mineLast ? tickState({ createdAt: t.lastMessageAt }, t) : null;
                    return (
                      <button type="button" key={t.id} className={`msg-row-item ${t.id === activeId ? 'selected' : ''} ${t.unread ? 'unread' : ''}`} onClick={() => setParams({ thread: t.id })}>
                        <Avatar person={t.person} size={48} online={p?.online} />
                        <span className="msg-row-text">
                          <span className="msg-row-top"><strong>{t.person.fullName}</strong><time dateTime={t.lastMessageAt ?? undefined}>{listTime(t.lastMessageAt)}</time></span>
                          <span className="msg-row-bottom">
                            <span className={`msg-preview ${isTyping ? 'typing' : ''}`}>
                              {isTyping ? 'typing…' : <>{mineLast && state && <Ticks state={state} />}{mineLast && 'You: '}{t.lastMessage?.startsWith(LOCATION_PREFIX) ? '📍 Location' : t.lastMessage || 'Say hello'}</>}
                            </span>
                            {t.unreadCount > 0 && <span className="msg-badge">{t.unreadCount > 99 ? '99+' : t.unreadCount}</span>}
                          </span>
                          <span className="msg-row-context">{t.booking ? `${t.booking.reference} · ${t.booking.serviceTitle}` : t.person.professionalProfile?.title || 'Connection'}</span>
                        </span>
                      </button>
                    );
                  })}
          </div>
          <p className="msg-stream" data-state={stream}>
            <i />{stream === 'live' ? 'Live' : stream === 'connecting' ? 'Connecting…' : stream === 'reconnecting' ? 'Reconnecting…' : 'Live updates paused · refreshing every 15 s'}
          </p>
        </aside>

        <section className="msg-chat" aria-label="Conversation">
          {!activeId ? (
            <div className="msg-chat-empty">
              <Empty title="Your messages live here" description="Pick a conversation, or start one from a booking. Professionals you connect with can be messaged any time." to="/dashboard/network" label="Open my network" icon="mail" />
            </div>
          ) : (
            <>
              <header className="msg-chat-head">
                <button type="button" className="msg-icon-btn msg-back" onClick={() => setParams({})} aria-label="Back to conversations"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></button>
                {active?.person.professionalProfile?.slug ? (
                  <Link to={`/professionals/${active.person.professionalProfile.slug}`} className="msg-chat-person" title="View profile">
                    <Avatar person={active.person} size={40} online={otherPresence?.online} />
                    <span><strong>{active.person.fullName}</strong><small className={typingHere ? 'typing' : ''}>{statusLine}</small></span>
                  </Link>
                ) : (
                  <span className="msg-chat-person">
                    <Avatar person={active?.person} size={40} online={otherPresence?.online} />
                    <span><strong>{active?.person.fullName ?? 'Conversation'}</strong><small className={typingHere ? 'typing' : ''}>{statusLine}</small></span>
                  </span>
                )}
                {active?.booking && <Link className="msg-booking-pill" to={`/bookings/${active.bookingId}`} title="Open booking">{active.booking.reference}</Link>}
                <button type="button" className="msg-icon-btn" onClick={block} aria-label="Block this conversation" title="Block"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg></button>
              </header>

              <div className="msg-scroll" ref={listRef} onScroll={onScroll} role="log" aria-label="Messages" aria-live="polite">
                {conv?.before && <button type="button" className="msg-earlier" onClick={loadEarlier}>Load earlier messages</button>}
                {conv?.loading ? (
                  <div role="status" aria-busy="true" className="msg-skeleton">
                    <span className="sr-only">Loading messages…</span>
                    {[55, 40, 70, 35, 50].map((w, i) => <Skeleton key={i} height="2.4rem" width={`${w}%`} style={{ borderRadius: 18, marginLeft: i % 2 ? 'auto' : 0 }} />)}
                  </div>
                ) : conv?.error ? <p className="msg-muted" role="alert">{conv.error} <button type="button" className="msg-link" onClick={() => loadMessages(activeId)}>Retry</button></p>
                  : (
                    <>
                      <div className="msg-notice">
                        <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
                        Messages are private to the two of you. Keep payments inside Servix — it is how your booking stays protected.
                      </div>
                      {conv?.loaded && conv.messages.length === 0 && <p className="msg-muted center">No messages yet. Say hello 👋</p>}
                      {grouped.map((item) => {
                        if (item.kind === 'day') return <div key={item.key} className="msg-day"><span>{item.label}</span></div>;
                        const m = item.m; const mine = m.senderId === user.id;
                        const isLocation = m.body.startsWith(LOCATION_PREFIX);
                        const url = isLocation ? m.body.slice(LOCATION_PREFIX.length).trim() : '';
                        return (
                          <div key={item.key} className={`msg-row ${mine ? 'mine' : 'theirs'} ${item.grouped ? 'grouped' : ''} ${m.failed ? 'failed' : ''}`}>
                            <div className={`msg-bubble ${mine ? 'mine' : 'theirs'} ${isLocation ? 'location' : ''}`}>
                              {isLocation ? (
                                <a className="msg-location" href={url} target="_blank" rel="noopener noreferrer">
                                  <span className="msg-location-pin"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg></span>
                                  <span><strong>{mine ? 'Your location' : `${active?.person.fullName.split(' ')[0]}'s location`}</strong><small>Open in Maps</small></span>
                                </a>
                              ) : <p>{renderBody(m.body)}</p>}
                              <span className="msg-meta"><time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>{mine && <Ticks state={tickState(m, conv)} />}</span>
                            </div>
                            {m.failed && <button type="button" className="msg-retry" onClick={() => retry(m)}>Not sent · Retry</button>}
                          </div>
                        );
                      })}
                      {typingHere && <TypingBubble person={active?.person} />}
                    </>
                  )}
              </div>
              {unseenBelow > 0 && <button type="button" className="msg-jump" onClick={jumpToBottom}>↓ {unseenBelow} new message{unseenBelow > 1 ? 's' : ''}</button>}

              <form className="msg-compose" onSubmit={submit}>
                <button type="button" className="msg-icon-btn" onClick={shareLocation} disabled={!conv?.canSend} aria-label="Share my location" title="Share my location">
                  <svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
                </button>
                <label className="sr-only" htmlFor="message-text">Your message</label>
                <textarea
                  id="message-text"
                  ref={textareaRef}
                  rows={1}
                  maxLength={4000}
                  placeholder={conv?.canSend === false ? 'Messaging is unavailable for this conversation.' : 'Message…'}
                  value={draft}
                  disabled={conv?.canSend === false}
                  onChange={(e) => { setDraft(e.target.value); signalTyping(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim()) { const text = draft; setDraft(''); e.target.style.height = 'auto'; send(text); } } }}
                  onBlur={() => { if (typingSentAt.current && activeId) { typingSentAt.current = 0; api.sendTyping(activeId, false).catch(() => {}); } }}
                />
                <button className="msg-send" disabled={!conv?.canSend || !draft.trim() || sending} aria-label="Send">
                  <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              </form>
              <p className="msg-safety"><span className="msg-kbd-hint">Enter to send · Shift+Enter for a new line · </span>Never share payment details or verification codes. <Link to="/contact">Report a concern</Link></p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

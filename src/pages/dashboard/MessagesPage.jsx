import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useWorkspace } from '../../components/dashboard/WorkspaceShell.jsx';
import { getMyBookings, getProBookings } from '../../lib/bookingApi.js';
import * as api from '../../lib/workspaceApi.js';
import { uploadChatAttachment, sendChatMessage, deleteChatMessage, reactToMessage, kindForFile, CHAT_LIMITS } from '../../lib/chatApi.js';
import { subscribeChatEvents } from '../../lib/chatRealtime.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useFeatures } from '../../lib/useFeatures.js';
import { PageHead, LoadState, Empty, useResource } from './shared.jsx';
import { ListSkeleton, Skeleton } from '../../components/ui/States.jsx';
import { AiAvatar } from '../../components/ai/AiBits.jsx';
import { CommunityGate } from './NetworkPage.jsx';
import { Avatar, Ticks, TypingBubble, MessageBubble, ActionSheet, Lightbox, EmojiPicker, I } from '../../components/chat/ChatBits.jsx';
import { ProfileSheet } from '../../components/chat/ProfileSheet.jsx';
import { AiThread, loadAiHistory } from '../../components/chat/AiThread.jsx';
import { useVoiceRecorder } from '../../components/chat/useVoiceRecorder.js';
import { LOCATION_PREFIX, TYPING_TTL, dayLabel, relativeSeen, listTime, sortMessages, tickState, previewOf, mergeMessage, formatDuration, formatBytes, newClientId, mediaSrc } from '../../components/chat/chatUtils.js';
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

const AI_THREAD = 'ai';

function MessagesContent() {
  const { user } = useAuth();
  const { overview } = useWorkspace();
  const features = useFeatures();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('thread');
  const aiOpen = activeId === AI_THREAD;
  const humanId = aiOpen ? null : activeId;

  const [threads, setThreads] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [byThread, setByThread] = useState({});
  const [presence, setPresence] = useState({});
  const [typing, setTyping] = useState({});
  const [stream, setStream] = useState('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [booking, setBooking] = useState('');
  const [query, setQuery] = useState('');
  const [reply, setReply] = useState(null);
  const [staged, setStaged] = useState(null); // { file, kind, previewUrl }
  const [sheet, setSheet] = useState(null); // { message, anchor }
  const [lightbox, setLightbox] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [aiTick, setAiTick] = useState(0);
  const voice = useVoiceRecorder();

  const activeRef = useRef(humanId); activeRef.current = humanId;
  const listRef = useRef(null);
  const stickToBottom = useRef(true);
  const [unseenBelow, setUnseenBelow] = useState(0);
  const typingSentAt = useRef(0);
  const typingStopTimer = useRef(null);
  const textareaRef = useRef(null);
  const photoInput = useRef(null);
  const fileInput = useRef(null);

  const bookings = useResource(async () => {
    const mine = await getMyBookings();
    const work = overview?.canManageServices ? await getProBookings() : [];
    return [...new Map([...mine, ...work].map((b) => [b.id, b])).values()];
  }, [overview?.canManageServices]);

  /* ---------------- threads ---------------- */
  const loadThreads = useCallback(async () => {
    try {
      const data = await api.getThreads();
      setThreads(data); setThreadError('');
      setPresence((old) => { const next = { ...old }; for (const t of data) next[t.person.id] = { online: t.online, lastSeen: t.lastSeenAt ?? old[t.person.id]?.lastSeen ?? null }; return next; });
    } catch (e) { setThreadError(e.message); }
  }, []);
  useEffect(() => { loadThreads(); }, [loadThreads]);

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

  useEffect(() => {
    if (stream === 'live') return undefined;
    const timer = setInterval(() => { if (document.hidden) return; loadThreads(); if (activeRef.current) loadMessages(activeRef.current, { merge: true }); }, 15_000);
    return () => clearInterval(timer);
  }, [stream, loadThreads, loadMessages]);

  const acknowledge = useCallback((id) => {
    api.markDelivered(id).catch(() => {});
    if (!document.hidden) api.markRead(id).then(() => setThreads((old) => old?.map((t) => (t.id === id ? { ...t, unread: false, unreadCount: 0 } : t)))).catch(() => {});
  }, []);

  useEffect(() => {
    setDraft(''); setError(''); setUnseenBelow(0); setReply(null); setStaged(null); setSheet(null); setEmojiOpen(false); setAttachOpen(false); stickToBottom.current = true;
    if (!humanId) return;
    loadMessages(humanId).then((data) => { if (data && activeRef.current === humanId) acknowledge(humanId); });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [humanId, loadMessages, acknowledge]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && activeRef.current) acknowledge(activeRef.current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acknowledge]);

  /* ---------------- realtime ---------------- */
  useEffect(() => {
    const stop = subscribeChatEvents((ev) => {
      switch (ev.type) {
        case 'hello': {
          setPresence((old) => { const next = { ...old }; for (const id of ev.online ?? []) next[id] = { online: true, lastSeen: null }; for (const [id, at] of Object.entries(ev.lastSeen ?? {})) if (!next[id]?.online) next[id] = { online: false, lastSeen: at }; return next; });
          loadThreads(); if (activeRef.current) loadMessages(activeRef.current, { merge: true });
          break;
        }
        case 'message': {
          const { threadId, message } = ev; const mine = message.senderId === user.id;
          setByThread((old) => { const prev = old[threadId]; if (!prev) return old; const map = new Map(prev.messages.filter((m) => !(m.pending && m.clientId === message.clientId)).map((m) => [m.id, m])); map.set(message.id, message); return { ...old, [threadId]: { ...prev, messages: sortMessages([...map.values()]) } }; });
          setThreads((old) => {
            if (!old) return old; const idx = old.findIndex((t) => t.id === threadId); if (idx < 0) { loadThreads(); return old; }
            const current = old[idx]; const isOpen = activeRef.current === threadId && !document.hidden;
            const updated = { ...current, lastMessage: previewOf(message), lastMessageKind: message.kind, lastMessageAt: message.createdAt, lastMessageSenderId: message.senderId, lastMessageId: message.id, unread: !mine && !isOpen ? true : current.unread && !isOpen, unreadCount: !mine && !isOpen ? (current.unreadCount ?? 0) + 1 : isOpen ? 0 : current.unreadCount };
            return [updated, ...old.slice(0, idx), ...old.slice(idx + 1)];
          });
          if (!mine) {
            setTyping((old) => { const n = { ...old }; delete n[threadId]; return n; });
            if (activeRef.current === threadId) { acknowledge(threadId); if (!stickToBottom.current) setUnseenBelow((n) => n + 1); } else api.markDelivered(threadId).catch(() => {});
          }
          break;
        }
        case 'message_update': {
          const { threadId, message } = ev;
          setByThread((old) => (old[threadId] ? { ...old, [threadId]: { ...old[threadId], messages: mergeMessage(old[threadId].messages, message) } } : old));
          setThreads((old) => old?.map((t) => (t.id === threadId && t.lastMessageId === message.id ? { ...t, lastMessage: previewOf(message), lastMessageKind: message.kind } : t)));
          break;
        }
        case 'typing': { setTyping((old) => { const next = { ...old }; if (ev.typing) next[ev.threadId] = Date.now() + TYPING_TTL; else delete next[ev.threadId]; return next; }); break; }
        case 'read': case 'delivered': {
          const key = ev.type === 'read' ? 'otherReadAt' : 'otherDeliveredAt';
          setByThread((old) => (old[ev.threadId] ? { ...old, [ev.threadId]: { ...old[ev.threadId], [key]: ev.at } } : old));
          setThreads((old) => old?.map((t) => (t.id === ev.threadId ? { ...t, [key]: ev.at } : t)));
          break;
        }
        case 'presence': { setPresence((old) => ({ ...old, [ev.userId]: { online: ev.online, lastSeen: ev.lastSeen ?? old[ev.userId]?.lastSeen ?? null } })); break; }
        case 'thread': case 'connection': { loadThreads(); break; }
        default:
      }
    }, setStream);
    return stop;
  }, [user.id, loadThreads, loadMessages, acknowledge]);

  useEffect(() => {
    if (!Object.keys(typing).length) return undefined;
    const timer = setInterval(() => { const now = Date.now(); setTyping((old) => { const next = {}; let changed = false; for (const [k, v] of Object.entries(old)) { if (v > now) next[k] = v; else changed = true; } return changed ? next : old; }); }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  /* ---------------- scrolling ---------------- */
  const active = useMemo(() => threads?.find((t) => t.id === humanId) ?? null, [threads, humanId]);
  const conv = byThread[humanId] ?? null;
  useEffect(() => { setProfileOpen(false); }, [humanId]);
  const lastMessageId = conv?.messages[conv.messages.length - 1]?.id;
  const typingHere = Boolean(humanId && typing[humanId] > Date.now());
  useEffect(() => { const el = listRef.current; if (!el) return; if (stickToBottom.current) { el.scrollTop = el.scrollHeight; setUnseenBelow(0); } }, [lastMessageId, humanId, typingHere, conv?.loaded, staged, reply]);
  const onScroll = () => { const el = listRef.current; if (!el) return; const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80; stickToBottom.current = nearBottom; if (nearBottom) setUnseenBelow(0); };
  const jumpToBottom = () => { const el = listRef.current; if (el) { stickToBottom.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setUnseenBelow(0); } };
  const jumpTo = (id) => { const el = document.getElementById(`msg-${id}`); if (!el) return; stickToBottom.current = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); };

  /* ---------------- typing signal ---------------- */
  const signalTyping = (nextDraft) => {
    if (!humanId || !conv?.canSend) return;
    clearTimeout(typingStopTimer.current);
    if (nextDraft.trim()) {
      const now = Date.now();
      if (now - typingSentAt.current > 2500) { typingSentAt.current = now; api.sendTyping(humanId, true).catch(() => {}); }
      typingStopTimer.current = setTimeout(() => { typingSentAt.current = 0; api.sendTyping(humanId, false).catch(() => {}); }, 3000);
    } else if (typingSentAt.current) { typingSentAt.current = 0; api.sendTyping(humanId, false).catch(() => {}); }
  };
  const stopTyping = (target) => { clearTimeout(typingStopTimer.current); if (typingSentAt.current && target) { typingSentAt.current = 0; api.sendTyping(target, false).catch(() => {}); } };

  /* ---------------- sending ---------------- */
  const patchMessage = (target, clientId, patch) => setByThread((old) => (old[target] ? { ...old, [target]: { ...old[target], messages: old[target].messages.map((m) => (m.clientId === clientId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) } } : old));

  const send = async ({ text = '', attachment = null, replyTo = null, clientId = newClientId(), uploaded = null }) => {
    const target = humanId; const body = text.trim();
    if (!target || (!body && !attachment && !uploaded) || !conv?.canSend) return;
    stopTyping(target);
    const kind = attachment ? attachment.kind.replace('chat-', '') : uploaded ? uploaded.key.split('/')[0].replace('chat-', '') : 'text';
    const previewUrl = attachment ? (attachment.previewUrl || URL.createObjectURL(attachment.file)) : uploaded?.url;
    const optimistic = {
      id: `local-${clientId}`, clientId, body, senderId: user.id, createdAt: new Date().toISOString(), pending: true, kind, reactions: {},
      attachment: attachment ? { url: previewUrl, name: attachment.file.name, mime: attachment.file.type, size: attachment.file.size, durationMs: attachment.durationMs ?? null, width: attachment.width, height: attachment.height } : uploaded ? { ...uploaded } : null,
      replyTo: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, kind: replyTo.kind, body: replyTo.body, attachmentName: replyTo.attachment?.name ?? null } : null,
      uploadProgress: 0, local: { attachment, uploaded, replyTo, text: body },
    };
    setByThread((old) => ({ ...old, [target]: { ...old[target], messages: sortMessages([...old[target].messages.filter((m) => m.clientId !== clientId), optimistic]) } }));
    stickToBottom.current = true; setError(''); setSending(true);
    try {
      let stored = uploaded;
      if (attachment && !stored) {
        stored = await uploadChatAttachment(attachment.file, attachment.kind, { durationMs: attachment.durationMs, onProgress: (p) => patchMessage(target, clientId, { uploadProgress: p }) });
        patchMessage(target, clientId, (m) => ({ uploadProgress: 1, local: { ...m.local, uploaded: stored } }));
      }
      const saved = await sendChatMessage(target, { body, clientId, ...(stored ? { attachment: { key: stored.key, name: stored.name, mime: stored.mime, size: stored.size, ...(stored.durationMs != null ? { durationMs: stored.durationMs } : {}), ...(stored.width ? { width: stored.width, height: stored.height } : {}) } } : {}), ...(replyTo ? { replyToId: replyTo.id } : {}) });
      setByThread((old) => { const prev = old[target]; if (!prev) return old; const map = new Map(prev.messages.filter((m) => m.clientId !== clientId).map((m) => [m.id, m])); map.set(saved.id, { ...saved, clientId }); return { ...old, [target]: { ...prev, messages: sortMessages([...map.values()]) } }; });
      setThreads((old) => { if (!old) return old; const idx = old.findIndex((t) => t.id === target); if (idx < 0) return old; const updated = { ...old[idx], lastMessage: previewOf(saved), lastMessageKind: saved.kind, lastMessageAt: saved.createdAt, lastMessageSenderId: user.id, lastMessageId: saved.id }; return [updated, ...old.slice(0, idx), ...old.slice(idx + 1)]; });
      if (attachment && previewUrl && !attachment.previewUrl) setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    } catch (e) {
      const reason = e?.message || 'Something went wrong';
      patchMessage(target, clientId, { pending: false, failed: true, uploadProgress: undefined, failReason: reason });
      setError(attachment || uploaded ? `Could not send the ${kind === 'image' ? 'photo' : kind === 'audio' ? 'voice note' : 'file'}: ${reason}` : reason);
    } finally { setSending(false); }
  };

  const submit = (e) => {
    e?.preventDefault?.();
    if (!draft.trim() && !staged) return;
    const text = draft; const att = staged; const rt = reply;
    setDraft(''); setStaged(null); setReply(null); setEmojiOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    send({ text, attachment: att, replyTo: rt });
  };
  const retry = (m) => {
    setByThread((old) => ({ ...old, [humanId]: { ...old[humanId], messages: old[humanId].messages.filter((x) => x.clientId !== m.clientId) } }));
    send({ text: m.local?.text ?? m.body, attachment: m.local?.uploaded ? null : m.local?.attachment ?? null, uploaded: m.local?.uploaded ?? null, replyTo: m.local?.replyTo ?? null, clientId: m.clientId });
  };

  const stage = (file) => {
    if (!file) return;
    const kind = kindForFile(file);

    if (kind === 'chat-audio') { setError('Use the microphone button to send a voice note.'); return; }
    const limit = CHAT_LIMITS[kind];
    const type = (file.type || '').split(';')[0];
    if (kind === 'chat-file' && !limit.accept.split(',').includes(type)) { setError(`That file type isn’t supported. Use ${limit.label}.`); return; }
    if (kind === 'chat-file' && file.size > limit.maxBytes) { setError(`That file is too large. Use ${limit.label}.`); return; }
    setError(''); setAttachOpen(false);
    setStaged({ file, kind, previewUrl: kind === 'chat-image' ? URL.createObjectURL(file) : null });
    setTimeout(() => textareaRef.current?.focus(), 30);
  };
  const unstage = () => { if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl); setStaged(null); };

  const shareLocation = () => {
    setAttachOpen(false);
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => send({ text: `${LOCATION_PREFIX}https://maps.google.com/?q=${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`, replyTo: reply }),
      () => setError('Could not read your location. Check the browser permission and try again.'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const startVoice = async () => { setError(''); setEmojiOpen(false); setAttachOpen(false); const ok = await voice.start(); if (!ok && voice.error) setError(voice.error); };
  const finishVoice = async () => {
    const result = await voice.stop();
    if (!result) { setError('Hold a little longer to record a voice note.'); return; }
    const rt = reply; setReply(null);
    send({ attachment: { file: result.file, kind: 'chat-audio', durationMs: result.durationMs }, replyTo: rt });
  };
  useEffect(() => { if (voice.error) setError(voice.error); }, [voice.error]);

  const loadEarlier = async () => {
    const target = humanId; const before = conv?.before; if (!target || !before) return;
    const el = listRef.current; const prevHeight = el?.scrollHeight ?? 0;
    try {
      const data = await api.getMessages(target, before);
      setByThread((old) => { const prev = old[target]; const map = new Map([...data.messages, ...prev.messages].map((m) => [m.id, m])); return { ...old, [target]: { ...prev, messages: sortMessages([...map.values()]), before: data.before } }; });
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } catch (e) { setError(e.message); }
  };

  const openBookingChat = async (e) => {
    e.preventDefault(); if (!booking) return; setError('');
    try { const t = await api.openThread({ bookingId: booking }); setNewChat(false); setBooking(''); await loadThreads(); setParams({ thread: t.id }); } catch (err) { setError(err.message); }
  };
  const block = async () => {
    if (!humanId || !window.confirm('Block new messages with this person? Existing messages remain available.')) return;
    try { await api.blockThread(humanId); setByThread((old) => ({ ...old, [humanId]: { ...old[humanId], canSend: false } })); } catch (e) { setError(e.message); }
  };

  /* ---------------- message actions ---------------- */
  const toggleReaction = async (m, emoji) => {
    if (!humanId || m.pending || m.kind === 'deleted') return;
    setSheet(null);
    try { const updated = await reactToMessage(humanId, m.id, emoji); setByThread((old) => ({ ...old, [humanId]: { ...old[humanId], messages: mergeMessage(old[humanId].messages, updated) } })); } catch (e) { setError(e.message); }
  };
  const removeMessage = async (m) => {
    setSheet(null);
    if (!humanId || !window.confirm('Delete this message for everyone?')) return;
    try { const updated = await deleteChatMessage(humanId, m.id); setByThread((old) => ({ ...old, [humanId]: { ...old[humanId], messages: mergeMessage(old[humanId].messages, updated) } })); } catch (e) { setError(e.message); }
  };
  const copyText = async (m) => { setSheet(null); try { await navigator.clipboard.writeText(m.body); } catch { /* ignore */ } };
  const replyTo = (m) => { setSheet(null); setReply(m); setTimeout(() => textareaRef.current?.focus(), 30); };

  /* ---------------- derived ---------------- */
  const aiHistory = useMemo(() => (features.ai ? loadAiHistory(user.id) : []), [features.ai, user.id, aiTick, aiOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!aiOpen) setAiTick((n) => n + 1); }, [aiOpen]);
  const visibleThreads = useMemo(() => {
    if (!threads) return null;
    const q = query.trim().toLowerCase();
    const list = q ? threads.filter((t) => t.person.fullName.toLowerCase().includes(q) || (t.booking?.serviceTitle ?? '').toLowerCase().includes(q) || (t.booking?.reference ?? '').toLowerCase().includes(q)) : threads;
    return list.slice().sort((a, b) => String(b.lastMessageAt ?? b.updatedAt ?? '').localeCompare(String(a.lastMessageAt ?? a.updatedAt ?? '')));
  }, [threads, query]);
  const totalUnread = useMemo(() => (threads ?? []).reduce((n, t) => n + (t.unreadCount ?? (t.unread ? 1 : 0)), 0), [threads]);
  const otherPresence = active ? presence[active.person.id] : null;
  const statusLine = !active ? '' : typingHere ? 'typing…' : otherPresence?.online ? 'Online' : relativeSeen(otherPresence?.lastSeen) || active.booking?.serviceTitle || (active.connectionId ? 'Connected on Servix' : 'Private Servix messages');
  const aiRole = user.role === 'admin' ? 'admin' : overview?.canManageServices ? 'professional' : 'customer';
  const showAi = features.ai && (!query.trim() || 'servix ai'.includes(query.trim().toLowerCase()));

  const grouped = useMemo(() => {
    if (!conv) return [];
    const out = []; let lastDay = ''; let prev = null;
    for (const m of conv.messages) {
      const day = dayLabel(m.createdAt);
      if (day !== lastDay) { out.push({ kind: 'day', key: `day-${day}-${m.id}`, label: day }); lastDay = day; prev = null; }
      const isGrouped = prev && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000;
      out.push({ kind: 'msg', key: m.id, m, grouped: isGrouped });
      prev = m;
    }
    return out;
  }, [conv]);

  const canSend = conv?.canSend !== false;
  const hasContent = Boolean(draft.trim() || staged);

  /* ---------------- render ---------------- */
  return (
    <>
      {error && <p className="ws-alert" role="alert">{error} <button type="button" className="msg-link" onClick={() => setError('')}>Dismiss</button></p>}
      <div className={`msg-inbox ${activeId ? 'has-thread' : ''}`}>
        <aside className="msg-list" aria-label="Conversations">
          <div className="msg-list-head">
            <div><strong>Chats</strong>{totalUnread > 0 && <span className="msg-badge" aria-label={`${totalUnread} unread`}>{totalUnread > 99 ? '99+' : totalUnread}</span>}</div>
            <button type="button" className="msg-icon-btn" onClick={() => setNewChat((v) => !v)} aria-expanded={newChat} aria-label="Start a conversation about a booking" title="New chat">{I.plus}</button>
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
          <label className="msg-search">{I.search}<input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search conversations" /></label>
          <div className="msg-list-scroll">
            {showAi && (
              <button type="button" className={`msg-row-item ai ${aiOpen ? 'selected' : ''}`} onClick={() => setParams({ thread: AI_THREAD })}>
                <AiAvatar size={48} state="still" />
                <span className="msg-row-text">
                  <span className="msg-row-top"><strong>Servix AI</strong><time>{aiHistory.length ? listTime(aiHistory[aiHistory.length - 1].at) : ''}</time></span>
                  <span className="msg-row-bottom"><span className="msg-preview">{aiHistory.length ? `${aiHistory[aiHistory.length - 1].role === 'user' ? 'You: ' : ''}${aiHistory[aiHistory.length - 1].content.slice(0, 80)}` : 'Ask about professionals, prices, bookings…'}</span><span className="msg-pin" aria-label="Pinned">📌</span></span>
                  <span className="msg-row-context">Assistant · always online</span>
                </span>
              </button>
            )}
            {threadError ? <p className="msg-muted" role="alert">{threadError} <button type="button" className="msg-link" onClick={loadThreads}>Retry</button></p>
              : !visibleThreads ? <ListSkeleton rows={5} panel={false} label="Loading conversations…" />
                : !visibleThreads.length ? <p className="msg-muted">{query ? 'No conversations match.' : 'No conversations yet. Start one from a booking or an accepted connection.'}</p>
                  : visibleThreads.map((t) => {
                    const p = presence[t.person.id]; const isTyping = typing[t.id] > Date.now(); const mineLast = t.lastMessageSenderId === user.id;
                    const state = mineLast && t.lastMessageKind !== 'deleted' ? tickState({ createdAt: t.lastMessageAt }, t) : null;
                    return (
                      <button type="button" key={t.id} className={`msg-row-item ${t.id === humanId ? 'selected' : ''} ${t.unread ? 'unread' : ''}`} onClick={() => setParams({ thread: t.id })}>
                        <Avatar person={t.person} size={48} online={p?.online} />
                        <span className="msg-row-text">
                          <span className="msg-row-top"><strong>{t.person.fullName}</strong><time dateTime={t.lastMessageAt ?? undefined}>{listTime(t.lastMessageAt)}</time></span>
                          <span className="msg-row-bottom">
                            <span className={`msg-preview ${isTyping ? 'typing' : ''}`}>{isTyping ? 'typing…' : <>{state && <Ticks state={state} />}{mineLast && 'You: '}{t.lastMessage?.startsWith(LOCATION_PREFIX) ? '📍 Location' : t.lastMessage || 'Say hello'}</>}</span>
                            {t.unreadCount > 0 && <span className="msg-badge">{t.unreadCount > 99 ? '99+' : t.unreadCount}</span>}
                          </span>
                          <span className="msg-row-context">{t.booking ? `${t.booking.reference} · ${t.booking.serviceTitle}` : t.person.professionalProfile?.title || 'Connection'}</span>
                        </span>
                      </button>
                    );
                  })}
          </div>
          <p className="msg-stream" data-state={stream}><i />{stream === 'live' ? 'Live' : stream === 'connecting' ? 'Connecting…' : stream === 'reconnecting' ? 'Reconnecting…' : 'Live updates paused · refreshing every 15 s'}</p>
        </aside>

        <section className={`msg-chat ${dragging ? 'dragging' : ''}`} aria-label="Conversation"
          onDragOver={(e) => { if (humanId && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={(e) => { if (!humanId) return; e.preventDefault(); setDragging(false); stage(e.dataTransfer.files?.[0]); }}>
          {!activeId ? (
            <div className="msg-chat-empty"><Empty title="Your messages live here" description="Pick a conversation, or start one from a booking. Professionals you connect with can be messaged any time." to="/dashboard/network" label="Open my network" icon="mail" /></div>
          ) : aiOpen ? (
            <AiThread user={user} role={aiRole} onBack={() => setParams({})} />
          ) : (
            <>
              <header className="msg-chat-head">
                <button type="button" className="msg-icon-btn msg-back" onClick={() => setParams({})} aria-label="Back to conversations">{I.back}</button>
                <button type="button" className="msg-chat-person" onClick={() => setProfileOpen(true)} title="Contact info" aria-haspopup="dialog">
                  <Avatar person={active?.person} size={40} online={otherPresence?.online} />
                  <span><strong>{active?.person.fullName ?? 'Conversation'}</strong><small className={typingHere ? 'typing' : ''}>{statusLine}</small></span>
                </button>
                {active?.booking && <Link className="msg-booking-pill" to={`/bookings/${active.bookingId}`} title="Open booking">{active.booking.reference}</Link>}
                <button type="button" className="msg-icon-btn" onClick={() => setProfileOpen(true)} aria-label="Contact info" title="Contact info">{I.info}</button>
              </header>

              <div className="msg-scroll" ref={listRef} onScroll={onScroll} role="log" aria-label="Messages" aria-live="polite">
                {conv?.before && <button type="button" className="msg-earlier" onClick={loadEarlier}>Load earlier messages</button>}
                {conv?.loading ? (
                  <div role="status" aria-busy="true" className="msg-skeleton"><span className="sr-only">Loading messages…</span>{[55, 40, 70, 35, 50].map((w, i) => <Skeleton key={i} height="2.4rem" width={`${w}%`} style={{ borderRadius: 18, marginLeft: i % 2 ? 'auto' : 0 }} />)}</div>
                ) : conv?.error ? <p className="msg-muted" role="alert">{conv.error} <button type="button" className="msg-link" onClick={() => loadMessages(humanId)}>Retry</button></p>
                  : (
                    <>
                      <div className="msg-notice"><i>{I.shield}</i>Messages are private to the two of you. Keep payments inside Servix — it is how your booking stays protected.</div>
                      {conv?.loaded && conv.messages.length === 0 && <p className="msg-muted center">No messages yet. Say hello 👋</p>}
                      {grouped.map((item) => (item.kind === 'day'
                        ? <div key={item.key} className="msg-day"><span>{item.label}</span></div>
                        : <MessageBubble key={item.key} m={item.m} mine={item.m.senderId === user.id} grouped={item.grouped} me={user.id} otherName={active?.person.fullName ?? ''} thread={conv}
                            onOpenActions={(m, anchor) => setSheet({ message: m, anchor })} onOpenImage={setLightbox} onJump={jumpTo} onToggleReaction={toggleReaction} onRetry={retry} />))}
                      {typingHere && <TypingBubble name={active?.person.fullName} />}
                    </>
                  )}
              </div>
              {unseenBelow > 0 && <button type="button" className="msg-jump" onClick={jumpToBottom}>↓ {unseenBelow} new message{unseenBelow > 1 ? 's' : ''}</button>}
              {dragging && <div className="msg-drop"><span>{I.photo}</span>Drop to send</div>}

              {voice.recording ? (
                <div className="msg-compose recording" role="status" aria-live="polite">
                  <button type="button" className="msg-icon-btn danger" onClick={voice.cancel} aria-label="Cancel recording">{I.trash}</button>
                  <span className="msg-rec-dot" />
                  <span className="msg-rec-time">{formatDuration(voice.elapsed)}</span>
                  <span className="msg-rec-level" aria-hidden="true">{Array.from({ length: 24 }).map((_, i) => <i key={i} style={{ transform: `scaleY(${Math.min(1, 0.15 + Math.max(0, voice.level * 3 - Math.abs(i - 12) / 30) + Math.abs(Math.sin((i + 1) * 1.7)) * voice.level)})` }} />)}</span>
                  <span className="msg-rec-hint">Recording… tap ✓ to send</span>
                  <button type="button" className="msg-send" onClick={finishVoice} aria-label="Stop and send voice note"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L19 7" /></svg></button>
                </div>
              ) : (
                <form className="msg-compose" onSubmit={submit}>
                  {(reply || staged) && (
                    <div className="msg-compose-tray">
                      {reply && <div className="msg-reply-bar"><span className="msg-quote static"><strong>{reply.senderId === user.id ? 'You' : active?.person.fullName}</strong><span>{previewOf(reply) || 'Message'}</span></span><button type="button" className="msg-icon-btn small" onClick={() => setReply(null)} aria-label="Cancel reply">{I.close}</button></div>}
                      {staged && (
                        <div className="msg-staged">
                          {staged.previewUrl ? <img src={staged.previewUrl} alt="" /> : <span className="msg-file-badge">{(staged.file.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}</span>}
                          <span className="msg-staged-text"><strong>{staged.file.name}</strong><small>{formatBytes(staged.file.size)} · {staged.kind === 'chat-image' ? 'add a caption below or just send' : 'ready to send'}</small></span>
                          <button type="button" className="msg-icon-btn small" onClick={unstage} aria-label="Remove attachment">{I.close}</button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="msg-compose-row">
                    <div className="msg-compose-tools">
                      <button type="button" className={`msg-icon-btn ${emojiOpen ? 'on' : ''}`} onClick={() => { setEmojiOpen((v) => !v); setAttachOpen(false); }} disabled={!canSend} aria-label="Emoji" aria-expanded={emojiOpen}>{I.smile}</button>
                      <div className="msg-attach-wrap">
                        <button type="button" className={`msg-icon-btn ${attachOpen ? 'on rot' : ''}`} onClick={() => { setAttachOpen((v) => !v); setEmojiOpen(false); }} disabled={!canSend} aria-label="Attach" aria-expanded={attachOpen}>{I.plus}</button>
                        {attachOpen && (
                          <div className="msg-attach-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => photoInput.current?.click()}><span className="photo">{I.photo}</span>Photo</button>
                            <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}><span className="doc">{I.doc}</span>Document</button>
                            <button type="button" role="menuitem" onClick={shareLocation}><span className="pin">{I.pin}</span>Location</button>
                          </div>
                        )}
                      </div>
                      {emojiOpen && <EmojiPicker onClose={() => setEmojiOpen(false)} onPick={(e) => { const el = textareaRef.current; const start = el?.selectionStart ?? draft.length; const next = `${draft.slice(0, start)}${e}${draft.slice(start)}`; setDraft(next); signalTyping(next); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + e.length, start + e.length); }); }} />}
                    </div>
                    <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { stage(e.target.files?.[0]); e.target.value = ''; }} />
                    <input ref={fileInput} type="file" accept={CHAT_LIMITS['chat-file'].accept} hidden onChange={(e) => { stage(e.target.files?.[0]); e.target.value = ''; }} />
                    <label className="sr-only" htmlFor="message-text">Your message</label>
                    <textarea id="message-text" ref={textareaRef} rows={1} maxLength={4000} value={draft} disabled={!canSend}
                      placeholder={!canSend ? 'Messaging is unavailable for this conversation.' : staged ? 'Add a caption…' : 'Message…'}
                      onChange={(e) => { setDraft(e.target.value); signalTyping(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
                      onPaste={(e) => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); stage(f); } }}
                      onBlur={() => stopTyping(humanId)} />
                    {hasContent || !voice.supported
                      ? <button className="msg-send" disabled={!canSend || !hasContent || sending} aria-label="Send">{I.send}</button>
                      : <button type="button" className="msg-send mic" onClick={startVoice} disabled={!canSend} aria-label="Record a voice note">{I.mic}</button>}
                  </div>
                </form>
              )}
              <p className="msg-safety"><span className="msg-kbd-hint">Enter to send · Shift+Enter for a new line · </span>Never share payment details or verification codes. <Link to="/contact">Report a concern</Link></p>
            </>
          )}
        </section>
      </div>
      {sheet && <ActionSheet message={sheet.message} anchor={sheet.anchor} mine={{ userId: user.id, isMine: sheet.message.senderId === user.id }} onClose={() => setSheet(null)} onReact={(e) => toggleReaction(sheet.message, e)} onReply={() => replyTo(sheet.message)} onCopy={() => copyText(sheet.message)} onDelete={() => removeMessage(sheet.message)} />}
      {profileOpen && active && !aiOpen && <ProfileSheet thread={active} presence={otherPresence} messages={conv?.messages ?? []} me={user.id} onClose={() => setProfileOpen(false)} onOpenImage={(a) => { setProfileOpen(false); setLightbox(a); }} onBlock={block} onJump={jumpTo} />}
      {lightbox && <Lightbox src={mediaSrc(lightbox.url)} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </>
  );
}

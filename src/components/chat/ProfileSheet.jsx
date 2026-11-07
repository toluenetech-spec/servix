import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, I } from './ChatBits.jsx';
import { relativeSeen, formatBytes, mediaSrc } from './chatUtils.js';

/**
 * Contact card for the person you are chatting with — opens from the chat header.
 * Everything shown here is already visible to this account (thread participant data,
 * the messages loaded in the conversation); nothing extra is fetched.
 */
export function ProfileSheet({ thread, presence, messages = [], me, onClose, onOpenImage, onBlock, onJump }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const person = thread?.person;
  const pro = person?.professionalProfile;
  const photos = useMemo(() => messages.filter((m) => m.kind === 'image' && m.attachment?.url && !m.pending).slice(-12).reverse(), [messages]);
  const files = useMemo(() => messages.filter((m) => (m.kind === 'file' || m.kind === 'audio') && m.attachment?.url && !m.pending).slice(-8).reverse(), [messages]);
  const links = useMemo(() => messages.filter((m) => m.kind === 'text' && /https?:\/\//.test(m.body)).slice(-6).reverse(), [messages]);
  if (!person) return null;
  const status = presence?.online ? 'Online' : relativeSeen(presence?.lastSeen) || (thread.booking ? 'Booking contact' : 'Connection');
  const sentByMe = messages.filter((m) => m.senderId === me).length;

  return (
    <div className="msg-profile-scrim" onClick={onClose}>
      <aside className="msg-profile" role="dialog" aria-label={`About ${person.fullName}`} onClick={(e) => e.stopPropagation()}>
        <header className="msg-profile-head">
          <button type="button" className="msg-icon-btn" onClick={onClose} aria-label="Close">{I.close}</button>
          <span>Contact info</span>
        </header>
        <div className="msg-profile-hero">
          <Avatar person={person} size={92} online={presence?.online} />
          <h3>{person.fullName}</h3>
          <p>{pro?.title || (pro ? 'Professional' : 'Customer')} · <span className={presence?.online ? 'on' : ''}>{status}</span></p>
          <div className="msg-profile-actions">
            {pro?.slug && <Link to={`/professionals/${pro.slug}`} className="msg-profile-btn primary">{I.user}<span>View full profile</span></Link>}
            {thread.bookingId && <Link to={`/bookings/${thread.bookingId}`} className="msg-profile-btn">{I.calendar}<span>Booking {thread.booking?.reference || ''}</span></Link>}
          </div>
        </div>

        <section className="msg-profile-section">
          <h4>About this conversation</h4>
          <dl>
            {thread.booking?.serviceTitle && <div><dt>Service</dt><dd>{thread.booking.serviceTitle}</dd></div>}
            <div><dt>How you met</dt><dd>{thread.booking ? 'Through a booking' : 'Connected on Servix'}</dd></div>
            <div><dt>Messages loaded</dt><dd>{messages.length} · {sentByMe} from you</dd></div>
          </dl>
        </section>

        <section className="msg-profile-section">
          <h4>Photos <small>{photos.length}</small></h4>
          {photos.length ? (
            <div className="msg-profile-grid">
              {photos.map((m) => (
                <button key={m.id} type="button" onClick={() => onOpenImage(m.attachment)} aria-label={m.attachment.name || 'Photo'}>
                  <img src={mediaSrc(m.attachment.url)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : <p className="msg-profile-empty">No photos shared yet.</p>}
        </section>

        {(files.length > 0 || links.length > 0) && (
          <section className="msg-profile-section">
            <h4>Files &amp; links</h4>
            <ul className="msg-profile-list">
              {files.map((m) => (
                <li key={m.id}>
                  <a href={mediaSrc(m.attachment.url)} target="_blank" rel="noopener noreferrer" download={m.attachment.name}>
                    <span className="msg-file-badge">{m.kind === 'audio' ? 'MIC' : (m.attachment.name?.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}</span>
                    <span><strong>{m.kind === 'audio' ? 'Voice note' : m.attachment.name}</strong><small>{formatBytes(m.attachment.size)}</small></span>
                  </a>
                </li>
              ))}
              {links.map((m) => {
                const url = m.body.match(/https?:\/\/\S+/)?.[0];
                return <li key={m.id}><button type="button" onClick={() => { onJump(m.id); onClose(); }}><span className="msg-file-badge link">{I.link}</span><span><strong>{url?.replace(/^https?:\/\//, '').slice(0, 48)}</strong><small>Tap to find in chat</small></span></button></li>;
              })}
            </ul>
          </section>
        )}

        <section className="msg-profile-section">
          <h4>Safety</h4>
          <p className="msg-profile-note">Keep payments inside Servix. Never share passwords or verification codes in chat.</p>
          <div className="msg-profile-danger">
            <button type="button" onClick={() => { onClose(); onBlock(); }}>{I.block}<span>Block {person.fullName.split(' ')[0]}</span></button>
            <a href="/contact?topic=report" target="_blank" rel="noopener noreferrer">{I.flag}<span>Report a concern</span></a>
          </div>
        </section>
      </aside>
    </div>
  );
}

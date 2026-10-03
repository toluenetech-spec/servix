/**
 * Read-only AI insight panels:
 *  - <BookingHealth>  plain-language status of a booking (status itself is computed by the backend)
 *  - <ExplainButton>  "What does this mean?" for Servix concepts (payments, escrow, statuses…)
 *  - <PricingGuide>   budget / price guidance from real Servix price data
 */
import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { bookingHealth, explain, pricingGuidance } from '../../lib/aiApi.js';
import { HEALTH_LABELS } from '../../lib/aiHelpers.js';
import { AiError, AiMarkdown, AiMeta, AiNote, AiTag, AiThinking, useAiTask } from './AiBits.jsx';

export function BookingHealth({ bookingId, status }) {
  const task = useAiTask();
  useEffect(() => { task.reset(); }, [bookingId, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = () => task.run((signal) => bookingHealth(bookingId, { signal }));
  const d = task.data; const label = d ? (HEALTH_LABELS[d.status] ?? { label: d.status, tone: 'gray' }) : null;
  return <section className="ai-panel" aria-label="Project health" data-testid="ai-booking-health">
    <div className="ai-panel__head"><h3>Where does this project stand?</h3><AiTag small /></div>
    {!d && !task.busy && <div className="ws-actions" style={{ alignItems: 'center' }}><button type="button" className="btn btn--secondary" style={{ fontSize: 12, padding: '8px 12px' }} onClick={run}><Icon name="sparkle" size={14} /> Explain this booking</button><span className="ws-muted" style={{ fontSize: 12 }}>A plain-language summary, what happens next and anything to watch.</span></div>}
    {task.busy && <AiThinking label="Reading the booking timeline…" onCancel={task.cancel} />}
    <AiError error={task.error} onRetry={run} />
    {d && !task.busy && <div>
      <div className="ai-chips" style={{ marginTop: 0, marginBottom: 10 }}><span className={`ai-chip ${label.tone}`}>{label.label}</span>{d.booking?.overdueDays > 0 && <span className="ai-chip bad">{d.booking.overdueDays} day{d.booking.overdueDays === 1 ? '' : 's'} overdue</span>}</div>
      <AiMarkdown text={d.summary} />
      {d.nextSteps?.length > 0 && <><p style={{ marginTop: 10 }}><strong>Next steps</strong></p><ul className="ai-list">{d.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul></>}
      {d.concerns?.length > 0 && <><p style={{ marginTop: 10 }}><strong>Watch out for</strong></p><ul className="ai-list ai-flags">{d.concerns.map((s) => <li key={s}>{s}</li>)}</ul></>}
      <div className="ws-actions" style={{ marginTop: 10 }}><button type="button" className="ai-link" onClick={run}>Refresh</button></div>
      <AiMeta ai={d.ai} />
      <AiNote>The status badge is computed by Servix from the booking record; only the wording is AI-written.</AiNote>
    </div>}
  </section>;
}

export function ExplainButton({ topic, context, label = 'What does this mean?' }) {
  const [open, setOpen] = useState(false);
  const task = useAiTask();
  const [draft, setDraft] = useState('');
  const run = () => { setDraft(''); let partial = ''; return task.run((signal) => explain(topic, context, { signal, onDelta: (t) => { partial += t; setDraft(partial); } })).finally(() => setDraft('')); };
  return <span style={{ display: 'inline-block' }}>
    <button type="button" className="ai-link ai-explain" onClick={() => { if (!open) { setOpen(true); if (!task.data) run(); } else setOpen(false); }} aria-expanded={open} data-testid="ai-explain"><Icon name="sparkle" size={11} /> {label}</button>
    {open && <div className="ai-panel" style={{ marginTop: 10 }} role="region" aria-label={`Explanation: ${topic}`}>
      <div className="ai-panel__head"><h3 style={{ textTransform: 'capitalize' }}>{topic}</h3><div className="ws-actions" style={{ alignItems: 'center' }}><AiTag small /><button type="button" className="ai-link" onClick={() => setOpen(false)}>Close</button></div></div>
      {task.busy && !draft && <AiThinking label="Explaining…" onCancel={task.cancel} />}
      {task.busy && draft && <AiMarkdown text={draft} streaming />}
      <AiError error={task.error} onRetry={run} />
      {task.data && !task.busy && <><AiMarkdown text={task.data.answer} /><AiMeta ai={task.data.ai} /></>}
    </div>}
  </span>;
}

export function PricingGuide({ categories = [], defaultCategory = '', audience = 'customer' }) {
  const [categorySlug, setCategorySlug] = useState(defaultCategory);
  const [brief, setBrief] = useState('');
  const [days, setDays] = useState('');
  const task = useAiTask();
  useEffect(() => { if (!categorySlug && categories.length) setCategorySlug(categories[0].slug ?? categories[0].id); }, [categories, categorySlug]);
  const run = () => task.run((signal) => pricingGuidance({ categorySlug, ...(brief.trim() ? { brief: brief.trim() } : {}), ...(Number(days) > 0 ? { deliveryDays: Number(days) } : {}) }, { signal }));
  const d = task.data; const s = d?.stats;
  return <div className="ai-panel" data-testid="ai-pricing">
    <div className="ai-panel__head"><h3>{audience === 'professional' ? 'What should I charge?' : 'What should I budget?'}</h3><AiTag small /></div>
    <p>Based on the prices professionals actually list on Servix in that category. When Servix doesn’t have enough data yet, it says so instead of guessing.</p>
    <div className="req-form-grid">
      <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Category<select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)}>{categories.map((c) => <option key={c.slug ?? c.id} value={c.slug ?? c.id}>{c.name}</option>)}</select></label>
      <label className="ws-form" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Delivery (days, optional)<input type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
      <label className="ws-form full" style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600 }}>Describe the job (optional)<textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={1500} placeholder="e.g. 5-page website with contact form and basic SEO" /></label>
    </div>
    <div className="ai-panel__row"><button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} disabled={task.busy || !categorySlug} onClick={run}><Icon name="sparkle" size={14} /> Get guidance</button>{task.busy && <AiThinking label="Checking Servix prices…" onCancel={task.cancel} />}</div>
    <AiError error={task.error} onRetry={run} />
    {d && !task.busy && <div className="ai-result">
      {d.basis === 'servix_data' && d.rangeLow != null && d.rangeHigh != null ? <p><strong style={{ fontSize: 18, color: '#12372a' }}>₦{Number(d.rangeLow).toLocaleString('en-NG')} – ₦{Number(d.rangeHigh).toLocaleString('en-NG')}</strong></p> : <p><span className="ai-chip warn">Not enough Servix data yet</span></p>}
      <AiMarkdown text={d.summary} style={{ marginTop: 8 }} />
      {s && !s.insufficient && <p style={{ marginTop: 8 }}>Servix listings in this category: {s.count} gigs · median ₦{Number(s.median).toLocaleString('en-NG')} · from ₦{Number(s.min).toLocaleString('en-NG')} to ₦{Number(s.max).toLocaleString('en-NG')}.</p>}
      {d.tips?.length > 0 && <ul className="ai-list">{d.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
      <AiMeta ai={d.ai} />
      <AiNote>Ranges are clamped to real Servix prices — they are guidance, not a quote.</AiNote>
    </div>}
  </div>;
}

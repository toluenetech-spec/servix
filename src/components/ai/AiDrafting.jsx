/**
 * Drafting helpers. Every draft is a suggestion the user explicitly inserts — nothing is saved by the AI.
 *  - <AiTextDraft>   gig description / profile about / client message → preview → "Use this text"
 *  - <RequestBriefAssist> plain-language brief → validated request draft → fills the request form
 *  - <ProposalDraftAssist> open request → proposal draft (price, days, cover, milestones) → fills the proposal form
 */
import { useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { draft, draftProposal } from '../../lib/aiApi.js';
import { proposalDraftToForm, requestDraftToForm } from '../../lib/aiHelpers.js';
import { AiError, AiMeta, AiNote, AiTag, AiThinking, useAiTask } from './AiBits.jsx';

const TONES = [['friendly', 'Friendly'], ['professional', 'Professional'], ['brief', 'Short & direct']];
const COPY = {
  gig_description: { title: 'Draft the description with Servix AI', hint: 'Jot down what you deliver, how you work and what you need from the client. You get a full description to edit.', placeholder: 'e.g. I design logos and brand kits for small businesses. 3 concepts, 2 revisions, files in PNG/SVG/PDF, 5 days.' },
  profile_about: { title: 'Draft your About section', hint: 'A few facts about you — years of experience, what you specialise in, who you work with.', placeholder: 'e.g. 6 years as a wedding photographer in Abuja, 200+ events, calm with nervous couples, deliver within 10 days.' },
  client_message: { title: 'Draft a message', hint: 'What do you want to say? Keep the facts; the AI handles the wording.', placeholder: 'e.g. Tell the client the first draft is ready and ask for feedback by Friday.' },
};

export function AiTextDraft({ kind, seed = '', onUse, compact = false }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(seed);
  const [tone, setTone] = useState('friendly');
  const task = useAiTask();
  const copy = COPY[kind] ?? COPY.gig_description;
  if (!open) return <button type="button" className="btn btn--secondary" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setOpen(true)} data-testid={`ai-draft-${kind}`}><Icon name="sparkle" size={14} /> Draft with Servix AI</button>;
  const run = () => task.run((signal) => draft(kind, input.trim(), tone, { signal }));
  return <div className="ai-panel" data-testid={`ai-draft-panel-${kind}`}>
    <div className="ai-panel__head"><h3>{copy.title}</h3><div className="ws-actions" style={{ alignItems: 'center' }}><AiTag small /><button type="button" className="ai-link" onClick={() => { task.reset(); setOpen(false); }}>Close</button></div></div>
    {!compact && <p>{copy.hint}</p>}
    <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} placeholder={copy.placeholder} aria-label="Notes for the draft" />
    <div className="ai-panel__row">
      <select value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Tone">{TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} disabled={task.busy || input.trim().length < 5} onClick={run}>{task.data ? 'Draft again' : 'Write a draft'}</button>
    </div>
    {task.busy && <AiThinking label="Writing…" onCancel={task.cancel} />}
    <AiError error={task.error} onRetry={run} />
    {task.data && !task.busy && <div className="ai-result">
      <blockquote data-testid="ai-draft-text">{task.data.draft}</blockquote>
      <div className="ws-actions"><button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} onClick={() => { onUse(task.data.draft); task.reset(); setOpen(false); }}>Use this text</button><button type="button" className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(task.data.draft)}>Copy</button></div>
      <AiMeta ai={task.data.ai} />
      <AiNote>Edit anything that isn’t accurate before you save — the AI only knows what you typed above.</AiNote>
    </div>}
  </div>;
}

export function RequestBriefAssist({ form, onFill, disabled }) {
  const [input, setInput] = useState('');
  const task = useAiTask();
  const run = () => task.run((signal) => draft('request_brief', input.trim(), 'friendly', { signal }));
  return <div className="ai-panel" data-testid="ai-request-brief">
    <div className="ai-panel__head"><h3>Describe it in your own words</h3><AiTag small /></div>
    <p>Tell us what you need like you would tell a friend — budget, timing, where. Servix AI turns it into a structured request you can still edit. It only uses real Servix categories; nothing is posted until you publish.</p>
    <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} disabled={disabled} placeholder="e.g. I need a simple website for my restaurant in Ikeja with the menu and WhatsApp ordering, budget around 150 to 250k, before the end of next month." aria-label="Describe your request" />
    <div className="ai-panel__row">
      <button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} disabled={disabled || task.busy || input.trim().length < 5} onClick={run}><Icon name="sparkle" size={14} /> {task.data ? 'Draft again' : 'Draft my request'}</button>
      {task.busy && <AiThinking label="Structuring your request…" onCancel={task.cancel} />}
    </div>
    <AiError error={task.error} onRetry={run} />
    {task.data?.draft && !task.busy && <div className="ai-result">
      <p><strong style={{ color: '#17452e' }}>Draft ready:</strong> “{task.data.draft.title}” · {task.data.draft.budgetType === 'range' && task.data.draft.budgetMin != null ? `₦${Number(task.data.draft.budgetMin).toLocaleString('en-NG')} – ` : ''}{task.data.draft.budgetMax != null ? `₦${Number(task.data.draft.budgetMax).toLocaleString('en-NG')}` : 'no budget yet'}{task.data.draft.deadlineAt ? ` · by ${new Date(task.data.draft.deadlineAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</p>
      {task.data.draft.missingInformation?.length > 0 && <><p style={{ marginTop: 8 }}><strong>Worth adding before you publish:</strong></p><ul className="ai-list">{task.data.draft.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul></>}
      <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} onClick={() => onFill(requestDraftToForm(task.data.draft, form))} data-testid="ai-request-fill">Fill in the form</button></div>
      <AiMeta ai={task.data.ai} />
      <AiNote>Check the category, budget and deadline — you can change every field below before saving.</AiNote>
    </div>}
  </div>;
}

export function ProposalDraftAssist({ requestId, form, onFill }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const task = useAiTask();
  if (!open) return <button type="button" className="btn btn--secondary" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setOpen(true)} data-testid="ai-proposal-open"><Icon name="sparkle" size={14} /> Draft with Servix AI</button>;
  const run = () => task.run((signal) => draftProposal(requestId, notes.trim() || undefined, { signal }));
  const d = task.data?.draft;
  return <div className="ai-panel" data-testid="ai-proposal-panel">
    <div className="ai-panel__head"><h3>Draft a proposal from your profile</h3><div className="ws-actions" style={{ alignItems: 'center' }}><AiTag small /><button type="button" className="ai-link" onClick={() => { task.reset(); setOpen(false); }}>Close</button></div></div>
    <p>Servix AI reads this request and your gigs, then suggests a price, timeline and a first-person cover note. Nothing is sent until you review it and press “Send proposal”.</p>
    <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1500} placeholder="Optional: anything specific you want included (your approach, questions, a price you have in mind)…" aria-label="Notes for the proposal" />
    <div className="ai-panel__row"><button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} disabled={task.busy} onClick={run}>{d ? 'Draft again' : 'Write a draft'}</button>{task.busy && <AiThinking label="Drafting…" onCancel={task.cancel} />}</div>
    <AiError error={task.error} onRetry={run} />
    {d && !task.busy && <div className="ai-result">
      <p><strong style={{ color: '#17452e' }}>₦{Number(d.price).toLocaleString('en-NG')}</strong> · {d.deliveryDays} day{d.deliveryDays === 1 ? '' : 's'}{d.serviceSlug ? ' · attached to one of your gigs' : ' · custom work'}</p>
      <blockquote data-testid="ai-proposal-cover">{d.cover}</blockquote>
      {d.milestones?.length > 0 && <ul className="ai-list">{d.milestones.map((m, i) => <li key={i}>{m.title}{m.amount ? ` — ₦${Number(m.amount).toLocaleString('en-NG')}` : ''}{m.days ? ` · ${m.days} d` : ''}</li>)}</ul>}
      {d.flags?.length > 0 && <ul className="ai-list ai-flags">{d.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
      <div className="ws-actions" style={{ marginTop: 12 }}><button type="button" className="btn btn--primary" style={{ fontSize: 12, padding: '9px 14px' }} onClick={() => { onFill(proposalDraftToForm(d, form)); task.reset(); setOpen(false); }} data-testid="ai-proposal-fill">Put it in the form</button></div>
      <AiMeta ai={task.data.ai} />
      <AiNote>Make the price and timeline yours — the customer sees exactly what you send, not what the AI drafted.</AiNote>
    </div>}
  </div>;
}

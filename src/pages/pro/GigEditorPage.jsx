/**
 * Gig editor — the Fiverr-style six-step wizard for creating/editing a service:
 *   1 Overview · 2 Pricing · 3 Description & FAQ · 4 Requirements · 5 Gallery · 6 Publish
 * The draft is created after Pricing (title + category + price are the minimum
 * the API needs) and PATCHed on every later "Save & Continue". Publishing is
 * blocked by the server's checklist (publishProblems) until the gig is complete.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { OnboardingLayout, Stepper } from '../../components/onboarding/OnboardingLayout.jsx';
import { ListEditor, TagInput } from '../../components/onboarding/ListEditor.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { getCategories } from '../../lib/api.js';
import { formatPrice } from '../../lib/format.js';
import * as proApi from '../../lib/proApi.js';
import { uploadFile, UPLOAD_LIMITS, formatBytes } from '../../lib/uploadApi.js';

export const GIG_STEPS = ['Overview', 'Pricing', 'Description & FAQ', 'Requirements', 'Gallery', 'Publish'];
const DELIVERY_OPTIONS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 45, 60, 90];
const PRICE_UNITS = ['per project', 'per hour', 'per day', 'per session', 'per month'];
const GALLERY_LIMITS = { image: 5, video: 1, document: 2 };

const EMPTY_GIG = {
  id: null, status: 'draft',
  title: '', categorySlug: '', serviceType: '', searchTags: [],
  price: '', priceUnit: 'per project', deliveryDays: '', revisions: '1', isRemote: true, locationLabel: '', included: [],
  shortDescription: '', description: '', faqs: [],
  requirements: [], gallery: [],
  publishProblems: {},
};

function fromService(s) {
  return {
    id: s.id, status: s.status,
    title: s.title ?? '', categorySlug: s.categoryId ?? '', serviceType: s.serviceType ?? '', searchTags: s.searchTags ?? [],
    price: s.price ? String(s.price) : '', priceUnit: s.priceUnit || 'per project',
    deliveryDays: s.deliveryDays ? String(s.deliveryDays) : '', revisions: s.revisions == null ? '1' : String(s.revisions),
    isRemote: s.location !== '' ? s.location === 'Remote' : true, locationLabel: s.location && s.location !== 'Remote' ? s.location : '',
    included: s.included ?? [],
    shortDescription: s.shortDescription ?? '', description: s.description ?? '',
    faqs: (s.faqs ?? []).map((f) => ({ q: f.q ?? '', a: f.a ?? '' })),
    requirements: (s.requirements ?? []).map((r) => ({ question: r.question ?? '', type: r.type ?? 'text', options: r.options ?? [], required: Boolean(r.required) })),
    gallery: s.media ?? [],
    publishProblems: s.publishProblems ?? {},
  };
}

function toPayload(g) {
  return {
    title: g.title.trim(),
    categorySlug: g.categorySlug,
    serviceType: g.serviceType.trim() || undefined,
    searchTags: g.searchTags,
    price: Number(g.price) || 0,
    priceUnit: g.priceUnit,
    deliveryDays: g.deliveryDays ? Number(g.deliveryDays) : undefined,
    revisions: g.revisions === '' ? undefined : Number(g.revisions),
    isRemote: g.isRemote,
    locationLabel: g.isRemote ? 'Remote' : g.locationLabel.trim() || undefined,
    included: g.included.map((s) => s.trim()).filter(Boolean),
    shortDescription: g.shortDescription.trim(),
    description: g.description.trim(),
    faqs: g.faqs.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() })),
    requirements: g.requirements.filter((r) => r.question.trim()).map((r) => ({ question: r.question.trim(), type: r.type, options: r.type === 'choice' ? r.options : [], required: r.required })),
    gallery: g.gallery.map((m) => ({ url: m.url, kind: m.kind, fileName: m.fileName || '' })),
  };
}

export default function GigEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  useDocumentMeta({ title: isNew ? 'Create a gig' : 'Edit gig', description: 'Describe the service you offer on Servix.' });
  const { user, initializing, authAvailable } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();

  const [step, setStep] = useState(0);
  const [gig, setGig] = useState(EMPTY_GIG);
  const [categories, setCategories] = useState([]);
  const [state, setState] = useState(isNew ? 'ready' : 'loading'); // loading | ready | error | denied
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);
  useEffect(() => {
    if (initializing) return;
    if (!authAvailable || !user) { setState('denied'); return; }
    if (user.role !== 'professional' && user.role !== 'admin') { navigate('/professionals/apply', { replace: true }); return; }
    if (isNew) return;
    proApi.getMyService(id).then((s) => { setGig(fromService(s)); setState('ready'); }).catch(() => setState('error'));
  }, [initializing, authAvailable, user, id, isNew, navigate]);

  const patch = (changes) => setGig((g) => ({ ...g, ...changes }));

  function validate(i) {
    const e = {};
    if (i === 0) {
      if (gig.title.trim().length < 5) e.title = 'Give the gig a title of at least 5 characters.';
      if (!gig.categorySlug) e.categorySlug = 'Choose a category.';
      if (gig.searchTags.some((t) => t.length < 2 || t.length > 20)) e.searchTags = 'Tags must be 2–20 characters.';
    }
    if (i === 1) {
      if (!(Number(gig.price) >= 1000)) e.price = 'Set a price of at least ₦1,000.';
      if (!gig.deliveryDays) e.deliveryDays = 'Choose a delivery time.';
      if (!gig.isRemote && !gig.locationLabel.trim()) e.locationLabel = 'Where do you deliver this in person?';
    }
    if (i === 2) {
      if (gig.shortDescription.trim().length < 20) e.shortDescription = 'Write at least 20 characters.';
      if (gig.shortDescription.trim().length > 200) e.shortDescription = 'Keep it under 200 characters.';
      if (gig.description.trim().length < 50) e.description = 'Describe the gig in at least 50 characters.';
    }
    if (i === 3) {
      gig.requirements.forEach((r, idx) => { if (r.type === 'choice' && r.options.length < 2) e[`requirements.${idx}`] = 'Add at least two options.'; });
    }
    if (i === 4) {
      if (!gig.gallery.some((m) => m.kind === 'image')) e.gallery = 'Add at least one image so clients can see your work.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    setSaveError('');
    setSaving(true);
    try {
      const payload = toPayload(gig);
      const saved = gig.id ? await proApi.updateService(gig.id, payload) : await proApi.createService(payload);
      setGig((g) => ({ ...fromService(saved), status: saved.status }));
      if (!gig.id) navigate(`/dashboard/gigs/${saved.id}/edit`, { replace: true });
      return saved;
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      setSaveError(err.message || 'Could not save the gig. Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    if (!validate(step)) return;
    // Overview alone cannot be stored (the API needs a price) — move on and save after Pricing.
    if (step >= 1 || gig.id) { const saved = await save(); if (!saved) return; }
    setStep(Math.min(GIG_STEPS.length - 1, step + 1));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function back() { setStep(Math.max(0, step - 1)); window.scrollTo({ top: 0, behavior: 'instant' }); }

  async function saveAndExit() {
    if (gig.id || (validate(0) && Number(gig.price) >= 1000)) {
      const saved = await save();
      if (!saved) return;
      showToast('Gig saved as a draft.', 'success');
    }
    navigate('/dashboard/gigs');
  }

  async function publish() {
    const saved = await save();
    if (!saved) return;
    try {
      await proApi.publishService(saved.id);
      showToast('Your gig is live.', 'success');
      navigate('/dashboard/gigs');
    } catch (err) {
      if (err.errors) setGig((g) => ({ ...g, publishProblems: err.errors }));
      setSaveError(err.message || 'Could not publish yet.');
    }
  }

  /* -------- guards -------- */
  if (state === 'denied') {
    return <OnboardingLayout exitTo="/login"><div className="ob-status"><h1>Sign in to manage gigs</h1><p>The gig editor is part of the professional workspace.</p><Button to="/login" variant="primary">Sign in</Button></div></OnboardingLayout>;
  }
  if (initializing || state === 'loading') {
    return <OnboardingLayout exitTo="/dashboard/gigs"><div className="ob-status" role="status" aria-busy="true"><p>Loading your gig…</p></div></OnboardingLayout>;
  }
  if (state === 'error') {
    return <OnboardingLayout exitTo="/dashboard/gigs"><div className="ob-status"><h1>We couldn’t load this gig</h1><p>It may have been removed, or the connection dropped.</p><Button to="/dashboard/gigs" variant="secondary">Back to my gigs</Button></div></OnboardingLayout>;
  }

  const problems = gig.publishProblems ?? {};
  const problemStep = { title: 0, shortDescription: 2, description: 2, price: 1, deliveryDays: 1, gallery: 4 };
  const last = step === GIG_STEPS.length - 1;
  const actions = (
    <>
      <Button type="button" variant="ghost" onClick={back} disabled={saving || step === 0}>Back</Button>
      <span className="ob-footer__spacer" />
      <Button type="button" variant="ghost" onClick={saveAndExit} disabled={saving}>Save & exit</Button>
      {last ? (
        gig.status === 'active'
          ? <Button type="button" variant="primary" onClick={async () => { const s = await save(); if (s) { showToast('Changes saved.', 'success'); navigate('/dashboard/gigs'); } }} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          : <Button type="button" variant="primary" onClick={publish} disabled={saving}>{saving ? 'Working…' : 'Publish gig'}</Button>
      ) : (
        <Button type="button" variant="primary" onClick={next} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</Button>
      )}
    </>
  );

  return (
    <OnboardingLayout exitTo="/dashboard/gigs" progress={((step + 1) / GIG_STEPS.length) * 100} actions={actions} wide>
      <Stepper steps={GIG_STEPS} current={step} />
      {saveError && <div className="ob-error" role="alert" style={{ marginBottom: 20 }}>{saveError}</div>}

      {step === 0 && (
        <section className="ob-section" aria-labelledby="gig-overview">
          <h1 id="gig-overview">Overview</h1>
          <p className="lead">Clients find gigs through titles, categories and search tags — make all three specific.</p>
          <div className="ob-form">
            <Field label="Gig title" required error={errors.title} hint={`Start with “I will …”. ${gig.title.length}/140`}>
              {(props) => (
                <div className="gig-title">
                  <span aria-hidden="true">I will</span>
                  <input {...props} className="input" type="text" maxLength={140} placeholder="design a modern logo for your business" value={gig.title.replace(/^I will\s*/i, '')} onChange={(e) => patch({ title: `I will ${e.target.value}`.trimEnd() })} />
                </div>
              )}
            </Field>
            <Field label="Category" required error={errors.categorySlug}>
              {(props) => (
                <select {...props} className="select" value={gig.categorySlug} onChange={(e) => patch({ categorySlug: e.target.value })}>
                  <option value="">Choose a category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Service type" hint="The specific thing you do inside that category, e.g. Logo design, Shopify store, Wedding photography.">
              {(props) => <input {...props} className="input" type="text" maxLength={80} value={gig.serviceType} onChange={(e) => patch({ serviceType: e.target.value })} />}
            </Field>
            <Field label="Search tags" error={errors.searchTags} hint="Up to 5 words or phrases clients might search for. 2–20 characters each.">
              {(props) => <TagInput id={props.id} value={gig.searchTags} onChange={(searchTags) => patch({ searchTags })} max={5} maxLength={20} placeholder="e.g. logo, brand identity" />}
            </Field>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="ob-section" aria-labelledby="gig-pricing">
          <h1 id="gig-pricing">Pricing</h1>
          <p className="lead">One clear price. The client pays it upfront through Servix and it’s released to you when the work is completed.</p>
          <div className="ob-form">
            <div className="gig-grid">
              <Field label="Price (₦)" required error={errors.price} hint="Minimum ₦1,000.">
                {(props) => <input {...props} className="input" type="number" min={1000} step={500} inputMode="numeric" value={gig.price} onChange={(e) => patch({ price: e.target.value })} />}
              </Field>
              <Field label="Priced" required>
                {(props) => <select {...props} className="select" value={gig.priceUnit} onChange={(e) => patch({ priceUnit: e.target.value })}>{PRICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>}
              </Field>
              <Field label="Delivery time" required error={errors.deliveryDays}>
                {(props) => (
                  <select {...props} className="select" value={gig.deliveryDays} onChange={(e) => patch({ deliveryDays: e.target.value })}>
                    <option value="">Choose…</option>
                    {DELIVERY_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Revisions included" error={errors.revisions}>
                {(props) => (
                  <select {...props} className="select" value={gig.revisions} onChange={(e) => patch({ revisions: e.target.value })}>
                    {[0, 1, 2, 3, 4, 5, 10].map((r) => <option key={r} value={r}>{r === 0 ? 'None' : r}</option>)}
                    <option value="20">Unlimited (20)</option>
                  </select>
                )}
              </Field>
            </div>
            <div className="field">
              <span className="field__label">Where it happens</span>
              <div className="gig-choice">
                <label><input type="radio" name="where" checked={gig.isRemote} onChange={() => patch({ isRemote: true })} /> Remote / online</label>
                <label><input type="radio" name="where" checked={!gig.isRemote} onChange={() => patch({ isRemote: false })} /> In person</label>
              </div>
              {!gig.isRemote && (
                <Field label="Service area" required error={errors.locationLabel}>
                  {(props) => <input {...props} className="input" type="text" placeholder="e.g. Lagos mainland" maxLength={120} value={gig.locationLabel} onChange={(e) => patch({ locationLabel: e.target.value })} />}
                </Field>
              )}
            </div>
            <Field label="What’s included" error={errors.included} hint="Up to 15 items, e.g. “3 logo concepts”, “Source files”, “2 rounds of feedback”. Press Enter after each.">
              {(props) => <TagInput id={props.id} value={gig.included} onChange={(included) => patch({ included })} max={15} maxLength={200} placeholder="Add an item" />}
            </Field>
            {Number(gig.price) >= 1000 && <p className="ws-muted">Clients will see <strong>{formatPrice(Number(gig.price))}</strong> {gig.priceUnit}{gig.deliveryDays ? ` · ${gig.deliveryDays === '1' ? '1 day' : `${gig.deliveryDays} days`} delivery` : ''}.</p>}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="ob-section" aria-labelledby="gig-description">
          <h1 id="gig-description">Description & FAQ</h1>
          <p className="lead">Briefly describe your gig, then answer the questions clients usually ask before booking.</p>
          <div className="ob-form">
            <Field label="Short description" required error={errors.shortDescription} hint={`Shown on search cards. ${gig.shortDescription.length}/200`}>
              {(props) => <textarea {...props} className="textarea" rows={2} maxLength={200} value={gig.shortDescription} onChange={(e) => patch({ shortDescription: e.target.value })} />}
            </Field>
            <Field label="Full description" required error={errors.description} hint={`What you deliver, how you work, what you need from the client. ${gig.description.length}/5000 (minimum 50).`}>
              {(props) => <textarea {...props} className="textarea" rows={10} maxLength={5000} value={gig.description} onChange={(e) => patch({ description: e.target.value })} />}
            </Field>
            <div className="field">
              <span className="field__label">Frequently asked questions</span>
              <ListEditor
                label="FAQ"
                items={gig.faqs}
                onChange={(faqs) => patch({ faqs })}
                max={10}
                addLabel="Add FAQ"
                empty="Add questions like “Do you provide source files?” or “How many revisions are included?”"
                fields={[
                  { key: 'q', label: 'Question', required: true, wide: true, maxLength: 300 },
                  { key: 'a', label: 'Answer', type: 'textarea', wide: true, maxLength: 1000 },
                ]}
              />
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="ob-section" aria-labelledby="gig-requirements">
          <h1 id="gig-requirements">Requirements</h1>
          <p className="lead">Tell clients what you need from them to get started. They see these questions when they book.</p>
          <RequirementsEditor items={gig.requirements} onChange={(requirements) => patch({ requirements })} errors={errors} />
        </section>
      )}

      {step === 4 && (
        <section className="ob-section" aria-labelledby="gig-gallery">
          <h1 id="gig-gallery">Showcase your services in a gig gallery</h1>
          <p className="lead">Encourage clients to choose your gig by featuring real examples of your work. At least one image is required to publish.</p>
          {errors.gallery && <div className="ob-error" role="alert" style={{ marginBottom: 16 }}>{errors.gallery}</div>}
          <GalleryEditor gallery={gig.gallery} onChange={(gallery) => patch({ gallery })} />
        </section>
      )}

      {step === 5 && (
        <section className="ob-section" aria-labelledby="gig-publish">
          <h1 id="gig-publish">{gig.status === 'active' ? 'Review your changes' : 'Almost there…'}</h1>
          <p className="lead">{gig.status === 'active' ? 'This gig is live. Saving updates it immediately.' : 'Publishing makes the gig visible to clients and bookable straight away.'}</p>
          <div className="ob-review">
            {Object.keys(problems).length > 0 && (
              <div className="ob-error" role="alert">
                <strong>Finish these before publishing:</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {Object.entries(problems).map(([k, msg]) => (
                    <li key={k}>{msg} <button type="button" className="ob-list__remove" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => setStep(problemStep[k] ?? 0)}>Fix</button></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="ob-review__card">
              {gig.gallery.find((m) => m.kind === 'image') && <img src={gig.gallery.find((m) => m.kind === 'image').url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8 }} />}
              <h3>{gig.title || 'Untitled gig'} <button type="button" onClick={() => setStep(0)}>Edit</button></h3>
              <dl>
                <dt>Category</dt><dd>{categories.find((c) => c.id === gig.categorySlug)?.name || gig.categorySlug || '—'}{gig.serviceType ? ` · ${gig.serviceType}` : ''}</dd>
                <dt>Tags</dt><dd>{gig.searchTags.join(', ') || '—'}</dd>
                <dt>Price</dt><dd>{Number(gig.price) >= 1000 ? `${formatPrice(Number(gig.price))} ${gig.priceUnit}` : '—'}</dd>
                <dt>Delivery</dt><dd>{gig.deliveryDays ? `${gig.deliveryDays} day${gig.deliveryDays === '1' ? '' : 's'}` : '—'} · {gig.revisions === '0' ? 'no revisions' : `${gig.revisions === '20' ? 'unlimited' : gig.revisions} revision${gig.revisions === '1' ? '' : 's'}`}</dd>
                <dt>Included</dt><dd>{gig.included.join(', ') || '—'}</dd>
                <dt>Short description</dt><dd>{gig.shortDescription || '—'}</dd>
                <dt>Requirements</dt><dd>{gig.requirements.filter((r) => r.question).length} question{gig.requirements.filter((r) => r.question).length === 1 ? '' : 's'}</dd>
                <dt>Gallery</dt><dd>{gig.gallery.filter((m) => m.kind === 'image').length} image(s), {gig.gallery.filter((m) => m.kind === 'video').length} video, {gig.gallery.filter((m) => m.kind === 'document').length} document(s)</dd>
              </dl>
            </div>
          </div>
        </section>
      )}
    </OnboardingLayout>
  );
}

/* ================= requirements ================= */

const REQUIREMENT_SUGGESTIONS = [
  'Please describe your business and who your customers are.',
  'Share any examples or references you like.',
  'Do you have existing brand materials (logo, colours, fonts)?',
  'What is your deadline?',
];

function RequirementsEditor({ items, onChange, errors }) {
  const update = (i, patch) => onChange(items.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="ob-list" role="group" aria-label="Requirements">
      {items.length === 0 && (
        <div className="ob-note" style={{ display: 'block' }}>
          <b>Need ideas?</b> Click to add:
          <div className="ws-actions" style={{ marginTop: 10 }}>
            {REQUIREMENT_SUGGESTIONS.map((q) => <button key={q} type="button" className="btn btn--secondary btn--sm" onClick={() => onChange([...items, { question: q, type: 'text', options: [], required: false }])}>{q}</button>)}
          </div>
        </div>
      )}
      {items.map((r, i) => (
        <div className="ob-list__item" key={i}>
          <div className="ob-list__row"><strong>Question {i + 1}</strong><button type="button" className="ob-list__remove" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>Remove</button></div>
          <div className="ob-list__grid">
            <label className="ob-list__item--wide">Question<span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span>
              <textarea rows={2} maxLength={300} value={r.question} onChange={(e) => update(i, { question: e.target.value })} />
            </label>
            <label>Answer type
              <select value={r.type} onChange={(e) => update(i, { type: e.target.value })}>
                <option value="text">Free text</option>
                <option value="choice">Multiple choice</option>
                <option value="file">File attachment</option>
              </select>
            </label>
            <label className="gig-check">Required
              <span><input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} /> Client must answer before booking</span>
            </label>
            {r.type === 'choice' && (
              <label className="ob-list__item--wide">Options (press Enter after each)
                <TagInput value={r.options} onChange={(options) => update(i, { options })} max={10} maxLength={80} placeholder="e.g. Yes" />
              </label>
            )}
          </div>
          {errors[`requirements.${i}`] && <p className="field__error" role="alert">{errors[`requirements.${i}`]}</p>}
        </div>
      ))}
      {items.length < 15 && <button type="button" className="ob-add" onClick={() => onChange([...items, { question: '', type: 'text', options: [], required: false }])}>+ Add a question</button>}
    </div>
  );
}

/* ================= gallery ================= */

function GalleryEditor({ gallery, onChange }) {
  const images = gallery.filter((m) => m.kind === 'image');
  const video = gallery.find((m) => m.kind === 'video') ?? null;
  const documents = gallery.filter((m) => m.kind === 'document');
  const [busy, setBusy] = useState(null); // kind being uploaded
  const [error, setError] = useState('');
  const refs = { image: useRef(null), video: useRef(null), document: useRef(null) };
  const kindMap = { image: 'service', video: 'service-video', document: 'service-document' };

  async function add(kind, files) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setError('');
    const room = GALLERY_LIMITS[kind] - gallery.filter((m) => m.kind === kind).length;
    if (room <= 0) { setError(kind === 'video' ? 'A gig can have one video.' : `Up to ${GALLERY_LIMITS[kind]} ${kind}s.`); return; }
    setBusy(kind);
    const added = [];
    try {
      for (const file of list.slice(0, room)) {
        const stored = await uploadFile(file, kindMap[kind]);
        added.push({ url: stored.url, kind, fileName: stored.fileName || file.name });
      }
      onChange([...gallery, ...added]);
    } catch (err) {
      if (added.length) onChange([...gallery, ...added]);
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }
  const remove = (item) => onChange(gallery.filter((m) => m !== item));
  const makeCover = (item) => onChange([item, ...gallery.filter((m) => m !== item)]);

  return (
    <div className="gig-gallery">
      {error && <div className="ob-error" role="alert">{error}</div>}
      <section className="ob-review__card">
        <h3>Images ({images.length}/{GALLERY_LIMITS.image})</h3>
        <p className="ws-muted" style={{ margin: 0 }}>{UPLOAD_LIMITS.image.label}. The first image is the cover clients see in search.</p>
        <div className="gig-thumbs">
          {images.map((m, i) => (
            <figure key={m.url} className="gig-thumb">
              <img src={m.url} alt={m.fileName || `Image ${i + 1}`} />
              {i === 0 && <span className="ob-pill gig-thumb__cover">Cover</span>}
              <figcaption>
                {i > 0 && <button type="button" onClick={() => makeCover(m)}>Make cover</button>}
                <button type="button" onClick={() => remove(m)}>Remove</button>
              </figcaption>
            </figure>
          ))}
          {images.length < GALLERY_LIMITS.image && (
            <button type="button" className="gig-thumb gig-thumb--add" disabled={busy === 'image'} onClick={() => refs.image.current?.click()}>
              <Icon name="image" size={22} />{busy === 'image' ? 'Uploading…' : 'Add image'}
            </button>
          )}
        </div>
        <input ref={refs.image} type="file" hidden multiple accept={UPLOAD_LIMITS.image.accept} aria-label="Add gallery images" onChange={(e) => { add('image', e.target.files); e.target.value = ''; }} />
      </section>

      <section className="ob-review__card">
        <h3>Video ({video ? 1 : 0}/1)</h3>
        <p className="ws-muted" style={{ margin: 0 }}>{UPLOAD_LIMITS.video.label}. A short intro of you or your process converts best.</p>
        {video ? (
          <div className="gig-file"><Icon name="video" size={18} /><span>{video.fileName || 'Video'}</span><button type="button" className="ob-list__remove" onClick={() => remove(video)}>Remove</button></div>
        ) : (
          <button type="button" className="ob-add" disabled={busy === 'video'} onClick={() => refs.video.current?.click()}>{busy === 'video' ? 'Uploading video… this can take a moment' : '+ Add video'}</button>
        )}
        <input ref={refs.video} type="file" hidden accept={UPLOAD_LIMITS.video.accept} aria-label="Add a gig video" onChange={(e) => { add('video', e.target.files); e.target.value = ''; }} />
      </section>

      <section className="ob-review__card">
        <h3>Documents ({documents.length}/{GALLERY_LIMITS.document})</h3>
        <p className="ws-muted" style={{ margin: 0 }}>{UPLOAD_LIMITS.document.label}. Price lists, brochures or case studies.</p>
        {documents.map((d) => (
          <div className="gig-file" key={d.url}><Icon name="file" size={18} /><span>{d.fileName || 'Document'}</span><button type="button" className="ob-list__remove" onClick={() => remove(d)}>Remove</button></div>
        ))}
        {documents.length < GALLERY_LIMITS.document && (
          <button type="button" className="ob-add" disabled={busy === 'document'} onClick={() => refs.document.current?.click()}>{busy === 'document' ? 'Uploading…' : '+ Add PDF'}</button>
        )}
        <input ref={refs.document} type="file" hidden multiple accept={UPLOAD_LIMITS.document.accept} aria-label="Add PDF documents" onChange={(e) => { add('document', e.target.files); e.target.value = ''; }} />
      </section>
      <p className="ws-muted">Uploads go to Servix storage straight away; they’re attached to the gig when you save.{busy ? ` Current limit ${formatBytes(busy === 'video' ? UPLOAD_LIMITS.video.maxBytes : busy === 'document' ? UPLOAD_LIMITS.document.maxBytes : UPLOAD_LIMITS.image.maxBytes)}.` : ''}</p>
    </div>
  );
}

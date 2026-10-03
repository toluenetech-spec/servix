/** Customer: create or edit a service request (draft until published). Server validation errors are shown per field. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { createRequest, getRequest, updateRequest, requestAction } from '../../lib/marketplaceApi.js';
import { getCategories } from '../../lib/api.js';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { PageHead } from '../dashboard/shared.jsx';
import { PageSkeleton } from '../../components/ui/States.jsx';
import { useFeatures } from '../../lib/useFeatures.js';
import { RequestBriefAssist } from '../../components/ai/AiDrafting.jsx';
import '../../components/marketplace/marketplace.css';

const EMPTY = { title: '', categorySlug: '', description: '', budgetType: 'fixed', budgetMin: '', budgetMax: '', deadlineAt: '', isRemote: true, location: '', requiredSkills: '', extraRequirements: '' };
const toLocalInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export default function RequestEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  useDocumentMeta({ title: editing ? 'Edit request' : 'Post a request', description: 'Tell professionals what you need.' });
  const navigate = useNavigate(); const toast = useToast(); const { ai } = useFeatures();
  const [form, setForm] = useState(EMPTY); const [categories, setCategories] = useState([]); const formRef = useRef(null);
  const [loading, setLoading] = useState(editing); const [busy, setBusy] = useState(''); const [errors, setErrors] = useState({}); const [status, setStatus] = useState('draft');

  useEffect(() => { getCategories().then((c) => setCategories(c.items ?? c)).catch(() => setCategories([])); }, []);
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    getRequest(id).then((r) => { if (!alive) return; setStatus(r.status); setForm({ title: r.title, categorySlug: r.category.slug, description: r.description, budgetType: r.budgetType, budgetMin: r.budgetMin ?? '', budgetMax: r.budgetMax ?? '', deadlineAt: toLocalInput(r.deadlineAt), isRemote: r.isRemote, location: r.location ?? '', requiredSkills: r.requiredSkills.join(', '), extraRequirements: r.extraRequirements ?? '' }); })
      .catch((e) => toast(e.message, 'error')).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm((f) => ({ ...f, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined, budget: undefined })); };

  function payload() {
    const min = form.budgetMin === '' ? null : Number(form.budgetMin); const max = form.budgetMax === '' ? null : Number(form.budgetMax);
    return {
      title: form.title.trim(), categorySlug: form.categorySlug, description: form.description.trim(), budgetType: form.budgetType,
      budgetMin: form.budgetType === 'fixed' ? (max ?? min) : min, budgetMax: form.budgetType === 'fixed' ? (max ?? min) : max,
      deadlineAt: form.deadlineAt ? new Date(`${form.deadlineAt}T23:59:00`).toISOString() : null,
      isRemote: Boolean(form.isRemote), location: form.isRemote ? null : form.location.trim() || null,
      requiredSkills: form.requiredSkills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 15),
      extraRequirements: form.extraRequirements.trim() || null,
    };
  }

  async function save(publish) {
    setBusy(publish ? 'publish' : 'save'); setErrors({});
    try {
      const body = payload();
      const saved = editing ? await updateRequest(id, body) : await createRequest(body);
      if (publish) {
        const problems = saved.publishProblems ?? {};
        if (Object.keys(problems).length) { setErrors(problems); toast('Complete the highlighted fields before publishing.', 'error'); if (!editing) navigate(`/dashboard/requests/${saved.id}/edit`, { replace: true }); return; }
        await requestAction(saved.id, 'publish');
        toast('Your request is live. Professionals can now send proposals.', 'success');
      } else toast(editing ? 'Request updated.' : 'Draft saved.', 'success');
      navigate(`/dashboard/requests/${saved.id}`);
    } catch (e) {
      if (e.errors) setErrors(e.errors);
      toast(e.message, 'error');
    } finally { setBusy(''); }
  }

  if (loading) return <PageSkeleton variant="panel" label="Loading request…" />;
  const err = (k) => errors[k] && <span className="field-error" role="alert">{errors[k]}</span>;
  const locked = editing && !['draft', 'open', 'paused'].includes(status);

  return <>
    <PageHead title={editing ? 'Edit request' : 'Post a request'} description="Be specific about the outcome you want — professionals quote more accurately and you get fewer back-and-forth questions. Nothing is charged until you accept a proposal." />
    {locked && <div className="ws-alert">This request is {status} and can no longer be edited. <Link to={`/dashboard/requests/${id}`}>Back to the request</Link>.</div>}
    <section className="ws-panel">
      {ai && !locked && <RequestBriefAssist form={form} disabled={Boolean(busy)} onFill={(next) => { setForm(next); setErrors({}); toast('Draft filled in — review every field, then save or publish.', 'success'); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />}
      <form ref={formRef} className="ws-form" style={{ maxWidth: 820 }} onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        <div className="req-form-grid">
          <label className="full">Title
            <input value={form.title} onChange={set('title')} maxLength={140} placeholder="e.g. Brand identity for a new bakery" aria-invalid={Boolean(errors.title)} disabled={locked} />
            {err('title')}
          </label>
          <label>Category
            <select value={form.categorySlug} onChange={set('categorySlug')} aria-invalid={Boolean(errors.categorySlug)} disabled={locked}>
              <option value="">Choose a category…</option>
              {categories.map((c) => <option key={c.slug ?? c.id} value={c.slug ?? c.id}>{c.name}</option>)}
            </select>
            {err('categorySlug')}
          </label>
          <label>Deadline (optional)
            <input type="date" value={form.deadlineAt} onChange={set('deadlineAt')} min={new Date().toISOString().slice(0, 10)} disabled={locked} />
          </label>
          <label className="full">What do you need?
            <textarea rows={6} value={form.description} onChange={set('description')} maxLength={5000} placeholder="Describe the outcome, what you already have, and what “done” looks like." aria-invalid={Boolean(errors.description)} disabled={locked} />
            <small className="ws-muted">{form.description.trim().length}/40 characters minimum to publish.</small>
            {err('description')}
          </label>
          <label>Budget type
            <select value={form.budgetType} onChange={set('budgetType')} disabled={locked}><option value="fixed">Fixed budget</option><option value="range">Budget range</option></select>
          </label>
          {form.budgetType === 'fixed' ? (
            <label>Budget (₦)
              <input type="number" inputMode="numeric" min={0} step={1000} value={form.budgetMax} onChange={set('budgetMax')} placeholder="e.g. 80000" aria-invalid={Boolean(errors.budget || errors.budgetMax)} disabled={locked} />
              {err('budget')}{err('budgetMax')}
            </label>
          ) : (
            <>
              <label>Minimum (₦)<input type="number" inputMode="numeric" min={0} step={1000} value={form.budgetMin} onChange={set('budgetMin')} aria-invalid={Boolean(errors.budget || errors.budgetMin)} disabled={locked} />{err('budget')}{err('budgetMin')}</label>
              <label>Maximum (₦)<input type="number" inputMode="numeric" min={0} step={1000} value={form.budgetMax} onChange={set('budgetMax')} aria-invalid={Boolean(errors.budgetMax)} disabled={locked} />{err('budgetMax')}</label>
            </>
          )}
          <label className="inline-check full"><input type="checkbox" checked={Boolean(form.isRemote)} onChange={set('isRemote')} disabled={locked} /> This can be done remotely</label>
          {!form.isRemote && <label className="full">Location<input value={form.location} onChange={set('location')} maxLength={120} placeholder="e.g. Lekki Phase 1, Lagos" aria-invalid={Boolean(errors.location)} disabled={locked} />{err('location')}</label>}
          <label className="full">Skills wanted (optional, comma-separated)<input value={form.requiredSkills} onChange={set('requiredSkills')} placeholder="branding, illustrator, packaging" disabled={locked} /></label>
          <label className="full">Anything else professionals should know? (optional)<textarea rows={3} value={form.extraRequirements} onChange={set('extraRequirements')} maxLength={3000} disabled={locked} /></label>
        </div>
        {!locked && (
          <div className="ws-actions">
            <button type="submit" className="btn btn--secondary" disabled={Boolean(busy)}>{busy === 'save' ? 'Saving…' : editing && status !== 'draft' ? 'Save changes' : 'Save draft'}</button>
            {(!editing || status === 'draft' || status === 'paused') && <button type="button" className="btn btn--primary" disabled={Boolean(busy)} onClick={() => save(true)}>{busy === 'publish' ? 'Publishing…' : 'Publish request'}</button>}
            <Link className="btn btn--ghost" to={editing ? `/dashboard/requests/${id}` : '/dashboard/requests'}>Cancel</Link>
          </div>
        )}
      </form>
    </section>
  </>;
}

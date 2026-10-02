/**
 * Become a Professional — Fiverr-style seller onboarding.
 *
 *   Overview (import LinkedIn/CV PDF  or  fill out manually)
 *     → 1 Personal info → 2 Professional info → 3 Portfolio → 4 Review & submit
 *
 * Drafts save on every "Continue" (create on first save, PATCH after) so an
 * applicant can leave and come back. The PDF import only PRE-FILLS fields —
 * everything is reviewed by the applicant and then by the Servix team.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { FormSkeleton, Skeleton } from '../../components/ui/States.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { PhotoUploader } from '../../components/ui/PhotoUploader.jsx';
import { OnboardingLayout, Stepper } from '../../components/onboarding/OnboardingLayout.jsx';
import { ListEditor, TagInput } from '../../components/onboarding/ListEditor.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { getCategories } from '../../lib/api.js';
import * as proApi from '../../lib/proApi.js';
import { importResume, uploadFile, formatBytes, UPLOAD_LIMITS } from '../../lib/uploadApi.js';

const STEPS = ['Personal info', 'Professional info', 'Portfolio', 'Review'];
const LANGUAGE_LEVELS = ['', 'Basic', 'Conversational', 'Fluent', 'Native or bilingual'];
const ABOUT_MIN = 50;

const EMPTY_DETAILS = { occupation: '', website: '', languages: [], education: [], certifications: [], experience: [], source: undefined };
const EMPTY_FORM = { title: '', about: '', locationCity: '', categorySlug: '', skills: [], photoUrl: null, resumeUrl: null, resumeFileName: null, portfolio: [], details: EMPTY_DETAILS };

function fromApplication(app) {
  return {
    title: app.title ?? '',
    about: app.about ?? '',
    locationCity: app.locationCity ?? '',
    categorySlug: app.categorySlug ?? '',
    skills: app.skills ?? [],
    photoUrl: app.photoUrl ?? null,
    resumeUrl: app.resumeUrl ?? null,
    resumeFileName: app.resumeFileName ?? null,
    portfolio: (app.portfolio ?? []).map((p) => ({ title: p.title ?? '', category: p.category ?? '', mediaUrl: p.mediaUrl ?? '' })),
    details: { ...EMPTY_DETAILS, ...(app.details ?? {}) },
  };
}

function toPayload(form) {
  const d = form.details;
  const clean = (rows, requiredKey) => rows.filter((r) => (r[requiredKey] ?? '').trim());
  return {
    title: form.title.trim(),
    about: form.about.trim() || undefined,
    locationCity: form.locationCity.trim() || undefined,
    categorySlug: form.categorySlug || undefined,
    skills: form.skills,
    photoUrl: form.photoUrl || null,
    resumeUrl: form.resumeUrl || null,
    resumeFileName: form.resumeFileName || null,
    portfolio: clean(form.portfolio, 'title').map((p) => ({ title: p.title.trim(), category: p.category?.trim() || undefined, mediaUrl: p.mediaUrl || undefined })),
    details: {
      occupation: d.occupation?.trim() || undefined,
      website: d.website?.trim() || undefined,
      languages: clean(d.languages, 'name'),
      education: clean(d.education, 'school'),
      certifications: clean(d.certifications, 'name'),
      experience: clean(d.experience, 'title'),
      source: d.source,
    },
  };
}

/** Merge PDF suggestions into the form without overwriting anything the applicant already typed. */
function mergeSuggestions(form, s, source, resume) {
  const keep = (current, next) => (current && String(current).trim() ? current : next);
  const list = (current, next) => (current.length ? current : next);
  return {
    ...form,
    title: keep(form.title, s.title),
    about: keep(form.about, s.about),
    locationCity: keep(form.locationCity, s.locationCity),
    skills: list(form.skills, s.skills),
    resumeUrl: resume.resumeUrl ?? form.resumeUrl,
    resumeFileName: resume.resumeFileName ?? form.resumeFileName,
    details: {
      ...form.details,
      website: keep(form.details.website, s.website),
      languages: list(form.details.languages, s.languages.map((l) => ({ name: l.name, level: l.level }))),
      education: list(form.details.education, s.education),
      certifications: list(form.details.certifications, s.certifications),
      experience: list(form.details.experience, s.experience),
      source,
    },
  };
}

const STATUS_COPY = {
  under_review: { icon: 'clock', title: 'Your application is being reviewed', text: 'The Servix team reviews every application. You’ll get a notification and an email as soon as it’s approved — usually within two business days.' },
  approved: { icon: 'check', title: 'Welcome to Servix, professional.', text: 'Your application was approved. Head to your workspace to publish your first gig.' },
  rejected: { icon: 'alert', title: 'This application was not approved', text: 'Review the feedback below, update your details and submit a new application.' },
};

export default function ApplyPage() {
  useDocumentMeta({ title: 'Become a professional', description: 'Create your Servix professional profile.' });
  const { user, initializing, authAvailable } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState(null);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [screen, setScreen] = useState('overview'); // overview | 0..3 | status
  const [choice, setChoice] = useState(null); // 'import' | 'manual'
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    if (initializing) return;
    if (!authAvailable || !user) { setLoading(false); return; }
    proApi.getMyApplication()
      .then((app) => {
        if (app.status === 'approved') { navigate('/dashboard/gigs', { replace: true }); return; }
        setApplication(app);
        if (app.status === 'pending') { setForm(fromApplication(app)); setScreen(app.title ? 0 : 'overview'); setChoice(app.title ? 'manual' : null); }
        else setScreen('status');
      })
      .catch(() => setApplication(null))
      .finally(() => setLoading(false));
  }, [initializing, authAvailable, user, navigate]);

  const patch = (changes) => setForm((f) => ({ ...f, ...changes }));
  const patchDetails = (changes) => setForm((f) => ({ ...f, details: { ...f.details, ...changes } }));

  function validate(step) {
    const e = {};
    if (step === 0) {
      if (form.title.trim().length < 3) e.title = 'Enter your professional title (at least 3 characters).';
      if (form.about.trim().length < ABOUT_MIN) e.about = `Tell clients about your work in at least ${ABOUT_MIN} characters.`;
      if (!form.categorySlug) e.categorySlug = 'Choose the category that fits you best.';
    }
    if (step === 1) {
      if (form.skills.length === 0) e.skills = 'Add at least one skill.';
      if (form.details.website && !/^https?:\/\/.+\..+/.test(form.details.website.trim())) e.website = 'Enter a full web address starting with https://';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function saveDraft() {
    setSaveError('');
    setSaving(true);
    try {
      const payload = toPayload(form);
      const canPatch = application && application.status === 'pending';
      const saved = canPatch ? await proApi.updateApplication(application.id, payload) : await proApi.createApplication(payload);
      setApplication(saved);
      return saved;
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      setSaveError(err.message || 'Could not save. Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    if (typeof screen !== 'number') return;
    if (!validate(screen)) return;
    if (form.title.trim().length >= 3) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setScreen(Math.min(STEPS.length - 1, screen + 1));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function back() {
    if (screen === 0) setScreen('overview');
    else if (typeof screen === 'number') setScreen(screen - 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function saveAndExit() {
    if (form.title.trim().length >= 3) {
      const saved = await saveDraft();
      if (!saved) return;
      showToast('Draft saved. Come back any time to finish.', 'success');
    }
    navigate('/dashboard');
  }

  async function submit() {
    if (!confirmed) { setErrors({ confirm: 'Please confirm your details are accurate.' }); return; }
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const submitted = await proApi.submitApplication(saved.id);
      setApplication(submitted);
      setScreen('status');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (err) {
      setSaveError(err.message || 'Could not submit. Please try again.');
    }
  }

  /* ---------------- guards ---------------- */
  if (!authAvailable) {
    return (
      <OnboardingLayout exitTo="/">
        <div className="ob-status"><h1>Applications open with the platform launch</h1><p>Professional applications require a Servix account.</p><Button to="/professionals/join" variant="secondary">Learn about joining</Button></div>
      </OnboardingLayout>
    );
  }
  if (initializing || loading) {
    return <OnboardingLayout exitTo="/dashboard"><div className="ob-section"><Skeleton height="2rem" width="45%" style={{ marginBottom: 12 }} /><Skeleton height="0.9rem" width="70%" style={{ marginBottom: 28 }} /><FormSkeleton fields={5} panel={false} label="Loading your application…" /></div></OnboardingLayout>;
  }
  if (!user) {
    return (
      <OnboardingLayout exitTo="/">
        <div className="ob-status"><h1>Sign in to apply</h1><p>You need a Servix account to apply as a professional.</p><div className="ws-actions"><Button to="/login" variant="primary">Sign In</Button><Button to="/register" variant="secondary">Create an Account</Button></div></div>
      </OnboardingLayout>
    );
  }

  /* ---------------- status (submitted / rejected) ---------------- */
  if (screen === 'status' && application) {
    const copy = STATUS_COPY[application.status] ?? STATUS_COPY.under_review;
    return (
      <OnboardingLayout exitTo="/dashboard">
        <div className="ob-status">
          <span className="ws-empty-icon"><Icon name={copy.icon} /></span>
          <h1>{copy.title}</h1>
          <p>{copy.text}</p>
          {application.status === 'rejected' && application.rejectionReason && <p><strong>Feedback:</strong> {application.rejectionReason}</p>}
          {application.status === 'under_review' && application.submittedAt && (
            <p className="ws-muted">Submitted {new Date(application.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
          )}
          <div className="ws-actions">
            <Button to="/dashboard" variant="primary">Go to your dashboard</Button>
            {application.status === 'rejected' && (
              <Button variant="secondary" onClick={() => { setForm(fromApplication(application)); setApplication(null); setScreen('overview'); setChoice(null); }}>Start a new application</Button>
            )}
          </div>
        </div>
      </OnboardingLayout>
    );
  }

  /* ---------------- overview ---------------- */
  if (screen === 'overview') {
    return (
      <Overview
        choice={choice}
        onChoice={setChoice}
        form={form}
        onImported={(suggestions, source, resume) => { setForm((f) => mergeSuggestions(f, suggestions, source, resume)); setChoice('import'); }}
        onContinue={() => { if (choice === 'manual') patchDetails({ source: 'manual' }); setScreen(0); window.scrollTo({ top: 0, behavior: 'instant' }); }}
      />
    );
  }

  /* ---------------- steps ---------------- */
  const progress = ((screen + 1) / (STEPS.length + 1)) * 100;
  const actions = (
    <>
      <Button type="button" variant="ghost" onClick={back} disabled={saving}>Back</Button>
      <span className="ob-footer__spacer" />
      <Button type="button" variant="ghost" onClick={saveAndExit} disabled={saving}>Save & exit</Button>
      {screen < STEPS.length - 1 ? (
        <Button type="button" variant="primary" onClick={next} disabled={saving}>{saving ? 'Saving…' : 'Continue'}</Button>
      ) : (
        <Button type="button" variant="primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit for review'}</Button>
      )}
    </>
  );

  return (
    <OnboardingLayout exitTo="/dashboard" progress={progress} actions={actions} wide={screen === 3}>
      <Stepper steps={STEPS} current={screen} />
      {saveError && <div className="ob-error" role="alert" style={{ marginBottom: 20 }}>{saveError}</div>}

      {screen === 0 && (
        <section className="ob-section" aria-labelledby="step-personal">
          <h1 id="step-personal">Personal info</h1>
          <p className="lead">Tell us a bit about yourself. This information appears on your public profile so potential clients can get to know you.</p>
          <div className="ob-form">
            <Field label="Full name" hint="From your Servix account. Change it in Account settings.">
              {(props) => <input {...props} className="input" type="text" value={user.fullName} readOnly />}
            </Field>
            <div className="field">
              <span className="field__label">Profile picture</span>
              <PhotoUploader kind="profile" value={form.photoUrl ?? user.avatarUrl} name={user.fullName} onChange={(url) => patch({ photoUrl: url })} />
            </div>
            <Field label="Professional title" required error={errors.title} hint="e.g. Brand Designer, Backend Developer, Wedding Photographer">
              {(props) => <input {...props} className="input" type="text" maxLength={120} value={form.title} onChange={(e) => patch({ title: e.target.value })} />}
            </Field>
            <Field label="Category" required error={errors.categorySlug}>
              {(props) => (
                <select {...props} className="select" value={form.categorySlug} onChange={(e) => patch({ categorySlug: e.target.value })}>
                  <option value="">Choose a category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Description" required error={errors.about} hint={`Share your work, experience and interests. ${form.about.trim().length}/${ABOUT_MIN} characters minimum.`}>
              {(props) => <textarea {...props} className="textarea" rows={6} maxLength={2000} value={form.about} onChange={(e) => patch({ about: e.target.value })} />}
            </Field>
            <Field label="City" error={errors.locationCity} hint="Where you are based. Clients can still book remote work.">
              {(props) => <input {...props} className="input" type="text" placeholder="e.g. Ibadan" maxLength={120} value={form.locationCity} onChange={(e) => patch({ locationCity: e.target.value })} />}
            </Field>
            <div className="field">
              <span className="field__label">Languages</span>
              <ListEditor
                label="Language"
                items={form.details.languages}
                onChange={(languages) => patchDetails({ languages })}
                max={8}
                addLabel="Add language"
                fields={[
                  { key: 'name', label: 'Language', placeholder: 'e.g. English', required: true, maxLength: 40 },
                  { key: 'level', label: 'Level', type: 'select', options: LANGUAGE_LEVELS },
                ]}
              />
            </div>
          </div>
        </section>
      )}

      {screen === 1 && (
        <section className="ob-section" aria-labelledby="step-professional">
          <h1 id="step-professional">Professional info</h1>
          <p className="lead">This is your time to shine. Let potential clients know what you do best and how you gained your skills, certifications and experience.</p>
          <div className="ob-form">
            <Field label="Occupation" hint="A plain-language label, e.g. Graphic designer, Software developer, Event planner.">
              {(props) => <input {...props} className="input" type="text" maxLength={120} value={form.details.occupation} onChange={(e) => patchDetails({ occupation: e.target.value })} />}
            </Field>
            <Field label="Skills" required error={errors.skills} hint="Up to 15. Press Enter after each one.">
              {(props) => <TagInput id={props.id} aria-describedby={props['aria-describedby']} value={form.skills} onChange={(skills) => patch({ skills })} max={15} placeholder="e.g. Figma, SEO, Node.js" />}
            </Field>
            <div className="field">
              <span className="field__label">Work experience</span>
              <ListEditor
                label="Role"
                items={form.details.experience}
                onChange={(experience) => patchDetails({ experience })}
                max={8}
                addLabel="Add experience"
                empty="No roles added yet."
                fields={[
                  { key: 'title', label: 'Job title', required: true, maxLength: 120 },
                  { key: 'company', label: 'Company / client', maxLength: 120 },
                  { key: 'start', label: 'From', placeholder: 'e.g. Jan 2021', maxLength: 40 },
                  { key: 'end', label: 'To', placeholder: 'e.g. Present', maxLength: 40 },
                  { key: 'description', label: 'What you did', type: 'textarea', wide: true, maxLength: 600 },
                ]}
              />
            </div>
            <div className="field">
              <span className="field__label">Education</span>
              <ListEditor
                label="Education"
                items={form.details.education}
                onChange={(education) => patchDetails({ education })}
                max={6}
                addLabel="Add education"
                fields={[
                  { key: 'school', label: 'School / institution', required: true, wide: true },
                  { key: 'degree', label: 'Degree or course' },
                  { key: 'year', label: 'Year', placeholder: 'e.g. 2016', maxLength: 40 },
                ]}
              />
            </div>
            <div className="field">
              <span className="field__label">Certifications</span>
              <ListEditor
                label="Certification"
                items={form.details.certifications}
                onChange={(certifications) => patchDetails({ certifications })}
                max={10}
                addLabel="Add certification"
                fields={[
                  { key: 'name', label: 'Certificate', required: true, wide: true },
                  { key: 'issuer', label: 'Issued by', maxLength: 120 },
                  { key: 'year', label: 'Year', maxLength: 40 },
                ]}
              />
            </div>
            <Field label="Personal website" error={errors.website} hint="Optional. Your portfolio site, Behance, GitHub, etc.">
              {(props) => <input {...props} className="input" type="url" placeholder="https://" maxLength={500} value={form.details.website} onChange={(e) => patchDetails({ website: e.target.value })} />}
            </Field>
            {form.resumeFileName && (
              <p className="ob-note"><span><b>CV attached:</b> {form.resumeFileName}</span><button type="button" className="ob-list__remove" onClick={() => patch({ resumeUrl: null, resumeFileName: null })}>Remove</button></p>
            )}
          </div>
        </section>
      )}

      {screen === 2 && (
        <section className="ob-section" aria-labelledby="step-portfolio">
          <h1 id="step-portfolio">Show your work</h1>
          <p className="lead">Optional, but profiles with real examples get booked far more often. Add up to 10 projects with an image each.</p>
          <ListEditor
            label="Project"
            items={form.portfolio}
            onChange={(portfolio) => patch({ portfolio })}
            max={10}
            addLabel="Add project"
            empty="No projects yet — you can also add them later from your workspace."
            fields={[
              { key: 'title', label: 'Project title', required: true, wide: true, maxLength: 140 },
              { key: 'category', label: 'Type of work', placeholder: 'e.g. Logo design', maxLength: 80 },
            ]}
            renderExtra={(row, update) => <PortfolioImage value={row.mediaUrl} onChange={(mediaUrl) => update({ mediaUrl })} />}
          />
        </section>
      )}

      {screen === 3 && (
        <section className="ob-section" aria-labelledby="step-review">
          <h1 id="step-review">Review and submit</h1>
          <p className="lead">Check everything once more. After you submit, the Servix team reviews your profile and the application is locked while that happens.</p>
          <div className="ob-review">
            <div className="ob-review__card">
              <div className="ob-review__head">
                <Avatar src={form.photoUrl ?? user.avatarUrl} name={user.fullName} size={64} />
                <div><strong>{user.fullName}</strong><span>{form.title}{form.locationCity ? ` · ${form.locationCity}` : ''}</span></div>
              </div>
              <h3>Personal info <button type="button" onClick={() => setScreen(0)}>Edit</button></h3>
              <dl>
                <dt>Category</dt><dd>{categories.find((c) => c.id === form.categorySlug)?.name || '—'}</dd>
                <dt>Description</dt><dd>{form.about || '—'}</dd>
                <dt>Languages</dt><dd>{form.details.languages.filter((l) => l.name).map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`).join(', ') || '—'}</dd>
              </dl>
            </div>
            <div className="ob-review__card">
              <h3>Professional info <button type="button" onClick={() => setScreen(1)}>Edit</button></h3>
              <dl>
                <dt>Occupation</dt><dd>{form.details.occupation || '—'}</dd>
                <dt>Skills</dt><dd>{form.skills.join(', ') || '—'}</dd>
                <dt>Experience</dt><dd>{form.details.experience.filter((x) => x.title).map((x) => `${x.title}${x.company ? ` at ${x.company}` : ''}${x.start ? ` (${x.start}–${x.end || 'Present'})` : ''}`).join('; ') || '—'}</dd>
                <dt>Education</dt><dd>{form.details.education.filter((x) => x.school).map((x) => `${x.degree ? `${x.degree}, ` : ''}${x.school}${x.year ? ` (${x.year})` : ''}`).join('; ') || '—'}</dd>
                <dt>Certifications</dt><dd>{form.details.certifications.filter((x) => x.name).map((x) => `${x.name}${x.issuer ? ` — ${x.issuer}` : ''}`).join('; ') || '—'}</dd>
                <dt>Website</dt><dd>{form.details.website || '—'}</dd>
                <dt>CV</dt><dd>{form.resumeFileName || 'Not attached'}</dd>
              </dl>
            </div>
            <div className="ob-review__card">
              <h3>Portfolio <button type="button" onClick={() => setScreen(2)}>Edit</button></h3>
              <dl><dt>Projects</dt><dd>{form.portfolio.filter((p) => p.title).map((p) => p.title).join(', ') || 'None yet'}</dd></dl>
            </div>
            <label className="ob-check">
              <input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); setErrors({}); }} />
              <span>I confirm this information is accurate and that I’ll deliver the services I list professionally, in line with the <Link to="/terms">Servix terms</Link>.</span>
            </label>
            {errors.confirm && <p className="field__error" role="alert">{errors.confirm}</p>}
          </div>
        </section>
      )}
    </OnboardingLayout>
  );
}

/* ================= overview screen ================= */

function Overview({ choice, onChoice, form, onImported, onContinue }) {
  const [open, setOpen] = useState('import');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setImportError('');
    setResult(null);
    setImporting(true);
    try {
      const res = await importResume(file);
      if (!res.textFound) {
        setImportError('We couldn’t find readable text in that PDF (scanned images can’t be read). Try the LinkedIn export, or fill out your profile manually.');
        return;
      }
      setResult({ ...res, fileName: file.name, size: file.size });
      onImported(res.suggestions, res.suggestions.source, { resumeUrl: res.resumeUrl, resumeFileName: res.resumeFileName ?? file.name });
    } catch (err) {
      setImportError(err.message || 'We couldn’t read that file. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  const found = result?.suggestions?.found ?? [];
  const foundLabels = { title: 'Professional title', about: 'Description', locationCity: 'City', skills: `${result?.suggestions?.skills?.length ?? 0} skills`, languages: 'Languages', certifications: 'Certifications', education: 'Education', experience: `${result?.suggestions?.experience?.length ?? 0} roles`, website: 'Website' };
  const canContinue = choice === 'manual' || (choice === 'import' && result);

  const actions = (
    <>
      <span className="ob-footer__spacer" />
      <Button type="button" variant="primary" disabled={!canContinue} onClick={onContinue}>Continue</Button>
    </>
  );

  return (
    <OnboardingLayout exitTo="/dashboard" progress={4} actions={actions}>
      <div className="ob-hero">
        <h1>Grow your brand.<br />Work with clients across Nigeria.</h1>
        <p>Start by creating a profile that makes you stand out.</p>
      </div>

      <div className={`ob-option ${choice === 'import' ? 'is-selected' : ''}`}>
        <button type="button" className="ob-option__head" aria-expanded={open === 'import'} onClick={() => { setOpen(open === 'import' ? null : 'import'); }}>
          <h2>Upload your experience <small>(8 min)</small></h2>
          <span className="ob-option__meta"><span className="ob-pill">Recommended</span><Icon name={open === 'import' ? 'chevron-up' : 'chevron-down'} size={18} /></span>
        </button>
        {open === 'import' && (
          <div className="ob-option__body">
            <div className="ob-linkedin">
              <div>
                <h3 style={{ fontSize: 15, margin: '14px 0 0' }}>Add experience from LinkedIn</h3>
                <ol className="ob-steps">
                  <li><span className="ob-steps__num">1</span><span>Go to your profile on <a href="https://www.linkedin.com/in/me/" target="_blank" rel="noreferrer">LinkedIn</a></span></li>
                  <li><span className="ob-steps__num">2</span><span>Click on <b>Resources</b></span></li>
                  <li><span className="ob-steps__num">3</span><span>Click on <b>Save to PDF</b></span></li>
                </ol>
              </div>
              <div className="ob-illus" aria-hidden="true">
                <div className="ob-illus__bar"><i /><i /><i /></div>
                <div className="ob-illus__banner"><span className="ob-illus__face" /></div>
                <div className="ob-illus__row"><span>Open to</span><span>Add section</span><span className="dark">Resources</span></div>
                <div className="ob-illus__menu"><span>Send profile</span><span><b>Save to PDF</b></span><span>Saved items</span></div>
              </div>
            </div>

            <div
              className={`ob-drop ${dragging ? 'is-active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
            >
              <p>Drag and drop file or</p>
              <input ref={inputRef} type="file" accept={UPLOAD_LIMITS.document.accept} hidden aria-label="Select a PDF file" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
              <Button type="button" variant="secondary" disabled={importing} onClick={() => { onChoice('import'); inputRef.current?.click(); }}>
                <Icon name="upload" size={16} /> {importing ? 'Reading your PDF…' : 'Select file'}
              </Button>
            </div>
            <div className="ob-note"><span><b>No LinkedIn?</b> Upload your CV instead.</span><span className="ws-muted">{UPLOAD_LIMITS.document.label}</span></div>

            {importError && <div className="ob-error" role="alert" style={{ marginTop: 12 }}>{importError}</div>}
            {result && (
              <div className="ob-found" role="status">
                <strong>We read {result.fileName} ({formatBytes(result.size)}).</strong>{' '}
                {found.length ? 'Here’s what we found — you’ll review and edit it in the next steps:' : 'We couldn’t pick out specific fields, but the file is attached for the review team. You can fill the form in the next steps.'}
                {found.length > 0 && <ul>{found.map((k) => <li key={k}>{foundLabels[k] ?? k}</li>)}</ul>}
                {result.note && <p className="ws-muted" style={{ marginTop: 8 }}>{result.note}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`ob-option ${choice === 'manual' ? 'is-selected' : ''}`}>
        <button type="button" className="ob-option__head" aria-pressed={choice === 'manual'} onClick={() => { onChoice('manual'); setOpen(null); }}>
          <h2>Fill out profile manually <small>(15 min)</small></h2>
          <span className="ob-option__meta ob-manual-icon"><Icon name="pen" size={18} /></span>
        </button>
      </div>

      {form.title && <p className="ws-muted" style={{ marginTop: 20 }}>You already have a saved draft — choose an option to continue editing it.</p>}
    </OnboardingLayout>
  );
}

function PortfolioImage({ value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setBusy(true);
    try { const stored = await uploadFile(file, 'portfolio'); onChange(stored.url); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      {value ? <img src={value} alt="" width={72} height={54} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #e3e7df' }} /> : <span style={{ width: 72, height: 54, borderRadius: 6, background: '#eef1ea', display: 'grid', placeItems: 'center' }}><Icon name="camera" size={18} /></span>}
      <input ref={inputRef} type="file" accept={UPLOAD_LIMITS.image.accept} hidden onChange={pick} aria-label="Project image" />
      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Uploading…' : value ? 'Change image' : 'Add image'}</button>
      {value && <button type="button" className="ob-list__remove" onClick={() => onChange('')}>Remove image</button>}
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}

export { mergeSuggestions, toPayload, fromApplication };

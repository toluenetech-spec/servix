/**
 * Become a Professional — application form & status (Phase C).
 * Reuses the existing Servix design system: Field, Button, Badge,
 * SectionHeader, state blocks. No new visual language.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Skeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { getCategories } from '../../lib/api.js';
import * as proApi from '../../lib/proApi.js';

const STATUS_COPY = {
  pending: {
    badge: 'Draft',
    title: 'Finish and submit your application',
    text: 'Your application is saved as a draft. Review it below and submit when ready.',
  },
  under_review: {
    badge: 'Under review',
    title: 'Your application is being reviewed',
    text: 'The Servix team reviews every application. You\u2019ll be able to build your profile as soon as it\u2019s approved.',
  },
  approved: {
    badge: 'Approved',
    title: 'Welcome to Servix, professional.',
    text: 'Your application was approved. Head to your workspace to complete your profile and list your first service.',
  },
  rejected: {
    badge: 'Not approved',
    title: 'This application was not approved',
    text: 'You can review the feedback below and submit a new application.',
  },
};

export default function ApplyPage() {
  useDocumentMeta({
    title: 'Apply as a Professional',
    description: 'Apply to offer your professional services on Servix.',
  });

  const { user, initializing, authAvailable } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState(null);
  const [categories, setCategories] = useState([]);
  const [values, setValues] = useState({
    title: '',
    about: '',
    locationCity: '',
    categorySlug: '',
    skills: '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (initializing) return;
    if (!authAvailable || !user) {
      setLoading(false);
      return;
    }
    if (user.role === 'professional') {
      navigate('/pro', { replace: true });
      return;
    }
    proApi
      .getMyApplication()
      .then((app) => {
        setApplication(app);
        setValues({
          title: app.title ?? '',
          about: app.about ?? '',
          locationCity: app.locationCity ?? '',
          categorySlug: app.categorySlug ?? '',
          skills: (app.skills ?? []).join(', '),
        });
      })
      .catch(() => setApplication(null))
      .finally(() => setLoading(false));
  }, [initializing, authAvailable, user, navigate]);

  function parseSkills(raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 15);
  }

  async function saveDraft() {
    setErrors({});
    const payload = {
      title: values.title,
      about: values.about || undefined,
      locationCity: values.locationCity || undefined,
      categorySlug: values.categorySlug || undefined,
      skills: parseSkills(values.skills),
    };
    setSaving(true);
    try {
      const saved = application?.status === 'pending'
        ? await proApi.updateApplication(application.id, payload)
        : await proApi.createApplication(payload);
      setApplication(saved);
      showToast('Application saved.', 'success');
      return saved;
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      else showToast(err.message ?? 'Could not save. Please try again.', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const submitted = await proApi.submitApplication(saved.id);
      setApplication(submitted);
      showToast('Application submitted for review.', 'success');
    } catch (err) {
      showToast(err.message ?? 'Could not submit. Please try again.', 'error');
    }
  }

  /* ---------------- render guards ---------------- */

  if (!authAvailable) {
    return (
      <div className="page container container--narrow section">
        <span className="eyebrow">Become a professional</span>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-4)' }}>
          Applications open with the platform launch
        </h1>
        <p className="lead" style={{ marginBottom: 'var(--space-8)' }}>
          Professional applications require a Servix account. Accounts activate
          when the platform launches.
        </p>
        <Button to="/professionals/join" variant="secondary">
          Learn about joining
        </Button>
      </div>
    );
  }

  if (initializing || loading) {
    return (
      <div className="page container container--narrow section" aria-busy="true">
        <Skeleton height="2rem" width="45%" style={{ marginBottom: '1rem' }} />
        <Skeleton height="1rem" width="70%" style={{ marginBottom: '2rem' }} />
        <Skeleton height="18rem" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page container container--narrow section">
        <span className="eyebrow">Become a professional</span>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-4)' }}>
          Sign in to apply
        </h1>
        <p className="lead" style={{ marginBottom: 'var(--space-8)' }}>
          You need a Servix account to apply as a professional.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Button to="/login" variant="primary">
            Sign In
          </Button>
          <Button to="/register" variant="secondary">
            Create an Account
          </Button>
        </div>
      </div>
    );
  }

  const status = application?.status;
  const statusCopy = status ? STATUS_COPY[status] : null;
  const editable = !application || status === 'pending' || status === 'rejected';

  return (
    <div className="page container container--narrow" style={{ paddingBlock: 'var(--space-12) var(--space-20)' }}>
      <span className="eyebrow">Become a professional</span>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-3)' }}>
        {statusCopy ? statusCopy.title : 'Apply to join Servix'}
      </h1>

      {statusCopy && (
        <div className="notice" style={{ marginBottom: 'var(--space-8)' }}>
          <span className="notice__icon">
            <Icon name={status === 'approved' ? 'check-circle' : status === 'rejected' ? 'alert' : 'info'} size={18} />
          </span>
          <span>
            <Badge variant={status === 'approved' ? 'brand' : status === 'rejected' ? 'accent' : 'neutral'}>
              {statusCopy.badge}
            </Badge>{' '}
            {statusCopy.text}
            {status === 'rejected' && application.rejectionReason && (
              <>
                {' '}
                <strong>Feedback:</strong> {application.rejectionReason}
              </>
            )}
          </span>
        </div>
      )}

      {status === 'approved' && (
        <Button to="/pro" variant="primary" size="lg">
          Go to your workspace
        </Button>
      )}

      {status === 'under_review' && (
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
          Submitted{' '}
          {application.submittedAt
            ? new Date(application.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
            : 'recently'}
          . We aim to review applications within two business days.
        </p>
      )}

      {editable && (
        <form
          className="contact-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Field label="Professional title" required error={errors.title} hint="e.g. Brand Designer, Backend Developer">
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                value={values.title}
                onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
              />
            )}
          </Field>

          <Field label="Category" error={errors.categorySlug}>
            {(props) => (
              <select
                {...props}
                className="select"
                value={values.categorySlug}
                onChange={(e) => setValues((v) => ({ ...v, categorySlug: e.target.value }))}
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="City" error={errors.locationCity}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                placeholder="e.g. Lagos"
                value={values.locationCity}
                onChange={(e) => setValues((v) => ({ ...v, locationCity: e.target.value }))}
              />
            )}
          </Field>

          <Field label="About your work" error={errors.about} hint="What do you do, and for whom?">
            {(props) => (
              <textarea
                {...props}
                className="textarea"
                rows={5}
                value={values.about}
                onChange={(e) => setValues((v) => ({ ...v, about: e.target.value }))}
              />
            )}
          </Field>

          <Field label="Skills" error={errors.skills} hint="Comma-separated, up to 15 — e.g. React, Figma, SEO">
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                value={values.skills}
                onChange={(e) => setValues((v) => ({ ...v, skills: e.target.value }))}
              />
            )}
          </Field>

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Button type="button" variant="secondary" onClick={saveDraft} disabled={saving}>
              {saving ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              Submit for Review
            </Button>
          </div>
          <p className="trust-strip__note" style={{ margin: 0 }}>
            Approval is reviewed by the Servix team. Submitting locks the
            application while it&rsquo;s under review.
          </p>
        </form>
      )}

      <p className="auth__meta" style={{ textAlign: 'left', marginTop: 'var(--space-8)' }}>
        Questions? <Link to="/professionals/join">How joining works</Link>
      </p>
    </div>
  );
}

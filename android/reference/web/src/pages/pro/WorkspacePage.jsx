/**
 * Professional Workspace (Phase C) — profile + service management.
 * Built entirely from the existing Servix design system: Tabs, Field,
 * Button, Badge, cards, state blocks. Same product, same language.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Field } from '../../components/ui/Field.jsx';
import { Badge, VerifiedBadge } from '../../components/ui/Badge.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Skeleton, EmptyState, ErrorState, ListSkeleton, StatsSkeleton, TableSkeleton, FormSkeleton, CardsSkeleton } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { getCategories } from '../../lib/api.js';
import { formatPrice } from '../../lib/format.js';
import * as proApi from '../../lib/proApi.js';
import * as bookingApi from '../../lib/bookingApi.js';
import { PhotoUploader } from '../../components/ui/PhotoUploader.jsx';
import { ListEditor } from '../../components/onboarding/ListEditor.jsx';
import { ChipPicker, SelectWithOther } from '../../components/onboarding/OptionPicker.jsx';
import { LANGUAGES, LANGUAGE_LEVELS, optionsFor } from '../../data/professionCatalog.js';
import '../../components/onboarding/onboarding.css';
import { Link as RouterLink } from 'react-router-dom';
import { useFeatures } from '../../lib/useFeatures.js';
import { AiTextDraft } from '../../components/ai/AiDrafting.jsx';

const TABS = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'services', label: 'Services' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'profile', label: 'Profile' },
];

const BOOKING_STATUS = {
  requested: { label: 'New request', variant: 'accent' },
  accepted: { label: 'Accepted', variant: 'brand' },
  in_progress: { label: 'In progress', variant: 'brand' },
  delivered: { label: 'Delivered', variant: 'neutral' },
  completed: { label: 'Completed', variant: 'brand' },
  declined: { label: 'Declined', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  disputed: { label: 'Disputed', variant: 'accent' },
  refunded: { label: 'Refunded', variant: 'outline' },
};

function ProBookingsTab() {
  const showToast = useToast();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    bookingApi.getProBookings().then(setBookings).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function act(fn, id, msg) {
    setBusy(true);
    try {
      await fn(id);
      showToast(msg, 'success');
      load();
    } catch (err) {
      showToast(err.message ?? 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message="We couldn't load your bookings." onRetry={load} />;
  if (!bookings) return <ListSkeleton rows={5} label="Loading client bookings…" />;
  if (bookings.length === 0) {
    return <EmptyState title="No bookings yet" message="Customer bookings on your services appear here." />;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {bookings.map((b) => {
        const meta = BOOKING_STATUS[b.status] ?? { label: b.status, variant: 'neutral' };
        return (
          <article key={b.id} className="card" style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: '15rem', flex: 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{b.reference}</span>
                </div>
                <h3 style={{ fontSize: 'var(--text-base)' }}>{b.serviceTitle}</h3>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {b.customerName} · {new Date(b.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · {formatPrice(b.amount)}
                </p>
                {b.notes && <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>“{b.notes}”</p>}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {b.status === 'requested' && (
                  <>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => act(bookingApi.acceptBooking, b.id, 'Booking accepted.')}>Accept</Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => act((id) => bookingApi.declineBooking(id, ''), b.id, 'Declined — customer refunded.')}>Decline</Button>
                  </>
                )}
                {b.status === 'accepted' && (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => act(bookingApi.startBooking, b.id, 'Work started.')}>Start Work</Button>
                )}
                {b.status === 'in_progress' && (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => act(bookingApi.deliverBooking, b.id, 'Delivered — awaiting customer confirmation.')}>Mark Delivered</Button>
                )}
                <RouterLink to={`/bookings/${b.id}`} className="btn btn--ghost btn--sm">Details</RouterLink>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function EarningsTab() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kycBlocked, setKycBlocked] = useState(false);

  const load = useCallback(() => {
    setError(null);
    bookingApi.getEarnings().then(setData).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function payout() {
    setBusy(true);
    try {
      const res = await bookingApi.requestPayout();
      showToast(`Payout of ${formatPrice(res.amount)} processed (${res.providerRef}).`, 'success');
      load();
    } catch (err) {
      if (err.code === 'KYC_REQUIRED') { setKycBlocked(true); showToast('Identity verification is required before payouts.', 'error'); return; }
      showToast(err.message ?? 'Payout failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message="We couldn't load your earnings." onRetry={load} />;
  if (!data) return <><StatsSkeleton label="Loading your earnings…" /><TableSkeleton rows={5} label="" /></>;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: '40rem' }}>
      <div className="profile-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div>
          <div className="profile-stat__value">{formatPrice(data.payable)}</div>
          <div className="profile-stat__label">Available for payout</div>
        </div>
        <div>
          <div className="profile-stat__value">{formatPrice(data.lifetimeEarnings)}</div>
          <div className="profile-stat__label">Lifetime earnings</div>
        </div>
      </div>
      {kycBlocked && <div className="ob-error" role="alert" data-testid="kyc-required">Payouts are only available to verified professionals. <Link to="/dashboard/identity">Verify your identity →</Link> (one-time, usually 12–24 hours).</div>}
      <div>
        <Button variant="primary" disabled={busy || data.payable <= 0} onClick={payout}>
          {busy ? 'Processing…' : 'Request Payout'}
        </Button>
        <p className="trust-strip__note" style={{ marginTop: 'var(--space-3)' }}>
          Balances are ledger-derived. Disputed bookings are excluded until resolved.
        </p>
      </div>
      {data.payouts.length > 0 && (
        <div className="earnings">
          <table>
            <thead>
              <tr><th>Reference</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{p.reference}</td>
                  <td>{formatPrice(p.amount)}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ServicesTab({ categories }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const [services, setServices] = useState(null);
  const [error, setError] = useState(null);
  const categoryName = (slug) => categories.find((c) => c.id === slug)?.name ?? slug;

  const load = useCallback(() => {
    setError(null);
    proApi
      .getMyServices()
      .then(setServices)
      .catch((err) => setError(err));
  }, []);

  useEffect(load, [load]);

  async function act(fn, id, message) {
    try {
      await fn(id);
      showToast(message, 'success');
      load();
    } catch (err) {
      if (err.code === 'GIG_INCOMPLETE') {
        showToast('Finish the gig before publishing — opening the editor.', 'error');
        navigate(`/dashboard/gigs/${id}/edit`);
        return;
      }
      if (err.code === 'KYC_REQUIRED') {
        showToast('Verify your identity before publishing — opening Identity verification.', 'error');
        navigate('/dashboard/identity');
        return;
      }
      showToast(err.message ?? 'Action failed.', 'error');
    }
  }

  if (error) {
    return <ErrorState message="We couldn't load your services." onRetry={load} />;
  }
  if (!services) {
    return <CardsSkeleton count={3} tall label="Loading your gigs…" />;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {services.length} service{services.length === 1 ? '' : 's'} · drafts are only visible to you
        </p>
        <Button variant="primary" to="/dashboard/gigs/new">
          Create a new gig
        </Button>
      </div>

      {services.length === 0 ? (
        <EmptyState
          title="No services yet"
          message="Create your first service listing — it stays a private draft until you publish it."
          action={
            <Button variant="secondary" to="/dashboard/gigs/new">
              Create a gig
            </Button>
          }
        />
      ) : (
        services.map((s) => (
          <article key={s.id} className="card" style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: '16rem', flex: 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <Badge variant={s.status === 'active' ? 'brand' : 'outline'}>
                    {s.status === 'active' ? 'Published' : s.status === 'paused' ? 'Unpublished' : 'Draft'}
                  </Badge>
                  <span className="service-card__category">{categoryName(s.categoryId)}</span>
                  {s.status !== 'active' && s.publishProblems && Object.keys(s.publishProblems).length > 0 && (
                    <span className="ws-chip warn">{Object.keys(s.publishProblems).length} step{Object.keys(s.publishProblems).length === 1 ? '' : 's'} left</span>
                  )}
                </div>
                <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-1)' }}>{s.title}</h3>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {formatPrice(s.price)} {s.priceUnit}
                  {s.duration ? ` · ${s.duration}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {s.status === 'active' ? (
                  <>
                    <Button variant="ghost" size="sm" to={`/services/${s.id}`}>
                      View public page
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => act(proApi.unpublishService, s.id, 'Service unpublished.')}
                    >
                      Unpublish
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => act(proApi.publishService, s.id, 'Service published.')}
                  >
                    Publish
                  </Button>
                )}
                <Button variant="secondary" size="sm" to={`/dashboard/gigs/${s.id}/edit`}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => act(proApi.archiveService, s.id, 'Service removed.')}
                >
                  Remove
                </Button>
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

/* ---------------- profile tab ---------------- */

function ProfileTab({ categories, profile, onProfileChange }) {
  const showToast = useToast(); const { ai: aiOn } = useFeatures();
  const [values, setValues] = useState({
    title: profile.title ?? '',
    about: profile.about ?? '',
    locationCity: (profile.location ?? '').split(',')[0] ?? '',
    categorySlug: profile.categoryId ?? '',
    availability: profile.availability ?? 'available',
    skills: profile.skills ?? [],
  });
  const [image, setImage] = useState(profile.image ?? null);
  const [photoStatus, setPhotoStatus] = useState('');
  const { refreshUser } = useAuth();
  // The photo is saved the moment it is picked (not on "Save profile"), so it
  // can never be lost by navigating away; the account avatar is synced server-side.
  const savePhoto = useCallback(async (url) => {
    setPhotoStatus('');
    const updated = await proApi.updateMyProfile({ imageUrl: url ?? '' });
    setImage(url ?? null);
    onProfileChange({ ...profile, image: updated.image ?? url ?? null });
    try { await refreshUser(); } catch { /* navbar refreshes on next load */ }
    setPhotoStatus(url ? 'Photo saved.' : 'Photo removed.');
  }, [onProfileChange, profile, refreshUser]);
  const [details, setDetails] = useState({ occupation: '', website: '', languages: [], education: [], certifications: [], experience: [], ...(profile.details ?? {}) });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      const updated = await proApi.updateMyProfile({
        title: values.title,
        about: values.about || undefined,
        locationCity: values.locationCity || undefined,
        categorySlug: values.categorySlug || undefined,
        availability: values.availability,
        imageUrl: image ?? '',
        details: {
          occupation: details.occupation?.trim() || undefined,
          website: details.website?.trim() || undefined,
          languages: details.languages.filter((x) => x.name?.trim()),
          education: details.education.filter((x) => x.school?.trim()),
          certifications: details.certifications.filter((x) => x.name?.trim()),
          experience: details.experience.filter((x) => x.title?.trim()),
        },
      });
      const skills = values.skills.map((x) => x.trim()).filter(Boolean).slice(0, 15);
      await proApi.replaceSkills(skills);
      showToast('Profile updated.', 'success');
      onProfileChange({ ...updated, skills });
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      else showToast(err.message ?? 'Could not save your profile.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: '46rem' }}>
      <div className="notice">
        <span className="notice__icon">
          <Icon name="eye" size={18} />
        </span>
        <span>
          Your public profile is live at{' '}
          <Link to={`/professionals/${profile.id}`} style={{ color: 'var(--color-forest)', fontWeight: 600 }}>
            /professionals/{profile.id}
          </Link>
        </span>
      </div>

      <form className="contact-form" onSubmit={save} noValidate>
        <div className="field">
          <span className="field__label">Profile photo</span>
          <PhotoUploader kind="profile" value={image} name={profile.name} onChange={savePhoto} status={photoStatus} />
        </div>
        <div className="grid-2" style={{ gap: 'var(--space-5)' }}>
          <Field label="Category" error={errors.categorySlug}>
            {(props) => (
              <select
                {...props}
                className="select"
                value={values.categorySlug}
                onChange={(e) => setValues((v) => ({ ...v, categorySlug: e.target.value }))}
              >
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Availability" error={errors.availability}>
            {(props) => (
              <select
                {...props}
                className="select"
                value={values.availability}
                onChange={(e) => setValues((v) => ({ ...v, availability: e.target.value }))}
              >
                <option value="available">Available now</option>
                <option value="limited">Limited availability</option>
                <option value="unavailable">Unavailable</option>
              </select>
            )}
          </Field>
        </div>

        <Field label="Professional title" required error={errors.title} hint="Choose the title clients will see, or pick “Other” to type your own.">
          {(props) => (
            <SelectWithOther
              id={props.id}
              aria-describedby={props['aria-describedby']}
              options={optionsFor(values.categorySlug, 'titles')}
              value={values.title}
              onChange={(title) => setValues((v) => ({ ...v, title }))}
              placeholder="Choose your title…"
              otherPlaceholder="e.g. Wedding Photographer"
              maxLength={120}
            />
          )}
        </Field>

        <Field label="City" error={errors.locationCity}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="text"
              value={values.locationCity}
              onChange={(e) => setValues((v) => ({ ...v, locationCity: e.target.value }))}
            />
          )}
        </Field>

        <Field label="About" error={errors.about}>
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
        {aiOn && <AiTextDraft kind="profile_about" seed={values.title} onUse={(text) => setValues((v) => ({ ...v, about: text }))} />}

        <Field label="Skills" error={errors.skills} hint="Tap the skills you offer (up to 15). Use “Other” for anything not listed.">
          {(props) => (
            <ChipPicker
              id={props.id}
              aria-describedby={props['aria-describedby']}
              label="Skills"
              options={optionsFor(values.categorySlug, 'skills')}
              value={values.skills}
              onChange={(skills) => setValues((v) => ({ ...v, skills }))}
              max={15}
            />
          )}
        </Field>

        <Field label="Occupation" error={errors['details.occupation']} hint="A plain-language label for what you do.">
          {(props) => (
            <SelectWithOther
              id={props.id}
              aria-describedby={props['aria-describedby']}
              options={optionsFor(values.categorySlug, 'occupations')}
              value={details.occupation ?? ''}
              onChange={(occupation) => setDetails((d) => ({ ...d, occupation }))}
              placeholder="Choose an occupation…"
              otherPlaceholder="e.g. Event planner"
              maxLength={120}
            />
          )}
        </Field>
        <Field label="Personal website" error={errors['details.website']} hint="Optional — portfolio site, Behance, GitHub…">
          {(props) => <input {...props} className="input" type="url" placeholder="https://" value={details.website ?? ''} onChange={(e) => setDetails((d) => ({ ...d, website: e.target.value }))} />}
        </Field>
        <div className="field">
          <span className="field__label">Languages</span>
          <ListEditor label="Language" items={details.languages} onChange={(languages) => setDetails((d) => ({ ...d, languages }))} max={8} addLabel="Add language"
            fields={[{ key: 'name', label: 'Language', type: 'select-other', options: LANGUAGES, placeholder: 'Choose a language…', otherPlaceholder: 'Language name', required: true, maxLength: 40 }, { key: 'level', label: 'Level', type: 'select', options: ['', ...LANGUAGE_LEVELS] }]} />
        </div>
        <div className="field">
          <span className="field__label">Work experience</span>
          <ListEditor label="Role" items={details.experience} onChange={(experience) => setDetails((d) => ({ ...d, experience }))} max={8} addLabel="Add experience" empty="Shown on your public profile under Experience."
            fields={[{ key: 'title', label: 'Job title', type: 'select-other', options: optionsFor(values.categorySlug, 'titles'), placeholder: 'Choose a job title…', otherPlaceholder: 'Job title', required: true, maxLength: 120 }, { key: 'company', label: 'Company / client', maxLength: 120 }, { key: 'start', label: 'From', maxLength: 40 }, { key: 'end', label: 'To', maxLength: 40 }, { key: 'description', label: 'What you did', type: 'textarea', wide: true, maxLength: 600 }]} />
        </div>
        <div className="field">
          <span className="field__label">Education</span>
          <ListEditor label="Education" items={details.education} onChange={(education) => setDetails((d) => ({ ...d, education }))} max={6} addLabel="Add education"
            fields={[{ key: 'school', label: 'School / institution', required: true, wide: true }, { key: 'degree', label: 'Degree or course' }, { key: 'year', label: 'Year', maxLength: 40 }]} />
        </div>
        <div className="field">
          <span className="field__label">Certifications</span>
          <ListEditor label="Certification" items={details.certifications} onChange={(certifications) => setDetails((d) => ({ ...d, certifications }))} max={10} addLabel="Add certification"
            fields={[{ key: 'name', label: 'Certificate', type: 'select-other', options: optionsFor(values.categorySlug, 'certifications'), placeholder: 'Choose a certification…', otherPlaceholder: 'Certificate name', required: true, wide: true }, { key: 'issuer', label: 'Issued by', maxLength: 120 }, { key: 'year', label: 'Year', maxLength: 40 }]} />
        </div>

        <div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Profile'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function WorkspacePage({ section = null }) {
  useDocumentMeta({
    title: 'Professional Workspace',
    description: 'Manage your Servix professional profile and services.',
  });

  const { user, initializing, authAvailable } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState(section || 'bookings');
  useEffect(() => { setTab(section || 'bookings'); }, [section]);
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | denied

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (initializing) return;
    if (!authAvailable || !user) {
      setState('denied');
      return;
    }
    proApi
      .getMyProfile()
      .then((p) => {
        setProfile(p);
        setState('ready');
      })
      .catch((err) => {
        if (err.status === 403) navigate('/professionals/apply', { replace: true });
        else setState('denied');
      });
  }, [initializing, authAvailable, user, navigate]);

  if (state === 'loading' || initializing) {
    return (
      <div className="page container section" aria-busy="true">
        <Skeleton height="2rem" width="40%" style={{ marginBottom: '1rem' }} />
        <ListSkeleton rows={4} label="Loading your workspace…" />
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="page container container--narrow section">
        <EmptyState
          title="Professional workspace"
          message={
            authAvailable
              ? 'Sign in with a professional account to manage your profile and services.'
              : 'The professional workspace activates with the Servix platform launch.'
          }
          action={
            authAvailable ? (
              <Button to="/login" variant="primary">
                Sign In
              </Button>
            ) : (
              <Button to="/professionals/join" variant="secondary">
                Learn about joining
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="page container" style={{ paddingBlock: 'var(--space-10) var(--space-20)' }}>
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <span className="eyebrow">Professional workspace</span>
        <h1 style={{ fontSize: 'var(--text-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {section ? ({ services: 'My gigs', bookings: 'Client bookings', earnings: 'Earnings & payouts', profile: 'Profile & portfolio' }[section]) : profile.name}
          {profile.verified && <VerifiedBadge />}
        </h1>
        <p className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
          {profile.title}
          {profile.location ? ` · ${profile.location}` : ''}
        </p>
      </header>

      {!section && <Tabs tabs={TABS} active={tab} onChange={setTab} label="Workspace sections" />}

      <div style={{ paddingTop: 'var(--space-8)' }}>
        {tab === 'bookings' && <ProBookingsTab />}
        {tab === 'services' && <ServicesTab categories={categories} />}
        {tab === 'earnings' && <EarningsTab />}
        {tab === 'profile' && (
          <ProfileTab categories={categories} profile={profile} onProfileChange={setProfile} />
        )}
      </div>
    </div>
  );
}

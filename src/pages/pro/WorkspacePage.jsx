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
import { Skeleton, EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useDocumentMeta } from '../../lib/useDocumentMeta.js';
import { getCategories } from '../../lib/api.js';
import { formatPrice } from '../../lib/format.js';
import * as proApi from '../../lib/proApi.js';
import * as bookingApi from '../../lib/bookingApi.js';
import { Link as RouterLink } from 'react-router-dom';

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
  if (!bookings) return <Skeleton height="10rem" />;
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
      showToast(err.message ?? 'Payout failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message="We couldn't load your earnings." onRetry={load} />;
  if (!data) return <Skeleton height="10rem" />;

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

const EMPTY_SERVICE = {
  title: '',
  categorySlug: '',
  price: '',
  priceUnit: 'per project',
  durationLabel: '',
  shortDescription: '',
  description: '',
  included: '',
  requirements: '',
};

/* ---------------- service editor ---------------- */

function ServiceEditor({ categories, initial, onSaved, onCancel }) {
  const showToast = useToast();
  const [values, setValues] = useState(
    initial
      ? {
          title: initial.title,
          categorySlug: initial.categoryId,
          price: String(initial.price),
          priceUnit: initial.priceUnit,
          durationLabel: initial.duration ?? '',
          shortDescription: initial.shortDescription,
          description: initial.description,
          included: (initial.included ?? []).join('\n'),
          requirements: (initial.requirements ?? []).join('\n'),
        }
      : EMPTY_SERVICE,
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const lines = (raw) =>
    raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 15);

  async function save(e) {
    e.preventDefault();
    setErrors({});
    setSaving(true);
    const payload = {
      title: values.title,
      categorySlug: values.categorySlug,
      price: Number(values.price) || 0,
      priceUnit: values.priceUnit,
      durationLabel: values.durationLabel || undefined,
      shortDescription: values.shortDescription,
      description: values.description,
      included: lines(values.included),
      requirements: lines(values.requirements),
    };
    try {
      const saved = initial
        ? await proApi.updateService(initial.id, payload)
        : await proApi.createService(payload);
      showToast(initial ? 'Service updated.' : 'Service created as draft.', 'success');
      onSaved(saved);
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      else showToast(err.message ?? 'Could not save the service.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={save} noValidate>
      <Field label="Service title" required error={errors.title}>
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

      <div className="grid-2" style={{ gap: 'var(--space-5)' }}>
        <Field label="Category" required error={errors.categorySlug}>
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
        <Field label="Price (₦)" required error={errors.price} hint="Minimum ₦1,000">
          {(props) => (
            <input
              {...props}
              className="input"
              type="number"
              min="1000"
              value={values.price}
              onChange={(e) => setValues((v) => ({ ...v, price: e.target.value }))}
            />
          )}
        </Field>
      </div>

      <div className="grid-2" style={{ gap: 'var(--space-5)' }}>
        <Field label="Price unit" error={errors.priceUnit}>
          {(props) => (
            <select
              {...props}
              className="select"
              value={values.priceUnit}
              onChange={(e) => setValues((v) => ({ ...v, priceUnit: e.target.value }))}
            >
              {['per project', 'per session', 'per day', 'per engagement', 'per video'].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Duration" error={errors.durationLabel} hint="e.g. 2–3 weeks">
          {(props) => (
            <input
              {...props}
              className="input"
              type="text"
              value={values.durationLabel}
              onChange={(e) => setValues((v) => ({ ...v, durationLabel: e.target.value }))}
            />
          )}
        </Field>
      </div>

      <Field
        label="Short description"
        required
        error={errors.shortDescription}
        hint="Shown on service cards (20–200 characters)."
      >
        {(props) => (
          <textarea
            {...props}
            className="textarea"
            rows={2}
            value={values.shortDescription}
            onChange={(e) => setValues((v) => ({ ...v, shortDescription: e.target.value }))}
          />
        )}
      </Field>

      <Field label="Full description" required error={errors.description} hint="At least 50 characters.">
        {(props) => (
          <textarea
            {...props}
            className="textarea"
            rows={6}
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          />
        )}
      </Field>

      <div className="grid-2" style={{ gap: 'var(--space-5)' }}>
        <Field label="What's included" error={errors.included} hint="One item per line.">
          {(props) => (
            <textarea
              {...props}
              className="textarea"
              rows={4}
              value={values.included}
              onChange={(e) => setValues((v) => ({ ...v, included: e.target.value }))}
            />
          )}
        </Field>
        <Field label="What you need from the customer" error={errors.requirements} hint="One item per line.">
          {(props) => (
            <textarea
              {...props}
              className="textarea"
              rows={4}
              value={values.requirements}
              onChange={(e) => setValues((v) => ({ ...v, requirements: e.target.value }))}
            />
          )}
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Draft'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ---------------- services tab ---------------- */

function ServicesTab({ categories }) {
  const showToast = useToast();
  const [services, setServices] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | service

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
      showToast(err.message ?? 'Action failed.', 'error');
    }
  }

  if (error) {
    return <ErrorState message="We couldn't load your services." onRetry={load} />;
  }
  if (!services) {
    return <Skeleton height="12rem" />;
  }

  if (editing) {
    return (
      <ServiceEditor
        categories={categories}
        initial={editing === 'new' ? null : editing}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {services.length} service{services.length === 1 ? '' : 's'} · drafts are only visible to you
        </p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          New Service
        </Button>
      </div>

      {services.length === 0 ? (
        <EmptyState
          title="No services yet"
          message="Create your first service listing — it stays a private draft until you publish it."
          action={
            <Button variant="secondary" onClick={() => setEditing('new')}>
              Create a Service
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
                  <span className="service-card__category">{s.categoryId}</span>
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
                <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>
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
  const showToast = useToast();
  const [values, setValues] = useState({
    title: profile.title ?? '',
    about: profile.about ?? '',
    locationCity: (profile.location ?? '').split(',')[0] ?? '',
    categorySlug: profile.categoryId ?? '',
    availability: profile.availability ?? 'available',
    skills: (profile.skills ?? []).join(', '),
  });
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
      });
      const skills = values.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 15);
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
        <Field label="Professional title" required error={errors.title}>
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

        <Field label="Skills" error={errors.skills} hint="Comma-separated, up to 15.">
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

export default function WorkspacePage() {
  useDocumentMeta({
    title: 'Professional Workspace',
    description: 'Manage your Servix professional profile and services.',
  });

  const { user, initializing, authAvailable } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('bookings');
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
        <Skeleton height="16rem" />
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
          {profile.name}
          {profile.verified && <VerifiedBadge />}
        </h1>
        <p className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
          {profile.title}
          {profile.location ? ` · ${profile.location}` : ''}
        </p>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Workspace sections" />

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

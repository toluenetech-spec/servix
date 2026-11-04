import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { Field } from '../components/ui/Field.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useDocumentMeta } from '../lib/useDocumentMeta.js';
import { submitContact } from '../lib/api.js';

const SUBJECTS = [
  'General enquiry',
  'Joining as a professional',
  'Partnership',
  'Report a problem',
  'Press',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Please enter your name.';
  if (!values.email.trim()) errors.email = 'Please enter your email address.';
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Please enter a valid email address.';
  if (!values.subject) errors.subject = 'Please choose a subject.';
  if (!values.message.trim()) errors.message = 'Please enter a message.';
  else if (values.message.trim().length < 20)
    errors.message = 'Please provide a little more detail (at least 20 characters).';
  return errors;
}

export default function ContactPage() {
  useDocumentMeta({
    title: 'Contact',
    description:
      'Contact the Servix team — general enquiries, professional onboarding, partnerships and support.',
  });

  const showToast = useToast();
  const [values, setValues] = useState({ name: '', email: '', subject: '', message: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function setValue(key, value) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      // Frontend-only for now — becomes POST /api/contact in the backend phase.
      await submitContact(values);
      setSent(true);
      showToast('Message recorded. Live delivery arrives with the platform launch.', 'success');
    } catch {
      showToast("We couldn't process your message. Please try again.", 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="container">
        <header className="page-hero">
          <span className="eyebrow">Contact</span>
          <h1>Talk to the Servix team</h1>
          <p className="page-hero__desc">
            Questions about the platform, joining as a professional, or anything
            else — we&rsquo;d like to hear from you.
          </p>
        </header>

        <div className="contact-grid">
          {sent ? (
            <div className="state-block" role="status">
              <div className="state-block__icon" style={{ color: 'var(--color-forest)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m8.5 12.5 2.5 2.5 5-5.5" />
                </svg>
              </div>
              <h3>Thanks, {values.name.split(' ')[0]}.</h3>
              <p>
                Your message has been validated and recorded in this preview.
                Message delivery goes live with the Servix backend — until then,
                nothing has been sent to a server.
              </p>
              <Button variant="secondary" onClick={() => { setSent(false); setValues({ name: '', email: '', subject: '', message: '' }); }}>
                Send another message
              </Button>
            </div>
          ) : (
            <form className="contact-form" onSubmit={onSubmit} noValidate>
              <Field label="Name" required error={errors.name}>
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="text"
                    autoComplete="name"
                    value={values.name}
                    onChange={(e) => setValue('name', e.target.value)}
                  />
                )}
              </Field>

              <Field label="Email" required error={errors.email}>
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={values.email}
                    onChange={(e) => setValue('email', e.target.value)}
                  />
                )}
              </Field>

              <Field label="Subject" required error={errors.subject}>
                {(props) => (
                  <select
                    {...props}
                    className="select"
                    value={values.subject}
                    onChange={(e) => setValue('subject', e.target.value)}
                  >
                    <option value="">Choose a subject…</option>
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                label="Message"
                required
                error={errors.message}
                hint="Tell us what you need — the more detail, the better."
              >
                {(props) => (
                  <textarea
                    {...props}
                    className="textarea"
                    rows={6}
                    value={values.message}
                    onChange={(e) => setValue('message', e.target.value)}
                  />
                )}
              </Field>

              <div>
                <Button type="submit" variant="primary" size="lg" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Message'}
                </Button>
              </div>
            </form>
          )}

          <aside className="contact-info" aria-label="Contact information">
            <div className="contact-info__item">
              <h3>Email</h3>
              <p>
                Official contact addresses will be published here at launch.
              </p>
            </div>
            <div className="contact-info__item">
              <h3>Support</h3>
              <p>
                We aim to respond to every enquiry within two business days.
                For common questions, check the FAQ first.
              </p>
            </div>
            <div className="contact-info__item">
              <h3>FAQ</h3>
              <p>
                <Link to="/how-it-works">Read frequently asked questions →</Link>
              </p>
            </div>
            <div className="contact-info__item">
              <h3>Professionals</h3>
              <p>
                Interested in joining? See{' '}
                <Link to="/professionals/join">how onboarding works →</Link>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

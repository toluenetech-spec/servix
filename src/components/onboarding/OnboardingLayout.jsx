import { Link } from 'react-router-dom';
import './onboarding.css';

/**
 * Full-width onboarding frame (Fiverr-style): brand top-left, Exit top-right,
 * centred content, sticky action bar at the bottom with progress + buttons.
 */
export function OnboardingLayout({ exitTo = '/dashboard', progress = 0, children, actions, wide = false }) {
  return (
    <div className="ob">
      <header className="ob-header">
        <Link to="/" className="ob-brand" aria-label="Servix home">servix<span>.</span></Link>
        <Link to={exitTo} className="ob-exit">Exit</Link>
      </header>
      <main id="main" className={`ob-main ${wide ? 'ob-main--wide' : ''}`}>{children}</main>
      {actions && (
        <footer className="ob-footer">
          <div className="ob-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Application progress">
            <span style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
          </div>
          <div className="ob-footer__row">{actions}</div>
        </footer>
      )}
    </div>
  );
}

export function Stepper({ steps, current }) {
  return (
    <ol className="ob-stepper" aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="ob-stepper__dot">{i < current ? '✓' : i + 1}</span>
          <span className="ob-stepper__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

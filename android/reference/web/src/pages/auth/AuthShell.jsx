import { Icon } from '../../components/ui/Icon.jsx';

/**
 * Shared two-panel shell for authentication pages.
 * Shared layout for live authentication and guided security checks.
 */
export function AuthShell({ children }) {
  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__card">{children}</div>
      </div>
      <div className="auth__side on-dark" aria-hidden="true">
        <div />
        <div>
          <blockquote>
            One place for professional services — discover, compare, book and
            get it done.
          </blockquote>
          <ul className="auth__side-points">
            <li>
              <Icon name="check" size={16} />
              Trusted professionals with verified profiles
            </li>
            <li>
              <Icon name="check" size={16} />
              Clear pricing and agreed scope on every booking
            </li>
            <li>
              <Icon name="check" size={16} />
              Everything managed from a single account
            </li>
          </ul>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-on-dark-muted)' }}>
          Your account. Your services. Protected at every step.
        </p>
      </div>
    </div>
  );
}

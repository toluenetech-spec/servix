import { Icon } from '../../components/ui/Icon.jsx';

/**
 * Shared two-panel shell for authentication pages.
 * NOTE: No authentication backend exists yet. Forms validate on the
 * frontend and clearly state that account features arrive at launch.
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
          Accounts activate with the Servix platform launch.
        </p>
      </div>
    </div>
  );
}

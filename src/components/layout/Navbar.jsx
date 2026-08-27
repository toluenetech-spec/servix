import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Logo } from '../brand/Logo.jsx';
import { Button } from '../ui/Button.jsx';
import { Icon } from '../ui/Icon.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';

const NAV_LINKS = [
  { to: '/services', label: 'Services' },
  { to: '/professionals', label: 'Professionals' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/professionals/join', label: 'For Professionals' },
  { to: '/pricing', label: 'Pricing' },
];

/* Must mirror the desktop breakpoint in layout.css (max-width: 900px). */
const DESKTOP_NAV_QUERY = '(min-width: 901px)';

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const location = useLocation();
  const { user, logout } = useAuth();

  async function onSignOut() {
    try {
      await logout();
    } catch {
      /* session already gone */
    }
  }

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Lock scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  // Move focus into the panel when the menu opens.
  useEffect(() => {
    if (menuOpen) panelRef.current?.focus();
  }, [menuOpen]);

  // Close on Escape and return focus to the toggle button.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // Close the menu if the viewport grows into the desktop layout.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const media = window.matchMedia(DESKTOP_NAV_QUERY);
    const onChange = (e) => {
      if (e.matches) setMenuOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [menuOpen]);

  return (
    <header className="navbar">
      <div className="container navbar__inner">
        <Link to="/" className="navbar__brand" aria-label="Servix home">
          <Logo height={28} />
        </Link>

        <nav aria-label="Main navigation">
          <ul className="navbar__links">
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.to === '/professionals'}
                  className="navbar__link"
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="navbar__actions">
          {user ? (
            <>
              {user.role === 'professional' ? (
                <Button variant="ghost" to="/pro">
                  Workspace
                </Button>
              ) : (
                <Button variant="ghost" to="/bookings">
                  My Bookings
                </Button>
              )}
              <span className="navbar__user" title={user.email}>
                {user.fullName.split(' ')[0]}
              </span>
              <Button variant="ghost" onClick={onSignOut}>
                Sign Out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" to="/login">
                Sign In
              </Button>
              <Button variant="primary" to="/register">
                Get Started
              </Button>
            </>
          )}
          <button
            ref={toggleRef}
            className="navbar__toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      {menuOpen &&
        /* Portaled to <body>: the navbar's backdrop-filter creates a
           containing block that would otherwise clip this fixed panel
           to the navbar's height. */
        createPortal(
          <nav
            ref={panelRef}
            className="mobile-nav"
            id="mobile-nav"
            aria-label="Mobile navigation"
            tabIndex={-1}
          >
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/professionals'}
                className="mobile-nav__link"
              >
                {link.label}
                <Icon name="chevron-right" size={18} />
              </NavLink>
            ))}
            <div className="mobile-nav__actions">
              {user ? (
                <>
                  {user.role === 'professional' ? (
                    <Button variant="primary" to="/pro" block>
                      Workspace
                    </Button>
                  ) : (
                    <Button variant="primary" to="/bookings" block>
                      My Bookings
                    </Button>
                  )}
                  <Button variant="secondary" block onClick={onSignOut}>
                    Sign Out ({user.fullName.split(' ')[0]})
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" to="/login" block>
                    Sign In
                  </Button>
                  <Button variant="primary" to="/register" block>
                    Get Started
                  </Button>
                </>
              )}
            </div>
          </nav>,
          document.body
        )}
    </header>
  );
}
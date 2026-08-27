import { Link } from 'react-router-dom';
import { Logo } from '../brand/Logo.jsx';

const COLUMNS = [
  {
    heading: 'Platform',
    links: [
      { to: '/services', label: 'Services' },
      { to: '/professionals', label: 'Professionals' },
      { to: '/how-it-works', label: 'How It Works' },
      { to: '/pricing', label: 'Pricing' },
    ],
  },
  {
    heading: 'Professionals',
    links: [
      { to: '/professionals/join', label: 'Become a Professional' },
      { to: '/how-it-works', label: 'Resources' },
      { to: '/contact', label: 'Help' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/contact', label: 'Contact' },
      { to: '/about', label: 'Careers' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { to: '/privacy', label: 'Privacy' },
      { to: '/terms', label: 'Terms' },
    ],
  },
];

/* Placeholder social icons — real accounts to be added when created. */
function SocialIcon({ label, path }) {
  return (
    <a href="#" aria-label={`${label} (coming soon)`} onClick={(e) => e.preventDefault()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    </a>
  );
}

export function Footer() {
  return (
    <footer className="footer on-dark">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__about">
            <Logo onDark height={26} />
            <p>
              Servix connects customers with trusted professional service
              providers — discover services, compare professionals, and manage
              bookings in one place.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="footer__heading">{col.heading}</h2>
              <ul className="footer__list">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="footer__bottom">
          <span>© {new Date().getFullYear()} Servix. All rights reserved.</span>
          <div className="footer__social">
            <SocialIcon
              label="X"
              path="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L2.8 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.1 3.7H5.3L17.8 20Z"
            />
            <SocialIcon
              label="LinkedIn"
              path="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.2V9h3.4v1.6h.1c.5-.9 1.7-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3ZM5.3 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1Zm1.8 13.1H3.5V9h3.6v11.5Z"
            />
            <SocialIcon
              label="Instagram"
              path="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.9-.1Zm0 1.8c-3.1 0-3.5 0-4.8.1-1.1 0-1.7.2-2.1.4-.5.2-.9.4-1.2.8-.4.4-.6.7-.8 1.2-.2.4-.3 1-.4 2.1-.1 1.3-.1 1.6-.1 4.8s0 3.5.1 4.8c0 1.1.2 1.7.4 2.1.2.5.4.9.8 1.2.4.4.7.6 1.2.8.4.2 1 .3 2.1.4 1.3.1 1.6.1 4.8.1s3.5 0 4.8-.1c1.1 0 1.7-.2 2.1-.4.5-.2.9-.4 1.2-.8.4-.4.6-.7.8-1.2.2-.4.3-1 .4-2.1.1-1.3.1-1.6.1-4.8s0-3.5-.1-4.8c0-1.1-.2-1.7-.4-2.1a2 2 0 0 0-.8-1.2 2 2 0 0 0-1.2-.8c-.4-.2-1-.3-2.1-.4-1.3-.1-1.6-.1-4.8-.1Zm0 3.1a5 5 0 1 1 0 9.9 5 5 0 0 1 0-9.9Zm0 8.1a3.2 3.2 0 1 0 0-6.3 3.2 3.2 0 0 0 0 6.3Zm6.3-8.3a1.2 1.2 0 1 1-2.3 0 1.2 1.2 0 0 1 2.3 0Z"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}

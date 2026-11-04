export const SITE_ORIGIN = 'https://www.servix.name.ng';
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/brand/servix-social.png`;
export const SOCIAL_ALT = 'Servix — Professional services, simplified. Discover. Compare. Book.';
export const DEFAULT_DESCRIPTION = 'Discover professional services, compare providers and manage bookings in one place with Servix.';
export const PUBLIC_ROUTES = {
  '/': 'Professional Services, Simplified', '/services': 'Explore Services', '/professionals': 'Find Professionals',
  '/professionals/join': 'Become a Professional', '/how-it-works': 'How Servix Works', '/pricing': 'Pricing',
  '/about': 'About Servix', '/contact': 'Contact Servix', '/privacy': 'Privacy Policy', '/terms': 'Terms of Service', '/cookies': 'Cookie Policy',
  '/login': 'Sign In', '/register': 'Create Account', '/forgot-password': 'Password Recovery',
};
export function safeCanonical(pathname) {
  // Never put tokens, booking IDs, private URLs or arbitrary user input in share metadata.
  const path = pathname.split(/[?#]/)[0];
  return SITE_ORIGIN + (Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, path) ? path : '/');
}

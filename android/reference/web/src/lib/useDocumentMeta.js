import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { safeCanonical, SOCIAL_IMAGE, SOCIAL_ALT, DEFAULT_DESCRIPTION } from '../content/social.js';

const SITE_NAME = 'Servix';

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Per-route SEO metadata: document title, meta description and
 * Open Graph tags. Each public page calls this with unique values.
 */
export function useDocumentMeta({ title, description }) {
  const { pathname } = useLocation();
  useEffect(() => {
    description = description || DEFAULT_DESCRIPTION;
    const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Professional Services, Simplified`;
    document.title = fullTitle;
    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
    }
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:image', SOCIAL_IMAGE);
    setMeta('property', 'og:image:alt', SOCIAL_ALT);
    setMeta('property', 'og:url', safeCanonical(pathname));
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', SOCIAL_IMAGE);
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = safeCanonical(pathname);
  }, [title, description, pathname]);
}

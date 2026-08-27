/**
 * SERVIX LOGO
 * ------------------------------------------------------------------
 * Renders the official brand asset from /public/brand/.
 *
 *   /brand/servix-logo.svg        — primary logo (light backgrounds)
 *   /brand/servix-logo-dark.svg   — inverted logo (dark backgrounds)
 *   /brand/favicon.svg            — app icon
 *
 * NOTE: The files currently in /public/brand are TEMPORARY stand-ins
 * generated to keep the layout functional. When the official uploaded
 * logo is added, replace those files 1:1 (same names) — no code
 * changes are required. Never restyle or distort the asset here:
 * this component only controls sizing via height.
 */
export function Logo({ onDark = false, height = 28, className }) {
  const src = onDark ? '/brand/servix-logo-dark.svg' : '/brand/servix-logo.svg';
  return (
    <img
      src={src}
      alt="Servix"
      style={{ height, width: 'auto', display: 'block' }}
      className={className}
    />
  );
}

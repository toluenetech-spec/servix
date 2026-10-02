/**
 * Account/profile avatar: shows the uploaded photo when there is one,
 * otherwise the person's initial. Same look everywhere (sidebar, top bar,
 * settings, onboarding preview).
 */
export function Avatar({ src, name = '', size = 36, className = '', ...rest }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (src) {
    return <img className={`ws-avatar ws-avatar--photo ${className}`.trim()} src={src} alt={name ? `Photo of ${name}` : 'Profile photo'} width={size} height={size} style={style} {...rest} />;
  }
  return <span className={`ws-avatar ${className}`.trim()} aria-hidden={name ? undefined : 'true'} style={style} {...rest}>{initial}</span>;
}

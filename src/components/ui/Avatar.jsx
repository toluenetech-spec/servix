import { useEffect, useState } from 'react';

/**
 * Account/profile avatar: shows the uploaded photo when there is one,
 * otherwise the person's initial. Same look everywhere (sidebar, top bar,
 * settings, onboarding preview). If the photo URL cannot be loaded the
 * initial is shown instead of a broken-image icon; onLoadError lets the
 * caller surface that honestly (e.g. the photo uploader).
 */
export function Avatar({ src, name = '', size = 36, className = '', onLoadError, ...rest }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const [failedSrc, setFailedSrc] = useState(null);
  useEffect(() => { setFailedSrc(null); }, [src]);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (src && failedSrc !== src) {
    return (
      <img
        className={`ws-avatar ws-avatar--photo ${className}`.trim()}
        src={src}
        alt={name ? `Photo of ${name}` : 'Profile photo'}
        width={size}
        height={size}
        style={style}
        onError={() => { setFailedSrc(src); onLoadError?.(src); }}
        {...rest}
      />
    );
  }
  return <span className={`ws-avatar ${className}`.trim()} aria-hidden={name ? undefined : 'true'} style={style} {...rest}>{initial}</span>;
}

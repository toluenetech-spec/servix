import { Link } from 'react-router-dom';

/**
 * Button — supports rendering as <button>, <Link to> or <a href>.
 * Variants: primary | secondary | ghost | on-dark | outline-dark
 * Sizes: sm | md (default) | lg
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  to,
  href,
  children,
  className = '',
  ...rest
}) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (to) {
    return (
      <Link to={to} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

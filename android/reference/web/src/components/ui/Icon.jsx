/**
 * Minimal inline icon set (stroke-based, 24px grid).
 * Icons are decorative by default (aria-hidden); pass a `label`
 * for semantically meaningful usage.
 */
const paths = {
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17Z"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z"/>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></>,
  'thumbs-up': <path d="M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17 20H7"/>,
  'thumbs-down': <path d="M17 13V4h3v9h-3Zm0 0-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1-6A2 2 0 0 1 7 4h10"/>,
  'bar-chart': <path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>,
  megaphone: <><path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6m2.5-9a8 8 0 0 1 0 12"/></>,
  crown: <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z"/>,
  'calendar-check': <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4m-7 7 2 2 4-4"/></>,
  'trending-up': <path d="M3 17 9 11l4 4 8-8m0 0h-5m5 0v5"/>,
  inbox: <><path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
  'help-circle': <><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1"/></>,
  'credit-card': <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 15h4"/></>,
  'settings': <><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,
  'layers': <path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>,
  'grid': <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  search: <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35" />,
  'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  star: (
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m8.5 12.5 2.5 2.5 5-5.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2 4 5.5V11c0 5 3.4 9.4 8 10.8 4.6-1.4 8-5.8 8-10.8V5.5L12 2Z" />
      <path d="m8.8 11.8 2.3 2.3 4.2-4.6" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" />,
  layout: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  pen: (
    <path d="m12 19 7-7 3 3-7 7-3-3Zm6-6L15 10l-9.5 9.5L4 21l1.5-1.5L15 10Zm-3-3 3-3 3 3-3 3-3-3ZM2 22l4-1-3-3-1 4Z" />
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.4c2.4.7 4 2.7 4 5.6" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.5 17.5 0 0 1-2.7 3.7M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.4M3 3l18 18" />
      <path d="M10 10a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10m-7 6h4" />,
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18M16 15h2" />
    </>
  ),
  grow: <path d="M4 20h16M6 20V9m6 11V4m6 16v-8" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6m0 4h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 17v-6m0-4h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  heart: (
    <path d="M12 20.5s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9.5c0 6.1-8 11-8 11Z" />
  ),
  sparkle: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1M8.4 15.6l-2.1 2.1" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  upload: <path d="M12 16V4m0 0 -4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  trash: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  video: <path d="M15 10l5-3v10l-5-3M3 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  image: <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />,
};

export function Icon({ name, size = 20, strokeWidth = 1.75, label, className }) {
  const content = paths[name];
  if (!content) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={className}
      focusable="false"
    >
      {content}
    </svg>
  );
}

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

/** Bottom-sheet drawer used for mobile filters. */
export function Drawer({ open, onClose, title, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    ref.current?.querySelector('button, [href], input, select')?.focus();

    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="drawer__head">
          <h2 className="drawer__title">{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close filters">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

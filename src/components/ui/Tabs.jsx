import { useId, useRef } from 'react';

/** Accessible tabs with arrow-key navigation. */
export function Tabs({ tabs, active, onChange, label = 'Sections' }) {
  const id = useId();
  const listRef = useRef(null);

  function onKeyDown(e) {
    const idx = tabs.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
    if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (e.key === 'Home') next = tabs[0];
    if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      onChange(next.id);
      listRef.current
        ?.querySelector(`[data-tab-id="${next.id}"]`)
        ?.focus();
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-tab-id={tab.id}
          id={`${id}-tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`${id}-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          className="tabs__tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

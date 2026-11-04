import { useId, useState } from 'react';
import { Icon } from './Icon.jsx';

/** FAQ accordion. items: [{ q, a }] */
export function Accordion({ items }) {
  const id = useId();
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="accordion">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div className="accordion__item" key={item.q}>
            <h3 style={{ fontSize: 'inherit', fontWeight: 'inherit' }}>
              <button
                className="accordion__trigger"
                aria-expanded={open}
                aria-controls={`${id}-panel-${i}`}
                id={`${id}-trigger-${i}`}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                {item.q}
                <Icon name="chevron-down" size={18} className="accordion__chevron" />
              </button>
            </h3>
            {open && (
              <div
                className="accordion__panel"
                id={`${id}-panel-${i}`}
                role="region"
                aria-labelledby={`${id}-trigger-${i}`}
              >
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

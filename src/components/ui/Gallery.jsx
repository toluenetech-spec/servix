import { useState } from 'react';

/** Image gallery with thumbnail selection. */
export function Gallery({ images, alt }) {
  const [index, setIndex] = useState(0);
  const list = images?.length ? images : [];

  if (!list.length) return null;

  return (
    <div className="gallery">
      <div className="gallery__main">
        <img src={list[index]} alt={`${alt} — image ${index + 1} of ${list.length}`} />
      </div>
      {list.length > 1 && (
        <div className="gallery__thumbs" role="group" aria-label="Gallery thumbnails">
          {list.map((src, i) => (
            <button
              key={src + i}
              className="gallery__thumb"
              aria-current={i === index}
              aria-label={`Show image ${i + 1}`}
              onClick={() => setIndex(i)}
            >
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
